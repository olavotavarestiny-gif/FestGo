import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

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
    pickupPoint: reservation.pickupPoint.name,
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
