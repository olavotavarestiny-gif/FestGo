import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const deletableStatuses = new Set([
  "LEAD",
  "PRE_RESERVED",
  "WAITLIST",
  "CANCELLED",
  "EXPIRED",
]);

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  try {
    await enforceRateLimit({
      namespace: "admin-delete-customer",
      identifier: user.id,
      limit: 10,
      windowMs: 60 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Limite de eliminações atingido. Tenta mais tarde." },
      { status: 429 },
    );
  }

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      reservations: {
        include: {
          payments: { select: { id: true } },
          passengers: { include: { ticket: { select: { id: true } } } },
        },
      },
      referralCodes: {
        include: { redemptions: { select: { id: true } } },
      },
    },
  });
  if (!customer)
    return NextResponse.json({ error: "Contacto não encontrado." }, { status: 404 });

  const protectedRecord =
    customer.reservations.some(
      (reservation) =>
        !deletableStatuses.has(reservation.status) ||
        reservation.payments.length > 0 ||
        reservation.passengers.some((passenger) => passenger.ticket),
    ) || customer.referralCodes.some((code) => code.redemptions.length > 0);
  if (protectedRecord)
    return NextResponse.json(
      {
        error:
          "Este contacto possui pagamento, bilhete ou histórico comercial protegido e não pode ser eliminado.",
      },
      { status: 409 },
    );

  const reservationIds = customer.reservations.map((reservation) => reservation.id);
  await prisma.$transaction(async (tx) => {
    if (reservationIds.length) {
      await tx.notification.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await tx.cRMIntegrationJob.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await tx.referralRedemption.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await tx.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await tx.referralCode.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UNCONVERTED_CONTACT_DELETED",
        entityType: "Customer",
        metadata: { reservationsDeleted: reservationIds.length },
        ipAddress: clientIp(request),
      },
    });
  });
  return NextResponse.json({ ok: true });
}
