import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createPayment,
  paymentPageUrl,
  PaymentsApiError,
} from "@/lib/integrations/payments-api";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { createWiPayPayment, WiPayError } from "@/lib/integrations/wipay";
import {
  jsonObject,
  reconcileTestPayment,
  recoverTestPayment,
  TEST_AMOUNT,
  TEST_CURRENCY,
  TEST_PRODUCT_ID,
} from "@/lib/test-payments";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("START_PAYMENT"),
    method: z.enum(["multicaixa", "reference"]),
    confirmation: z.literal(true),
  }),
  z.object({ action: z.literal("RECONCILE") }),
]);

function resultFrom(payment: {
  providerPaymentId: string | null;
  status: string;
  rawStatus: string | null;
  providerDetails: unknown;
}) {
  const details = jsonObject(payment.providerDetails);
  return {
    paymentId: payment.providerPaymentId,
    status: payment.rawStatus ?? payment.status,
    amount: TEST_AMOUNT,
    currency: TEST_CURRENCY,
    paymentUrl:
      typeof details.paymentUrl === "string" ? details.paymentUrl : null,
    reference: details.reference ?? null,
    instructions:
      typeof details.instructions === "string" ? details.instructions : null,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
  const { id } = await context.params;
  const reservation = await prisma.testReservation.findUnique({
    where: { id },
    include: { payment: true, ticket: true },
  });
  if (!reservation)
    return NextResponse.json(
      { error: "Reserva de teste não encontrada." },
      { status: 404 },
    );

  if (parsed.data.action === "RECONCILE") {
    if (!reservation.payment)
      return NextResponse.json(
        { error: "Ainda não existe uma transacção para consultar." },
        { status: 409 },
      );
    try {
      await enforceRateLimit({
        namespace: "admin-test-payment-reconcile",
        identifier: `${user.id}:${id}`,
        limit: 360,
        windowMs: 60 * 60_000,
      });
      if (reservation.payment.provider === "wipay")
        return NextResponse.json({
          ok: true,
          ...resultFrom(reservation.payment),
        });
      const result = reservation.payment.providerPaymentId
        ? await reconcileTestPayment(reservation.payment.id)
        : await recoverTestPayment(reservation.payment.id);
      if (!result)
        return NextResponse.json(
          { ok: false, status: "UNKNOWN", pending: true },
          { status: 202 },
        );
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "INTEGRATED_TEST_PAYMENT_RECONCILED",
          entityType: "TestReservation",
          entityId: id,
          metadata: { status: result.status },
          ipAddress: clientIp(request),
        },
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof PaymentsApiError
              ? error.message
              : "Não foi possível reconciliar o teste.",
        },
        { status: 502 },
      );
    }
  }

  if (reservation.status === "PAID")
    return NextResponse.json(
      { error: "Este teste já está pago." },
      { status: 409 },
    );
  if (
    reservation.payment &&
    ["CREATED", "PENDING", "UNKNOWN"].includes(reservation.payment.status)
  )
    return NextResponse.json({
      ok: true,
      existing: true,
      ...resultFrom(reservation.payment),
    });
  let storedProviderPaymentId: string | null = null;
  try {
    await enforceRateLimit({
      namespace: "admin-integrated-test-payment",
      identifier: `${user.id}:${id}`,
      limit: 2,
      windowMs: 60 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Limite de tentativas atingido." },
      { status: 429 },
    );
  }

  const payment = reservation.payment
    ? await prisma.testPayment.update({
        where: { id: reservation.payment.id },
        data: {
          status: "CREATED",
          rawStatus: null,
          idempotencyKey: `festgo-test-${reservation.reference}-${crypto.randomUUID()}`,
          method: process.env.PAYMENTS_PROVIDER === "wipay" ? "hosted" : parsed.data.method,
          provider: process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo",
        },
      })
    : await prisma.testPayment.create({
        data: {
          testReservationId: reservation.id,
          idempotencyKey: `festgo-test-${reservation.reference}-${crypto.randomUUID()}`,
          productId: process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay-sandbox" : TEST_PRODUCT_ID,
          provider: process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo",
          method: process.env.PAYMENTS_PROVIDER === "wipay" ? "hosted" : parsed.data.method,
          amount: TEST_AMOUNT,
          currency: TEST_CURRENCY,
        },
      });
  try {
    if (process.env.PAYMENTS_PROVIDER === "wipay") {
      const appUrl = new URL(
        process.env.WIPAY_APP_URL ?? process.env.APP_URL ?? "https://festgo.mazanga.digital",
      );
      const referenceId = `festgo_test_${reservation.reference}_${crypto.randomUUID()}`;
      await prisma.testPayment.update({
        where: { id: payment.id },
        data: { providerDetails: { referenceId } },
      });
      const returnUrl = new URL(
        `/admin/teste-gateway/reserva/${reservation.accessToken}`,
        appUrl,
      );
      const failureUrl = new URL(returnUrl);
      failureUrl.searchParams.set("cancelled", "1");
      const remote = await createWiPayPayment({
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        customerPhone: reservation.customerPhone.replace(/^\+244/, ""),
        referenceId,
        successUrl: returnUrl.toString(),
        failureUrl: failureUrl.toString(),
        callbackUrl: new URL("/api/webhooks/wipay-test", appUrl).toString(),
      });
      const details = { referenceId, paymentUrl: remote.checkoutUrl };
      await prisma.$transaction([
        prisma.testPayment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: remote.paymentId,
            providerDetails: details,
            rawStatus: "checkout_created",
            status: "PENDING",
          },
        }),
        prisma.testReservation.update({
          where: { id: reservation.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
      ]);
      return NextResponse.json({
        ok: true,
        paymentId: remote.paymentId,
        status: "PENDING",
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        ...details,
      });
    }
    const remote = await createPayment({
      productId: TEST_PRODUCT_ID,
      quantity: 1,
      method: parsed.data.method,
      customer: {
        name: reservation.passengerName,
        email: reservation.customerEmail,
        phone: reservation.customerPhone,
      },
    });
    storedProviderPaymentId = remote.payment_id;
    const details = {
      paymentUrl: paymentPageUrl(remote),
      reference: remote.reference ?? null,
      instructions: remote.instructions ?? remote.message ?? null,
      statusCheckUrl: remote.status_check_url ?? null,
      responseSource: remote.diagnostics.source,
      responseKeys: remote.diagnostics.responseKeys,
    };
    // Persistir o identificador antes de qualquer validação ou redireccionamento.
    await prisma.testPayment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: remote.payment_id,
        providerDetails: details,
        rawStatus: remote.status,
        status: "UNKNOWN",
      },
    });
    const verified = await reconcileTestPayment(payment.id);
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "INTEGRATED_TEST_PAYMENT_CREATED",
        entityType: "TestReservation",
        entityId: reservation.id,
        metadata: {
          providerPaymentId: remote.payment_id,
          amount: TEST_AMOUNT,
          productId: TEST_PRODUCT_ID,
          verifiedStatus: verified.status,
          responseSource: remote.diagnostics.source,
        },
        ipAddress: clientIp(request),
      },
    });
    return NextResponse.json({
      ok: true,
      paymentId: remote.payment_id,
      status: verified.status,
      amount: TEST_AMOUNT,
      currency: TEST_CURRENCY,
      ...details,
    });
  } catch (error) {
    const providerError = error instanceof PaymentsApiError ? error : null;
    const wipayError = error instanceof WiPayError ? error : null;
    const diagnosticCode =
      providerError?.diagnosticCode ??
      wipayError?.code ??
      (error instanceof DOMException && error.name === "TimeoutError"
        ? "WIPAY_TIMEOUT"
        : "UNEXPECTED_ERROR");
    const diagnosticDetail = wipayError?.detail ?? null;
    const knownFailure =
      (Boolean(providerError?.status) && (providerError?.status ?? 500) < 500) ||
      (Boolean(wipayError?.status) && (wipayError?.status ?? 500) < 500);
    await prisma.$transaction([
      prisma.testPayment.update({
        where: { id: payment.id },
        data: {
          status:
            !storedProviderPaymentId && knownFailure ? "FAILED" : "UNKNOWN",
          rawStatus:
            !storedProviderPaymentId
              ? diagnosticCode
              : "UNKNOWN",
          providerDetails: {
            ...jsonObject(payment.providerDetails),
            diagnosticCode,
            diagnosticDetail,
          },
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "INTEGRATED_TEST_PAYMENT_CREATE_FAILED",
          entityType: "TestReservation",
          entityId: reservation.id,
          metadata: {
            providerPaymentId: storedProviderPaymentId,
            diagnosticCode,
            diagnosticDetail,
            providerStatus: providerError?.status ?? wipayError?.status ?? null,
          },
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json(
      {
        error:
          providerError || wipayError
            ? `${(providerError ?? wipayError)!.message}${diagnosticDetail ? ` Host: ${diagnosticDetail}` : ""}`
            : "Não foi possível iniciar o pagamento de teste.",
        diagnosticCode,
        diagnosticDetail,
      },
      { status: knownFailure ? 502 : 202 },
    );
  }
}
