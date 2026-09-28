import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

const schema = z.object({
  leg: z.enum(["OUTBOUND", "RETURN"]),
  deviceId: z.string().trim().max(120).optional(),
});

async function findTestTicket(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  return prisma.testTicket.findUnique({
    where: { publicToken: token },
    include: { testReservation: true, validations: true },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const ticket = await findTestTicket((await context.params).token);
  if (!ticket)
    return NextResponse.json(
      { error: "Bilhete de teste inexistente." },
      { status: 404 },
    );
  return NextResponse.json({
    test: true,
    passenger: ticket.testReservation.passengerName,
    event: ticket.testReservation.eventName,
    pickupPoint: ticket.testReservation.pickupPreference,
    seat: ticket.testReservation.testSeat,
    reference: ticket.testReservation.reference,
    status: ticket.status,
    reservationStatus: ticket.testReservation.status,
    used: ticket.validations.map((item) => item.leg),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Indica o trajecto." }, { status: 400 });
  const ticket = await findTestTicket((await context.params).token);
  if (!ticket)
    return NextResponse.json(
      { error: "Bilhete de teste inexistente." },
      { status: 404 },
    );
  if (ticket.status !== "VALID" || ticket.testReservation.status !== "PAID")
    return NextResponse.json(
      { error: "Bilhete de teste inválido." },
      { status: 409 },
    );
  try {
    const validation = await prisma.$transaction(async (tx) => {
      const created = await tx.testTicketValidation.create({
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
          action: "TEST_TICKET_VALIDATED",
          entityType: "TestTicket",
          entityId: ticket.id,
          metadata: { leg: parsed.data.leg, test: true },
          ipAddress: clientIp(request),
        },
      });
      return created;
    });
    return NextResponse.json({
      valid: true,
      test: true,
      passenger: ticket.testReservation.passengerName,
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
        { error: "Este trajecto de teste já foi validado." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Não foi possível validar o bilhete de teste." },
      { status: 503 },
    );
  }
}
