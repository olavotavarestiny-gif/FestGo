import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyWiPaySignature, WiPayError } from "@/lib/integrations/wipay";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

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

function jsonDetails(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
    if (!(await verifyWiPaySignature(rawBody, request.headers.get("signature"))))
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  } catch (error) {
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
  const payment = await prisma.payment.findFirst({
    where: {
      provider: "wipay",
      OR: [
        { providerPaymentId: payload.id },
        { providerReference: payload.reference_id },
      ],
    },
    include: {
      reservation: {
        include: {
          customer: true,
          passengers: true,
          seatPreferences: { where: { releasedAt: null } },
        },
      },
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
  const existing = await prisma.paymentWebhookEvent.findUnique({
    where: { providerEventId },
  });
  if (existing?.processedAt)
    return NextResponse.json({ received: true, duplicate: true });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const webhook =
          existing ??
          (await tx.paymentWebhookEvent.create({
            data: {
              paymentId: payment.id,
              providerEventId,
              type: `wipay.${payload.status}`,
              payload,
              signatureValid: true,
            },
          }));
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${payment.reservation.eventId} FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: {
            reservation: {
              include: {
                passengers: true,
                seatPreferences: { where: { releasedAt: null } },
              },
            },
          },
        });
        const details = {
          ...jsonDetails(current.providerDetails),
          processor: payload.processor,
          statusReason: payload.status_reason,
          statusDatetime: payload.status_datetime,
        };
        if (payload.status === "rejected") {
          if (current.status === "SUCCEEDED" || current.reservation.status === "PAID") {
            await tx.paymentWebhookEvent.update({
              where: { id: webhook.id },
              data: { processedAt: new Date() },
            });
            return { status: "SUCCEEDED", ticketsIssued: false } as const;
          }
          await tx.payment.update({
            where: { id: current.id },
            data: {
              providerPaymentId: current.providerPaymentId ?? payload.id,
              status: "FAILED",
              rawStatus: `rejected:${payload.status_reason}`,
              providerDetails: details,
              reconciledAt: new Date(),
            },
          });
          await tx.reservation.update({
            where: { id: current.reservationId },
            data: { status: "EXPIRED" },
          });
          await tx.seatPreference.updateMany({
            where: { reservationId: current.reservationId, releasedAt: null },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
          await tx.paymentWebhookEvent.update({
            where: { id: webhook.id },
            data: { processedAt: new Date() },
          });
          return { status: "FAILED", ticketsIssued: false } as const;
        }

        await tx.payment.update({
          where: { id: current.id },
          data: {
            providerPaymentId: current.providerPaymentId ?? payload.id,
            status: "SUCCEEDED",
            rawStatus: "accepted",
            providerDetails: details,
            reconciledAt: new Date(),
          },
        });
        const awaitingConfirmation = current.reservation.status !== "PAID";
        if (awaitingConfirmation) {
          await tx.reservation.updateMany({
            where: {
              id: current.reservationId,
              status: {
                in: [
                  "HELD",
                  "PAYMENT_PENDING",
                  "AWAITING_PAYMENT",
                  "PAYMENT_UNCERTAIN",
                  "CANCELLED",
                  "EXPIRED",
                ],
              },
            },
            data: { status: "PAYMENT_UNCERTAIN", paidAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              action: "WIPAY_PAYMENT_AWAITING_ADMIN_CONFIRMATION",
              entityType: "Reservation",
              entityId: current.reservationId,
              metadata: { paymentId: current.id, providerPaymentId: payload.id },
            },
          });
        }
        await tx.paymentWebhookEvent.update({
          where: { id: webhook.id },
          data: { processedAt: new Date() },
        });
        return {
          status: "SUCCEEDED",
          ticketsIssued: false,
          awaitingAdminConfirmation: awaitingConfirmation,
        } as const;
      },
      { isolationLevel: "Serializable", timeout: 10_000 },
    );
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json(
      { error: "Não foi possível processar o callback." },
      { status: 503 },
    );
  }
}
