import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcilePayment } from "@/lib/integrations/payments-api";

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const now = new Date();
  const expired = await prisma.reservation.updateMany({
    where: {
      status: "HELD",
      holdExpiresAt: { lt: now },
      payments: { none: {} },
    },
    data: { status: "EXPIRED" },
  });
  const payments = await prisma.payment.findMany({
    where: {
      provider: "paygo",
      providerPaymentId: { not: null },
      status: { in: ["CREATED", "PENDING", "UNKNOWN"] },
      reservation: {
        status: { in: ["AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: { id: true },
  });
  let reconciled = 0;
  let failed = 0;
  for (const payment of payments) {
    try {
      await reconcilePayment(payment.id);
      reconciled += 1;
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json({ expiredHolds: expired.count, reconciled, failed });
}

export const GET = run;
export const POST = run;
