import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendSms, ZiettError } from "@/lib/integrations/ziett";
import {
  invitationState,
  paymentInvitationLink,
  paymentInvitationTtlHours,
} from "@/lib/payment-invitations";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { analyzeSms, smsTemplates } from "@/lib/sms";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("GENERATE") }),
  z.object({ action: z.literal("REVOKE") }),
  z.object({
    action: z.literal("SEND_SMS"),
    acknowledgeMultipleSegments: z.boolean().default(false),
  }),
]);

function responseFor(invitation: {
  id: string;
  nonce: string;
  expiresAt: Date;
  revokedAt: Date | null;
  confirmedAt: Date | null;
}) {
  return {
    state: invitationState(invitation),
    expiresAt: invitation.expiresAt.toISOString(),
    confirmedAt: invitation.confirmedAt?.toISOString() ?? null,
    link: invitation.revokedAt ? null : paymentInvitationLink(invitation),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
  const { reservationId } = await context.params;
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      customer: true,
      paymentInvitation: true,
      payments: {
        where: { status: { in: ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED"] } },
        take: 1,
      },
    },
  });
  if (!reservation)
    return NextResponse.json({ error: "Reserva não encontrada." }, { status: 404 });
  if (reservation.status !== "PAYMENT_PENDING")
    return NextResponse.json(
      { error: "A pré-reserva deve estar aprovada e sem cobrança activa." },
      { status: 409 },
    );
  if (reservation.payments.length)
    return NextResponse.json(
      { error: "Já existe uma cobrança associada a esta reserva." },
      { status: 409 },
    );

  if (parsed.data.action === "GENERATE") {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`;
      const current = await tx.paymentInvitation.findUnique({
        where: { reservationId },
      });
      const active =
        current &&
        !current.revokedAt &&
        current.expiresAt > new Date();
      const invitation = active
        ? current
        : await tx.paymentInvitation.upsert({
            where: { reservationId },
            create: {
              reservationId,
              expiresAt: new Date(
                Date.now() + paymentInvitationTtlHours() * 60 * 60_000,
              ),
              createdById: user.id,
            },
            update: {
              nonce: randomUUID(),
              expiresAt: new Date(
                Date.now() + paymentInvitationTtlHours() * 60 * 60_000,
              ),
              confirmedAt: null,
              revokedAt: null,
              createdById: user.id,
            },
          });
      const link = paymentInvitationLink(invitation);
      const content = smsTemplates.paymentInvitation(
        link,
        reservation.reference,
      );
      const analysis = analyzeSms(content);
      if (!active) {
        await tx.notification.upsert({
          where: {
            reservationId_channel_template: {
              reservationId,
              channel: "SMS",
              template: "PAYMENT_LINK",
            },
          },
          create: {
            reservationId,
            channel: "SMS",
            recipient: reservation.customer.phone,
            template: "PAYMENT_LINK",
            status: "DRAFT",
            content,
            encoding: analysis.encoding,
            characterCount: analysis.characterCount,
            segmentCount: analysis.segments,
            requestedById: user.id,
          },
          update: {
            recipient: reservation.customer.phone,
            status: "DRAFT",
            providerMessageId: null,
            providerStatus: null,
            content,
            encoding: analysis.encoding,
            characterCount: analysis.characterCount,
            segmentCount: analysis.segments,
            attempts: 0,
            lastError: null,
            sentAt: null,
            requestedById: user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: current
              ? "PAYMENT_INVITATION_REGENERATED"
              : "PAYMENT_INVITATION_CREATED",
            entityType: "PaymentInvitation",
            entityId: invitation.id,
            metadata: { reservationId, expiresAt: invitation.expiresAt },
            ipAddress: clientIp(request),
          },
        });
      }
      return invitation;
    });
    return NextResponse.json({ ok: true, ...responseFor(result) });
  }

  const invitation = reservation.paymentInvitation;
  if (!invitation)
    return NextResponse.json(
      { error: "Gera primeiro o link de pagamento." },
      { status: 409 },
    );

  if (parsed.data.action === "REVOKE") {
    if (invitation.revokedAt)
      return NextResponse.json(
        { error: "Este convite já está revogado." },
        { status: 409 },
      );
    const revoked = await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "PAYMENT_INVITATION_REVOKED",
          entityType: "PaymentInvitation",
          entityId: invitation.id,
          metadata: { reservationId },
          ipAddress: clientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json({ ok: true, ...responseFor(revoked) });
  }

  if (invitation.revokedAt || invitation.expiresAt <= new Date())
    return NextResponse.json(
      { error: "O convite está revogado ou expirado." },
      { status: 409 },
    );
  const link = paymentInvitationLink(invitation);
  const content = smsTemplates.paymentInvitation(link, reservation.reference);
  const analysis = analyzeSms(content);
  if (
    (!analysis.isSingleSegment || analysis.encoding !== "GSM-7") &&
    !parsed.data.acknowledgeMultipleSegments
  )
    return NextResponse.json(
      {
        error: `Este texto usa ${analysis.segments} segmentos ${analysis.encoding}. Confirma o custo antes de enviar.`,
        requiresAcknowledgement: true,
      },
      { status: 409 },
    );

  try {
    await enforceRateLimit({
      namespace: "admin-payment-link-sms",
      identifier: `${user.id}:${reservationId}`,
      limit: 3,
      windowMs: 60 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Limite de tentativas atingido. Tenta mais tarde." },
      { status: 429 },
    );
  }

  const notification = await prisma.notification.findUnique({
    where: {
      reservationId_channel_template: {
        reservationId,
        channel: "SMS",
        template: "PAYMENT_LINK",
      },
    },
  });
  if (!notification)
    return NextResponse.json(
      { error: "O SMS ainda não foi preparado." },
      { status: 409 },
    );
  if (notification.status === "SENT")
    return NextResponse.json(
      { error: "O link já foi enviado por SMS." },
      { status: 409 },
    );
  if (notification.attempts >= 3)
    return NextResponse.json(
      { error: "O limite seguro de três tentativas foi atingido." },
      { status: 409 },
    );
  const claimed = await prisma.notification.updateMany({
    where: {
      id: notification.id,
      attempts: { lt: 3 },
      OR: [
        { status: { in: ["DRAFT", "FAILED", "RETRY"] } },
        {
          status: "PROCESSING",
          updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      content,
      encoding: analysis.encoding,
      characterCount: analysis.characterCount,
      segmentCount: analysis.segments,
      requestedById: user.id,
      lastError: null,
    },
  });
  if (!claimed.count)
    return NextResponse.json(
      { error: "Já existe um envio em processamento." },
      { status: 409 },
    );

  let sendResult: Awaited<ReturnType<typeof sendSms>>;
  try {
    sendResult = await sendSms({
      phone: reservation.customer.phone,
      content,
      idempotencyKey: `notification-${notification.id}-${invitation.nonce}`,
    });
  } catch (error) {
    const providerStatus =
      error instanceof ZiettError && error.status
        ? `HTTP_${error.status}`
        : "ERROR";
    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          providerStatus,
          lastError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Falha desconhecida no envio.",
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PAYMENT_INVITATION_SMS_FAILED",
          entityType: "PaymentInvitation",
          entityId: invitation.id,
          metadata: { reservationId, segments: analysis.segments },
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json(
      { error: "A Ziett não concluiu o envio. Podes tentar novamente." },
      { status: 502 },
    );
  }

  try {
    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: "SENT",
          attempts: { increment: 1 },
          providerMessageId: sendResult.messageId,
          providerStatus: sendResult.providerStatus,
          sentAt: new Date(),
          lastError: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PAYMENT_INVITATION_SMS_SENT",
          entityType: "PaymentInvitation",
          entityId: invitation.id,
          metadata: {
            reservationId,
            characters: analysis.characterCount,
            segments: analysis.segments,
            encoding: analysis.encoding,
          },
          ipAddress: clientIp(request),
        },
      }),
    ]);
  } catch {
    return NextResponse.json(
      {
        error:
          "A Ziett aceitou o SMS, mas o registo local ficou pendente. Aguarda antes de tentar novamente.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    status: "SENT",
    providerStatus: sendResult.providerStatus,
    characters: analysis.characterCount,
    segments: analysis.segments,
  });
}
