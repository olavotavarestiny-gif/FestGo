import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { sendSms, ZiettError } from "@/lib/integrations/ziett";
import { analyzeSms, smsTemplates } from "@/lib/sms";

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
      const updated = await tx.reservation.updateMany({
        where: { id, status: "PRE_RESERVED" },
        data: {
          status: "PAYMENT_PENDING",
          contactStatus: "AWAITING_PAYMENT",
        },
      });
      if (!updated.count) return false;
      await tx.seatPreference.updateMany({
        where: { reservationId: id, releasedAt: null },
        data: { status: "TEMPORARILY_HELD" },
      });
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

  if (parsed.data.action === "SEND_APPROVAL_SMS") {
    if (reservation.status !== "PAYMENT_PENDING")
      return NextResponse.json(
        { error: "A pré-reserva deve ser aprovada antes do envio." },
        { status: 409 },
      );
    try {
      await enforceRateLimit({
        namespace: "admin-approval-sms",
        identifier: `${user.id}:${id}`,
        limit: 3,
        windowMs: 60 * 60_000,
      });
    } catch {
      return NextResponse.json(
        { error: "Limite de tentativas atingido. Tenta mais tarde." },
        { status: 429 },
      );
    }

    const content = smsTemplates.preReservationApproved(reservation.reference);
    const analysis = analyzeSms(content);
    if (analysis.encoding !== "GSM-7" || !analysis.isSingleSegment)
      return NextResponse.json(
        { error: "O SMS ultrapassa o limite seguro de um segmento GSM-7." },
        { status: 409 },
      );

    let notification;
    try {
      const existing = await prisma.notification.findUnique({
        where: {
          reservationId_channel_template: {
            reservationId: id,
            channel: "SMS",
            template: "PRE_RESERVATION_APPROVED",
          },
        },
      });
      if (!existing) {
        notification = await prisma.notification.create({
          data: {
            reservationId: id,
            channel: "SMS",
            recipient: reservation.customer.phone,
            template: "PRE_RESERVATION_APPROVED",
            status: "PROCESSING",
            content,
            encoding: analysis.encoding,
            characterCount: analysis.characterCount,
            segmentCount: analysis.segments,
            requestedById: user.id,
          },
        });
      } else {
        if (existing.status === "SENT")
          return NextResponse.json(
            { error: "O SMS de aprovação já foi enviado." },
            { status: 409 },
          );
        if (existing.attempts >= 3)
          return NextResponse.json(
            { error: "O limite seguro de três tentativas foi atingido." },
            { status: 409 },
          );
        const claimed = await prisma.notification.updateMany({
          where: {
            id: existing.id,
            attempts: { lt: 3 },
            OR: [
              { status: { in: ["FAILED", "RETRY"] } },
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
        notification = { ...existing, status: "PROCESSING" };
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return NextResponse.json(
          { error: "Já existe um envio em processamento." },
          { status: 409 },
        );
      throw error;
    }

    let result: Awaited<ReturnType<typeof sendSms>>;
    try {
      result = await sendSms({
        phone: reservation.customer.phone,
        content,
        idempotencyKey: `notification-${notification.id}`,
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
            action: "PRE_RESERVATION_APPROVAL_SMS_FAILED",
            entityType: "Reservation",
            entityId: id,
            metadata: {
              notificationId: notification.id,
              providerStatus,
              characters: analysis.characterCount,
              segments: analysis.segments,
            },
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
            providerMessageId: result.messageId,
            providerStatus: result.providerStatus,
            sentAt: new Date(),
            lastError: null,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "PRE_RESERVATION_APPROVAL_SMS_SENT",
            entityType: "Reservation",
            entityId: id,
            metadata: {
              notificationId: notification.id,
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
      providerStatus: result.providerStatus,
      characters: analysis.characterCount,
      segments: analysis.segments,
    });
  }

  if (parsed.data.action === "RELEASE") {
    const now = new Date();
    await prisma.$transaction([
      prisma.reservation.update({
        where: { id },
        data: { status: "CANCELLED" },
      }),
      prisma.seatPreference.updateMany({
        where: { reservationId: id, releasedAt: null },
        data: { status: "RELEASED", releasedAt: now },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PRE_RESERVATION_CANCELLED_AND_SEATS_RELEASED",
          entityType: "Reservation",
          entityId: id,
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  try {
    await enforceRateLimit({
      namespace: "admin-pre-reservation-sms",
      identifier: `${user.id}:${id}`,
      limit: 3,
      windowMs: 60 * 60_000,
    });
    const notification = await prisma.notification.findUnique({
      where: {
        reservationId_channel_template: {
          reservationId: id,
          channel: "SMS",
          template: "PRE_RESERVATION_RECEIVED",
        },
      },
    });
    if (!notification)
      return NextResponse.json(
        { error: "O SMS não está configurado para esta inscrição." },
        { status: 409 },
      );
    if (notification.status === "SENT" || notification.status === "PROCESSING")
      return NextResponse.json(
        { error: "Este SMS já foi enviado ou está em processamento." },
        { status: 409 },
      );
    if (notification.status === "BLOCKED")
      return NextResponse.json(
        { error: "O SMS está bloqueado pelo controlo de segmentos." },
        { status: 409 },
      );
    if (notification.attempts >= 3)
      return NextResponse.json(
        { error: "O limite seguro de envios foi atingido." },
        { status: 409 },
      );
    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: { status: "RETRY" },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "PRE_RESERVATION_SMS_REQUEUED",
          entityType: "Reservation",
          entityId: id,
          ipAddress: clientIp(request),
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      typeof error === "object" && error && "status" in error && error.status === 429
    )
      return NextResponse.json(
        { error: "Limite de reenvios atingido. Tenta mais tarde." },
        { status: 429 },
      );
    return NextResponse.json({ error: "Não foi possível reagendar o SMS." }, { status: 503 });
  }
}
