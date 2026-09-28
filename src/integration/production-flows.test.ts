import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as createReservation } from "@/app/api/reservations/route";
import { POST as createPreReservationLead } from "@/app/api/pre-reservations/lead/route";
import { POST as completePreReservation } from "@/app/api/pre-reservations/route";
import { POST as createPaymentIntent } from "@/app/api/payments/intent/route";
import {
  GET as inspectTicket,
  POST as validateTicket,
} from "@/app/api/tickets/[token]/validate/route";
import { createSessionToken } from "@/lib/auth-crypto";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient();
const phones = Array.from(
  { length: 6 },
  (_, index) => `+24492300000${index + 1}`,
);

describe.skipIf(!enabled)("production database flows", () => {
  beforeAll(async () => {
    process.env.SALES_ENABLED = "true";
    process.env.BOOKING_MODE = "PAID_RESERVATION";
    process.env.PAYMENTS_ENABLED = "true";
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: "brunch-mangais" },
    });
    expect(event.status).toBe("DRAFT");
    await prisma.event.update({
      where: { id: event.id },
      data: { status: "ON_SALE" },
    });
    await prisma.sMSVerification.createMany({
      data: phones.map((phone) => ({
        phone,
        codeHash: "test",
        expiresAt: new Date(Date.now() + 10 * 60_000),
        lastSentAt: new Date(),
        verifiedAt: new Date(),
      })),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never exceeds capacity under concurrent reservations and preserves idempotency", async () => {
    const challenges = await prisma.sMSVerification.findMany({
      where: { phone: { in: phones } },
      orderBy: { phone: "asc" },
    });
    const keys = challenges.map(() => randomUUID());
    const calls = challenges.map((challenge, index) => {
      const body = {
        name: `Comprador ${index}`,
        phone: challenge.phone,
        email: `buyer${index}@example.test`,
        pickup: "Cidade — Primeiro de Maio",
        passengers: Array.from(
          { length: 6 },
          (_, passenger) => `Passageiro ${index}-${passenger}`,
        ),
        referral: "",
        terms: true,
        marketing: false,
        verificationId: challenge.id,
        idempotencyKey: keys[index],
      };
      return createReservation(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `10.0.0.${index + 1}`,
          },
          body: JSON.stringify(body),
        }),
      );
    });
    const responses = await Promise.all(calls);
    const accepted = responses.filter((response) => response.status === 201);
    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: "brunch-mangais" },
    });
    const reserved = await prisma.reservation.aggregate({
      where: { eventId: event.id, status: "HELD" },
      _sum: { quantity: true },
    });
    expect(reserved._sum.quantity).toBeLessThanOrEqual(event.capacity);
    expect(accepted).toHaveLength(5);

    const first = (await accepted[0].json()) as { reservationId: string };
    const firstChallenge = challenges[0];
    const repeated = await createReservation(
      new Request("http://localhost/api/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.0.0.1",
        },
        body: JSON.stringify({
          name: "Comprador 0",
          phone: firstChallenge.phone,
          email: "buyer0@example.test",
          pickup: "Cidade — Primeiro de Maio",
          passengers: Array.from(
            { length: 6 },
            (_, passenger) => `Passageiro 0-${passenger}`,
          ),
          referral: "",
          terms: true,
          marketing: false,
          verificationId: firstChallenge.id,
          idempotencyKey: keys[0],
        }),
      }),
    );
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).reservationId).toBe(first.reservationId);
  }, 20_000);

  it("allows only one simultaneous validation per ticket leg and rejects anonymous inspection", async () => {
    const reservation = await prisma.reservation.findFirstOrThrow({
      include: { passengers: true },
    });
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: "PAID", paidAt: new Date() },
    });
    const user = await prisma.user.create({
      data: {
        email: `operator-${randomUUID()}@example.test`,
        name: "Operador",
        passwordHash: "test",
        role: "OPERATOR",
      },
    });
    const ticket = await prisma.ticket.create({
      data: { passengerId: reservation.passengers[0].id },
    });
    const attempts = await Promise.allSettled([
      prisma.ticketValidation.create({
        data: { ticketId: ticket.id, leg: "OUTBOUND", operatorId: user.id },
      }),
      prisma.ticketValidation.create({
        data: { ticketId: ticket.id, leg: "OUTBOUND", operatorId: user.id },
      }),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const response = await inspectTicket(
      new Request(
        `http://localhost/api/tickets/${ticket.publicToken}/validate`,
      ),
      { params: Promise.resolve({ token: ticket.publicToken }) },
    );
    expect(response.status).toBe(401);
    const session = createSessionToken({
      userId: user.id,
      role: "OPERATOR",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const duplicate = await validateTicket(
      new Request(
        `http://localhost/api/tickets/${ticket.publicToken}/validate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `festgo_session=${session}`,
          },
          body: JSON.stringify({ leg: "OUTBOUND" }),
        },
      ),
      { params: Promise.resolve({ token: ticket.publicToken }) },
    );
    expect(duplicate.status).toBe(409);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const revoked = await validateTicket(
      new Request(
        `http://localhost/api/tickets/${ticket.publicToken}/validate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `festgo_session=${session}`,
          },
          body: JSON.stringify({ leg: "RETURN" }),
        },
      ),
      { params: Promise.resolve({ token: ticket.publicToken }) },
    );
    expect(revoked.status).toBe(409);
  });

  it("deduplicates queued notifications and CRM work", async () => {
    const reservation = await prisma.reservation.findFirstOrThrow({
      include: { customer: true },
    });
    await Promise.all([
      prisma.notification.createMany({
        data: [{
          reservationId: reservation.id,
          channel: "SMS",
          recipient: reservation.customer.phone,
          template: "BOOKING_PAID",
        }],
        skipDuplicates: true,
      }),
      prisma.notification.createMany({
        data: [{
          reservationId: reservation.id,
          channel: "SMS",
          recipient: reservation.customer.phone,
          template: "BOOKING_PAID",
        }],
        skipDuplicates: true,
      }),
    ]);
    await prisma.cRMIntegrationJob.upsert({
      where: { reservationId_kind: { reservationId: reservation.id, kind: "SALE" } },
      create: { reservationId: reservation.id },
      update: {},
    });
    await prisma.cRMIntegrationJob.upsert({
      where: { reservationId_kind: { reservationId: reservation.id, kind: "SALE" } },
      create: { reservationId: reservation.id },
      update: {},
    });
    expect(
      await prisma.notification.count({
        where: { reservationId: reservation.id, template: "BOOKING_PAID" },
      }),
    ).toBe(1);
    expect(
      await prisma.cRMIntegrationJob.count({
        where: { reservationId: reservation.id },
      }),
    ).toBe(1);
  });

  it("creates every commercial plan at the exact advertised total", async () => {
    process.env.BOOKING_MODE = "PRE_RESERVATION";
    process.env.PRE_RESERVATIONS_ENABLED = "true";
    process.env.PAYMENTS_ENABLED = "false";
    delete process.env.ZIETT_API_KEY;
    delete process.env.KUKUGEST_API_KEY;
    delete process.env.CRON_SECRET;
    const cases = [
      ["INDIVIDUAL", 1, 25_000],
      ["DUO", 2, 47_500],
      ["DUO_INDIVIDUAL", 3, 72_500],
      ["GROUP", 4, 90_000],
    ] as const;
    let nextSeat = 1;
    for (const [plan, quantity, total] of cases) {
      const phone = `+24492400000${quantity}`;
      const leadResponse = await createPreReservationLead(
        new Request("http://localhost/api/pre-reservations/lead", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${quantity}` },
          body: JSON.stringify({
            name: `Responsável ${plan}`,
            phone,
            email: `${plan.toLowerCase()}@example.test`,
            plan,
            pickupPreference: "TALATONA_BELAS",
            dataConsent: true,
            marketingConsent: false,
            idempotencyKey: randomUUID(),
          }),
        }),
      );
      expect(leadResponse.status).toBe(201);
      const lead = await leadResponse.json();
      const seats = Array.from({ length: quantity }, () => nextSeat++);
      const completeResponse = await completePreReservation(
        new Request("http://localhost/api/pre-reservations", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.1.1.${quantity}` },
          body: JSON.stringify({
            reservationId: lead.reservationId,
            accessToken: lead.accessToken,
            passengers: Array.from({ length: quantity }, (_, index) => `Passageiro ${plan} ${index + 1}`),
            seats,
            joinWaitlist: false,
            terms: true,
          }),
        }),
      );
      expect(completeResponse.status).toBe(201);
      const completed = await completeResponse.json();
      expect(completed.quantity).toBe(quantity);
      expect(completed.total).toBe(total);
      expect(completed.seats).toEqual(seats);
    }
  });

  it("requires a custom pickup location and resolves simultaneous seat preference safely", async () => {
    const invalid = await createPreReservationLead(
      new Request("http://localhost/api/pre-reservations/lead", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" },
        body: JSON.stringify({
          name: "Responsável Outro",
          phone: "+244925000001",
          plan: "INDIVIDUAL",
          pickupPreference: "OUTRO",
          pickupOther: "",
          dataConsent: true,
          idempotencyKey: randomUUID(),
        }),
      }),
    );
    expect(invalid.status).toBe(400);

    const leads = await Promise.all([1, 2].map(async (suffix) => {
      const response = await createPreReservationLead(
        new Request("http://localhost/api/pre-reservations/lead", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${suffix + 1}` },
          body: JSON.stringify({
            name: `Concorrente ${suffix}`,
            phone: `+24492600000${suffix}`,
            plan: "INDIVIDUAL",
            pickupPreference: "OUTRO",
            pickupOther: "Kilamba",
            dataConsent: true,
            idempotencyKey: randomUUID(),
          }),
        }),
      );
      expect(response.status).toBe(201);
      return response.json();
    }));
    const attempts = await Promise.all(leads.map((lead, index) =>
      completePreReservation(
        new Request("http://localhost/api/pre-reservations", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.2.1.${index + 1}` },
          body: JSON.stringify({
            reservationId: lead.reservationId,
            accessToken: lead.accessToken,
            passengers: [`Concorrente ${index + 1}`],
            seats: [30],
            joinWaitlist: false,
            terms: true,
          }),
        }),
      ),
    ));
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);

    const payment = await createPaymentIntent(
      new Request("http://localhost/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(payment.status).toBe(409);
  });
});
