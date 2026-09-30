import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendSms, ZiettError } from "@/lib/integrations/ziett";
import { canRecoverCheckout, invitationState, paymentInvitationLink, paymentInvitationTtlHours } from "@/lib/payment-invitations";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { analyzeSms, smsTemplates } from "@/lib/sms";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("GENERATE") }),
  z.object({ action: z.literal("REVOKE") }),
  z.object({ action: z.literal("SEND_SMS"), content: z.string().trim().min(1).max(800).optional(), acknowledgeMultipleSegments: z.boolean().default(false) }),
  z.object({ action: z.literal("CONFIRM_MANUAL_PAYMENT"), transactionReference: z.string().trim().min(4).max(160) }),
]);

type Invitation = { id: string; nonce: string; expiresAt: Date; revokedAt: Date | null; confirmedAt: Date | null };
function responseFor(invitation: Invitation) {
  return { state: invitationState(invitation), expiresAt: invitation.expiresAt.toISOString(), confirmedAt: invitation.confirmedAt?.toISOString() ?? null, link: invitation.revokedAt ? null : paymentInvitationLink(invitation) };
}

export async function POST(request: Request, context: { params: Promise<{ reservationId: string }> }) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
  const { reservationId } = await context.params;
  const input = parsed.data;
  // A typed transaction reference is not proof of settlement. Only the verified
  // payment finalizer may issue tickets or move a reservation to PAID.
  if (input.action === "CONFIRM_MANUAL_PAYMENT")
    return NextResponse.json({ error: "A confirmação exige um pagamento verificado pelo fornecedor. Uma referência manual não comprova pagamento." }, { status: 409 });

  const seed = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { eventId: true } });
  if (!seed) return NextResponse.json({ error: "Reserva não encontrada." }, { status: 404 });
  if (input.action === "SEND_SMS") {
    try {
      await enforceRateLimit({ namespace: "admin-payment-link-sms", identifier: `${user.id}:${reservationId}`, limit: 3, windowMs: 60 * 60_000 });
    } catch {
      return NextResponse.json({ error: "Limite de tentativas atingido. Tenta mais tarde." }, { status: 429 });
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize with gateway finalization: inspect current state immediately
      // before sending, never the state fetched before a concurrent payment.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${seed.eventId} FOR UPDATE`;
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId }, include: { customer: true, event: true, payments: true, paymentInvitation: true },
      });
      if (!canRecoverCheckout(reservation))
        return NextResponse.json({ error: "A reserva está paga, cancelada, expirada ou aguarda reconciliação." }, { status: 409 });
      const audit = (action: string, invitationId: string, metadata: Record<string, string | number | null> = {}) => tx.auditLog.create({
        data: { userId: user.id, action, entityType: "PaymentInvitation", entityId: invitationId, metadata: { reservationId, reference: reservation.reference, ...metadata }, ipAddress: clientIp(request) },
      });
      let invitation = reservation.paymentInvitation;
      if (input.action === "GENERATE") {
        const active = invitation && !invitation.revokedAt && invitation.expiresAt > new Date();
        if (!active) {
          const expiresAt = new Date(Math.min(Date.now() + paymentInvitationTtlHours() * 60 * 60_000, reservation.holdExpiresAt?.getTime() ?? Infinity, reservation.event.eventDate.getTime()));
          invitation = await tx.paymentInvitation.upsert({
            where: { reservationId },
            create: { reservationId, expiresAt, createdById: user.id },
            update: { nonce: randomUUID(), expiresAt, confirmedAt: null, revokedAt: null, createdById: user.id },
          });
          const content = smsTemplates.paymentInvitation(paymentInvitationLink(invitation), reservation.reference);
          const analysis = analyzeSms(content);
          const data = { recipient: reservation.customer.phone, status: "DRAFT", content, encoding: analysis.encoding, characterCount: analysis.characterCount, segmentCount: analysis.segments, requestedById: user.id, attempts: 0, lastError: null, sentAt: null, providerMessageId: null, providerStatus: null };
          await tx.notification.upsert({ where: { reservationId_channel_template: { reservationId, channel: "SMS", template: "PAYMENT_LINK" } }, create: { reservationId, channel: "SMS", template: "PAYMENT_LINK", ...data }, update: data });
        }
        if (!invitation) throw new Error("Invitation unavailable");
        await audit(active ? "PAYMENT_INVITATION_REUSED" : "PAYMENT_INVITATION_CREATED", invitation.id, { result: "READY", expiresAt: invitation.expiresAt.toISOString() });
        return NextResponse.json({ ok: true, reference: reservation.reference, ...responseFor(invitation) });
      }
      if (!invitation) return NextResponse.json({ error: "Gera primeiro o link de pagamento." }, { status: 409 });
      if (input.action === "REVOKE") {
        const revoked = await tx.paymentInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
        await audit("PAYMENT_INVITATION_REVOKED", invitation.id, { result: "REVOKED" });
        return NextResponse.json({ ok: true, ...responseFor(revoked) });
      }
      if (invitation.revokedAt || invitation.expiresAt <= new Date())
        return NextResponse.json({ error: "O convite está revogado ou expirado." }, { status: 409 });
      const link = paymentInvitationLink(invitation);
      const content = input.content ?? smsTemplates.paymentInvitation(link, reservation.reference);
      if (!content.includes(link))
        return NextResponse.json({ error: "A mensagem deve incluir o link individual gerado para esta reserva." }, { status: 400 });
      const analysis = analyzeSms(content);
      if (analysis.segments > 6)
        return NextResponse.json({ error: "Encurta a mensagem para um máximo de seis segmentos." }, { status: 400 });
      if ((!analysis.isSingleSegment || analysis.encoding !== "GSM-7") && !input.acknowledgeMultipleSegments)
        return NextResponse.json({ error: `Este texto usa ${analysis.segments} segmentos ${analysis.encoding}. Confirma o custo antes de enviar.`, requiresAcknowledgement: true }, { status: 409 });
      const notification = await tx.notification.findUnique({ where: { reservationId_channel_template: { reservationId, channel: "SMS", template: "PAYMENT_LINK" } } });
      if (!notification) return NextResponse.json({ error: "Gera primeiro o link de pagamento." }, { status: 409 });
      if (notification.status === "SENT" || notification.attempts >= 3)
        return NextResponse.json({ error: "O link já foi enviado ou atingiu o limite de tentativas." }, { status: 409 });
      const claimed = await tx.notification.updateMany({
        where: { id: notification.id, attempts: { lt: 3 }, OR: [{ status: { in: ["DRAFT", "FAILED", "RETRY"] } }, { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
        data: { status: "PROCESSING", provider: "ziett", content, encoding: analysis.encoding, characterCount: analysis.characterCount, segmentCount: analysis.segments, requestedById: user.id, attempts: { increment: 1 }, lastError: null },
      });
      if (!claimed.count) return NextResponse.json({ error: "Já existe um envio em processamento." }, { status: 409 });
      try {
        const result = await sendSms({ phone: reservation.customer.phone, content, idempotencyKey: `notification-${notification.id}-${invitation.nonce}` });
        await tx.notification.update({ where: { id: notification.id }, data: { status: "SENT", providerMessageId: result.messageId, providerStatus: result.providerStatus, sentAt: new Date(), lastError: null } });
        await audit("PAYMENT_INVITATION_SMS_SENT", invitation.id, { result: "SENT", provider: "ziett", providerMessageId: result.messageId, notificationId: notification.id, attempt: notification.attempts + 1, segments: analysis.segments });
        return NextResponse.json({ ok: true, status: "SENT", providerStatus: result.providerStatus, characters: analysis.characterCount, segments: analysis.segments });
      } catch (error) {
        const providerStatus = error instanceof ZiettError && error.status ? `HTTP_${error.status}` : "ERROR";
        await tx.notification.update({ where: { id: notification.id }, data: { status: "FAILED", providerStatus, lastError: "Não foi possível confirmar o envio pela Ziett." } });
        await audit("PAYMENT_INVITATION_SMS_FAILED", invitation.id, { result: "FAILED", provider: "ziett", providerStatus, notificationId: notification.id, attempt: notification.attempts + 1 });
        return NextResponse.json({ error: "A Ziett não confirmou o envio. Podes tentar novamente." }, { status: 502 });
      }
    }, { timeout: 15_000 });
  } catch {
    return NextResponse.json({ error: "Não foi possível concluir a acção. O pagamento não foi alterado." }, { status: 503 });
  }
}
