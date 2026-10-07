import { purchaseEventId } from "@/lib/meta-server";
import { isPrivateWiPayProbe } from "@/lib/private-wipay-probe";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyReservationToken } from "@/lib/reservation-access";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { createTicketBundleToken } from "@/lib/ticket-access";
import { schedulePostPaymentJobs } from "@/lib/schedule-jobs";
import { publicPaymentDetails, reconcileProviderPayment } from "@/lib/payment-providers";
import { validWhatsappGroupUrl } from "@/lib/config";

export const runtime = "nodejs";
const schema = z.object({ reservationId: z.string().min(8).max(40), accessToken: z.string().min(32).max(100) });
const include = { event: true, route: true, pickupPoint: true, payments: { orderBy: { createdAt: "desc" as const } } } as const;

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  if (!verifyReservationToken(parsed.data.reservationId, parsed.data.accessToken))
    return NextResponse.json({ error: "Reserva não autorizada." }, { status: 403 });
  try {
    await enforceRateLimit({ namespace: "payment-status", identifier: clientIp(request), limit: 120, windowMs: 10 * 60_000 });
    let reservation = await prisma.reservation.findUnique({ where: { id: parsed.data.reservationId }, include });
    if (!reservation) return NextResponse.json({ error: "Reserva não encontrada." }, { status: 404 });
    let payment = reservation.payments.find((item) => item.status === "SUCCEEDED") ?? reservation.payments[0];
    if (payment?.providerPaymentId && ["CREATED", "PENDING", "UNKNOWN"].includes(payment.status)) {
      const result = await reconcileProviderPayment(payment, reservation.reference);
      if (result.newlyConfirmed) schedulePostPaymentJobs(request);
      reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include });
      payment = reservation.payments.find((item) => item.status === "SUCCEEDED") ?? reservation.payments[0];
    }
    const paid = reservation.status === "PAID" && payment?.status === "SUCCEEDED";
    const ticketUrl = paid ? (() => {
      const expiry = new Date((reservation.event.returnAt ?? reservation.event.eventDate).getTime() + 7 * 24 * 60 * 60_000);
      const token = createTicketBundleToken(reservation.reference, expiry);
      return `/reserva/${encodeURIComponent(reservation.reference)}/bilhetes?token=${encodeURIComponent(token)}`;
    })() : undefined;
    const group = reservation.route?.whatsappGroupUrl;
    const canRetry = !paid && ["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT"].includes(reservation.status) &&
      Boolean(reservation.holdExpiresAt && reservation.holdExpiresAt > new Date()) &&
      (!payment || ["FAILED", "CANCELLED"].includes(payment.status));
    return NextResponse.json({
      status: paid ? "SUCCEEDED" : payment?.status === "SUCCEEDED" ? "AWAITING_CONFIRMATION" : payment?.status ?? "NOT_STARTED",
      reservationStatus: reservation.status,
      reservationReference: reservation.reference,
      reference: reservation.reference,
      ticketUrl,
      metaPurchase: paid && !isPrivateWiPayProbe(reservation) ? { eventId: purchaseEventId(reservation.id), value: Number(payment.amount), currency: "AOA" } : undefined,
      whatsappGroupUrl: paid && group && validWhatsappGroupUrl(group) ? group : undefined,
      eventName: reservation.event.name,
      eventDate: reservation.event.eventDate,
      quantity: reservation.quantity,
      total: Number(reservation.totalAmount),
      currency: reservation.currency,
      pickupName: reservation.pickupPoint?.name ?? reservation.pickupPreference,
      departureAt: reservation.pickupPoint?.departureAt,
      holdExpiresAt: reservation.holdExpiresAt,
      details: publicPaymentDetails(payment?.providerDetails ?? null),
      canRetry,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && error.status === 429)
      return NextResponse.json({ error: "Demasiadas consultas. Aguarda alguns minutos." }, { status: 429 });
    return NextResponse.json({ error: "Não foi possível consultar o estado do pagamento." }, { status: 503 });
  }
}
