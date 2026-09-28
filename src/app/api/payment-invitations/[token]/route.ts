import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parsePaymentInvitationToken } from "@/lib/payment-invitations";
import {
  commercialPlans,
  pickupPreferences,
} from "@/lib/pre-reservations";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z
  .object({
    plan: z.enum(["INDIVIDUAL", "DUO", "DUO_INDIVIDUAL", "GROUP"]),
    passengers: z.array(z.string().trim().min(3).max(120)).min(1).max(4),
    seats: z.array(z.number().int().min(1).max(30)).min(1).max(4),
    pickupPreference: z.enum([
      "CIDADE_PRIMEIRO_MAIO",
      "TALATONA_BELAS",
      "11_NOVEMBRO",
      "BENFICA_GIRAFA",
      "OUTRO",
    ]),
    pickupOther: z.string().trim().max(160).optional().default(""),
  })
  .superRefine((value, context) => {
    const quantity = commercialPlans[value.plan].quantity;
    if (value.passengers.length !== quantity)
      context.addIssue({
        code: "custom",
        path: ["passengers"],
        message: `Este plano exige ${quantity} passageiro${quantity === 1 ? "" : "s"}.`,
      });
    if (value.seats.length !== quantity || new Set(value.seats).size !== quantity)
      context.addIssue({
        code: "custom",
        path: ["seats"],
        message: `Escolhe exactamente ${quantity} lugar${quantity === 1 ? "" : "es"}.`,
      });
    if (value.pickupPreference === "OUTRO" && value.pickupOther.length < 3)
      context.addIssue({
        code: "custom",
        path: ["pickupOther"],
        message: "Indica a localização pretendida.",
      });
  });

class InvitationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly seats?: number[],
  ) {
    super(message);
  }
}

function tokenMatches(
  parsed: { id: string; nonce: string; expiresAt: Date },
  invitation: { id: string; nonce: string; expiresAt: Date; revokedAt: Date | null },
) {
  return (
    parsed.id === invitation.id &&
    parsed.nonce === invitation.nonce &&
    Math.floor(parsed.expiresAt.getTime() / 1000) ===
      Math.floor(invitation.expiresAt.getTime() / 1000) &&
    !invitation.revokedAt &&
    invitation.expiresAt > new Date()
  );
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

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const parsedToken = parsePaymentInvitationToken(token);
  if (!parsedToken)
    return NextResponse.json(
      { error: "Este convite é inválido ou expirou." },
      { status: 404 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Confirma os dados." },
      { status: 400 },
    );
  try {
    await enforceRateLimit({
      namespace: "payment-invitation-update",
      identifier: `${parsedToken.id}:${clientIp(request)}`,
      limit: 12,
      windowMs: 60 * 60_000,
    });
    const result = await serializable(() =>
      prisma.$transaction(
        async (tx) => {
          const invitation = await tx.paymentInvitation.findUnique({
            where: { id: parsedToken.id },
            include: {
              reservation: {
                include: {
                  passengers: true,
                  seatPreferences: { where: { releasedAt: null } },
                  payments: {
                    where: {
                      status: {
                        in: ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED"],
                      },
                    },
                    take: 1,
                  },
                },
              },
            },
          });
          if (!invitation || !tokenMatches(parsedToken, invitation))
            throw new InvitationError("Este convite é inválido ou expirou.", 404);
          const reservation = invitation.reservation;
          if (reservation.status !== "PAYMENT_PENDING")
            throw new InvitationError(
              "Esta pré-reserva já não pode ser alterada.",
              409,
            );
          if (reservation.payments.length)
            throw new InvitationError(
              "Já existe uma cobrança associada a esta reserva.",
              409,
            );
          if (
            parsed.data.plan === "DUO_INDIVIDUAL" &&
            reservation.plan !== "DUO_INDIVIDUAL"
          )
            throw new InvitationError(
              "Escolhe Individual, Dupla ou Grupo.",
              400,
            );

          await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
          const event = await tx.event.findUniqueOrThrow({
            where: { id: reservation.eventId },
            select: { capacity: true },
          });
          if (parsed.data.seats.some((seat) => seat > event.capacity))
            throw new InvitationError("Um dos lugares é inválido.", 400);
          const plan = commercialPlans[parsed.data.plan];
          const pickup = pickupPreferences.find(
            (option) => option.code === parsed.data.pickupPreference,
          );
          if (!pickup)
            throw new InvitationError("Ponto de recolha inválido.", 400);
          const taken = await tx.seatPreference.findMany({
            where: {
              eventId: reservation.eventId,
              reservationId: { not: reservation.id },
              seatNumber: { in: parsed.data.seats },
              releasedAt: null,
            },
            select: { seatNumber: true },
          });
          if (taken.length)
            throw new InvitationError(
              "Um dos lugares acabou de ser escolhido. Selecciona outro.",
              409,
              taken.map((seat) => seat.seatNumber),
            );

          const before = {
            plan: reservation.plan,
            quantity: reservation.quantity,
            pickupPreference: reservation.pickupPreference,
            pickupOther: reservation.pickupOther,
            passengers: reservation.passengers.map((passenger) => passenger.fullName),
            seats: reservation.seatPreferences.map((seat) => seat.seatNumber),
          };
          await tx.seatPreference.updateMany({
            where: { reservationId: reservation.id, releasedAt: null },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
          await tx.reservationPassenger.deleteMany({
            where: { reservationId: reservation.id },
          });
          await tx.reservation.update({
            where: { id: reservation.id },
            data: {
              plan: parsed.data.plan,
              quantity: plan.quantity,
              unitPrice: plan.listTotal / plan.quantity,
              discountAmount: plan.listTotal - plan.total,
              totalAmount: plan.total,
              pickupPreference: pickup.label,
              pickupOther:
                parsed.data.pickupPreference === "OUTRO"
                  ? parsed.data.pickupOther
                  : null,
              holdExpiresAt: invitation.expiresAt,
              passengers: {
                create: parsed.data.passengers.map((fullName) => ({ fullName })),
              },
              seatPreferences: {
                create: parsed.data.seats.map((seatNumber) => ({
                  eventId: reservation.eventId,
                  seatNumber,
                  status: "TEMPORARILY_HELD",
                })),
              },
            },
          });
          await tx.paymentInvitation.update({
            where: { id: invitation.id },
            data: { confirmedAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              action: "PAYMENT_INVITATION_DETAILS_CONFIRMED",
              entityType: "Reservation",
              entityId: reservation.id,
              metadata: {
                invitationId: invitation.id,
                before,
                after: {
                  plan: parsed.data.plan,
                  quantity: plan.quantity,
                  totalAmount: plan.total,
                  pickupPreference: pickup.label,
                  pickupOther:
                    parsed.data.pickupPreference === "OUTRO"
                      ? parsed.data.pickupOther
                      : null,
                  passengers: parsed.data.passengers,
                  seats: parsed.data.seats,
                },
              },
              ipAddress: clientIp(request),
            },
          });
          return {
            reference: reservation.reference,
            plan: parsed.data.plan,
            quantity: plan.quantity,
            total: plan.total,
            seats: parsed.data.seats,
            pickup: parsed.data.pickupOther || pickup.label,
          };
        },
        { isolationLevel: "Serializable", timeout: 10_000 },
      ),
    );
    return NextResponse.json({
      ok: true,
      ...result,
      paymentsEnabled: false,
      message:
        "Dados confirmados. A FestGo avisará quando o pagamento estiver disponível.",
    });
  } catch (error) {
    if (error instanceof InvitationError)
      return NextResponse.json(
        { error: error.message, seats: error.seats },
        { status: error.status },
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
      { error: "Não foi possível actualizar a pré-reserva." },
      { status: 503 },
    );
  }
}
