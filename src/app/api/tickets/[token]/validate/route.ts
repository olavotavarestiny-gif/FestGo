import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const inputSchema = z.object({
  leg: z.enum(["OUTBOUND", "RETURN"]),
  deviceId: z.string().trim().max(120).optional(),
});

async function findTicket(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  return prisma.ticket.findUnique({
    where: { publicToken: token },
    include: {
      validations: true,
      passenger: {
        include: {
          reservation: { include: { event: true, pickupPoint: true } },
        },
      },
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await staffFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try { await enforceRateLimit({ namespace: "scanner-read", identifier: user.id, limit: 180, windowMs: 60_000 }); }
  catch { return NextResponse.json({ error: "Demasiadas consultas. Aguarda um momento." }, { status: 429 }); }
  const ticket = await findTicket((await params).token);
  if (!ticket)
    return NextResponse.json(
      { error: "Bilhete inexistente." },
      { status: 404 },
    );
  const reservation = ticket.passenger.reservation;
  return NextResponse.json({
    passenger: ticket.passenger.fullName,
    event: reservation.event.name,
    eventDate: reservation.event.eventDate,
    pickupPoint: reservation.pickupPoint?.name ?? "Por confirmar",
    status: ticket.status,
    reservationStatus: reservation.status,
    used: ticket.validations.map((item) => item.leg),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await staffFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Indica o trajecto." }, { status: 400 });
  const ticket = await findTicket((await params).token);
  if (!ticket)
    return NextResponse.json(
      { error: "Bilhete inexistente." },
      { status: 404 },
    );
  if (
    ticket.status !== "VALID" ||
    ticket.passenger.reservation.status !== "PAID"
  )
    return NextResponse.json(
      { error: "Bilhete inválido ou revogado." },
      { status: 409 },
    );
  try {
    const validation = await prisma.$transaction(async (tx) => {
      // Same lock order as payment/refund finalization: a revoked ticket cannot race check-in.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${ticket.passenger.reservation.eventId} FOR UPDATE`;
      const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { passenger: { include: { reservation: { include: { event: true } } } } } });
      if (current.status !== "VALID" || current.revokedAt || current.passenger.reservation.status !== "PAID" || current.passenger.reservation.event.status === "CANCELLED")
        throw new Error("TICKET_REVOKED");
      const created = await tx.ticketValidation.create({
        data: {
          ticketId: ticket.id,
          leg: parsed.data.leg,
          operatorId: user.id,
          deviceId: parsed.data.deviceId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "TICKET_VALIDATED",
          entityType: "Ticket",
          entityId: ticket.id,
          metadata: { leg: parsed.data.leg },
          ipAddress: clientIp(request),
        },
      });
      return created;
    });
    return NextResponse.json({
      valid: true,
      passenger: ticket.passenger.fullName,
      leg: parsed.data.leg,
      validatedAt: validation.validatedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TICKET_REVOKED")
      return NextResponse.json({ error: "Bilhete cancelado, reembolsado ou não pago." }, { status: 409 });
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "Este trajecto já foi validado." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Não foi possível validar o bilhete." },
      { status: 503 },
    );
  }
}
