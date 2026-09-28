import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as createTestReservation } from "@/app/api/admin/test-reservations/route";
import { POST as manageTestPayment } from "@/app/api/admin/test-reservations/[id]/route";
import {
  GET as inspectTestTicket,
  POST as validateTestTicket,
} from "@/app/api/admin/test-tickets/[token]/validate/route";
import { POST as paymentWebhook } from "@/app/api/webhooks/payments/route";
import { POST as reconcilePayments } from "@/app/api/jobs/reconcile-payments/route";
import { createSessionToken, hashPassword } from "@/lib/auth-crypto";
import {
  TEST_AMOUNT,
  TEST_CURRENCY,
  TEST_PRODUCT_ID,
} from "@/lib/test-payments";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient();

describe.skipIf(!enabled)("integrated administrative 100 Kz gateway test", () => {
  let cookie = "";

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    process.env.BOOKING_MODE = "PRE_RESERVATION";
    process.env.PAYMENTS_ENABLED = "false";
    process.env.PAYMENTS_API_URL =
      "https://rouxavcvorjiwhpjhsye.supabase.co/functions/v1/api-v1";
    process.env.PAYMENTS_API_KEY = "simulated-gateway-key";
    process.env.PAYMENTS_WEBHOOK_SECRET =
      "simulated-webhook-secret-with-thirty-two-characters";
    process.env.CRON_SECRET = "simulated-cron-secret-with-thirty-two-characters";
    const admin = await prisma.user.create({
      data: {
        email: `integrated-test-${randomUUID()}@example.test`,
        name: "Administrador do teste integrado",
        passwordHash: hashPassword("not-used-in-this-test"),
        role: "ADMIN",
      },
    });
    cookie = `festgo_session=${createSessionToken({
      userId: admin.id,
      role: admin.role,
      sessionVersion: admin.sessionVersion,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}`;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.PAYMENTS_API_KEY;
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    delete process.env.CRON_SECRET;
    await prisma.$disconnect();
  });

  it("isolates the reservation, confirms the signed webhook once, and validates each test leg once", async () => {
    const officialBefore = {
      reservations: await prisma.reservation.count(),
      seats: await prisma.seatPreference.count(),
      tickets: await prisma.ticket.count(),
      notifications: await prisma.notification.count(),
    };
    const reservationBody = {
      passengerName: "Passageiro Teste Integrado",
      email: "integrated-payment@example.test",
      phone: "+244923123456",
      plan: "INDIVIDUAL",
      testSeat: "TESTE-A1",
      pickupPreference: "TALATONA_BELAS",
    };
    const anonymous = await createTestReservation(
      new Request("http://localhost/api/admin/test-reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reservationBody),
      }),
    );
    expect(anonymous.status).toBe(401);

    const createdResponse = await createTestReservation(
      new Request("http://localhost/api/admin/test-reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-forwarded-for": "10.50.0.1",
        },
        body: JSON.stringify(reservationBody),
      }),
    );
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as {
      reference: string;
      url: string;
    };
    expect(created.reference).toMatch(/^TESTE-/);
    expect(created.url).toContain("/admin/teste-gateway/reserva/");
    const reservation = await prisma.testReservation.findUniqueOrThrow({
      where: { reference: created.reference },
    });

    const missingConfirmation = await manageTestPayment(
      new Request(
        `http://localhost/api/admin/test-reservations/${reservation.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            action: "START_PAYMENT",
            method: "multicaixa",
            confirmation: false,
          }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect(missingConfirmation.status).toBe(400);

    const providerPaymentId = "b6c87ce0-e3cc-4cec-a9c6-0663d2e3f271";
    let statusChecks = 0;
    const gatewayRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/payments") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: providerPaymentId,
            product_id: TEST_PRODUCT_ID,
            status: "pending",
            payment_method: "multicaixa_express",
            amount: TEST_AMOUNT,
            currency: TEST_CURRENCY,
            checkout_url: "https://gateway.example/checkout/integrated-test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith(`/payment-status/${providerPaymentId}`)) {
        statusChecks += 1;
        return new Response(
          JSON.stringify({
            payment: {
              id: providerPaymentId,
              product_id: TEST_PRODUCT_ID,
              amount: TEST_AMOUNT,
              currency: TEST_CURRENCY,
              status: statusChecks === 1 ? "pending" : "paid",
              payment_method: "multicaixa_express",
              customer: {
                email: reservation.customerEmail,
                phone: reservation.customerPhone,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", gatewayRequest);

    const startPayment = () =>
      manageTestPayment(
        new Request(
          `http://localhost/api/admin/test-reservations/${reservation.id}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
              "x-forwarded-for": "10.50.0.2",
            },
            body: JSON.stringify({
              action: "START_PAYMENT",
              method: "multicaixa",
              confirmation: true,
              amount: 1,
              productId: randomUUID(),
            }),
          },
        ),
        { params: Promise.resolve({ id: reservation.id }) },
      );
    const paymentResponse = await startPayment();
    const paymentResult = await paymentResponse.json();
    expect(paymentResponse.status).toBe(200);
    expect(paymentResult.amount).toBe(TEST_AMOUNT);
    expect(paymentResult.paymentUrl).toBe(
      "https://gateway.example/checkout/integrated-test",
    );
    const createCall = gatewayRequest.mock.calls.find((call) =>
      String(call[0]).endsWith("/payments"),
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      items: [{ product_id: TEST_PRODUCT_ID, quantity: 1 }],
    });
    const repeatedPayment = await startPayment();
    expect((await repeatedPayment.json()).existing).toBe(true);
    expect(
      gatewayRequest.mock.calls.filter((call) =>
        String(call[0]).endsWith("/payments"),
      ),
    ).toHaveLength(1);

    const webhookPayload = JSON.stringify({ payment_id: providerPaymentId });
    const invalidWebhook = await paymentWebhook(
      new Request("http://localhost/api/webhooks/payments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": "invalid",
          "x-forwarded-for": "10.50.0.3",
        },
        body: webhookPayload,
      }),
    );
    expect(invalidWebhook.status).toBe(401);

    const signature = createHmac(
      "sha256",
      process.env.PAYMENTS_WEBHOOK_SECRET!,
    )
      .update(webhookPayload)
      .digest("hex");
    const signedWebhook = () =>
      paymentWebhook(
        new Request("http://localhost/api/webhooks/payments", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-signature": signature,
            "x-forwarded-for": "10.50.0.3",
          },
          body: webhookPayload,
        }),
      );
    const confirmed = await signedWebhook();
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      received: true,
      test: true,
      status: "SUCCEEDED",
    });
    const duplicate = await signedWebhook();
    expect(await duplicate.json()).toMatchObject({
      received: true,
      duplicate: true,
      test: true,
    });

    const paid = await prisma.testReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { payment: true, ticket: true },
    });
    expect(paid.status).toBe("PAID");
    expect(Number(paid.payment?.amount)).toBe(TEST_AMOUNT);
    expect(paid.payment?.productId).toBe(TEST_PRODUCT_ID);
    expect(paid.payment?.providerPaymentId).toBe(providerPaymentId);
    expect(paid.ticket).not.toBeNull();
    expect(
      await prisma.testPaymentWebhookEvent.count({
        where: { testPaymentId: paid.payment!.id },
      }),
    ).toBe(1);
    expect(
      await prisma.testTicket.count({
        where: { testReservationId: reservation.id },
      }),
    ).toBe(1);

    const reconcile = await manageTestPayment(
      new Request(
        `http://localhost/api/admin/test-reservations/${reservation.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "RECONCILE" }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect(reconcile.status).toBe(200);
    expect(await prisma.testTicket.count({
      where: { testReservationId: reservation.id },
    })).toBe(1);

    const ticketToken = paid.ticket!.publicToken;
    const inspect = await inspectTestTicket(
      new Request(
        `http://localhost/api/admin/test-tickets/${ticketToken}/validate`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ token: ticketToken }) },
    );
    expect(inspect.status).toBe(200);
    expect(await inspect.json()).toMatchObject({
      test: true,
      reference: reservation.reference,
      seat: "TESTE-A1",
      used: [],
    });

    const validate = (leg: "OUTBOUND" | "RETURN") =>
      validateTestTicket(
        new Request(
          `http://localhost/api/admin/test-tickets/${ticketToken}/validate`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ leg }),
          },
        ),
        { params: Promise.resolve({ token: ticketToken }) },
      );
    expect((await validate("OUTBOUND")).status).toBe(200);
    expect((await validate("OUTBOUND")).status).toBe(409);
    expect((await validate("RETURN")).status).toBe(200);
    expect((await validate("RETURN")).status).toBe(409);

    expect({
      reservations: await prisma.reservation.count(),
      seats: await prisma.seatPreference.count(),
      tickets: await prisma.ticket.count(),
      notifications: await prisma.notification.count(),
    }).toEqual(officialBefore);
  }, 20_000);

  it("persists the provider id before checkout and reconciles without a webhook", async () => {
    const createdResponse = await createTestReservation(
      new Request("http://localhost/api/admin/test-reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-forwarded-for": "10.51.0.1",
        },
        body: JSON.stringify({
          passengerName: "Teste Sem Webhook",
          email: "no-webhook@example.test",
          phone: "+244923123457",
          plan: "INDIVIDUAL",
          testSeat: "TESTE-A2",
          pickupPreference: "11_NOVEMBRO",
        }),
      }),
    );
    const created = await createdResponse.json();
    const reservation = await prisma.testReservation.findUniqueOrThrow({
      where: { reference: created.reference },
    });
    const providerPaymentId = "c926e8c1-f1ea-4fe8-a33d-15fd44c3634d";
    let statusChecks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/payments") && init?.method === "POST")
          return new Response(
            JSON.stringify({
              id: providerPaymentId,
              product_id: TEST_PRODUCT_ID,
              amount: TEST_AMOUNT,
              currency: TEST_CURRENCY,
              status: "pending",
              payment_method: "multicaixa_express",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        if (url.endsWith(`/payment-status/${providerPaymentId}`)) {
          statusChecks += 1;
          return new Response(
            JSON.stringify({
              payment: {
                id: providerPaymentId,
                product_id: TEST_PRODUCT_ID,
                amount: TEST_AMOUNT,
                currency: TEST_CURRENCY,
                status: statusChecks === 1 ? "pending" : "completed",
                payment_method: "multicaixa_express",
                customer: {
                  email: reservation.customerEmail,
                  phone: reservation.customerPhone,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "unexpected request" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const started = await manageTestPayment(
      new Request(
        `http://localhost/api/admin/test-reservations/${reservation.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            action: "START_PAYMENT",
            method: "multicaixa",
            confirmation: true,
          }),
        },
      ),
      { params: Promise.resolve({ id: reservation.id }) },
    );
    expect(started.status).toBe(200);
    const beforeCron = await prisma.testReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { payment: true, ticket: true },
    });
    expect(beforeCron.payment?.providerPaymentId).toBe(providerPaymentId);
    expect(beforeCron.payment?.status).toBe("PENDING");
    expect(beforeCron.ticket).toBeNull();
    expect(
      await prisma.testPaymentWebhookEvent.count({
        where: { testPaymentId: beforeCron.payment!.id },
      }),
    ).toBe(0);

    const cron = await reconcilePayments(
      new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      }),
    );
    expect(cron.status).toBe(200);
    expect(await cron.json()).toMatchObject({
      publicPaymentsDisabled: true,
      testReconciled: 1,
      testFailed: 0,
    });
    const afterCron = await prisma.testReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { payment: true, ticket: true },
    });
    expect(afterCron.status).toBe("PAID");
    expect(afterCron.payment?.status).toBe("SUCCEEDED");
    expect(afterCron.ticket).not.toBeNull();
    expect(
      await prisma.testTicket.count({
        where: { testReservationId: reservation.id },
      }),
    ).toBe(1);
    await reconcilePayments(
      new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(
      await prisma.testTicket.count({
        where: { testReservationId: reservation.id },
      }),
    ).toBe(1);
  });

  it("recovers a discarded provider id from one exact sale match", async () => {
    const createdResponse = await createTestReservation(
      new Request("http://localhost/api/admin/test-reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-forwarded-for": "10.52.0.1",
        },
        body: JSON.stringify({
          passengerName: "Teste Recuperação",
          email: "recover-sale@example.test",
          phone: "+244923123458",
          plan: "INDIVIDUAL",
          testSeat: "TESTE-A3",
          pickupPreference: "BENFICA_GIRAFA",
        }),
      }),
    );
    const created = await createdResponse.json();
    const reservation = await prisma.testReservation.findUniqueOrThrow({
      where: { reference: created.reference },
    });
    const localPayment = await prisma.testPayment.create({
      data: {
        testReservationId: reservation.id,
        idempotencyKey: `discarded-${randomUUID()}`,
        productId: TEST_PRODUCT_ID,
        method: "multicaixa",
        status: "UNKNOWN",
        amount: TEST_AMOUNT,
        currency: TEST_CURRENCY,
        rawStatus: "UNKNOWN",
      },
    });
    const providerPaymentId = "d955fddb-df9c-4857-978b-a8136a5eb62b";
    const saleCreatedAt = new Date(
      localPayment.createdAt.getTime() + 4_000,
    ).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/sales?"))
          return new Response(
            JSON.stringify({
              sales: [
                {
                  id: providerPaymentId,
                  product_id: TEST_PRODUCT_ID,
                  amount: TEST_AMOUNT,
                  currency: TEST_CURRENCY,
                  status: "completed",
                  payment_method: "multicaixa_express",
                  customer_email: reservation.customerEmail,
                  customer_phone: reservation.customerPhone,
                  created_at: saleCreatedAt,
                  paid_at: saleCreatedAt,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        if (url.endsWith(`/payment-status/${providerPaymentId}`))
          return new Response(
            JSON.stringify({
              payment: {
                id: providerPaymentId,
                product_id: TEST_PRODUCT_ID,
                amount: TEST_AMOUNT,
                currency: TEST_CURRENCY,
                status: "completed",
                payment_method: "multicaixa_express",
                customer: {
                  email: reservation.customerEmail,
                  phone: reservation.customerPhone,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        return new Response(JSON.stringify({ error: "unexpected request" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const cron = await reconcilePayments(
      new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(cron.status).toBe(200);
    const recovered = await prisma.testReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { payment: true, ticket: true },
    });
    expect(recovered.payment?.providerPaymentId).toBe(providerPaymentId);
    expect(recovered.payment?.status).toBe("SUCCEEDED");
    expect(recovered.status).toBe("PAID");
    expect(recovered.ticket).not.toBeNull();
    expect(
      await prisma.testTicket.count({
        where: { testReservationId: reservation.id },
      }),
    ).toBe(1);
  });
});
