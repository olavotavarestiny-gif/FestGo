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
          method: parsed.data.method,
        },
      })
    : await prisma.testPayment.create({
        data: {
          testReservationId: reservation.id,
          idempotencyKey: `festgo-test-${reservation.reference}-${crypto.randomUUID()}`,
          productId: TEST_PRODUCT_ID,
          method: parsed.data.method,
          amount: TEST_AMOUNT,
          currency: TEST_CURRENCY,
        },
      });
  try {
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
    const knownFailure =
      Boolean(providerError?.status) && (providerError?.status ?? 500) < 500;
    await prisma.$transaction([
      prisma.testPayment.update({
        where: { id: payment.id },
        data: {
          status:
            !storedProviderPaymentId && knownFailure ? "FAILED" : "UNKNOWN",
          rawStatus:
            !storedProviderPaymentId && knownFailure
              ? `HTTP_${providerError?.status}`
              : "UNKNOWN",
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
            diagnosticCode: providerError?.diagnosticCode ?? "UNEXPECTED_ERROR",
            providerStatus: providerError?.status ?? null,
          },
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json(
      {
        error:
          providerError
            ? providerError.message
            : "Não foi possível iniciar o pagamento de teste.",
      },
      { status: knownFailure ? 502 : 202 },
    );
  }
}
