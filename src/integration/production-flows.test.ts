import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as createReservation } from "@/app/api/reservations/route";
import { POST as createPreReservationLead } from "@/app/api/pre-reservations/lead/route";
import { POST as completePreReservation } from "@/app/api/pre-reservations/route";
import { POST as createPaymentIntent } from "@/app/api/payments/intent/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as exportPassengers } from "@/app/api/admin/passengers.csv/route";
import { PATCH as updatePreReservation } from "@/app/api/admin/pre-reservations/[id]/route";
import { POST as managePaymentInvitation } from "@/app/api/admin/payment-invitations/[reservationId]/route";
import { POST as updatePaymentInvitation } from "@/app/api/payment-invitations/[token]/route";
import { POST as createGatewayTestPayment } from "@/app/api/admin/payment-test/route";
import {
  GET as inspectTicket,
  POST as validateTicket,
} from "@/app/api/tickets/[token]/validate/route";
import { createSessionToken } from "@/lib/auth-crypto";
import { hashPassword } from "@/lib/auth-crypto";

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
      sessionVersion: user.sessionVersion,
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

  it("calculates quantities 1 to 8 and identifies minors", async () => {
    process.env.BOOKING_MODE = "PRE_RESERVATION";
    process.env.PRE_RESERVATIONS_ENABLED = "true";
    process.env.PAYMENTS_ENABLED = "false";
    delete process.env.ZIETT_API_KEY;
    delete process.env.KUKUGEST_API_KEY;
    delete process.env.CRON_SECRET;
    const overCapacity = await createPreReservationLead(
      new Request("http://localhost/api/pre-reservations/lead", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.1.0.99" },
        body: JSON.stringify({
          name: "Reserva acima da capacidade",
          phone: "+244924000099",
          quantity: 31,
          pickupPreference: "TALATONA_BELAS",
          dataConsent: true,
          idempotencyKey: randomUUID(),
        }),
      }),
    );
    expect(overCapacity.status).toBe(409);
    const cases = [25_000, 47_500, 72_500, 90_000, 115_000, 137_500, 162_500, 180_000];
    for (const [index, total] of cases.entries()) {
      const quantity = index + 1;
      const phone = `+24492400000${quantity}`;
      const leadResponse = await createPreReservationLead(
        new Request("http://localhost/api/pre-reservations/lead", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${quantity}` },
          body: JSON.stringify({
            name: `Responsável ${quantity}`,
            phone,
            email: `quantity-${quantity}@example.test`,
            quantity,
            pickupPreference: "TALATONA_BELAS",
            dataConsent: true,
            marketingConsent: false,
            idempotencyKey: randomUUID(),
          }),
        }),
      );
      expect(leadResponse.status).toBe(201);
      const lead = await leadResponse.json();
      const seats = quantity === 3 ? [21, 22, 23] : Array.from({ length: quantity }, (_, seat) => seat + 1);
      const includesMinor = quantity === 5;
      const completeResponse = await completePreReservation(
        new Request("http://localhost/api/pre-reservations", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.1.1.${quantity}` },
          body: JSON.stringify({
            reservationId: lead.reservationId,
            accessToken: lead.accessToken,
            passengers: Array.from({ length: quantity }, (_, passengerIndex) => ({
              fullName: `Passageiro ${quantity} ${passengerIndex + 1}`,
              birthDate: includesMinor && passengerIndex === 0 ? "2012-01-01" : "1990-01-01",
            })),
            minorGuardianName: includesMinor ? "Adulto Responsável" : "",
            minorGuardianPhone: includesMinor ? "+244924999999" : "",
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
      const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: lead.reservationId } });
      expect(stored.minorCount).toBe(includesMinor ? 1 : 0);
      if (quantity !== 3)
        await prisma.seatPreference.updateMany({
          where: { reservationId: lead.reservationId, releasedAt: null },
          data: { status: "RELEASED", releasedAt: new Date() },
        });
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
          quantity: 1,
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
            quantity: 1,
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
            passengers: [{ fullName: `Concorrente ${index + 1}`, birthDate: "1990-01-01" }],
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

  it("protects admin data and approves a pre-reservation atomically", async () => {
    const anonymousExport = await exportPassengers(
      new Request("http://localhost/api/admin/passengers.csv"),
    );
    expect(anonymousExport.status).toBe(401);

    const password = "palavra-passe-administrativa-segura";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@example.test`,
        name: "Administrador de teste",
        passwordHash: hashPassword(password),
        role: "ADMIN",
      },
    });
    const loginResponse = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.3.0.1",
        },
        body: JSON.stringify({ email: admin.email, password }),
      }),
    );
    expect(loginResponse.status).toBe(200);
    const setCookie = loginResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    const cookie = setCookie.split(";")[0];

    const paymentsBeforeGatewayTest = await prisma.payment.count();
    process.env.PAYMENTS_API_URL =
      "https://rouxavcvorjiwhpjhsye.supabase.co/functions/v1/api-v1";
    process.env.PAYMENTS_API_KEY = "test-gateway-key";
    const gatewayRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          payment_id: "20c995f3-fec2-40f9-bd96-7eeab4ec970f",
          status: "pending",
          payment_method: "multicaixa",
          total_amount: 100,
          currency: "AOA",
          checkout_url: "https://gateway.example/checkout/test",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", gatewayRequest);
    const gatewayTestBody = {
      name: "Cliente de teste",
      email: "gateway-test@example.test",
      phone: "+244923111222",
      method: "multicaixa",
      confirmation: true,
    };
    const anonymousGatewayTest = await createGatewayTestPayment(
      new Request("http://localhost/api/admin/payment-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gatewayTestBody),
      }),
    );
    expect(anonymousGatewayTest.status).toBe(401);
    const gatewayTest = await createGatewayTestPayment(
      new Request("http://localhost/api/admin/payment-test", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(gatewayTestBody),
      }),
    );
    const gatewayResult = await gatewayTest.json();
    expect({ status: gatewayTest.status, error: gatewayResult.error }).toEqual({
      status: 200,
      error: undefined,
    });
    expect(gatewayResult.amount).toBe(100);
    expect(gatewayResult.paymentUrl).toBe("https://gateway.example/checkout/test");
    expect(JSON.parse(gatewayRequest.mock.calls[0][1].body).items).toEqual([
      { product_id: "20d032f3-e0c2-48d3-8ce1-c93bc682dd37", quantity: 1 },
    ]);
    expect(await prisma.payment.count()).toBe(paymentsBeforeGatewayTest);
    const repeatedGatewayTest = await createGatewayTestPayment(
      new Request("http://localhost/api/admin/payment-test", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(gatewayTestBody),
      }),
    );
    expect(repeatedGatewayTest.status).toBe(429);
    expect(gatewayRequest).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    delete process.env.PAYMENTS_API_KEY;

    const reservation = await prisma.reservation.findFirstOrThrow({
      where: { status: "PRE_RESERVED", plan: "DUO_INDIVIDUAL" },
      include: { seatPreferences: true },
    });
    const anonymousSms = await updatePreReservation(
      new Request(
        `http://localhost/api/admin/pre-reservations/${reservation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "SEND_APPROVAL_SMS" }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect(anonymousSms.status).toBe(401);
    const response = await updatePreReservation(
      new Request(
        `http://localhost/api/admin/pre-reservations/${reservation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "APPROVE" }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect(response.status).toBe(200);
    const approved = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { seatPreferences: true },
    });
    expect(approved.status).toBe("PAYMENT_PENDING");
    expect(approved.contactStatus).toBe("AWAITING_PAYMENT");
    expect(
      approved.seatPreferences.every(
        (seat) => seat.status === "TEMPORARILY_HELD",
      ),
    ).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: {
          userId: admin.id,
          entityId: reservation.id,
          action: "PRE_RESERVATION_APPROVED",
        },
      }),
    ).toBe(1);

    process.env.ZIETT_API_KEY = "test-key";
    process.env.ZIETT_SMS_REMITTER_ID = "00000000-0000-0000-0000-000000000001";
    const ziettRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message_id: "approval-message-1", status: "QUEUED" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", ziettRequest);
    const sendApproval = () => updatePreReservation(
      new Request(
        `http://localhost/api/admin/pre-reservations/${reservation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "SEND_APPROVAL_SMS" }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect((await sendApproval()).status).toBe(200);
    const notification = await prisma.notification.findUniqueOrThrow({
      where: {
        reservationId_channel_template: {
          reservationId: reservation.id,
          channel: "SMS",
          template: "PRE_RESERVATION_APPROVED",
        },
      },
    });
    expect(notification.status).toBe("SENT");
    expect(notification.content).toContain(reservation.reference);
    expect(notification.encoding).toBe("GSM-7");
    expect(notification.segmentCount).toBe(1);
    expect(notification.requestedById).toBe(admin.id);
    expect(notification.providerMessageId).toBe("approval-message-1");
    expect((await sendApproval()).status).toBe(409);
    expect(ziettRequest).toHaveBeenCalledOnce();

    const invitationRequest = (body: Record<string, unknown>, withCookie = true) =>
      managePaymentInvitation(
        new Request(
          `http://localhost/api/admin/payment-invitations/${reservation.id}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(withCookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
          },
        ),
        { params: Promise.resolve({ reservationId: reservation.id }) },
      );
    expect((await invitationRequest({ action: "GENERATE" }, false)).status).toBe(401);
    const generatedResponse = await invitationRequest({ action: "GENERATE" });
    expect(generatedResponse.status).toBe(200);
    const generated = await generatedResponse.json();
    expect(generated.state).toBe("ACTIVE");
    expect(generated.link).toMatch(/^https:\/\/festgo\.mazanga\.digital\/confirmar\//);
    const repeatedGeneration = await invitationRequest({ action: "GENERATE" });
    expect((await repeatedGeneration.json()).link).toBe(generated.link);
    expect(await prisma.paymentInvitation.count({
      where: { reservationId: reservation.id },
    })).toBe(1);

    const token = decodeURIComponent(new URL(generated.link).pathname.split("/").pop() ?? "");
    const invalidInvitation = await updatePaymentInvitation(
      new Request("http://localhost/api/payment-invitations/invalid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ token: `${token}modified` }) },
    );
    expect(invalidInvitation.status).toBe(404);

    const originalSeats = reservation.seatPreferences
      .map((seat) => seat.seatNumber)
      .sort((a, b) => a - b)
      .slice(0, 2);
    const confirmation = await updatePaymentInvitation(
      new Request(`http://localhost/api/payment-invitations/${token}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.4.0.1",
        },
        body: JSON.stringify({
          quantity: 2,
          passengers: [
            { fullName: "Passageiro actualizado 1", birthDate: "1990-01-01" },
            { fullName: "Passageiro actualizado 2", birthDate: "2012-01-01" },
          ],
          minorGuardianName: "Adulto Responsável",
          minorGuardianPhone: "+244923999999",
          seats: originalSeats,
          pickupPreference: "OUTRO",
          pickupOther: "Kilamba",
        }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(confirmation.status).toBe(200);
    const changed = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: {
        passengers: true,
        seatPreferences: { where: { releasedAt: null } },
        payments: true,
      },
    });
    expect(changed.plan).toBe("DUO");
    expect(changed.quantity).toBe(2);
    expect(Number(changed.totalAmount)).toBe(47_500);
    expect(changed.passengers).toHaveLength(2);
    expect(changed.minorCount).toBe(1);
    expect(changed.seatPreferences.map((seat) => seat.seatNumber).sort()).toEqual(originalSeats);
    expect(changed.pickupPreference).toBe("Outro");
    expect(changed.pickupOther).toBe("Kilamba");
    expect(changed.payments).toHaveLength(0);

    const paymentSmsWithoutCostConfirmation = await invitationRequest({ action: "SEND_SMS" });
    expect(paymentSmsWithoutCostConfirmation.status).toBe(409);
    ziettRequest.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message_id: "payment-link-message-1", status: "QUEUED" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    expect((await invitationRequest({
      action: "SEND_SMS",
      acknowledgeMultipleSegments: true,
    })).status).toBe(200);
    expect((await invitationRequest({
      action: "SEND_SMS",
      acknowledgeMultipleSegments: true,
    })).status).toBe(409);
    const paymentSms = await prisma.notification.findUniqueOrThrow({
      where: {
        reservationId_channel_template: {
          reservationId: reservation.id,
          channel: "SMS",
          template: "PAYMENT_LINK",
        },
      },
    });
    expect(paymentSms.status).toBe("SENT");
    expect(paymentSms.content).toContain(generated.link);
    expect(paymentSms.segmentCount).toBeGreaterThan(1);
    expect(paymentSms.providerMessageId).toBe("payment-link-message-1");

    expect((await invitationRequest({ action: "REVOKE" })).status).toBe(200);
    const revokedAccess = await updatePaymentInvitation(
      new Request(`http://localhost/api/payment-invitations/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quantity: 2,
          passengers: [
            { fullName: "Passageiro actualizado 1", birthDate: "1990-01-01" },
            { fullName: "Passageiro actualizado 2", birthDate: "2012-01-01" },
          ],
          minorGuardianName: "Adulto Responsável",
          minorGuardianPhone: "+244923999999",
          seats: originalSeats,
          pickupPreference: "OUTRO",
          pickupOther: "Kilamba",
        }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(revokedAccess.status).toBe(404);

    const retryReservation = await prisma.reservation.findFirstOrThrow({
      where: { status: "PRE_RESERVED", id: { not: reservation.id } },
    });
    const approveRetryReservation = await updatePreReservation(
      new Request(
        `http://localhost/api/admin/pre-reservations/${retryReservation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "APPROVE" }),
        },
      ),
      { params: Promise.resolve({ id: retryReservation.id }) },
    );
    expect(approveRetryReservation.status).toBe(200);
    ziettRequest
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ trace_id: "trace-failure" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message_id: "approval-message-2", status: "QUEUED" }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      );
    const sendRetryApproval = () => updatePreReservation(
      new Request(
        `http://localhost/api/admin/pre-reservations/${retryReservation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "SEND_APPROVAL_SMS" }),
        },
      ),
      { params: Promise.resolve({ id: retryReservation.id }) },
    );
    expect((await sendRetryApproval()).status).toBe(502);
    let retriedNotification = await prisma.notification.findUniqueOrThrow({
      where: {
        reservationId_channel_template: {
          reservationId: retryReservation.id,
          channel: "SMS",
          template: "PRE_RESERVATION_APPROVED",
        },
      },
    });
    expect(retriedNotification.status).toBe("FAILED");
    expect(retriedNotification.attempts).toBe(1);
    expect(retriedNotification.providerStatus).toBe("HTTP_503");
    expect((await sendRetryApproval()).status).toBe(200);
    retriedNotification = await prisma.notification.findUniqueOrThrow({
      where: { id: retriedNotification.id },
    });
    expect(retriedNotification.status).toBe("SENT");
    expect(retriedNotification.attempts).toBe(2);
    expect(retriedNotification.providerMessageId).toBe("approval-message-2");
    expect(ziettRequest).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
    delete process.env.ZIETT_API_KEY;
    delete process.env.ZIETT_SMS_REMITTER_ID;
  });
});
