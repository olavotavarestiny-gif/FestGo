import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkWiPaySignature, WiPayError } from "@/lib/integrations/wipay";

export const runtime = "nodejs";

const schema = z.object({
  id: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  status: z.enum(["accepted", "rejected"]),
  status_reason: z.string().min(1).max(40),
  status_datetime: z.string().datetime(),
  currency: z.string().length(3),
  customer: z.string(),
  reference_id: z.string(),
  processor: z.string(),
});

export async function POST(request: Request) {
  const raw = await request.text();
  let signature: Awaited<ReturnType<typeof checkWiPaySignature>>;
  try {
    signature = await checkWiPaySignature(raw, request.headers.get("signature"));
  } catch (error) {
    console.warn("WiPay test callback signature verification unavailable", {
      reason: error instanceof WiPayError ? error.code ?? "WIPAY_ERROR" : "UNAVAILABLE",
    });
    return NextResponse.json({ error: "Não foi possível validar a assinatura WiPay." }, { status: 503 });
  }
  if (signature !== "valid") {
    console.warn("WiPay test callback signature rejected", { reason: signature });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
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
  if ((payload.status === "accepted") !== (payload.status_reason === "2000"))
    return NextResponse.json({ error: "Estado WiPay inconsistente." }, { status: 400 });
  const payment = await prisma.testPayment.findFirst({
    where: {
      provider: "wipay",
      OR: [
        { providerPaymentId: payload.id },
        { providerDetails: { path: ["referenceId"], equals: payload.reference_id } },
      ],
    },
    include: { testReservation: true },
  });
  const details = payment?.providerDetails as { referenceId?: string } | null;
  if (
    !payment ||
    (payment.providerPaymentId !== null && payment.providerPaymentId !== payload.id) ||
    details?.referenceId !== payload.reference_id ||
    Number(payment.amount) !== Number(payload.amount) ||
    payment.currency.toLowerCase() !== payload.currency.toLowerCase()
  )
    return NextResponse.json({ error: "Pagamento de teste desconhecido." }, { status: 404 });
  const eventId = `wipay-test:${createHash("sha256").update(raw).digest("hex")}`;
  const existing = await prisma.testPaymentWebhookEvent.findUnique({
    where: { providerEventId: eventId },
  });
  if (existing?.processedAt)
    return NextResponse.json({ received: true, duplicate: true });
  await prisma.$transaction(async (tx) => {
    const event = existing ?? await tx.testPaymentWebhookEvent.create({
      data: {
        testPaymentId: payment.id,
        providerEventId: eventId,
        payload,
        signatureValid: true,
      },
    });
    if (payload.status === "accepted") {
      await tx.testPayment.update({
        where: { id: payment.id },
        data: { providerPaymentId: payload.id, status: "SUCCEEDED", rawStatus: "accepted", reconciledAt: new Date() },
      });
      await tx.testReservation.update({
        where: { id: payment.testReservationId },
        data: { status: "PAID" },
      });
      await tx.testTicket.upsert({
        where: { testReservationId: payment.testReservationId },
        create: { testReservationId: payment.testReservationId },
        update: {},
      });
    } else if (payment.status !== "SUCCEEDED") {
      await tx.testPayment.update({
        where: { id: payment.id },
        data: { providerPaymentId: payload.id, status: "FAILED", rawStatus: `rejected:${payload.status_reason}`, reconciledAt: new Date() },
      });
      await tx.testReservation.update({
        where: { id: payment.testReservationId },
        data: { status: "REJECTED" },
      });
    }
    await tx.testPaymentWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  });
  return NextResponse.json({ received: true, status: payload.status });
}
