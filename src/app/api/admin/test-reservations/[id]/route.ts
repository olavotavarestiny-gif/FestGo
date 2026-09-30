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
import { createWiPayPayment, ensureWiPaySignatureToken, WiPayError, wipayCallbackUrl } from "@/lib/integrations/wipay";
import { publicBaseUrl } from "@/lib/config";
import {
  createEkwanzaCharge,
  createEkwanzaTicket,
  EkwanzaError,
} from "@/lib/integrations/ekwanza";
import {
  jsonObject,
  reconcileEkwanzaTestPayment,
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
    provider: z
      .enum(["paygo", "wipay", "ekwanza", "ekwanza-ticket"])
      .optional(),
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
    qrCode: typeof details.qrCode === "string" ? details.qrCode : null,
    expirationDate:
      typeof details.expirationDate === "string"
        ? details.expirationDate
        : null,
    diagnosticCode:
      typeof details.diagnosticCode === "string" ? details.diagnosticCode : null,
    diagnosticDetail:
      typeof details.diagnosticDetail === "string"
        ? details.diagnosticDetail
        : null,
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
      const result =
        ["ekwanza", "ekwanza-ticket"].includes(reservation.payment.provider)
          ? await reconcileEkwanzaTestPayment(reservation.payment.id)
          : reservation.payment.providerPaymentId
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
  const selectedProvider =
    parsed.data.provider ??
    (process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo");
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
          productId:
            selectedProvider === "wipay"
              ? "wipay-sandbox"
              : selectedProvider === "ekwanza-ticket"
                ? "ekwanza-ticket"
                : selectedProvider === "ekwanza"
                  ? "ekwanza-gpo"
                  : TEST_PRODUCT_ID,
          method:
            selectedProvider === "wipay"
              ? "hosted"
              : selectedProvider === "ekwanza-ticket"
                ? "ticket"
                : selectedProvider === "ekwanza"
                  ? parsed.data.method === "multicaixa"
                    ? "gpo"
                    : "reference"
                  : parsed.data.method,
          provider: selectedProvider,
          providerPaymentId: null,
          providerDetails: {},
        },
      })
    : await prisma.testPayment.create({
        data: {
          testReservationId: reservation.id,
          idempotencyKey: `festgo-test-${reservation.reference}-${crypto.randomUUID()}`,
          productId:
            selectedProvider === "wipay"
              ? "wipay-sandbox"
              : selectedProvider === "ekwanza-ticket"
                ? "ekwanza-ticket"
                : selectedProvider === "ekwanza"
                  ? "ekwanza-gpo"
                  : TEST_PRODUCT_ID,
          provider: selectedProvider,
          method:
            selectedProvider === "wipay"
              ? "hosted"
              : selectedProvider === "ekwanza-ticket"
                ? "ticket"
                : selectedProvider === "ekwanza"
                  ? parsed.data.method === "multicaixa"
                    ? "gpo"
                    : "reference"
                  : parsed.data.method,
          amount: TEST_AMOUNT,
          currency: TEST_CURRENCY,
        },
      });
  try {
    if (selectedProvider === "wipay") {
      const appUrl = new URL(publicBaseUrl());
      if (
        appUrl.protocol !== "https:"
      )
        return NextResponse.json(
          { error: "Os dominios seguros da WiPay nao estao configurados." },
          { status: 503 },
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
      await ensureWiPaySignatureToken();
      const remote = await createWiPayPayment({
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        customerPhone: reservation.customerPhone.replace(/^\+244/, ""),
        referenceId,
        successUrl: returnUrl.toString(),
        failureUrl: failureUrl.toString(),
        callbackUrl: wipayCallbackUrl(appUrl.origin, true),
      });
      const details = { referenceId, paymentUrl: remote.checkoutUrl };
      await prisma.$transaction([
        prisma.testPayment.updateMany({
          where: { id: payment.id, status: { in: ["CREATED", "PENDING", "UNKNOWN"] } },
          data: {
            providerPaymentId: remote.paymentId,
            providerDetails: details,
            rawStatus: "checkout_created",
            status: "PENDING",
          },
        }),
        prisma.testReservation.updateMany({
          where: { id: reservation.id, status: { notIn: ["PAID", "REJECTED"] } },
          data: { status: "AWAITING_PAYMENT" },
        }),
      ]);
      const current = await prisma.testPayment.findUniqueOrThrow({ where: { id: payment.id } });
      return NextResponse.json({
        ok: true,
        provider: selectedProvider,
        paymentId: remote.paymentId,
        status: current.status,
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        ...details,
      });
    }
    if (selectedProvider === "ekwanza-ticket") {
      const referenceCode = `festgo_test_${reservation.reference.replace(/[^A-Za-z0-9_-]/g, "_")}_${crypto.randomUUID()}`;
      await prisma.testPayment.update({
        where: { id: payment.id },
        data: { providerDetails: { referenceCode } },
      });
      const remote = await createEkwanzaTicket({
        amount: TEST_AMOUNT,
        referenceCode,
        mobileNumber: reservation.customerPhone,
      });
      storedProviderPaymentId = remote.code;
      const details = {
        referenceCode,
        qrCode: remote.qrCode,
        expirationDate: remote.expirationDate,
      };
      await prisma.$transaction([
        prisma.testPayment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: remote.code,
            providerDetails: details,
            rawStatus: String(remote.status),
            status: "PENDING",
          },
        }),
        prisma.testReservation.update({
          where: { id: reservation.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "EKWANZA_TICKET_TEST_CREATED",
            entityType: "TestReservation",
            entityId: reservation.id,
            metadata: {
              ticketCode: remote.code,
              amount: TEST_AMOUNT,
              referenceCode,
            },
            ipAddress: clientIp(request),
          },
        }),
      ]);
      return NextResponse.json({
        ok: true,
        provider: selectedProvider,
        paymentId: remote.code,
        status: "PENDING",
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        qrCode: remote.qrCode,
        expirationDate: remote.expirationDate,
      });
    }
    if (selectedProvider === "ekwanza") {
      const merchantTransactionId = `TG${Date.now().toString(36).slice(-7).toUpperCase()}${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`.slice(0, 15);
      await prisma.testPayment.update({
        where: { id: payment.id },
        data: { providerDetails: { merchantTransactionId } },
      });
      const remote = await createEkwanzaCharge({
        amount: TEST_AMOUNT,
        merchantTransactionId,
        method: parsed.data.method === "multicaixa" ? "gpo" : "reference",
        phoneNumber: reservation.customerPhone,
      });
      storedProviderPaymentId = remote.id;
      const details = {
        merchantTransactionId,
        paymentUrl: remote.paymentUrl,
        reference: remote.reference,
        responseKeys: remote.responseKeys,
      };
      await prisma.$transaction([
        prisma.testPayment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: remote.id,
            providerDetails: details,
            rawStatus: remote.status,
            status: "PENDING",
          },
        }),
        prisma.testReservation.update({
          where: { id: reservation.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "EKWANZA_TEST_PAYMENT_CREATED",
            entityType: "TestReservation",
            entityId: reservation.id,
            metadata: {
              merchantTransactionId,
              amount: TEST_AMOUNT,
              method:
                parsed.data.method === "multicaixa" ? "gpo" : "reference",
            },
            ipAddress: clientIp(request),
          },
        }),
      ]);
      return NextResponse.json({
        ok: true,
        provider: selectedProvider,
        paymentId: merchantTransactionId,
        status: "PENDING",
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        paymentUrl: remote.paymentUrl,
        reference: remote.reference,
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
      provider: selectedProvider,
      paymentId: remote.payment_id,
      status: verified.status,
      amount: TEST_AMOUNT,
      currency: TEST_CURRENCY,
      ...details,
    });
  } catch (error) {
    const providerError = error instanceof PaymentsApiError ? error : null;
    const wipayError = error instanceof WiPayError ? error : null;
    const ekwanzaError = error instanceof EkwanzaError ? error : null;
    const diagnosticCode =
      providerError?.diagnosticCode ??
      wipayError?.code ??
      ekwanzaError?.code ??
      (error instanceof DOMException && error.name === "TimeoutError"
        ? "WIPAY_TIMEOUT"
        : "UNEXPECTED_ERROR");
    const diagnosticDetail = wipayError?.detail ?? null;
    const knownFailure =
      (Boolean(providerError?.status) && (providerError?.status ?? 500) < 500) ||
      (Boolean(wipayError?.status) && (wipayError?.status ?? 500) < 500) ||
      (Boolean(ekwanzaError?.status) &&
        (ekwanzaError?.status ?? 500) < 500);
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
            providerStatus:
              providerError?.status ??
              wipayError?.status ??
              ekwanzaError?.status ??
              null,
          },
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json(
      {
        error:
          providerError || wipayError || ekwanzaError
            ? `${(providerError ?? wipayError ?? ekwanzaError)!.message}${diagnosticDetail ? ` Host: ${diagnosticDetail}` : ""}`
            : "Não foi possível iniciar o pagamento de teste.",
        diagnosticCode,
        diagnosticDetail,
      },
      { status: knownFailure ? 502 : 202 },
    );
  }
}
