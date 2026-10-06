import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPayment, normalizeProductId, paymentMethodMatches, paymentPageUrl, paymentProductMatches, PaymentsApiError } from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";
import { verifyReservationToken } from "@/lib/reservation-access";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { createWiPayPayment, ensureWiPaySignatureToken, WiPayError, wipayCallbackUrl } from "@/lib/integrations/wipay";
import { createEkwanzaCharge, EkwanzaError } from "@/lib/integrations/ekwanza";
import { availablePaymentProviders, defaultPaymentProvider, publicPaymentDetails } from "@/lib/payment-providers";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { publicBaseUrl } from "@/lib/config";
import { isPrivateWiPayProbe } from "@/lib/private-wipay-probe";

export const runtime = "nodejs";
const schema = z.object({
  reservationId: z.string().min(8).max(40),
  accessToken: z.string().min(32).max(100),
  method: z.literal("multicaixa"),
  provider: z.enum(["wipay", "paygo", "ekwanza"]).optional(),
});
const livePaymentStatuses = ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED", "REFUND_PENDING", "REFUNDED"] as const;
const payableStates = ["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] as const;

class IntentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!arePaymentsEnabled() && !parsed.success)
    return NextResponse.json({ error: "Os pagamentos estão temporariamente indisponíveis." }, { status: 409 });
  if (!parsed.success) return NextResponse.json({ error: "Pedido de pagamento inválido." }, { status: 400 });
  if (!verifyReservationToken(parsed.data.reservationId, parsed.data.accessToken))
    return NextResponse.json({ error: "Reserva não autorizada." }, { status: 403 });
  try {
    await enforceRateLimit({ namespace: "payment-intent", identifier: clientIp(request), limit: 15, windowMs: 10 * 60_000 });
    const identity = await prisma.reservation.findUnique({ where: { id: parsed.data.reservationId }, select: {
      eventId: true, reference: true, totalAmount: true, event: { select: { slug: true } },
    } });
    if (!identity) throw new IntentError("Reserva não encontrada.", 404);
    const privateProbe = isPrivateWiPayProbe(identity);
    if (!arePaymentsEnabled() && !privateProbe)
      throw new IntentError("Os pagamentos estão temporariamente indisponíveis.", 409);
    const provider = privateProbe ? "wipay" : parsed.data.provider ?? defaultPaymentProvider();
    if (privateProbe && parsed.data.provider && parsed.data.provider !== "wipay")
      throw new IntentError("Este teste usa apenas a WiPay.", 400);
    if (!privateProbe && !availablePaymentProviders().includes(provider)) throw new IntentError("Este método de pagamento não está disponível.", 400);
    let wipaySettings: { appUrl: URL; callbackUrl: string } | undefined;
    if (provider === "wipay") {
      try {
        const appUrl = new URL(publicBaseUrl());
        if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash || appUrl.pathname !== "/" || appUrl.port ||
            (appUrl.protocol !== "https:" && process.env.NODE_ENV !== "test"))
          throw new Error("WiPay requires HTTPS.");
        wipaySettings = { appUrl, callbackUrl: wipayCallbackUrl(appUrl.origin) };
      } catch {
        throw new IntentError("A URL pública de retorno ou callback WiPay não está configurada.", 503);
      }
    }
    const method = provider === "wipay" ? "hosted" : provider === "ekwanza" ? "gpo" : parsed.data.method;
    // Claim exactly one local attempt before any request capable of charging.
    // A timeout keeps that claim UNKNOWN and cannot trigger a duplicate charge.
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${identity.eventId} FOR UPDATE`;
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: parsed.data.reservationId },
        include: { customer: true, event: true, payments: { where: { status: { in: [...livePaymentStatuses] } }, orderBy: { createdAt: "desc" } } },
      });
      if (privateProbe !== isPrivateWiPayProbe(reservation)) throw new IntentError("Reserva inválida.", 409);
      if (!payableStates.some((status) => status === reservation.status)) throw new IntentError("Esta reserva já não pode receber um pagamento.", 409);
      if (["CANCELLED", "CLOSED"].includes(reservation.event.status) || reservation.event.eventDate <= new Date())
        throw new IntentError("Este evento já não aceita pagamentos.", 409);
      const existing = reservation.payments[0];
      if (existing) {
        if (["SUCCEEDED", "REFUND_PENDING", "REFUNDED"].includes(existing.status)) throw new IntentError("Esta reserva já tem um pagamento recebido. Consulta o estado da compra.", 409);
        if (existing.provider !== provider || existing.method !== method) throw new IntentError("Já existe um pagamento em curso para esta reserva.", 409);
        return { reservation, payment: existing, created: false, productId: undefined };
      }
      if (!reservation.holdExpiresAt || reservation.holdExpiresAt <= new Date()) throw new IntentError("O prazo desta reserva expirou. Inicia uma nova reserva.", 409);
      const productVariables = { INDIVIDUAL: "PAYMENTS_PRODUCT_INDIVIDUAL_ID", DUO: "PAYMENTS_PRODUCT_DUO_ID", DUO_INDIVIDUAL: "PAYMENTS_PRODUCT_DUO_INDIVIDUAL_ID", GROUP: "PAYMENTS_PRODUCT_GROUP_ID" } as const;
      const productId = provider === "paygo" && reservation.plan ? normalizeProductId(process.env[productVariables[reservation.plan]]) : undefined;
      if (provider === "paygo" && !productId) throw new IntentError("O produto deste plano ainda não está configurado.", 409);
      const reference = provider === "wipay" ? `festgo_${reservation.reference.replace(/[^A-Za-z0-9_-]/g, "_")}_${crypto.randomUUID()}`
        : provider === "ekwanza" ? `FG${crypto.randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase()}` : undefined;
      const payment = await tx.payment.create({ data: {
        reservationId: reservation.id, provider, providerReference: reference,
        idempotencyKey: `${provider}-${reservation.id}-${crypto.randomUUID()}`,
        method, status: "CREATED", amount: reservation.totalAmount, currency: reservation.currency,
        providerDetails: productId ? { productId } : reference ? { merchantTransactionId: reference } : {},
      } });
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: "AWAITING_PAYMENT" } });
      return { reservation, payment, created: true, productId };
    }, { isolationLevel: "ReadCommitted", timeout: 10_000 });
    const { reservation, payment, productId } = claim;
    if (!claim.created) return NextResponse.json({
      reservationReference: reservation.reference, paymentId: payment.providerPaymentId,
      status: payment.providerPaymentId ? payment.status : "UNKNOWN", details: publicPaymentDetails(payment.providerDetails),
    }, { status: payment.providerPaymentId ? 200 : 202 });
    const amount = Number(reservation.totalAmount);
    let providerPaymentId: string;
    let rawStatus: string;
    let details: Prisma.InputJsonObject;
    try {
      if (provider === "wipay") {
        const { appUrl, callbackUrl } = wipaySettings!;
        await ensureWiPaySignatureToken();
        const resultUrl = new URL("/pagamento", appUrl);
        resultUrl.searchParams.set("reservation", reservation.id);
        resultUrl.searchParams.set("token", parsed.data.accessToken);
        const failureUrl = new URL(resultUrl); failureUrl.searchParams.set("cancelled", "1");
        const remote = await createWiPayPayment({ amount, currency: reservation.currency, customerPhone: reservation.customer.phone.replace(/^\+244/, ""), referenceId: payment.providerReference!, successUrl: resultUrl.toString(), failureUrl: failureUrl.toString(), callbackUrl });
        providerPaymentId = remote.paymentId; rawStatus = "checkout_created";
        details = { environment: process.env.WIPAY_ENVIRONMENT ?? "unknown", paymentUrl: remote.checkoutUrl };
      } else if (provider === "ekwanza") {
        if (reservation.currency.toUpperCase() !== "AOA") throw new IntentError("Moeda não suportada pelo É-Kwanza.", 409);
        const remote = await createEkwanzaCharge({ amount, merchantTransactionId: payment.providerReference!, method: "gpo", phoneNumber: reservation.customer.phone, description: `FestGO ${reservation.reference}` });
        const reference = remote.reference ?? {};
        providerPaymentId = remote.id; rawStatus = remote.status;
        details = { merchantTransactionId: payment.providerReference, source: "GPO", entity: reference.entity ?? reference.Entity ?? reference.MerchantIdentifier ?? null, reference: reference.referenceNumber ?? reference.ReferenceNumber ?? null, dueDate: reference.dueDate ?? reference.DueDate ?? null, paymentUrl: remote.paymentUrl };
      } else {
        if (!productId || !(await paymentProductMatches(productId, amount))) throw new IntentError("O produto do plano não corresponde ao preço oficial.", 409);
        const remote = await createPayment({ productId, quantity: 1, method: parsed.data.method, customer: { name: reservation.customer.fullName, email: reservation.customer.email ?? "", phone: reservation.customer.phone } });
        // Save identity even when amount verification fails, allowing safe reconciliation.
        await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ["CREATED", "PENDING", "UNKNOWN"] } }, data: { providerPaymentId: remote.payment_id, status: "UNKNOWN", rawStatus: remote.status } });
        if (!remote.success || remote.total_amount !== amount || remote.currency.toUpperCase() !== reservation.currency.toUpperCase() || !paymentMethodMatches(parsed.data.method, remote.payment_method))
          throw new PaymentsApiError("A resposta da API não corresponde ao total da reserva.");
        providerPaymentId = remote.payment_id; rawStatus = remote.status;
        details = { productId, entity: remote.reference?.entity ?? null, reference: remote.reference?.reference_number ?? null, expiresAt: remote.reference?.expiration_date ?? null, instructions: remote.instructions ?? remote.message ?? null, paymentUrl: paymentPageUrl(remote) };
      }
      // An early verified callback may already have committed SUCCEEDED/PAID.
      await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "PENDING", "UNKNOWN"] } },
        data: { providerPaymentId, rawStatus, status: "PENDING", providerDetails: details },
      });
      const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return NextResponse.json({ reservationReference: reservation.reference, paymentId: current.providerPaymentId, status: current.status, amount, method, details: publicPaymentDetails(current.providerDetails) });
    } catch (error) {
      const rejected = error instanceof IntentError ||
        ((error instanceof WiPayError || error instanceof EkwanzaError || error instanceof PaymentsApiError) && Boolean(error.status) && error.status! >= 400 && error.status! < 500 && ![408, 409, 429].includes(error.status!));
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
        const updated = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["CREATED", "PENDING", "UNKNOWN"] } }, data: { status: rejected ? "FAILED" : "UNKNOWN", rawStatus: rejected ? "CREATE_REJECTED" : "UNKNOWN" } });
        if (updated.count) await tx.reservation.updateMany({ where: { id: reservation.id, status: { in: [...payableStates] } }, data: { status: rejected ? "PAYMENT_PENDING" : "PAYMENT_UNCERTAIN" } });
      });
      return NextResponse.json(rejected ? { error: error instanceof IntentError ? error.message : "O gateway recusou a criação do pagamento. Tenta novamente." } : { reservationReference: reservation.reference, status: "UNKNOWN" }, { status: error instanceof IntentError ? error.status : rejected ? 502 : 202 });
    }
  } catch (error) {
    const status = error instanceof IntentError ? error.status : typeof error === "object" && error && "status" in error && error.status === 429 ? 429 : 503;
    return NextResponse.json({ error: error instanceof IntentError ? error.message : status === 429 ? "Demasiadas tentativas. Aguarda alguns minutos." : "Não foi possível iniciar o pagamento." }, { status });
  }
}
