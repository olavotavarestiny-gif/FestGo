import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkoutRecoverySchedule, publicBaseUrl } from "@/lib/config";
import { sendSms, ZiettError } from "@/lib/integrations/ziett";
import { canRecoverCheckout, checkoutRecoveryLink } from "@/lib/payment-invitations";
import { createTicketBundleToken } from "@/lib/ticket-access";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { analyzeSms, smsTemplates } from "@/lib/sms";

export const RECOVERY_TEMPLATES = ["ABANDONED_CHECKOUT", "ABANDONED_CHECKOUT_2", "PAYMENT_LINK"];
const TEMPLATES = ["BOOKING_PAID", "PICKUP_DETAILS", "EVENT_REMINDER", "ABANDONED_CHECKOUT", "ABANDONED_CHECKOUT_2"];

type ManualSms = { content: string; invitationNonce: string; requestedById: string };

export async function queueNotifications(now = new Date()) {
  // Retire unsent legacy communications as well as stopping new queue entries.
  await prisma.notification.updateMany({
    where: { template: { in: ["PRE_RESERVATION_RECEIVED", "PRE_RESERVATION_APPROVED"] }, status: { in: ["PENDING", "RETRY", "DRAFT"] } },
    data: { status: "CANCELLED", lastError: "Comunicação substituída pelo checkout no website." },
  });
  // Reconsider operational messages blocked on details without replaying any provider attempt.
  await prisma.notification.updateMany({
    where: { channel: "SMS", template: { in: ["PICKUP_DETAILS", "EVENT_REMINDER"] }, status: "BLOCKED", dispatchStartedAt: null, attempts: 0,
      reservation: { status: "PAID", pickupPoint: { operationalConfirmed: true, departureAt: { not: null }, address: { not: "Preferência; ponto exacto por confirmar" } } },
    }, data: { status: "PENDING", lastError: null },
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

  const schedule = checkoutRecoverySchedule();
  const eligible: Prisma.ReservationWhereInput = {
    status: { in: ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
    phoneVerifiedAt: { not: null }, verifiedPhone: { not: null },
    holdExpiresAt: { gt: now }, routeId: { not: null }, pickupPointId: { not: null },
    route: { active: true }, pickupPoint: { operationalConfirmed: true },
    event: { status: { notIn: ["CANCELLED", "CLOSED"] }, eventDate: { gt: now } },
    payments: { none: { status: { in: ["SUCCEEDED", "UNKNOWN", "REFUND_PENDING", "REFUNDED"] } } },
  };
  const abandoned = !arePaymentsEnabled() ? [] : await prisma.reservation.findMany({
    where: { ...eligible,
      createdAt: { lte: new Date(now.getTime() - schedule.first * 60_000) },
      notifications: { none: { channel: "SMS", OR: [{ template: "ABANDONED_CHECKOUT" }, { template: "PAYMENT_LINK", OR: [{ dispatchStartedAt: { not: null } }, { status: "SENT" }] }] } },
    }, select: { id: true, customer: { select: { phone: true } } }, take: 100,
  });
  if (abandoned.length) await prisma.notification.createMany({ data: abandoned.map((r) => ({ reservationId: r.id, channel: "SMS" as const, recipient: r.customer.phone, template: "ABANDONED_CHECKOUT" })), skipDuplicates: true });
  const second = !arePaymentsEnabled() ? [] : await prisma.reservation.findMany({
    where: { ...eligible,
      createdAt: { lte: new Date(now.getTime() - schedule.second * 60_000) },
      notifications: {
        some: { channel: "SMS", template: "ABANDONED_CHECKOUT", status: "SENT", attempts: { lte: 1 }, sentAt: { lte: new Date(now.getTime() - schedule.minimumGap * 60_000) } },
        none: { channel: "SMS", OR: [{ template: "ABANDONED_CHECKOUT_2" }, { template: "PAYMENT_LINK", OR: [{ dispatchStartedAt: { not: null } }, { status: "SENT" }] }] },
      },
    }, select: { id: true, customer: { select: { phone: true } } }, take: 100,
  });
  if (second.length) await prisma.notification.createMany({ data: second.map((r) => ({ reservationId: r.id, channel: "SMS" as const, recipient: r.customer.phone, template: "ABANDONED_CHECKOUT_2" })), skipDuplicates: true });
  // Expired/cancelled/paid holds cannot remain scheduled for recovery.
  await prisma.notification.updateMany({
    where: { channel: "SMS", template: { in: RECOVERY_TEMPLATES }, status: { in: ["PENDING", "RETRY", "DRAFT", "BLOCKED"] },
      reservation: { OR: [{ status: { notIn: ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"] } }, { holdExpiresAt: { lte: now } }, { event: { status: { in: ["CANCELLED", "CLOSED"] } } }, { payments: { some: { status: { in: ["SUCCEEDED", "UNKNOWN", "REFUND_PENDING", "REFUNDED"] } } } }] },
    }, data: { status: "CANCELLED", lastError: "Reserva já não pode receber recuperação de pagamento." },
  });
  return { remindersQueued: reminders.length, pickupDetailsQueued: pickupDetails.length, abandonedQueued: abandoned.length, secondRecoveryQueued: second.length };
}

/** Commit the dispatch fence BEFORE contacting Ziett. Ambiguous results are never replayed. */
export async function dispatchNotification(id: string, manual?: ManualSms) {
  const seed = await prisma.notification.findUnique({ where: { id }, include: { reservation: { select: { eventId: true } } } });
  if (!seed?.reservationId || !seed.reservation || (!manual && !TEMPLATES.includes(seed.template))) return false;
  const claimed = await prisma.notification.updateMany({
    where: { id, channel: "SMS", dispatchStartedAt: null, attempts: 0, status: { in: manual ? ["DRAFT", "PENDING"] : ["PENDING", "RETRY", "BLOCKED"] } },
    data: { status: "PROCESSING", dispatchStartedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!claimed.count) return false;
  const reservationId = seed.reservationId;
  try {
    return await prisma.$transaction(async (tx) => {
      // Shares the finalizer's lock, so a committed payment always suppresses recovery.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${seed.reservation!.eventId} FOR UPDATE`;
      const job = await tx.notification.findUniqueOrThrow({ where: { id } });
      if (job.status !== "PROCESSING") return false;
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId }, include: { event: true, customer: true, pickupPoint: true, route: true, payments: true, paymentInvitation: true,
          notifications: { where: { channel: "SMS", template: { in: RECOVERY_TEMPLATES } } } },
      });
      const stop = async (status: string, reason: string) => {
        await tx.notification.update({ where: { id }, data: { status, lastError: reason, dispatchStartedAt: null, attempts: 0 } });
        return false;
      };
      let content: string;
      if (RECOVERY_TEMPLATES.includes(job.template)) {
        const now = new Date();
        if (!canRecoverCheckout(reservation, now)) return stop("CANCELLED", "Reserva já não elegível para pagamento.");
        // A manual invitation also consumes the recovery budget; never reset it on regeneration.
        const otherAttempts = reservation.notifications.filter((n) => n.id !== id)
          .reduce((total, n) => total + Math.max(n.attempts, n.dispatchStartedAt || n.sentAt ? 1 : 0), 0);
        if (otherAttempts >= 2) return stop("CANCELLED", "Limite absoluto de duas recuperações atingido.");
        if (job.template === "PAYMENT_LINK") {
          const invitation = reservation.paymentInvitation;
          if (!manual || !invitation || invitation.nonce !== manual.invitationNonce || invitation.revokedAt || invitation.expiresAt <= now)
            return stop("CANCELLED", "Convite de pagamento inválido ou alterado.");
          content = manual.content;
        } else {
          const schedule = checkoutRecoverySchedule();
          if (!arePaymentsEnabled() || !reservation.phoneVerifiedAt || reservation.verifiedPhone !== reservation.customer.phone ||
              !reservation.holdExpiresAt || !reservation.route?.active || !reservation.pickupPoint?.operationalConfirmed ||
              reservation.pickupPoint.routeId !== reservation.routeId || (reservation.pickupPoint.departureAt && reservation.pickupPoint.departureAt <= now) ||
              reservation.notifications.some((n) => n.template === "PAYMENT_LINK" && (n.dispatchStartedAt || n.sentAt || n.attempts > 0)))
            return stop("CANCELLED", "Telefone não confirmado, pagamento indisponível ou recuperação já enviada manualmente.");
          const second = job.template === "ABANDONED_CHECKOUT_2";
          const first = reservation.notifications.find((n) => n.template === "ABANDONED_CHECKOUT");
          if (reservation.createdAt.getTime() + (second ? schedule.second : schedule.first) * 60_000 > now.getTime() ||
              (second && (!first?.sentAt || first.status !== "SENT" || first.sentAt.getTime() + schedule.minimumGap * 60_000 > now.getTime())))
            return stop("CANCELLED", "Horário de recuperação ainda não atingido ou primeiro envio não confirmado.");
          const link = checkoutRecoveryLink(reservation.id);
          content = second ? smsTemplates.abandonedCheckoutSecond(link, reservation.customer.fullName) : smsTemplates.abandonedCheckout(link, reservation.customer.fullName);
        }
      } else {
        if (reservation.status !== "PAID" || !reservation.payments.some((p) => p.status === "SUCCEEDED") || reservation.event.status === "CANCELLED")
          return stop("CANCELLED", "Reserva sem pagamento confirmado activo.");
        const expires = new Date((reservation.event.returnAt ?? reservation.event.eventDate).getTime() + 7 * 24 * 60 * 60_000);
        if (expires <= new Date()) return stop("CANCELLED", "A viagem terminou e o acesso expirou.");
        const token = createTicketBundleToken(reservation.reference, expires);
        const link = `${publicBaseUrl()}/reserva/${encodeURIComponent(reservation.reference)}/bilhetes?token=${encodeURIComponent(token)}`;
        if (job.template === "PICKUP_DETAILS") {
          if (!reservation.pickupPoint?.operationalConfirmed || !reservation.pickupPoint.departureAt || reservation.pickupPoint.address === "Preferência; ponto exacto por confirmar")
            return stop("BLOCKED", "Falta confirmar o ponto exacto ou o horário.");
          const time = reservation.pickupPoint.departureAt.toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" });
          const date = reservation.pickupPoint.departureAt.toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda", day: "2-digit", month: "2-digit" });
          content = smsTemplates.pickupDetails(reservation.pickupPoint.name, reservation.pickupPoint.address, date, time);
        } else if (job.template === "EVENT_REMINDER") {
          if (!reservation.pickupPoint?.operationalConfirmed || !reservation.pickupPoint.departureAt)
            return stop("BLOCKED", "Falta confirmar o horário de embarque.");
          const time = reservation.pickupPoint.departureAt.toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" });
          content = smsTemplates.eventReminder(link, reservation.pickupPoint.name, time);
        } else content = smsTemplates.paymentConfirmed(link);
      }
      const analysis = analyzeSms(content);
      // Portuguese and emoji use UCS-2; Ziett accepts multipart SMS in both encodings.
      if (analysis.segments > 6) return stop("BLOCKED", "Mensagem fora do limite de seis segmentos.");
      await tx.notification.update({ where: { id }, data: { provider: "ziett", recipient: reservation.customer.phone, content,
        encoding: analysis.encoding, characterCount: analysis.characterCount, segmentCount: analysis.segments, requestedById: manual?.requestedById } });
      try {
        const response = await sendSms({ phone: reservation.customer.phone, content, idempotencyKey: `notification-${id}` });
        await tx.notification.update({ where: { id }, data: { status: "SENT", providerMessageId: response.messageId, providerStatus: response.providerStatus, lastError: null, sentAt: new Date() } });
        await tx.auditLog.create({ data: { action: "NOTIFICATION_SENT", entityType: "Notification", entityId: id,
          metadata: { reservationId, template: job.template, provider: "ziett", providerMessageId: response.messageId, attempt: job.attempts } } });
        return true;
      } catch (error) {
        const rejected = error instanceof ZiettError && error.status && error.status >= 400 && error.status < 500;
        const providerStatus = error instanceof ZiettError && error.status ? `HTTP_${error.status}` : "UNKNOWN";
        await tx.notification.update({ where: { id }, data: { status: rejected ? "FAILED" : "UNKNOWN", providerStatus,
          lastError: "A Ziett não confirmou o envio. Sem reenvio automático para impedir duplicação." } });
        await tx.auditLog.create({ data: { action: "NOTIFICATION_FAILED", entityType: "Notification", entityId: id,
          metadata: { reservationId, template: job.template, provider: "ziett", providerStatus, attempt: job.attempts } } });
        return false;
      }
    }, { timeout: 15_000, maxWait: 10_000 });
  } catch {
    // A rollback after provider acceptance must not make the message eligible again.
    await prisma.notification.updateMany({ where: { id, status: "PROCESSING" }, data: {
      status: "UNKNOWN", lastError: "Envio interrompido; confirmar no fornecedor antes de qualquer intervenção.",
    } });
    return false;
  }
}

export async function processNotificationJobs(options: { limit?: number } = {}) {
  const now = new Date();
  await prisma.notification.updateMany({
    where: { channel: "SMS", status: "PROCESSING", dispatchStartedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "UNKNOWN", lastError: "Resultado do envio incerto; reenvio automático bloqueado." },
  });
  const jobs = await prisma.notification.findMany({
    where: { channel: "SMS", template: { in: TEMPLATES }, dispatchStartedAt: null, attempts: 0, status: { in: ["PENDING", "RETRY"] } },
    orderBy: { createdAt: "asc" }, take: Math.min(Math.max(options.limit ?? 20, 1), 20),
  });
  let sent = 0;
  for (const job of jobs) if (await dispatchNotification(job.id)) sent += 1;
  return { processed: jobs.length, sent };
}
