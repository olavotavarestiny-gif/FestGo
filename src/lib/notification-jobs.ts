import { prisma } from "@/lib/db";
import { abandonedCheckoutFollowupMinutes, publicBaseUrl } from "@/lib/config";
import { sendSms, ZiettError } from "@/lib/integrations/ziett";
import { canRecoverCheckout, checkoutRecoveryLink } from "@/lib/payment-invitations";
import { createTicketBundleToken } from "@/lib/ticket-access";
import { analyzeSms, smsTemplates } from "@/lib/sms";

const TEMPLATES = ["BOOKING_PAID", "PICKUP_DETAILS", "EVENT_REMINDER", "ABANDONED_CHECKOUT"];
const MAX_ATTEMPTS = 3;

export async function queueNotifications(now = new Date()) {
  // Retire unsent legacy communications as well as stopping new queue entries.
  await prisma.notification.updateMany({
    where: { template: { in: ["PRE_RESERVATION_RECEIVED", "PRE_RESERVATION_APPROVED"] }, status: { in: ["PENDING", "RETRY", "PROCESSING", "DRAFT"] } },
    data: { status: "CANCELLED", lastError: "Comunicação substituída pelo checkout no website." },
  });
  const reminders = await prisma.reservation.findMany({
    where: { status: "PAID", reference: { not: { startsWith: "FG-TEST-" } }, notifications: { none: { template: "EVENT_REMINDER", channel: "SMS" } }, event: { status: { not: "CANCELLED" }, eventDate: { gte: new Date(now.getTime() + 18 * 60 * 60_000), lte: new Date(now.getTime() + 30 * 60 * 60_000) } } },
    select: { id: true, customer: { select: { phone: true } } }, take: 100,
  });
  if (reminders.length) await prisma.notification.createMany({ data: reminders.map((r) => ({ reservationId: r.id, channel: "SMS" as const, recipient: r.customer.phone, template: "EVENT_REMINDER" })), skipDuplicates: true });

  const pickupDetails = await prisma.reservation.findMany({
    where: {
      status: "PAID", reference: { not: { startsWith: "FG-TEST-" } }, notifications: { none: { template: "PICKUP_DETAILS", channel: "SMS" } },
      event: { status: { not: "CANCELLED" }, eventDate: { gt: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60_000) } },
      pickupPoint: { operationalConfirmed: true, departureAt: { not: null }, address: { not: "Preferência; ponto exacto por confirmar" } },
    },
    select: { id: true, customer: { select: { phone: true } } }, take: 100,
  });
  if (pickupDetails.length) await prisma.notification.createMany({ data: pickupDetails.map((r) => ({ reservationId: r.id, channel: "SMS" as const, recipient: r.customer.phone, template: "PICKUP_DETAILS" })), skipDuplicates: true });

  const delay = abandonedCheckoutFollowupMinutes();
  const abandoned = delay <= 0 ? [] : await prisma.reservation.findMany({
    where: {
      status: { in: ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
      createdAt: { lte: new Date(now.getTime() - delay * 60_000) },
      // Only active, operational website checkouts are recoverable. A lead is
      // neither a checkout nor consent to unsolicited marketing.
      holdExpiresAt: { gt: now }, routeId: { not: null }, pickupPointId: { not: null },
      event: { status: { notIn: ["CANCELLED", "CLOSED"] }, eventDate: { gt: now } },
      payments: { none: { status: { in: ["SUCCEEDED", "UNKNOWN", "REFUND_PENDING", "REFUNDED"] } } },
      notifications: { none: { OR: [{ template: "ABANDONED_CHECKOUT" }, { template: "PAYMENT_LINK", status: { in: ["SENT", "PROCESSING"] } }] } },
    },
    select: { id: true, customer: { select: { phone: true } } }, take: 100,
  });
  if (abandoned.length) await prisma.notification.createMany({ data: abandoned.map((r) => ({ reservationId: r.id, channel: "SMS" as const, recipient: r.customer.phone, template: "ABANDONED_CHECKOUT" })), skipDuplicates: true });
  return { remindersQueued: reminders.length, pickupDetailsQueued: pickupDetails.length, abandonedQueued: abandoned.length };
}

export async function processNotificationJobs(options: { limit?: number } = {}) {
  const now = new Date();
  const jobs = await prisma.notification.findMany({
    where: {
      channel: "SMS", template: { in: TEMPLATES }, attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "PENDING" },
        { status: "RETRY", updatedAt: { lte: new Date(now.getTime() - 2 * 60_000) } },
        { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
      ],
    }, include: { reservation: { select: { eventId: true } } }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(options.limit ?? 20, 1), 20),
  });
  let sent = 0;
  for (const job of jobs) {
    if (!job.reservationId || !job.reservation) continue;
    const eventId = job.reservation.eventId;
    const reservationId = job.reservationId;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // The exact same lock is held by payment finalization. The read below
        // happens after acquiring it and the provider call stays inside it.
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
        const currentJob = await tx.notification.findUnique({ where: { id: job.id } });
        if (!currentJob || currentJob.attempts >= MAX_ATTEMPTS || !["PENDING", "RETRY", "PROCESSING"].includes(currentJob.status)) return false;
        if (currentJob.status === "PROCESSING" && currentJob.updatedAt > new Date(Date.now() - 10 * 60_000)) return false;
        if (currentJob.status === "RETRY" && currentJob.updatedAt > new Date(Date.now() - 2 * 60_000)) return false;
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id: reservationId }, include: { event: true, customer: true, pickupPoint: true, payments: true, notifications: { where: { template: { in: ["PAYMENT_LINK", "ABANDONED_CHECKOUT"] }, status: "SENT" } } },
        });
        let content: string;
        if (job.template === "ABANDONED_CHECKOUT") {
          const delay = abandonedCheckoutFollowupMinutes();
          if (delay <= 0 || !canRecoverCheckout(reservation) || !reservation.holdExpiresAt || !reservation.routeId || !reservation.pickupPointId || reservation.createdAt > new Date(Date.now() - delay * 60_000) || reservation.notifications.length) {
            await tx.notification.update({ where: { id: job.id }, data: { status: "CANCELLED", lastError: "Reserva já não elegível ou link já enviado." } });
            return false;
          }
          content = smsTemplates.abandonedCheckout(checkoutRecoveryLink(reservation.id), reservation.reference);
        } else {
          if (reservation.status !== "PAID" || !reservation.payments.some((p) => p.status === "SUCCEEDED") || reservation.event.status === "CANCELLED") {
            await tx.notification.update({ where: { id: job.id }, data: { status: "CANCELLED", lastError: "Reserva sem pagamento confirmado activo." } });
            return false;
          }
          const expires = new Date((reservation.event.returnAt ?? reservation.event.eventDate).getTime() + 7 * 24 * 60 * 60_000);
          if (expires <= new Date()) {
            await tx.notification.update({ where: { id: job.id }, data: { status: "CANCELLED", lastError: "A viagem terminou e o acesso expirou." } });
            return false;
          }
          const token = createTicketBundleToken(reservation.reference, expires);
          const link = `${publicBaseUrl()}/reserva/${encodeURIComponent(reservation.reference)}/bilhetes?token=${encodeURIComponent(token)}`;
          if (job.template === "PICKUP_DETAILS") {
            if (!reservation.pickupPoint?.operationalConfirmed || !reservation.pickupPoint.departureAt || reservation.pickupPoint.address === "Preferência; ponto exacto por confirmar") {
              await tx.notification.update({ where: { id: job.id }, data: { status: "BLOCKED", lastError: "Falta confirmar o ponto exacto ou o horário." } });
              return false;
            }
            const time = reservation.pickupPoint.departureAt.toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" });
            const date = reservation.pickupPoint.departureAt.toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda", day: "2-digit", month: "2-digit" });
            content = smsTemplates.pickupDetails(reservation.pickupPoint.name, reservation.pickupPoint.address, date, time);
          } else if (job.template === "EVENT_REMINDER") {
            if (!reservation.pickupPoint?.departureAt) {
              await tx.notification.update({ where: { id: job.id }, data: { status: "BLOCKED", lastError: "Falta confirmar o horário de embarque." } });
              return false;
            }
            const time = reservation.pickupPoint.departureAt.toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" });
            content = smsTemplates.eventReminder(link, reservation.pickupPoint.name, time);
          } else content = smsTemplates.paymentConfirmed(link, reservation.reference);
        }
        const analysis = analyzeSms(content);
        // Signed access links routinely exceed 160 characters. Permit bounded
        // multipart GSM-7 instead of silently blocking all purchased tickets.
        if (analysis.encoding !== "GSM-7" || analysis.segments > 6) {
          await tx.notification.update({ where: { id: job.id }, data: { status: "BLOCKED", content, encoding: analysis.encoding, characterCount: analysis.characterCount, segmentCount: analysis.segments, lastError: "Mensagem fora do limite de seis segmentos GSM-7." } });
          return false;
        }
        await tx.notification.update({ where: { id: job.id }, data: { status: "PROCESSING", provider: "ziett", attempts: { increment: 1 }, recipient: reservation.customer.phone, content, encoding: analysis.encoding, characterCount: analysis.characterCount, segmentCount: analysis.segments } });
        try {
          const response = await sendSms({ phone: reservation.customer.phone, content, idempotencyKey: `notification-${job.id}` });
          await tx.notification.update({ where: { id: job.id }, data: { status: "SENT", providerMessageId: response.messageId, providerStatus: response.providerStatus, lastError: null, sentAt: new Date() } });
          await tx.auditLog.create({ data: { action: "NOTIFICATION_SENT", entityType: "Notification", entityId: job.id, metadata: { reservationId, template: job.template, provider: "ziett", providerMessageId: response.messageId, attempt: currentJob.attempts + 1 } } });
          return true;
        } catch (error) {
          const providerStatus = error instanceof ZiettError && error.status ? `HTTP_${error.status}` : "ERROR";
          await tx.notification.update({ where: { id: job.id }, data: { status: currentJob.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "RETRY", providerStatus, lastError: "A Ziett não confirmou o envio." } });
          await tx.auditLog.create({ data: { action: "NOTIFICATION_FAILED", entityType: "Notification", entityId: job.id, metadata: { reservationId, template: job.template, provider: "ziett", providerStatus, attempt: currentJob.attempts + 1 } } });
          return false;
        }
      }, { timeout: 15_000 });
      if (result) sent += 1;
    } catch {
      // A rolled-back local write can be retried with the same provider key.
      // Never roll back a sale or expose the content/token through an error log.
    }
  }
  return { processed: jobs.length, sent };
}
