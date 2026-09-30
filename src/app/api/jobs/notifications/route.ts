import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processNotificationJobs, queueNotifications } from "@/lib/notification-jobs";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const queued = await queueNotifications();
  const processed = await processNotificationJobs();
  await prisma.requestRateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return NextResponse.json({ ...queued, ...processed });
}
export async function GET(request: Request) { return POST(request); }
