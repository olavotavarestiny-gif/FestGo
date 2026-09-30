import { prisma } from "@/lib/db";
import { registerKukuGestSale, upsertKukuGestPreReservation } from "@/lib/integrations/kukugest";

export async function processCRMJobs(options: { reservationId?: string; limit?: number } = {}) {
  const jobs = await prisma.cRMIntegrationJob.findMany({
    where: {
      ...(options.reservationId ? { reservationId: options.reservationId } : {}), attempts: { lt: 5 },
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
        { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      ],
    }, include: { reservation: { select: { eventId: true } } }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(options.limit ?? 20, 1), 20),
  });
  let succeeded = 0;
  for (const job of jobs) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${job.reservation.eventId} FOR UPDATE`;
        const claimed = await tx.cRMIntegrationJob.updateMany({
          where: {
            id: job.id, attempts: { lt: 5 },
            OR: [
              { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
              { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
            ],
          }, data: { status: "PROCESSING" },
        });
        if (claimed.count !== 1) return false;
        const currentJob = await tx.cRMIntegrationJob.findUniqueOrThrow({ where: { id: job.id } });
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id: job.reservationId }, include: { customer: true, event: true, pickupPoint: true, payments: true, seatPreferences: { where: { releasedAt: null } } },
        });
        if (!["SALE", "PRE_RESERVATION_CONTACT"].includes(job.kind) || (job.kind === "SALE" && (reservation.status !== "PAID" || !reservation.paidAt || !reservation.payments.some((payment) => payment.status === "SUCCEEDED")))) {
          await tx.cRMIntegrationJob.update({ where: { id: job.id }, data: { status: "DEAD_LETTER", lastError: "A reserva não possui uma venda confirmada activa ou o tipo de tarefa é inválido." } });
          return false;
        }
        const attempts = currentJob.attempts + 1;
        await tx.cRMIntegrationJob.update({ where: { id: job.id }, data: { attempts } });
        try {
          const customer = { name: reservation.customer.fullName, phone: reservation.customer.phone, email: reservation.customer.email };
          const response = job.kind === "PRE_RESERVATION_CONTACT"
            ? await upsertKukuGestPreReservation({ reference: reservation.reference, eventName: reservation.event.name, plan: reservation.plan ?? "Por definir", commercialStatus: reservation.contactStatus, pickupPreference: reservation.pickupOther || reservation.pickupPreference || "Por definir", seats: reservation.seatPreferences.map((seat) => seat.seatNumber), customer })
            : await registerKukuGestSale({ reservationId: reservation.id, reference: reservation.reference, eventName: reservation.event.name, amount: Number(reservation.totalAmount), paidAt: reservation.paidAt!, pickupPoint: reservation.pickupPoint?.name || reservation.pickupOther || reservation.pickupPreference || "Por definir", quantity: reservation.quantity, customer });
          await tx.cRMIntegrationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", lastError: null } });
          if (response.contactId) await tx.customer.update({ where: { id: reservation.customerId }, data: { crmExternalId: String(response.contactId) } });
          await tx.auditLog.create({ data: { action: "CRM_SYNC_SUCCEEDED", entityType: "CRMIntegrationJob", entityId: job.id, metadata: { reservationId: reservation.id, integration: "kukugest", kind: job.kind, attempt: attempts } } });
          return true;
        } catch {
          await tx.cRMIntegrationJob.update({ where: { id: job.id }, data: { status: attempts >= 5 ? "DEAD_LETTER" : "FAILED", lastError: "O KukuGest não confirmou a sincronização.", nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000) } });
          await tx.auditLog.create({ data: { action: "CRM_SYNC_FAILED", entityType: "CRMIntegrationJob", entityId: job.id, metadata: { reservationId: reservation.id, integration: "kukugest", kind: job.kind, attempt: attempts } } });
          return false;
        }
      }, { timeout: 12_000 });
      if (result) succeeded += 1;
    } catch {
      // Local failures retry the durable job. Sales are committed separately.
    }
  }
  return { processed: jobs.length, succeeded };
}
