import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/integrations/ziett";
import { createTicketBundleToken } from "@/lib/ticket-access";
import { analyzeSms, smsTemplates } from "@/lib/sms";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const now = new Date();
  const reminderReservations = await prisma.reservation.findMany({
    where: {
      status: "PAID",
      event: {
        eventDate: {
          gte: new Date(now.getTime() + 18 * 60 * 60_000),
          lte: new Date(now.getTime() + 30 * 60 * 60_000),
        },
      },
    },
    include: { customer: true },
  });
  await prisma.notification.createMany({
    data: reminderReservations.map((reservation) => ({
        reservationId: reservation.id,
        channel: "SMS" as const,
        recipient: reservation.customer.phone,
        template: "EVENT_REMINDER",
    })),
    skipDuplicates: true,
  });

  const jobs = await prisma.notification.findMany({
    where: {
      channel: "SMS",
      template: {
        in: ["PRE_RESERVATION_RECEIVED", "BOOKING_PAID", "EVENT_REMINDER"],
      },
      attempts: { lt: 3 },
      OR: [
        { status: { in: ["PENDING", "RETRY"] } },
        {
          status: "PROCESSING",
          updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        },
      ],
    },
    include: {
      reservation: {
        include: { customer: true, event: true, pickupPoint: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let sent = 0;
  for (const job of jobs) {
    const claimed = await prisma.notification.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: { in: ["PENDING", "RETRY"] } },
          {
            status: "PROCESSING",
            updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
          },
        ],
      },
      data: { status: "PROCESSING" },
    });
    if (!claimed.count || !job.reservation) continue;
    try {
      const reservation = job.reservation;
      let content: string;
      if (job.template === "PRE_RESERVATION_RECEIVED") {
        content = smsTemplates.preReservationReceived(reservation.reference);
      } else {
        const expiry = new Date(
          (reservation.event.returnAt ?? reservation.event.eventDate).getTime() +
            7 * 24 * 60 * 60_000,
        );
        const token = createTicketBundleToken(reservation.reference, expiry);
        const baseUrl = (
          process.env.APP_URL ?? "https://festgo.mazanga.digital"
        ).replace(/\/$/, "");
        const link = `${baseUrl}/reserva/${reservation.reference}/bilhetes?token=${encodeURIComponent(token)}`;
        if (job.template === "EVENT_REMINDER") {
          if (!reservation.pickupPoint?.departureAt)
            throw new Error("A reserva paga não tem ponto operacional confirmado.");
          const time = reservation.pickupPoint.departureAt.toLocaleTimeString(
            "pt-AO",
            { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" },
          );
          content = `FestGo: Amanha, embarque as ${time} em ${reservation.pickupPoint.name}. Bilhete: ${link}`;
        } else content = smsTemplates.paymentConfirmed(link);
      }
      const analysis = analyzeSms(content);
      if (analysis.encoding !== "GSM-7" || !analysis.isSingleSegment) {
        await prisma.notification.update({
          where: { id: job.id },
          data: {
            status: "BLOCKED",
            content,
            encoding: analysis.encoding,
            characterCount: analysis.characterCount,
            segmentCount: analysis.segments,
            lastError: "Envio bloqueado: a mensagem ultrapassa um segmento GSM-7.",
          },
        });
        continue;
      }
      const result = await sendSms({
        phone: job.recipient,
        idempotencyKey: `notification-${job.id}`,
        content,
      });
      await prisma.notification.update({
        where: { id: job.id },
        data: {
          status: "SENT",
          attempts: { increment: 1 },
          providerMessageId: result.messageId,
          providerStatus: result.providerStatus,
          content,
          encoding: analysis.encoding,
          characterCount: analysis.characterCount,
          segmentCount: analysis.segments,
          lastError: null,
          sentAt: new Date(),
        },
      });
      sent += 1;
    } catch (error) {
      await prisma.notification.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= 2 ? "FAILED" : "RETRY",
          attempts: { increment: 1 },
          lastError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Falha desconhecida no envio.",
        },
      });
    }
  }
  await prisma.requestRateLimit.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return NextResponse.json({
    processed: jobs.length,
    sent,
    remindersQueued: reminderReservations.length,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
