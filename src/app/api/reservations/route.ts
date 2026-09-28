import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createReservationToken } from "@/lib/reservation-access";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { arePaymentsEnabled } from "@/lib/pre-reservations";

export const runtime = "nodejs";

const bookingSchema = z.object({
  name: z.string().trim().min(4).max(120),
  phone: z.string().trim().min(9).max(24),
  email: z.string().trim().email().max(254),
  pickup: z.string().trim().min(2).max(100),
  passengers: z.array(z.string().trim().min(3).max(120)).min(1).max(6),
  referral: z.string().trim().max(80).optional().default(""),
  terms: z.literal(true),
  marketing: z.boolean().default(false),
  verificationId: z.string().min(8).max(40),
  idempotencyKey: z.string().uuid(),
});

class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("244") ? digits.slice(3) : digits;
  return /^9\d{8}$/.test(national) ? `+244${national}` : null;
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 7
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          (attempt + 1) * 10 + Math.floor(Math.random() * 10),
        ),
      );
    }
  }
  throw new Error("Serializable transaction retry exhausted.");
}

export async function POST(request: Request) {
  if (!arePaymentsEnabled())
    return NextResponse.json(
      { error: "As reservas ainda não estão abertas." },
      { status: 409 },
    );
  const parsed = bookingSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Confirma os dados e aceita os termos para continuar." },
      { status: 400 },
    );
  const input = parsed.data;
  const phone = normalizePhone(input.phone);
  if (!phone || input.passengers.length < 1) {
    return NextResponse.json(
      { error: "Indica um número angolano e pelo menos um passageiro." },
      { status: 400 },
    );
  }
  if (!process.env.DATABASE_URL)
    return NextResponse.json(
      { error: "A base de dados ainda não está configurada." },
      { status: 503 },
    );

  try {
    const existing = await prisma.reservation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { customer: true },
    });
    if (existing) {
      if (existing.customer.phone !== phone)
        return NextResponse.json(
          { error: "Chave de reserva inválida." },
          { status: 409 },
        );
      return NextResponse.json({
        reservationId: existing.id,
        accessToken: createReservationToken(existing.id),
        reference: existing.reference,
        total: Number(existing.totalAmount),
        discount: Number(existing.discountAmount),
        holdExpiresAt: existing.holdExpiresAt,
      });
    }
    await Promise.all([
      enforceRateLimit({
        namespace: "reservation-ip",
        identifier: clientIp(request),
        limit: 12,
        windowMs: 60 * 60_000,
      }),
      enforceRateLimit({
        namespace: "reservation-phone",
        identifier: phone,
        limit: 4,
        windowMs: 24 * 60 * 60_000,
      }),
    ]);

    const result = await retrySerializable(() =>
      prisma.$transaction(
        async (tx) => {
          const event = await tx.event.findUnique({
            where: { slug: "brunch-mangais" },
          });
          if (!event || event.status !== "ON_SALE")
            throw new BookingError("As reservas ainda não estão abertas.", 409);

          await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;
          const now = new Date();
          const challenge = await tx.sMSVerification.findFirst({
            where: {
              id: input.verificationId,
              phone,
              verifiedAt: { not: null },
              usedAt: null,
              expiresAt: { gt: now },
            },
          });
          if (!challenge)
            throw new BookingError(
              "Confirma novamente o teu número de telefone.",
              401,
            );

          const route = await tx.route.findFirst({
            where: { eventId: event.id, active: true },
          });
          if (!route)
            throw new BookingError("A rota ainda não está disponível.", 503);
          const pickup = await tx.pickupPoint.findFirst({
            where: { routeId: route.id, name: input.pickup },
          });
          if (!pickup)
            throw new BookingError(
              "O ponto de embarque seleccionado já não está disponível.",
              400,
            );

          const occupied = await tx.reservation.aggregate({
            where: {
              eventId: event.id,
              OR: [
                { status: "PAID" },
                { status: "PAYMENT_UNCERTAIN" },
                {
                  status: { in: ["HELD", "AWAITING_PAYMENT"] },
                  holdExpiresAt: { gt: now },
                },
              ],
            },
            _sum: { quantity: true },
          });
          const sold = occupied._sum.quantity ?? 0;
          const available = Math.min(event.capacity, route.capacity) - sold;
          if (input.passengers.length > available)
            throw new BookingError(
              "Já não há lugares suficientes para esta reserva.",
              409,
            );

          const customer = await tx.customer.upsert({
            where: { phone },
            update: {
              fullName: input.name,
              email: input.email,
              marketingConsent: input.marketing,
              consentUpdatedAt: now,
            },
            create: {
              fullName: input.name,
              phone,
              email: input.email,
              marketingConsent: input.marketing,
              consentUpdatedAt: now,
            },
          });

          const subtotal = Number(event.basePrice) * input.passengers.length;
          let discountAmount = 0;
          let referralCodeId: string | null = null;
          let discountId: string | null = null;
          const code = input.referral.toUpperCase();
          if (code) {
            const referral = await tx.referralCode.findUnique({
              where: { code },
              include: {
                customer: {
                  include: {
                    reservations: {
                      where: { status: "PAID" },
                      take: 1,
                      select: { id: true },
                    },
                  },
                },
              },
            });
            if (referral) {
              if (
                !referral.active ||
                referral.customer.phone === phone ||
                referral.customer.reservations.length === 0
              ) {
                throw new BookingError(
                  "Este código de recomendação não é válido para esta compra.",
                  400,
                );
              }
              referralCodeId = referral.id;
              discountAmount = Math.floor(subtotal * 0.05);
            } else {
              const discount = await tx.discount.findUnique({
                where: { code },
              });
              if (
                !discount ||
                !discount.active ||
                (discount.eventId && discount.eventId !== event.id) ||
                (discount.startsAt && discount.startsAt > now) ||
                (discount.endsAt && discount.endsAt < now) ||
                (discount.maxRedemptions !== null &&
                  discount.usedCount >= discount.maxRedemptions)
              ) {
                throw new BookingError(
                  "O código promocional não é válido.",
                  400,
                );
              }
              discountId = discount.id;
              discountAmount =
                discount.type === "PERCENT"
                  ? Math.floor((subtotal * Number(discount.value)) / 100)
                  : Math.min(subtotal, Number(discount.value));
            }
          }
          if (discountAmount > subtotal)
            throw new BookingError(
              "O desconto não pode exceder o total da reserva.",
              400,
            );

          const reference = `FG-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
          const reservation = await tx.reservation.create({
            data: {
              reference,
              eventId: event.id,
              routeId: route.id,
              pickupPointId: pickup.id,
              customerId: customer.id,
              discountId,
              status: "HELD",
              quantity: input.passengers.length,
              unitPrice: event.basePrice,
              discountAmount,
              totalAmount: subtotal - discountAmount,
              currency: "AOA",
              holdExpiresAt: new Date(now.getTime() + 15 * 60_000),
              idempotencyKey: input.idempotencyKey,
              passengers: {
                create: input.passengers.map((fullName) => ({ fullName })),
              },
            },
          });

          if (referralCodeId) {
            await tx.referralRedemption.create({
              data: {
                referralCodeId,
                reservationId: reservation.id,
                amount: discountAmount,
              },
            });
          }
          await tx.sMSVerification.update({
            where: { id: challenge.id },
            data: { usedAt: now },
          });

          return {
            reservationId: reservation.id,
            reference,
            total: subtotal - discountAmount,
            discount: discountAmount,
            holdExpiresAt: reservation.holdExpiresAt,
          };
        },
        { isolationLevel: "Serializable", timeout: 10_000 },
      ),
    );

    return NextResponse.json(
      { ...result, accessToken: createReservationToken(result.reservationId) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BookingError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    )
      return NextResponse.json(
        { error: "Limite de reservas atingido. Tenta novamente mais tarde." },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Não foi possível guardar a reserva. Tenta novamente." },
      { status: 503 },
    );
  }
}
