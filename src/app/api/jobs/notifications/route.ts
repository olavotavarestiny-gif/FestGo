import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSms } from "@/lib/integrations/ziett";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const jobs = await prisma.notification.findMany({
    where: { status: { in: ["PENDING", "RETRY"] }, channel: "SMS", attempts: { lt: 5 } },
    include: { reservation: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let sent = 0;
  for (const job of jobs) {
    if (!job.reservation) continue;
    try {
      const baseUrl = (process.env.APP_URL ?? "https://festgo.mazanga.digital").replace(/\/$/, "");
      const passengers = await prisma.reservationPassenger.findMany({
        where: { reservationId: job.reservation.id }, include: { ticket: true }, orderBy: { id: "asc" },
      });
      const ticketUrls = passengers.flatMap((passenger) => passenger.ticket
        ? [`${passenger.fullName}: ${baseUrl}/bilhete/${passenger.ticket.publicToken}`]
        : []);
      const result = await sendSms({
        phone: job.recipient,
        idempotencyKey: `notification-${job.id}`,
        content: `FestGO: pagamento confirmado para a reserva ${job.reservation.reference}. Bilhetes: ${ticketUrls.join(" | ") || baseUrl}`,
      });
      await prisma.notification.update({ where: { id: job.id }, data: { status: "SENT", attempts: { increment: 1 }, providerMessageId: result.messageId, sentAt: new Date() } });
      sent += 1;
    } catch {
      await prisma.notification.update({ where: { id: job.id }, data: { status: job.attempts >= 4 ? "FAILED" : "RETRY", attempts: { increment: 1 } } });
    }
  }
  return NextResponse.json({ processed: jobs.length, sent });
}
