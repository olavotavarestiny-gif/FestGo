import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as createReservation } from "@/app/api/reservations/route";
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
        pickup: "Cidade de Luanda",
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
          pickup: "Cidade de Luanda",
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
      where: { reservationId: reservation.id },
      create: { reservationId: reservation.id },
      update: {},
    });
    await prisma.cRMIntegrationJob.upsert({
      where: { reservationId: reservation.id },
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
});
