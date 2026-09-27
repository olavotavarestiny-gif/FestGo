import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { reconcilePayment } from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function providerPaymentId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : {};
  const payment =
    root.payment &&
    typeof root.payment === "object" &&
    !Array.isArray(root.payment)
      ? (root.payment as Record<string, unknown>)
      : data.payment &&
          typeof data.payment === "object" &&
          !Array.isArray(data.payment)
        ? (data.payment as Record<string, unknown>)
        : {};
  const candidate =
    root.payment_id ??
    root.paymentId ??
    data.payment_id ??
    data.paymentId ??
    payment.id ??
    data.id;
  return typeof candidate === "string" && /^[0-9a-f-]{36}$/i.test(candidate)
    ? candidate
    : null;
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit({
      namespace: "payment-webhook",
      identifier: clientIp(request),
      limit: 120,
      windowMs: 60_000,
    });
  } catch {
    return NextResponse.json({ error: "Limite excedido." }, { status: 429 });
  }
  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  }
  const webhookSecret =
    process.env.PAYMENTS_WEBHOOK_SECRET ?? process.env.Webhook_secret;
  let signatureValid = false;
  if (webhookSecret) {
    const direct =
      request.headers.get("x-webhook-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const suppliedHmac = request.headers
      .get("x-signature")
      ?.replace(/^sha256=/i, "");
    const expectedHmac = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    const equal = (left: string, right: string) => {
      const a = Buffer.from(left);
      const b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    };
    signatureValid = Boolean(
      (direct && equal(direct, webhookSecret)) ||
        (suppliedHmac && equal(suppliedHmac, expectedHmac)),
    );
    if (!signatureValid)
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 },
      );
  }
  const remoteId = providerPaymentId(payload);
  if (!remoteId)
    return NextResponse.json(
      { error: "Falta o identificador do pagamento." },
      { status: 400 },
    );

  try {
    const payment = await prisma.payment.findUnique({
      where: { providerPaymentId: remoteId },
    });
    if (!payment || payment.provider !== "paygo")
      return NextResponse.json(
        { error: "Pagamento desconhecido." },
        { status: 404 },
      );
    const providerEventId = createHash("sha256").update(rawBody).digest("hex");
    const existing = await prisma.paymentWebhookEvent.findUnique({
      where: { providerEventId },
    });
    if (existing?.processedAt)
      return NextResponse.json({ received: true, duplicate: true });
    const event =
      existing ??
      (await prisma.paymentWebhookEvent.create({
        data: {
          paymentId: payment.id,
          providerEventId,
          type: "payment.status",
          payload: payload as Prisma.InputJsonValue,
          signatureValid,
        },
      }));
    const result = await reconcilePayment(payment.id);
    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
    return NextResponse.json({ received: true, status: result.status });
  } catch {
    // A resposta não é confirmada para que o fornecedor possa repetir a entrega.
    return NextResponse.json(
      { error: "Não foi possível reconciliar o pagamento." },
      { status: 503 },
    );
  }
}
