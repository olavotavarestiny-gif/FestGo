import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { verifyReservationToken } from "@/lib/reservation-access";
import {
  ageOnDate,
  isPreReservationMode,
  normalizeAngolanPhone,
  parseBirthDate,
} from "@/lib/pre-reservations";
import { schedulePostPaymentJobs } from "@/lib/schedule-jobs";

export const runtime = "nodejs";

const schema = z.object({
  reservationId: z.string().min(8).max(40),
  accessToken: z.string().min(32).max(100),
  passengers: z.array(z.object({
    fullName: z.string().trim().min(3).max(120),
    birthDate: z.string(),
  })).min(1).max(100),
  seats: z.array(z.number().int().min(1).max(100)).max(100),
  minorGuardianName: z.string().trim().max(120).optional().default(""),
  minorGuardianPhone: z.string().trim().max(24).optional().default(""),
  joinWaitlist: z.boolean().default(false),
  terms: z.literal(true),
});

class PreReservationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly seats?: number[],
  ) {
    super(message);
  }
}

async function serializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 4
      )
        throw error;
    }
  }
  throw new Error("Transaction retry exhausted.");
}

export async function POST(request: Request) {
  if (!isPreReservationMode())
    return NextResponse.json(
      { error: "As pré-reservas ainda não estão abertas." },
      { status: 409 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Confirma passageiros, lugares e condições." },
      { status: 400 },
    );
  const input = parsed.data;
  if (!verifyReservationToken(input.reservationId, input.accessToken))
    return NextResponse.json({ error: "Inscrição não autorizada." }, { status: 403 });

  try {
    await enforceRateLimit({
      namespace: "pre-reservation-complete-ip",
      identifier: clientIp(request),
      limit: 15,
      windowMs: 60 * 60_000,
    });
    const result = await serializable(() =>
      prisma.$transaction(
        async (tx) => {
          const reservation = await tx.reservation.findUnique({
            where: { id: input.reservationId },
            include: {
              customer: true,
              event: true,
              seatPreferences: { where: { releasedAt: null } },
            },
          });
          if (!reservation)
            throw new PreReservationError("Inscrição não encontrada.", 404);
          if (reservation.status !== "LEAD") {
            if (["PRE_RESERVED", "WAITLIST"].includes(reservation.status))
              return reservation;
            throw new PreReservationError(
              "Esta inscrição já não pode ser alterada.",
              409,
            );
          }
          if (input.passengers.length !== reservation.quantity)
            throw new PreReservationError(
              `Confirma os dados dos ${reservation.quantity} passageiros.`,
              400,
            );
          if (reservation.quantity > reservation.event.capacity)
            throw new PreReservationError("A quantidade ultrapassa a capacidade do evento.", 400);
          if (input.seats.some((seat) => seat > reservation.event.capacity))
            throw new PreReservationError("Um dos lugares é inválido.", 400);
          const passengerData = input.passengers.map((passenger) => {
            const birthDate = parseBirthDate(passenger.birthDate);
            if (!birthDate)
              throw new PreReservationError("Indica uma data de nascimento válida para todos os passageiros.", 400);
            const ageAtEvent = ageOnDate(birthDate, reservation.event.eventDate);
            if (ageAtEvent < 0 || ageAtEvent > 120)
              throw new PreReservationError("Confirma as datas de nascimento dos passageiros.", 400);
            return {
              fullName: passenger.fullName,
              birthDate,
              ageAtEvent,
              isMinor: ageAtEvent < reservation.event.minorAgeLimit,
            };
          });
          const minorCount = passengerData.filter((passenger) => passenger.isMinor).length;
          const guardianPhone = input.minorGuardianPhone
            ? normalizeAngolanPhone(input.minorGuardianPhone)
            : null;
          if (
            minorCount > 0 &&
            (input.minorGuardianName.length < 4 || !guardianPhone)
          )
            throw new PreReservationError(
              "Identifica o adulto responsável pelos menores.",
              400,
            );
          if (new Set(input.seats).size !== input.seats.length)
            throw new PreReservationError("Escolhe lugares diferentes.", 400);
          if (!input.joinWaitlist && input.seats.length !== reservation.quantity)
            throw new PreReservationError(
              `Escolhe exactamente ${reservation.quantity} lugar${reservation.quantity === 1 ? "" : "es"}.`,
              400,
            );
          if (input.joinWaitlist && input.seats.length)
            throw new PreReservationError(
              "A lista de espera não pode incluir lugares.",
              400,
            );

          await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
          if (!input.joinWaitlist) {
            const taken = await tx.seatPreference.findMany({
              where: {
                eventId: reservation.eventId,
                seatNumber: { in: input.seats },
                releasedAt: null,
              },
              select: { seatNumber: true },
            });
            if (taken.length)
              throw new PreReservationError(
                "Um dos lugares acabou de ser escolhido. Selecciona outro.",
                409,
                "SEATS_TAKEN",
                taken.map((seat) => seat.seatNumber),
              );
          }

          await tx.reservationPassenger.deleteMany({
            where: { reservationId: reservation.id },
          });
          await tx.reservation.update({
            where: { id: reservation.id },
            data: {
              status: input.joinWaitlist ? "WAITLIST" : "PRE_RESERVED",
              termsAcceptedAt: new Date(),
              minorCount,
              minorAgeLimit: reservation.event.minorAgeLimit,
              minorGuardianName: minorCount ? input.minorGuardianName : null,
              minorGuardianPhone: minorCount ? guardianPhone : null,
              passengers: {
                create: passengerData,
              },
            },
          });
          if (!input.joinWaitlist)
            await tx.seatPreference.createMany({
              data: input.seats.map((seatNumber) => ({
                eventId: reservation.eventId,
                reservationId: reservation.id,
                seatNumber,
              })),
            });
          await tx.contactActivity.create({
            data: {
              reservationId: reservation.id,
              outcome: "TO_CONTACT",
              comment: "Pré-reserva recebida pelo website.",
            },
          });
          if (process.env.ZIETT_API_KEY && process.env.ZIETT_SMS_REMITTER_ID) {
            await tx.notification.create({
              data: {
                reservationId: reservation.id,
                channel: "SMS",
                recipient: reservation.customer.phone,
                template: "PRE_RESERVATION_RECEIVED",
              },
            });
          }
          if (process.env.KUKUGEST_ENABLED === "true") {
            await tx.cRMIntegrationJob.upsert({
              where: {
                reservationId_kind: {
                  reservationId: reservation.id,
                  kind: "PRE_RESERVATION_CONTACT",
                },
              },
              update: { status: "PENDING", nextAttemptAt: new Date() },
              create: {
                reservationId: reservation.id,
                kind: "PRE_RESERVATION_CONTACT",
              },
            });
          }
          return tx.reservation.findUniqueOrThrow({
            where: { id: reservation.id },
            include: {
              customer: true,
              seatPreferences: { where: { releasedAt: null } },
            },
          });
        },
        { isolationLevel: "Serializable", timeout: 10_000 },
      ),
    );
    schedulePostPaymentJobs(request);
    return NextResponse.json(
      {
        reference: result.reference,
        status: result.status,
        plan: result.plan,
        quantity: result.quantity,
        total: Number(result.totalAmount),
        pickupPreference: result.pickupPreference,
        pickupOther: result.pickupOther,
        seats: result.seatPreferences.map((seat) => seat.seatNumber).sort((a, b) => a - b),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PreReservationError)
      return NextResponse.json(
        { error: error.message, code: error.code, seats: error.seats },
        { status: error.status },
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "Um dos lugares acabou de ser escolhido. Selecciona outro.", code: "SEATS_TAKEN" },
        { status: 409 },
      );
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    )
      return NextResponse.json(
        { error: "Limite atingido. Tenta novamente mais tarde." },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Não foi possível concluir a pré-reserva. Tenta novamente." },
      { status: 503 },
    );
  }
}
