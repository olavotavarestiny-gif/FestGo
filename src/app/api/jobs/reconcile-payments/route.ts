import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileProviderPayment } from "@/lib/payment-providers";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { schedulePostPaymentJobs } from "@/lib/schedule-jobs";
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
  const expiring = await prisma.reservation.findMany({
    where: { status: { in: ["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] }, holdExpiresAt: { lte: now }, payments: { none: { status: { in: ["SUCCEEDED", "REFUND_PENDING"] } } } },
    take: 100, select: { id: true, eventId: true },
  });
  let expiredHolds = 0;
  for (const reservation of expiring) {
    expiredHolds += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${reservation.eventId} FOR UPDATE`;
      const updated = await tx.reservation.updateMany({
        where: { id: reservation.id, status: { in: ["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] }, holdExpiresAt: { lte: now }, payments: { none: { status: { in: ["SUCCEEDED", "REFUND_PENDING"] } } } },
        data: { status: "EXPIRED" },
      });
      if (updated.count) await tx.seatPreference.updateMany({ where: { reservationId: reservation.id, releasedAt: null }, data: { status: "RELEASED", releasedAt: now } });
      return updated.count;
    });
  }
  const payments = await prisma.payment.findMany({
    where: {
      provider: { in: ["paygo", "ekwanza"] },
      providerPaymentId: { not: null },
      status: { in: ["CREATED", "PENDING", "UNKNOWN", "SUCCEEDED", "REFUND_PENDING"] },
      reservation: { status: { notIn: ["PAID", "REFUNDED"] } },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
    include: { reservation: { select: { reference: true } } },
  });
  let reconciled = 0;
  let failed = 0;
  for (const payment of payments) {
    try {
      const result = await reconcileProviderPayment(payment, payment.reservation.reference);
      if (result.newlyConfirmed) schedulePostPaymentJobs(request);
      reconciled += 1;
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json({ expiredHolds, reconciled, failed });
}

export const GET = run;
export const POST = run;
