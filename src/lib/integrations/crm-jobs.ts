import { prisma } from "@/lib/db";
import { registerKukuGestSale } from "@/lib/integrations/kukugest";

export async function processCRMJobs(
  options: { reservationId?: string; limit?: number } = {},
) {
  const jobs = await prisma.cRMIntegrationJob.findMany({
    where: {
      ...(options.reservationId
        ? { reservationId: options.reservationId }
        : {}),
      attempts: { lt: 5 },
      OR: [
        {
          status: { in: ["PENDING", "FAILED"] },
          nextAttemptAt: { lte: new Date() },
        },
        {
          status: "PROCESSING",
          updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
        },
      ],
    },
    include: {
      reservation: {
        include: { customer: true, event: true, pickupPoint: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(options.limit ?? 20, 1), 20),
  });
  let succeeded = 0;

  for (const job of jobs) {
    const claimed = await prisma.cRMIntegrationJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          {
            status: "PROCESSING",
            updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
          },
        ],
      },
      data: { status: "PROCESSING" },
    });
    if (claimed.count !== 1) continue;

    try {
      const reservation = job.reservation;
      const result = await registerKukuGestSale({
        reservationId: reservation.id,
        reference: reservation.reference,
        eventName: reservation.event.name,
        amount: Number(reservation.totalAmount),
        paidAt: reservation.paidAt ?? reservation.updatedAt,
        pickupPoint: reservation.pickupPoint.name,
        quantity: reservation.quantity,
        customer: {
          name: reservation.customer.fullName,
          phone: reservation.customer.phone,
          email: reservation.customer.email,
        },
      });
      await prisma.$transaction([
        prisma.cRMIntegrationJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            attempts: { increment: 1 },
            lastError: null,
          },
        }),
        ...(result.contactId
          ? [
              prisma.customer.update({
                where: { id: reservation.customerId },
                data: { crmExternalId: String(result.contactId) },
              }),
            ]
          : []),
      ]);
      succeeded += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Falha desconhecida.";
      await prisma.cRMIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: attempts >= 5 ? "DEAD_LETTER" : "FAILED",
          attempts,
          lastError: message,
          nextAttemptAt: new Date(
            Date.now() + Math.min(60, 2 ** attempts) * 60_000,
          ),
        },
      });
    }
  }
  return { processed: jobs.length, succeeded };
}
