import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CONTACT"),
    status: z.enum(["TO_CONTACT", "CONTACTED", "AWAITING_PAYMENT", "NO_RESPONSE"]),
    comment: z.string().trim().max(1000).optional().default(""),
  }),
  z.object({ action: z.literal("APPROVE") }),
  z.object({ action: z.literal("SEND_APPROVAL_SMS") }),
  z.object({ action: z.literal("RESEND_SMS") }),
  z.object({ action: z.literal("RELEASE") }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
  const { id } = await context.params;
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { customer: true },
  });
  if (!reservation)
    return NextResponse.json({ error: "Inscrição não encontrada." }, { status: 404 });
  if (!(["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"] as string[]).includes(reservation.status))
    return NextResponse.json(
      { error: "Esta acção só está disponível para pré-reservas activas." },
      { status: 409 },
    );

  if (parsed.data.action === "CONTACT") {
    await prisma.$transaction([
      prisma.reservation.update({
        where: { id },
        data: { contactStatus: parsed.data.status },
      }),
      prisma.contactActivity.create({
        data: {
          reservationId: id,
          userId: user.id,
          outcome: parsed.data.status,
          comment: parsed.data.comment || null,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PRE_RESERVATION_CONTACT_UPDATED",
          entityType: "Reservation",
          entityId: id,
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "APPROVE") {
    if (reservation.status !== "PRE_RESERVED")
      return NextResponse.json(
        { error: "Só é possível aprovar uma pré-reserva por analisar." },
        { status: 409 },
      );
    const approved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
      const current = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { route: true, pickupPoint: true } });
      if (current.status !== "PRE_RESERVED") return false;
      const updated = await tx.reservation.updateMany({
        where: { id, status: "PRE_RESERVED" },
        data: {
          status: "PAYMENT_PENDING",
          contactStatus: "AWAITING_PAYMENT",
          operationalConfirmed: Boolean(current.route?.active && current.pickupPoint?.operationalConfirmed && current.pickupPoint.departureAt),
        },
      });
      if (!updated.count) return false;
      await tx.contactActivity.create({
        data: {
          reservationId: id,
          userId: user.id,
          outcome: "AWAITING_PAYMENT",
          comment: "Pré-reserva aprovada pela equipa FestGO.",
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "PRE_RESERVATION_APPROVED",
          entityType: "Reservation",
          entityId: id,
          ipAddress: clientIp(request),
        },
      });
      return true;
    });
    return approved
      ? NextResponse.json({ ok: true })
      : NextResponse.json(
          { error: "A pré-reserva já foi alterada por outro administrador." },
          { status: 409 },
        );
  }

  if (["SEND_APPROVAL_SMS", "RESEND_SMS"].includes(parsed.data.action)) {
    return NextResponse.json(
      { error: "Esta comunicação foi desactivada. Usa o envio manual de um link de checkout válido." },
      { status: 409 },
    );
  }

  if (parsed.data.action === "RELEASE") {
    const now = new Date();
    const released = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
      const current = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      if (!["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"].includes(current.status) || current.payments.some((payment) => ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED", "REFUND_PENDING", "REFUNDED"].includes(payment.status))) return false;
      await tx.reservation.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      await tx.seatPreference.updateMany({
        where: { reservationId: id, releasedAt: null },
        data: { status: "RELEASED", releasedAt: now },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "PRE_RESERVATION_CANCELLED_AND_SEATS_RELEASED",
          entityType: "Reservation",
          entityId: id,
          ipAddress: clientIp(request),
        },
      });
      return true;
    });
    return released ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "A reserva foi alterada ou tem um pagamento por reconciliar." }, { status: 409 });
  }

  return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
}
