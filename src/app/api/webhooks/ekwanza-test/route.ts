import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { reconcileEkwanzaTestPayment } from "@/lib/test-payments";

export const runtime = "nodejs";

const schema = z.object({
  merchantTransactionId: z.string().min(8).max(160),
  ekwanzaTransactionId: z.union([z.string(), z.number()]),
  operationStatus: z.coerce.number().int().refine((value) => [1, 3, 4, 5].includes(value)),
  operationData: z.object({
    amount: z.coerce.number().positive(),
    merchantIdentifier: z.string().min(1).max(120),
    referenceType: z.enum(["REF", "GPO"]),
  }),
});

export async function POST(request: Request) {
  try {
    await enforceRateLimit({
      namespace: "ekwanza-test-callback",
      identifier: clientIp(request),
      limit: 120,
      windowMs: 60_000,
    });
  } catch {
    return NextResponse.json({ error: "Limite excedido." }, { status: 429 });
  }
  const raw = await request.text();
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Callback inválido." }, { status: 400 });
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success)
    return NextResponse.json({ error: "Callback inválido." }, { status: 400 });
  const payload = parsed.data;
  const expectedMerchant = process.env.EKWANZA_MERCHANT_IDENTIFIER?.trim();
  if (!expectedMerchant)
    return NextResponse.json(
      { error: "MerchantIdentifier não configurado." },
      { status: 503 },
    );
  const payment = await prisma.testPayment.findFirst({
    where: {
      provider: "ekwanza",
      providerDetails: {
        path: ["merchantTransactionId"],
        equals: payload.merchantTransactionId,
      },
    },
  });
  if (
    !payment ||
    Number(payment.amount) !== payload.operationData.amount ||
    payment.currency !== "AOA" ||
    payload.operationData.merchantIdentifier !== expectedMerchant ||
    (payment.method === "gpo" ? "GPO" : "REF") !==
      payload.operationData.referenceType
  )
    return NextResponse.json(
      { error: "Pagamento de teste desconhecido." },
      { status: 404 },
    );

  const providerEventId = `ekwanza-test:${createHash("sha256").update(raw).digest("hex")}`;
  const existing = await prisma.testPaymentWebhookEvent.findUnique({
    where: { providerEventId },
  });
  if (existing?.processedAt)
    return NextResponse.json({ received: true, duplicate: true });

  await prisma.$transaction(async (tx) => {
    const event =
      existing ??
      (await tx.testPaymentWebhookEvent.create({
        data: {
          testPaymentId: payment.id,
          providerEventId,
          payload,
          // A documentação GPO v2.7 não define uma assinatura do callback.
          signatureValid: false,
        },
      }));
    void event;
  });
  try {
    const result = await reconcileEkwanzaTestPayment(payment.id);
    await prisma.testPaymentWebhookEvent.update({
      where: { providerEventId },
      data: { processedAt: new Date() },
    });
    return NextResponse.json({ received: true, status: result.status });
  } catch {
    return NextResponse.json(
      { error: "A transacção não foi confirmada pela AppyPay." },
      { status: 503 },
    );
  }
}
