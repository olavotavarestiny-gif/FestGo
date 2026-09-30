import { createHash } from "node:crypto";
import { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Only provider adapters which authenticated/queried the provider may call this. */
export type VerifiedPayment = {
  localPaymentId: string;
  provider: "paygo" | "ekwanza" | "wipay";
  providerPaymentId: string;
  providerReference?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  rawStatus: string;
  details?: Prisma.InputJsonObject;
  webhook?: {
    providerEventId: string;
    type: string;
    payload: Prisma.InputJsonValue;
  };
};

export class PaymentVerificationError extends Error {
  readonly status = 409;
  constructor() {
    super("O pagamento verificado não corresponde à reserva guardada.");
    this.name = "PaymentVerificationError";
  }
}

export function nextPaymentStatus(current: PaymentStatus, incoming: PaymentStatus): PaymentStatus {
  if (current === "REFUNDED") return current;
  if (incoming === "REFUNDED") return incoming;
  if (current === "REFUND_PENDING") return current;
  if (current === "SUCCEEDED" && incoming !== "REFUND_PENDING") return current;
  if (["FAILED", "CANCELLED"].includes(current) && ["CREATED", "PENDING", "UNKNOWN"].includes(incoming))
    return current;
  return incoming;
}

/** Shared with reservation creation: live holds and paid passengers consume capacity. */
export function occupiedReservationWhere(now: Date): Prisma.ReservationWhereInput {
  return {
    OR: [
      { status: "PAID" },
      {
        status: { in: ["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] },
        holdExpiresAt: { gt: now },
      },
    ],
  };
}

export async function finalizeVerifiedPayment(input: VerifiedPayment) {
  const identity = await prisma.payment.findUnique({
    where: { id: input.localPaymentId },
    select: { reservation: { select: { eventId: true } } },
  });
  if (!identity) throw new PaymentVerificationError();
  // Read committed + the shared Event lock serializes capacity changes. Re-read
  // all financial state after obtaining it, never act on pre-lock snapshots.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${identity.reservation.eventId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: input.localPaymentId },
      include: {
        reservation: {
          include: {
            event: true,
            route: { include: { vehicle: true } },
            pickupPoint: true,
            customer: true,
            passengers: true,
            seatPreferences: { where: { releasedAt: null } },
          },
        },
      },
    });
    const reservation = payment.reservation;
    if (
      payment.provider !== input.provider ||
      (payment.providerPaymentId !== null && payment.providerPaymentId !== input.providerPaymentId) ||
      (!payment.providerPaymentId && input.provider !== "wipay") ||
      (input.provider !== "paygo" && (!input.providerReference || input.providerReference !== payment.providerReference)) ||
      (payment.providerReference && input.providerReference && payment.providerReference !== input.providerReference) ||
      !Number.isFinite(input.amount) || input.amount <= 0 ||
      input.amount !== Number(payment.amount) || input.amount !== Number(reservation.totalAmount) ||
      input.currency.toUpperCase() !== payment.currency.toUpperCase() ||
      input.currency.toUpperCase() !== reservation.currency.toUpperCase()
    ) throw new PaymentVerificationError();

    const result = {
      status: nextPaymentStatus(payment.status, input.status),
      rawStatus: input.rawStatus,
      reservationReference: reservation.reference,
      newlyConfirmed: false,
      ticketsIssued: false,
      seatConflict: false,
      requiresReview: false,
      duplicate: false,
    };
    let webhookId: string | undefined;
    if (input.webhook) {
      const event = await tx.paymentWebhookEvent.upsert({
        where: { providerEventId: input.webhook.providerEventId },
        create: { ...input.webhook, paymentId: payment.id, signatureValid: true },
        update: {},
      });
      if (event.paymentId !== payment.id) throw new PaymentVerificationError();
      if (event.processedAt) return { ...result, duplicate: true, rawStatus: payment.rawStatus };
      webhookId = event.id;
    }
    const now = new Date();
    const acceptedTransition = result.status === input.status;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: input.providerPaymentId,
        providerReference: payment.providerReference ?? input.providerReference,
        status: result.status,
        ...(acceptedTransition ? { rawStatus: input.rawStatus, ...(input.details ? { providerDetails: input.details } : {}) } : {}),
        reconciledAt: now,
      },
    });
    if (!acceptedTransition) result.rawStatus = payment.rawStatus ?? payment.status;

    if (result.status === "REFUNDED") {
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: "REFUNDED" } });
      await tx.ticket.updateMany({
        where: { passenger: { reservationId: reservation.id }, status: { not: "REVOKED" } },
        data: { status: "REVOKED", revokedAt: now },
      });
      await tx.seatPreference.updateMany({
        where: { reservationId: reservation.id, releasedAt: null },
        data: { status: "RELEASED", releasedAt: now },
      });
    } else if (result.status === "SUCCEEDED" && reservation.status !== "PAID" && reservation.status !== "REFUNDED") {
      const occupied = occupiedReservationWhere(now);
      const eventOccupied = await tx.reservation.aggregate({
        where: { eventId: reservation.eventId, id: { not: reservation.id }, ...occupied },
        _sum: { quantity: true },
      });
      const routeOccupied = reservation.routeId ? await tx.reservation.aggregate({
        where: { routeId: reservation.routeId, id: { not: reservation.id }, ...occupied },
        _sum: { quantity: true },
      }) : null;
      const vehicleOccupied = reservation.route?.vehicleId ? await tx.reservation.aggregate({
        where: { eventId: reservation.eventId, route: { vehicleId: reservation.route.vehicleId }, id: { not: reservation.id }, ...occupied },
        _sum: { quantity: true },
      }) : null;
      const seats = reservation.seatPreferences.map((seat) => seat.seatNumber);
      const seatConflict = seats.length > 0 && (
        seats.length !== reservation.quantity || new Set(seats).size !== seats.length ||
        await tx.seatPreference.count({
          where: {
            eventId: reservation.eventId, reservationId: { not: reservation.id },
            seatNumber: { in: seats }, releasedAt: null,
            OR: [
              { status: "CONFIRMED" },
              { status: "TEMPORARILY_HELD", reservation: occupied },
            ],
          },
        }) > 0
      );
      const capacityConflict = (eventOccupied._sum.quantity ?? 0) + reservation.quantity > reservation.event.capacity ||
        (reservation.route && (routeOccupied?._sum.quantity ?? 0) + reservation.quantity > reservation.route.capacity) ||
        (reservation.route?.vehicle && (vehicleOccupied?._sum.quantity ?? 0) + reservation.quantity > reservation.route.vehicle.capacity);
      const invalidState = reservation.status === "CANCELLED" ||
        ["CANCELLED", "CLOSED"].includes(reservation.event.status) ||
        reservation.event.eventDate <= now ||
        (!reservation.route && seats.length === 0) ||
        (reservation.route !== null && (!reservation.route.active || !reservation.pickupPoint?.operationalConfirmed || !reservation.pickupPoint.departureAt || reservation.pickupPoint.routeId !== reservation.routeId)) ||
        reservation.passengers.length !== reservation.quantity;
      if (capacityConflict || seatConflict || invalidState) {
        // The money was received, but a late capture must never oversell or
        // reactivate an explicitly cancelled/refunded booking.
        if (reservation.status !== "CANCELLED")
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { status: "PAYMENT_UNCERTAIN", paidAt: reservation.paidAt ?? now },
          });
        const action = "PAYMENT_REQUIRES_REVIEW";
        const existingReview = await tx.auditLog.findFirst({
          where: { action, entityType: "Payment", entityId: payment.id }, select: { id: true },
        });
        if (!existingReview) await tx.auditLog.create({
          data: {
            action, entityType: "Payment", entityId: payment.id,
            metadata: { reservationId: reservation.id, capacityConflict: Boolean(capacityConflict), seatConflict, invalidState },
          },
        });
        result.seatConflict = Boolean(capacityConflict || seatConflict);
        result.requiresReview = true;
      } else {
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: "PAID", paidAt: reservation.paidAt ?? now } });
        await tx.seatPreference.updateMany({ where: { reservationId: reservation.id, releasedAt: null }, data: { status: "CONFIRMED" } });
        await tx.ticket.createMany({ data: reservation.passengers.map((passenger) => ({ passengerId: passenger.id })), skipDuplicates: true });
        await tx.notification.createMany({
          data: [{ reservationId: reservation.id, channel: "SMS", recipient: reservation.customer.phone, template: "BOOKING_PAID" }],
          skipDuplicates: true,
        });
        await tx.cRMIntegrationJob.upsert({
          where: { reservationId_kind: { reservationId: reservation.id, kind: "SALE" } },
          create: { reservationId: reservation.id, kind: "SALE" }, update: {},
        });
        await tx.paymentInvitation.updateMany({ where: { reservationId: reservation.id, confirmedAt: null }, data: { confirmedAt: now } });
        await tx.referralRedemption.updateMany({ where: { reservationId: reservation.id, confirmedAt: null }, data: { confirmedAt: now } });
        if (reservation.discountId) await tx.discount.update({ where: { id: reservation.discountId }, data: { usedCount: { increment: 1 } } });
        const referralCode = `FG${createHash("sha256").update(reservation.customerId).digest("hex").slice(0, 10).toUpperCase()}`;
        await tx.referralCode.upsert({ where: { customerId: reservation.customerId }, create: { customerId: reservation.customerId, code: referralCode }, update: {} });
        await tx.auditLog.create({
          data: { action: "PAYMENT_CONFIRMED", entityType: "Reservation", entityId: reservation.id, metadata: { paymentId: payment.id, provider: payment.provider, amount: input.amount, currency: input.currency } },
        });
        result.newlyConfirmed = true;
        result.ticketsIssued = true;
      }
    } else if (!["PAID", "REFUNDED", "CANCELLED", "EXPIRED"].includes(reservation.status)) {
      if (["FAILED", "CANCELLED"].includes(result.status)) {
        const otherLivePayment = await tx.payment.count({
          where: { reservationId: reservation.id, id: { not: payment.id }, status: { in: ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED", "REFUND_PENDING"] } },
        });
        if (!otherLivePayment) {
          await tx.reservation.update({ where: { id: reservation.id }, data: { status: result.status === "FAILED" ? "EXPIRED" : "CANCELLED" } });
          await tx.seatPreference.updateMany({ where: { reservationId: reservation.id, releasedAt: null }, data: { status: "RELEASED", releasedAt: now } });
        }
      } else if (["PENDING", "UNKNOWN"].includes(result.status)) {
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: result.status === "UNKNOWN" ? "PAYMENT_UNCERTAIN" : "AWAITING_PAYMENT" } });
      }
    }
    if (webhookId) await tx.paymentWebhookEvent.update({ where: { id: webhookId }, data: { processedAt: now } });
    return result;
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}
