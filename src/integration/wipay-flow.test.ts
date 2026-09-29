import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as wipayCallback } from "@/app/api/webhooks/wipay/route";
import { resetWiPayTokenCacheForTests } from "@/lib/integrations/wipay";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient();
const signatureToken = "signature-token-with-more-than-thirty-two-characters";

describe.skipIf(!enabled)("WiPay callback flow", () => {
  let eventId = "";

  beforeAll(async () => {
    process.env.WIPAY_API_URL = "https://api.wipay.ao";
    process.env.WIPAY_CLIENT_ID = "wp_sandbox_client";
    process.env.WIPAY_CLIENT_SECRET = "WPS_sandbox_secret";
    process.env.WIPAY_ENVIRONMENT = "sandbox";
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    delete process.env.CRON_SECRET;
    eventId = (
      await prisma.event.findUniqueOrThrow({ where: { slug: "brunch-mangais" } })
    ).id;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          access_token: signatureToken,
          expires_in: 86_400,
          scope: "signature",
        }),
      ),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetWiPayTokenCacheForTests();
    await prisma.$disconnect();
  });

  async function preparedPayment(input: { seat?: number; amount?: number }) {
    const suffix = randomUUID();
    const customer = await prisma.customer.create({
      data: {
        fullName: "Cliente WiPay Sandbox",
        phone: `+24492${Math.floor(1000000 + Math.random() * 8999999)}`,
      },
    });
    const reservation = await prisma.reservation.create({
      data: {
        reference: `WIPAY-${suffix.slice(0, 8).toUpperCase()}`,
        eventId,
        customerId: customer.id,
        status: "AWAITING_PAYMENT",
        quantity: 1,
        unitPrice: input.amount ?? 25_000,
        totalAmount: input.amount ?? 25_000,
        holdExpiresAt: new Date(Date.now() + 60 * 60_000),
        idempotencyKey: `reservation-${suffix}`,
        passengers: { create: { fullName: "Passageiro WiPay" } },
        ...(input.seat
          ? {
              seatPreferences: {
                create: {
                  eventId,
                  seatNumber: input.seat,
                  status: "TEMPORARILY_HELD",
                },
              },
            }
          : {}),
      },
      include: { passengers: true },
    });
    const providerPaymentId = randomUUID();
    const providerReference = `festgo_${suffix}`;
    const payment = await prisma.payment.create({
      data: {
        reservationId: reservation.id,
        provider: "wipay",
        providerPaymentId,
        providerReference,
        idempotencyKey: `payment-${suffix}`,
        method: "hosted",
        status: "PENDING",
        amount: input.amount ?? 25_000,
        currency: "AOA",
      },
    });
    return { reservation, payment, providerPaymentId, providerReference };
  }

  function callbackRequest(payload: Record<string, unknown>, valid = true) {
    const raw = JSON.stringify(payload);
    const signature = valid
      ? createHmac("sha256", signatureToken).update(raw).digest("hex")
      : "0".repeat(64);
    return new Request("https://festgo.mazanga.digital/api/webhooks/wipay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        signature,
        "x-forwarded-for": `10.80.0.${Math.floor(1 + Math.random() * 200)}`,
      },
      body: raw,
    });
  }

  function payloadFor(
    prepared: Awaited<ReturnType<typeof preparedPayment>>,
    status: "accepted" | "rejected" = "accepted",
  ) {
    return {
      id: prepared.providerPaymentId,
      amount: Number(prepared.payment.amount).toFixed(2),
      status,
      status_reason: status === "accepted" ? "2000" : "3002",
      status_datetime: new Date().toISOString(),
      currency: "aoa",
      customer: "923000000",
      reference_id: prepared.providerReference,
      processor: "gpo",
    };
  }

  it("accepts a signed callback exactly once and emits one ticket", async () => {
    const prepared = await preparedPayment({ seat: 11 });
    const payload = payloadFor(prepared);
    const first = await wipayCallback(callbackRequest(payload));
    expect(first.status).toBe(200);
    expect(await prisma.ticket.count({
      where: { passenger: { reservationId: prepared.reservation.id } },
    })).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({
      where: { id: prepared.reservation.id },
    })).status).toBe("PAID");

    const duplicate = await wipayCallback(callbackRequest(payload));
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    expect(await prisma.ticket.count({
      where: { passenger: { reservationId: prepared.reservation.id } },
    })).toBe(1);
  });

  it("binds an early callback to its random reference when the provider ID is not persisted yet", async () => {
    const prepared = await preparedPayment({ seat: 14 });
    await prisma.payment.update({
      where: { id: prepared.payment.id },
      data: { providerPaymentId: null },
    });
    const response = await wipayCallback(callbackRequest(payloadFor(prepared)));
    expect(response.status).toBe(200);
    expect(await prisma.payment.findUniqueOrThrow({
      where: { id: prepared.payment.id },
    })).toMatchObject({
      providerPaymentId: prepared.providerPaymentId,
      status: "SUCCEEDED",
    });
  });

  it("does not downgrade a successful payment when a later callback says rejected", async () => {
    const prepared = await preparedPayment({ seat: 15 });
    expect((await wipayCallback(callbackRequest(payloadFor(prepared)))).status).toBe(200);
    const rejected = payloadFor(prepared, "rejected");
    rejected.status_datetime = new Date(Date.now() + 1_000).toISOString();
    expect((await wipayCallback(callbackRequest(rejected))).status).toBe(200);
    expect(await prisma.payment.findUniqueOrThrow({
      where: { id: prepared.payment.id },
    })).toMatchObject({ status: "SUCCEEDED" });
    expect((await prisma.reservation.findUniqueOrThrow({
      where: { id: prepared.reservation.id },
    })).status).toBe("PAID");
  });

  it("rejects an invalid signature and an incorrect amount", async () => {
    const prepared = await preparedPayment({ seat: 12 });
    expect((await wipayCallback(callbackRequest(payloadFor(prepared), false))).status).toBe(401);
    expect((await wipayCallback(callbackRequest({
      ...payloadFor(prepared),
      amount: "1.00",
    }))).status).toBe(409);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: prepared.payment.id } })).status).toBe("PENDING");
  });

  it("releases seats after a signed rejection", async () => {
    const prepared = await preparedPayment({ seat: 13 });
    expect((await wipayCallback(callbackRequest(payloadFor(prepared, "rejected")))).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: prepared.payment.id } })).status).toBe("FAILED");
    expect(await prisma.seatPreference.count({
      where: { reservationId: prepared.reservation.id, releasedAt: null },
    })).toBe(0);
  });

  it("records a late paid callback without emitting a ticket when seats are gone", async () => {
    const prepared = await preparedPayment({});
    const response = await wipayCallback(callbackRequest(payloadFor(prepared)));
    expect(await response.json()).toMatchObject({
      status: "SUCCEEDED",
      ticketsIssued: false,
    });
    expect((await prisma.reservation.findUniqueOrThrow({
      where: { id: prepared.reservation.id },
    })).status).toBe("PAYMENT_UNCERTAIN");
    expect(await prisma.ticket.count({
      where: { passenger: { reservationId: prepared.reservation.id } },
    })).toBe(0);
  });
});
