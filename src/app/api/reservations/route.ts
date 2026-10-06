import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createReservationToken } from "@/lib/reservation-access";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { arePaymentsEnabled, calculateTicketPricing, legacyPlanForQuantity, normalizeAngolanPhone } from "@/lib/pre-reservations";
import { isOtpRequired, reservationHoldMinutes } from "@/lib/config";
import { availableCapacity, occupiedReservations } from "@/lib/capacity";
import { pickupAvailableForSale } from "@/lib/pickup-availability";
import { TERMS_VERSION } from "@/lib/terms";

export const runtime = "nodejs";
const bookingSchema = z.object({
  eventSlug: z.string().trim().min(1).max(100).default("brunch-mangais"),
  name: z.string().trim().min(4).max(120),
  phone: z.string().trim().min(9).max(24),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  pickup: z.string().trim().min(2).max(100).optional(),
  pickupPointId: z.string().min(8).max(40).optional(),
  passengers: z.array(z.string().trim().min(3).max(120)).min(1).max(100),
  seats: z.array(z.number().int().min(1).max(100)).max(100).optional(),
  referral: z.string().trim().max(80).optional().default(""),
  terms: z.literal(true),
  marketing: z.boolean().default(false),
  verificationId: z.string().min(8).max(40).optional(),
  idempotencyKey: z.string().uuid(),
}).strict().refine((value) => Boolean(value.pickupPointId || value.pickup));

class BookingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code) || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10 + Math.floor(Math.random() * 10)));
    }
  }
  throw new Error("Reservation transaction retries exhausted.");
}

export async function POST(request: Request) {
  if (!arePaymentsEnabled()) return NextResponse.json({ error: "As reservas ainda não estão abertas." }, { status: 409 });
  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confirma os dados, o embarque e os termos para continuar. O preço é calculado no servidor." }, { status: 400 });
  const input = parsed.data;
  const phone = normalizeAngolanPhone(input.phone);
  if (!phone) return NextResponse.json({ error: "Indica um número angolano válido." }, { status: 400 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "O serviço de reservas está indisponível." }, { status: 503 });
  try {
    // Even replay requests are rate limited. The UUID is a recovery capability, never a sequential ID.
    await enforceRateLimit({ namespace: "reservation-ip", identifier: clientIp(request), limit: 30, windowMs: 60 * 60_000 });
    const result = await retrySerializable(() => prisma.$transaction(async (tx) => {
      const existing = await tx.reservation.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { customer: true, passengers: true, event: true, pickupPoint: true, seatPreferences: { where: { releasedAt: null } } } });
      if (existing) {
        if (existing.customer.phone !== phone || (existing.customer.email ?? "") !== input.email || existing.event.slug !== input.eventSlug ||
          existing.quantity !== input.passengers.length || (input.pickupPointId ? existing.pickupPointId !== input.pickupPointId : existing.pickupPoint?.name !== input.pickup) ||
          existing.passengers.some((passenger) => !input.passengers.includes(passenger.fullName)) ||
          (input.seats && (input.seats.length !== existing.seatPreferences.length || input.seats.some((seat) => !existing.seatPreferences.some((item) => item.seatNumber === seat)))))
          throw new BookingError("Esta chave já pertence a uma reserva com outros dados.", 409);
        return { reservation: existing, reused: true };
      }
      const event = await tx.event.findUnique({ where: { slug: input.eventSlug } });
      if (!event) throw new BookingError("Evento indisponível.", 404);
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;
      const now = new Date();
      if (event.status !== "ON_SALE" || event.eventDate <= now || (event.salesOpenAt && event.salesOpenAt > now) || (event.salesCloseAt && event.salesCloseAt <= now))
        throw new BookingError("As vendas deste evento não estão abertas.", 409);
      if (event.currency !== "AOA") throw new BookingError("Moeda do evento indisponível.", 409);

      const pickup = await tx.pickupPoint.findFirst({
        where: { ...(input.pickupPointId ? { id: input.pickupPointId } : { name: input.pickup }), route: { eventId: event.id, active: true } },
        include: { route: { include: { vehicle: true } } },
      });
      if (!pickup || !pickupAvailableForSale(pickup, now))
        throw new BookingError("Este embarque ainda não está confirmado ou já encerrou.", 409);
      const route = pickup.route;
      if (input.passengers.length > await availableCapacity(tx, event, route, now))
        throw new BookingError("Já não há lugares suficientes para esta reserva.", 409);
      if (input.seats && (input.seats.length !== input.passengers.length || new Set(input.seats).size !== input.seats.length || input.seats.some((seat) => seat > event.capacity)))
        throw new BookingError("Escolhe um lugar diferente para cada passageiro.", 400);
      const taken = await tx.seatPreference.findMany({
        where: { eventId: event.id, releasedAt: null },
        select: { seatNumber: true },
      });
      const unavailableSeats = new Set(taken.map((seat) => seat.seatNumber));
      const seats = input.seats ?? Array.from({ length: event.capacity }, (_, index) => index + 1)
        .filter((seat) => !unavailableSeats.has(seat)).slice(0, input.passengers.length);
      if (seats.length !== input.passengers.length || seats.some((seat) => unavailableSeats.has(seat)))
        throw new BookingError("Um dos lugares já não está disponível. Escolhe outro.", 409);

      const challenge = input.verificationId ? await tx.sMSVerification.findFirst({
        where: { id: input.verificationId, phone, verifiedAt: { not: null }, usedAt: null, expiresAt: { gt: now } },
      }) : null;
      if (isOtpRequired() && !challenge) throw new BookingError("Confirma novamente o teu número de telefone.", 401);
      // Bound seat-hold abuse per contact as well as per IP, inside the reservation transaction.
      const recent = await tx.reservation.count({ where: { customer: { phone }, createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } } });
      if (recent >= 4) throw new BookingError("Limite de reservas atingido. Tenta novamente mais tarde.", 429);

      const customer = await tx.customer.upsert({ where: { phone }, update: {
        fullName: input.name, email: input.email || null, marketingConsent: input.marketing, consentUpdatedAt: now,
      }, create: { fullName: input.name, phone, email: input.email || null, marketingConsent: input.marketing, consentUpdatedAt: now } });
      const pricing = calculateTicketPricing(input.passengers.length, { individual: Number(event.individualPrice), duo: Number(event.duoPrice), group: Number(event.groupPrice) });
      if (!Number.isFinite(pricing.total) || pricing.total <= 0) throw new BookingError("Os preços do evento precisam de revisão.", 409);
      let promoDiscount = 0;
      let referralCodeId: string | null = null;
      let discountId: string | null = null;
      const code = input.referral.toUpperCase();
      if (code) {
        const referral = await tx.referralCode.findUnique({ where: { code }, include: { customer: { include: { reservations: { where: { status: "PAID" }, take: 1, select: { id: true } } } } } });
        if (referral) {
          if (!referral.active || referral.customer.phone === phone || !referral.customer.reservations.length)
            throw new BookingError("Este código de recomendação não é válido para esta compra.", 400);
          referralCodeId = referral.id;
          promoDiscount = Math.floor(pricing.total * 0.05);
        } else {
          const discount = await tx.discount.findUnique({ where: { code } });
          if (!discount || !discount.active || (discount.eventId && discount.eventId !== event.id) ||
            (discount.startsAt && discount.startsAt > now) || (discount.endsAt && discount.endsAt <= now) ||
            !["PERCENT", "FIXED"].includes(discount.type) || Number(discount.value) < 0 ||
            (discount.type === "PERCENT" && Number(discount.value) > 100))
            throw new BookingError("O código promocional não é válido.", 400);
          // Count confirmed redemptions and live discount holds together, including concurrent events.
          await tx.$queryRaw`SELECT "id" FROM "Discount" WHERE "id" = ${discount.id} FOR UPDATE`;
          const reservedUses = await tx.reservation.count({ where: { discountId: discount.id, ...occupiedReservations(now), NOT: { status: "PAID" } } });
          if (discount.maxRedemptions !== null && discount.usedCount + reservedUses >= discount.maxRedemptions)
            throw new BookingError("O código promocional já atingiu o limite de utilizações.", 409);
          discountId = discount.id;
          promoDiscount = discount.type === "PERCENT" ? Math.floor(pricing.total * Number(discount.value) / 100) : Math.min(pricing.total, Number(discount.value));
        }
      }
      const totalAmount = pricing.total - promoDiscount;
      if (totalAmount <= 0) throw new BookingError("Este desconto não permite pagamento online. Contacta a organização.", 400);
      const holdExpiresAt = new Date(Math.min(now.getTime() + reservationHoldMinutes() * 60_000, pickup.departureAt?.getTime() ?? event.eventDate.getTime(), event.salesCloseAt?.getTime() ?? Infinity));
      const reservation = await tx.reservation.create({ data: {
        reference: `FG-${now.getFullYear()}-${randomBytes(6).toString("hex").toUpperCase()}`,
        eventId: event.id, routeId: route.id, pickupPointId: pickup.id, pickupPreference: pickup.name,
        operationalConfirmed: true, customerId: customer.id, discountId, status: "HELD",
        quantity: input.passengers.length, plan: legacyPlanForQuantity(input.passengers.length), unitPrice: event.individualPrice,
        discountAmount: pricing.discount + promoDiscount, totalAmount, pricingBreakdown: pricing,
        currency: event.currency, holdExpiresAt, termsAcceptedAt: now, idempotencyKey: input.idempotencyKey,
        passengers: { create: input.passengers.map((fullName) => ({ fullName })) },
        seatPreferences: { create: seats.map((seatNumber) => ({ eventId: event.id, seatNumber, status: "TEMPORARILY_HELD" })) },
      } });
      if (referralCodeId) await tx.referralRedemption.create({ data: { referralCodeId, reservationId: reservation.id, amount: promoDiscount } });
      await tx.auditLog.create({ data: { action: "TERMS_ACCEPTED", entityType: "Reservation", entityId: reservation.id, metadata: { version: TERMS_VERSION, acceptedAt: now.toISOString() } } });
      if (challenge) await tx.sMSVerification.update({ where: { id: challenge.id }, data: { usedAt: now } });
      return { reservation, reused: false };
    }, { isolationLevel: "Serializable", timeout: 15_000, maxWait: 10_000 }));
    const reservation = result.reservation;
    return NextResponse.json({ reservationId: reservation.id, accessToken: createReservationToken(reservation.id), reference: reservation.reference,
      total: Number(reservation.totalAmount), discount: Number(reservation.discountAmount), holdExpiresAt: reservation.holdExpiresAt }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof BookingError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (typeof error === "object" && error && "status" in error && error.status === 429)
      return NextResponse.json({ error: "Limite de reservas atingido. Tenta novamente mais tarde." }, { status: 429 });
    return NextResponse.json({ error: "Não foi possível guardar a reserva. Tenta novamente." }, { status: 503 });
  }
}
