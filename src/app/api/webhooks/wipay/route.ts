import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkWiPaySignature, WiPayError } from "@/lib/integrations/wipay";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { finalizeVerifiedPayment, PaymentVerificationError } from "@/lib/payment-finalization";
import { schedulePostPaymentJobs } from "@/lib/schedule-jobs";

export const runtime = "nodejs";

const callbackSchema = z.object({
  id: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  status: z.enum(["accepted", "rejected"]),
  status_reason: z.string().min(1).max(40),
  status_datetime: z.string().datetime(),
  currency: z.string().length(3),
  customer: z.string().min(3).max(80),
  reference_id: z.string().min(8).max(160),
  processor: z.string().min(1).max(80),
});

export async function POST(request: Request) {
  try {
    await enforceRateLimit({
      namespace: "wipay-callback",
      identifier: clientIp(request),
      limit: 120,
      windowMs: 60_000,
    });
  } catch {
    return NextResponse.json({ error: "Limite excedido." }, { status: 429 });
  }

  const rawBody = await request.text();
  try {
    const signature = await checkWiPaySignature(rawBody, request.headers.get("signature"));
    if (signature !== "valid") {
      console.warn("WiPay callback signature rejected", { reason: signature });
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
    }
  } catch (error) {
    console.warn("WiPay callback signature verification unavailable", {
      reason: error instanceof WiPayError ? error.code ?? "WIPAY_ERROR" : "UNAVAILABLE",
    });
    return NextResponse.json(
      {
        error:
          error instanceof WiPayError
            ? "Não foi possível validar a assinatura WiPay."
            : "Falha temporária na validação.",
      },
      { status: 503 },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Callback inválido." }, { status: 400 });
  }
  const parsed = callbackSchema.safeParse(decoded);
  if (!parsed.success)
    return NextResponse.json({ error: "Callback inválido." }, { status: 400 });
  const payload = parsed.data;
  if ((payload.status === "accepted") !== (payload.status_reason === "2000"))
    return NextResponse.json({ error: "Estado WiPay inconsistente." }, { status: 400 });
  const payment = await prisma.payment.findFirst({
    where: {
      provider: "wipay",
      OR: [
        { providerPaymentId: payload.id },
        { providerReference: payload.reference_id },
      ],
    },

  });
  if (!payment)
    return NextResponse.json({ error: "Pagamento desconhecido." }, { status: 404 });
  if (
    (payment.providerPaymentId !== null && payment.providerPaymentId !== payload.id) ||
    payment.providerReference !== payload.reference_id ||
    Number(payment.amount) !== Number(payload.amount) ||
    payment.currency.toLowerCase() !== payload.currency.toLowerCase()
  )
    return NextResponse.json(
      { error: "O callback não corresponde à cobrança guardada." },
      { status: 409 },
    );

  const providerEventId = `wipay:${createHash("sha256").update(rawBody).digest("hex")}`;
  try {
    const result = await finalizeVerifiedPayment({
      localPaymentId: payment.id,
      provider: "wipay",
      providerPaymentId: payload.id,
      providerReference: payload.reference_id,
      amount: Number(payload.amount),
      currency: payload.currency,
      status: payload.status === "accepted" ? "SUCCEEDED" : "FAILED",
      rawStatus: `${payload.status}:${payload.status_reason}`,
      webhook: { providerEventId, type: `wipay.${payload.status}`, payload },
    });
    if (result.newlyConfirmed) schedulePostPaymentJobs(request);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof PaymentVerificationError ? error.message : "Não foi possível processar o callback." },
      { status: error instanceof PaymentVerificationError ? 409 : 503 },
    );
  }
}
