import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcilePayment } from "@/lib/integrations/payments-api";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import {
  reconcileTestPayment,
  recoverTestPayment,
} from "@/lib/test-payments";

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const testPayments = await prisma.testPayment.findMany({
    where: {
      status: { in: ["CREATED", "PENDING", "UNKNOWN"] },
      testReservation: { status: { not: "PAID" } },
    },
    orderBy: { updatedAt: "asc" },
    take: 25,
    select: { id: true, providerPaymentId: true },
  });
  let testReconciled = 0;
  let testPending = 0;
  let testFailed = 0;
  for (const payment of testPayments) {
    try {
      const result = payment.providerPaymentId
        ? await reconcileTestPayment(payment.id)
        : await recoverTestPayment(payment.id);
      if (result) testReconciled += 1;
      else testPending += 1;
    } catch {
      testFailed += 1;
    }
  }
  if (!arePaymentsEnabled())
    return NextResponse.json({
      publicPaymentsDisabled: true,
      reconciled: 0,
      testReconciled,
      testPending,
      testFailed,
    });
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
