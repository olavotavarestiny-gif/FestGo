import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma as appDb } from "@/lib/db";
import { POST as requestOtp } from "@/app/api/otp/request/route";
import { POST as verifyOtp } from "@/app/api/otp/verify/route";
import { POST as reserve } from "@/app/api/reservations/route";
import { POST as callback } from "@/app/api/webhooks/wipay/route";
import { GET as notificationCron } from "@/app/api/jobs/notifications/route";
import CheckoutPage from "@/app/checkout/[reservationId]/page";
import { queueNotifications, processNotificationJobs, dispatchNotification, RECOVERY_TEMPLATES } from "@/lib/notification-jobs";
import { checkoutRecoveryLink } from "@/lib/payment-invitations";
import { verifyTicketBundleToken } from "@/lib/ticket-access";
import { ensureWiPaySignatureToken, resetWiPayTokenCacheForTests } from "@/lib/integrations/wipay";
import { checkoutRecoverySchedule, otpExpirationMinutes } from "@/lib/config";

const enabled = process.env.FESTGO_ISOLATED_TEST === "true";
const db = new PrismaClient();
const signingKey = "isolated-wipay-signature-thirty-two-characters";
const provider = vi.fn<typeof fetch>();
let phoneSequence = 0;
const newPhone = () => `+244923${String(++phoneSequence).padStart(6, "0")}`;
function post(path: string, body: object) {
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `sms-test-${randomUUID()}` }, body: JSON.stringify(body) });
}
function sentBody(index = 0) {
  return JSON.parse(String(provider.mock.calls[index][1]?.body)) as { content: string; target_e164: string };
}

describe.skipIf(!enabled)("SMS lifecycle on isolated PostgreSQL with simulated providers", () => {
  let eventId: string;
  let routeId: string;
  let pickupId: string;
  beforeAll(async () => {
    Object.assign(process.env, { SALES_ENABLED: "true", PAYMENTS_ENABLED: "true", CHECKOUT_REQUIRE_OTP: "true", OTP_EXPIRATION_MINUTES: "5", MAX_OTP_ATTEMPTS: "5",
      ABANDONED_CHECKOUT_FOLLOWUP_MINUTES: "10", ABANDONED_CHECKOUT_SECOND_FOLLOWUP_MINUTES: "20", ZIETT_API_KEY: "isolated-sms-key", ZIETT_SMS_REMITTER_ID: randomUUID(),
      WIPAY_CLIENT_ID: "wp_isolated_client", WIPAY_CLIENT_SECRET: "WPS_isolated_secret", WIPAY_ENVIRONMENT: "sandbox" });
    // Existing post-payment scheduling uses Next request scope; invoke the durable worker explicitly in this suite.
    delete process.env.CRON_SECRET;
    const event = await db.event.update({ where: { slug: "brunch-mangais" }, data: { status: "ON_SALE", eventDate: new Date(Date.now() + 30 * 86400_000), returnAt: null, salesCloseAt: null, salesOpenAt: null, capacity: 500 } });
    eventId = event.id;
    const route = await db.route.findFirstOrThrow({ where: { eventId } });
    routeId = route.id;
    await db.route.update({ where: { id: routeId }, data: { active: true, capacity: 500 } });
    const pickup = await db.pickupPoint.findFirstOrThrow({ where: { routeId } });
    pickupId = pickup.id;
    await db.pickupPoint.update({ where: { id: pickupId }, data: { operationalConfirmed: true, departureAt: new Date(Date.now() + 29 * 86400_000), address: "Entrada principal" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: signingKey, scope: "signature", expires_in: 86400 })));
    await ensureWiPaySignatureToken();
  });
  beforeEach(() => {
    provider.mockReset().mockImplementation(async () => Response.json({ message_id: randomUUID(), status: "QUEUED" }, { status: 202 }));
    vi.stubGlobal("fetch", provider);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Each case leaves unrelated work terminal, so global cron assertions are deterministic.
    await db.notification.updateMany({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING", "DRAFT"] } }, data: { status: "CANCELLED" } });
    await db.reservation.updateMany({ where: { status: { in: ["HELD", "AWAITING_PAYMENT"] } }, data: { status: "CANCELLED" } });
  });
  afterAll(async () => { vi.unstubAllGlobals(); resetWiPayTokenCacheForTests(); await db.$disconnect(); await appDb.$disconnect(); });

  async function challenge(phone = newPhone()) {
    const response = await requestOtp(post("/api/otp/request", { phone }));
    expect(response.status).toBe(200);
    const data = await response.json() as { challengeId: string };
    const code = sentBody(provider.mock.calls.length - 1).content.match(/\b\d{6}\b/)![0];
    return { phone, challengeId: data.challengeId, code };
  }
  async function booking(minutesAgo = 11) {
    const otp = await challenge();
    expect((await verifyOtp(post("/api/otp/verify", otp))).status).toBe(200);
    const response = await reserve(post("/api/reservations", { name: "Ana Teste", phone: otp.phone, pickupPointId: pickupId, passengers: ["Ana Teste"], terms: true, verificationId: otp.challengeId, idempotencyKey: randomUUID() }));
    expect(response.status).toBe(201);
    const data = await response.json() as { reservationId: string };
    const reservation = await db.reservation.update({ where: { id: data.reservationId }, data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
    expect(reservation.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(reservation.verifiedPhone).toBe(otp.phone);
    provider.mockClear();
    return reservation;
  }
  async function notification(reservationId: string, template: string) {
    return db.notification.findUniqueOrThrow({ where: { reservationId_channel_template: { reservationId, channel: "SMS", template } } });
  }
  async function pay(reservationId: string) {
    const payment = await db.payment.create({ data: { reservationId, provider: "wipay", providerPaymentId: randomUUID(), providerReference: `festgo_${randomUUID()}`,
      idempotencyKey: randomUUID(), method: "hosted", amount: 25000, currency: "AOA", status: "PENDING" } });
    const body = JSON.stringify({ id: payment.providerPaymentId, reference_id: payment.providerReference, amount: "25000.00", currency: "aoa", customer: "923000000", status: "accepted", status_reason: "2000", status_datetime: new Date().toISOString(), processor: "gpo" });
    const request = () => new Request("http://localhost:3000/api/webhooks/wipay", { method: "POST", headers: { "content-type": "application/json", signature: createHmac("sha256", signingKey).update(body).digest("hex") }, body });
    expect((await callback(request())).status).toBe(200);
    return request;
  }

  it("sends six-digit OTP for exactly five minutes and records acceptance without logging the code", async () => {
    const otp = await challenge();
    const saved = await db.sMSVerification.findUniqueOrThrow({ where: { id: otp.challengeId } });
    expect(saved).toMatchObject({ sendStatus: "SENT", providerStatus: "QUEUED", providerMessageId: expect.any(String), sentAt: expect.any(Date) });
    expect(saved.expiresAt.getTime() - saved.lastSentAt.getTime()).toBe(300_000);
    expect(saved.codeHash).not.toContain(otp.code);
    expect(sentBody().content).toBe(`FestGo: O teu código de confirmação é ${otp.code}. Válido por 5 minutos. Não partilhes este código.`);
    expect((await verifyOtp(post("/api/otp/verify", otp))).status).toBe(200);
    expect((await verifyOtp(post("/api/otp/verify", otp))).status).toBe(400);
  });

  it("serializes simultaneous OTP requests and resends, enforces cooldown, and invalidates the old challenge", async () => {
    const phone = newPhone();
    const responses = await Promise.all([requestOtp(post("/api/otp/request", { phone })), requestOtp(post("/api/otp/request", { phone }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(provider).toHaveBeenCalledTimes(1);
    const old = await db.sMSVerification.findFirstOrThrow({ where: { phone } });
    expect((await requestOtp(post("/api/otp/request", { phone }))).status).toBe(429);
    await db.sMSVerification.update({ where: { id: old.id }, data: { lastSentAt: new Date(Date.now() - 31_000) } });
    const replacement = await challenge(phone);
    expect(replacement.challengeId).not.toBe(old.id);
    expect((await db.sMSVerification.findUniqueOrThrow({ where: { id: old.id } })).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(provider).toHaveBeenCalledTimes(2);
    expect((await verifyOtp(post("/api/otp/verify", replacement))).status).toBe(200);
  });

  it("rejects invalid/expired OTP and caps concurrent verification attempts", async () => {
    const otp = await challenge();
    const wrong = { ...otp, code: otp.code === "000000" ? "000001" : "000000" };
    const responses = await Promise.all(Array.from({ length: 8 }, () => verifyOtp(post("/api/otp/verify", wrong))));
    expect(responses.every((r) => [400, 429].includes(r.status))).toBe(true);
    expect((await db.sMSVerification.findUniqueOrThrow({ where: { id: otp.challengeId } })).attempts).toBe(5);
    expect((await verifyOtp(post("/api/otp/verify", otp))).status).toBe(429);
    await db.sMSVerification.update({ where: { id: otp.challengeId }, data: { expiresAt: new Date(0) } });
    expect((await verifyOtp(post("/api/otp/verify", otp))).status).toBe(400);
  });

  it("does not send immediately, sends each of two follow-ups once, and blocks a third", async () => {
    const r = await booking(1);
    await queueNotifications();
    expect(await db.notification.count({ where: { reservationId: r.id } })).toBe(0);
    await db.reservation.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await Promise.all([queueNotifications(), queueNotifications()]);
    const first = await notification(r.id, "ABANDONED_CHECKOUT");
    const runs = await Promise.all([processNotificationJobs(), processNotificationJobs()]);
    expect(runs.reduce((total, run) => total + run.sent, 0)).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(sentBody().content).toContain("Olá, Ana. A tua reserva FestGo ficou por concluir.");
    expect(sentBody().content).toContain(checkoutRecoveryLink(r.id));
    expect((await notification(r.id, first.template)).status).toBe("SENT");
    await db.reservation.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 21 * 60_000) } });
    await queueNotifications();
    expect(await db.notification.count({ where: { reservationId: r.id, template: "ABANDONED_CHECKOUT_2" } })).toBe(0); // keeps a gap after first actual send
    await db.notification.update({ where: { id: first.id }, data: { sentAt: new Date(Date.now() - 11 * 60_000) } });
    await Promise.all([queueNotifications(), queueNotifications()]);
    await Promise.all([processNotificationJobs(), processNotificationJobs()]);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(sentBody(1).content).toContain("Se já não quiseres reservar, ignora esta mensagem.");
    await queueNotifications(); await processNotificationJobs();
    expect(provider).toHaveBeenCalledTimes(2);
    // The legacy manual link cannot bypass the same two-message budget.
    const invitation = await db.paymentInvitation.create({ data: { reservationId: r.id, expiresAt: new Date(Date.now() + 60_000) } });
    const third = await db.notification.create({ data: { reservationId: r.id, channel: "SMS", recipient: r.verifiedPhone!, template: "PAYMENT_LINK", status: "DRAFT" } });
    expect(await dispatchNotification(third.id, { content: "FestGo: pagamento", invitationNonce: invitation.nonce, requestedById: "unused" })).toBe(false);
    expect((await notification(r.id, "PAYMENT_LINK")).status).toBe("CANCELLED");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("counts historical provider retries conservatively so old reservations cannot exceed two attempts", async () => {
    const r = await booking(21);
    const first = await db.notification.create({ data: { reservationId: r.id, channel: "SMS", recipient: r.verifiedPhone!,
      template: "ABANDONED_CHECKOUT", status: "SENT", attempts: 2, dispatchStartedAt: new Date(Date.now() - 15 * 60_000), sentAt: new Date(Date.now() - 11 * 60_000) } });
    await queueNotifications();
    expect(await db.notification.count({ where: { reservationId: r.id, template: "ABANDONED_CHECKOUT_2" } })).toBe(0);
    const second = await db.notification.create({ data: { reservationId: r.id, channel: "SMS", recipient: r.verifiedPhone!, template: "ABANDONED_CHECKOUT_2" } });
    expect(await dispatchNotification(second.id)).toBe(false);
    expect((await notification(r.id, second.template)).status).toBe("CANCELLED");
    expect((await notification(r.id, first.template)).attempts).toBe(2);
    expect(provider).not.toHaveBeenCalled();
  });

  it("resumes the existing reservation through the signed link without creating another", async () => {
    const r = await booking();
    const link = new URL(checkoutRecoveryLink(r.id));
    expect(link.toString()).not.toContain(r.verifiedPhone!);
    const count = await db.reservation.count();
    const page = await CheckoutPage({ params: Promise.resolve({ reservationId: r.id }), searchParams: Promise.resolve({ token: link.searchParams.get("token")! }) });
    expect(page.props.access.reservationId).toBe(r.id);
    expect(page.props.quantity).toBe(1);
    expect(await db.reservation.count()).toBe(count);
    await expect(CheckoutPage({ params: Promise.resolve({ reservationId: r.id }), searchParams: Promise.resolve({ token: "invalid" }) })).rejects.toThrow();
  });

  it("suppresses recovery when payment arrives before SMS 1, activates tickets, and sends confirmation only once despite repeated webhooks/jobs", async () => {
    const r = await booking();
    await queueNotifications();
    const webhook = await pay(r.id);
    expect((await notification(r.id, "ABANDONED_CHECKOUT")).status).toBe("CANCELLED");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PAID");
    expect(await db.ticket.count({ where: { passenger: { reservationId: r.id }, status: "VALID" } })).toBe(1);
    expect((await callback(webhook())).status).toBe(200);
    await Promise.all([processNotificationJobs(), processNotificationJobs()]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(sentBody().content).toContain("Pagamento confirmado 🎉");
    const link = new URL(sentBody().content.match(/https?:\/\/\S+/)![0]);
    expect(verifyTicketBundleToken(r.reference, link.searchParams.get("token")!)).toBe(true);
    expect((await notification(r.id, "BOOKING_PAID")).sentAt).toBeInstanceOf(Date);
    await queueNotifications(); await processNotificationJobs();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await db.notification.count({ where: { reservationId: r.id, template: "BOOKING_PAID" } })).toBe(1);
  });

  it("cancels SMS 2 if paid after SMS 1, including when SMS 2 was already queued", async () => {
    const r = await booking(21);
    await queueNotifications(); await processNotificationJobs();
    const first = await notification(r.id, "ABANDONED_CHECKOUT");
    await db.notification.update({ where: { id: first.id }, data: { sentAt: new Date(Date.now() - 11 * 60_000) } });
    await queueNotifications();
    const second = await notification(r.id, "ABANDONED_CHECKOUT_2");
    await pay(r.id);
    expect((await db.notification.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("CANCELLED");
    await processNotificationJobs();
    expect(provider).toHaveBeenCalledTimes(2); // recovery 1 + confirmation
    expect(sentBody(1).content).toContain("Pagamento confirmado");
  });

  it.each(["CANCELLED", "EXPIRED", "REFUNDED", "PAYMENT_UNCERTAIN"] as const)("never sends recovery in reservation state %s", async (status) => {
    const r = await booking();
    await queueNotifications();
    await db.reservation.update({ where: { id: r.id }, data: { status } });
    await processNotificationJobs();
    expect(provider).not.toHaveBeenCalled();
    expect((await notification(r.id, "ABANDONED_CHECKOUT")).status).toBe("CANCELLED");
  });

  it("rechecks verified telephone, hold expiry and disabled payments before sending", async () => {
    const r = await booking();
    await db.reservation.update({ where: { id: r.id }, data: { phoneVerifiedAt: null } });
    await queueNotifications();
    expect(await db.notification.count({ where: { reservationId: r.id } })).toBe(0);
    await db.reservation.update({ where: { id: r.id }, data: { phoneVerifiedAt: new Date() } });
    await queueNotifications();
    await db.reservation.update({ where: { id: r.id }, data: { holdExpiresAt: new Date(0) } });
    await processNotificationJobs();
    expect(provider).not.toHaveBeenCalled();
    const other = await booking();
    await queueNotifications();
    process.env.PAYMENTS_ENABLED = "false";
    await processNotificationJobs();
    process.env.PAYMENTS_ENABLED = "true";
    expect((await notification(other.id, "ABANDONED_CHECKOUT")).status).toBe("CANCELLED");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["rejection", "timeout", "accepted-without-id"])("audits provider %s without retrying or sending a second recovery", async (failure) => {
    const r = await booking(21);
    await queueNotifications();
    if (failure === "timeout") provider.mockRejectedValue(new Error("timeout"));
    else provider.mockImplementation(async () => Response.json({}, { status: failure === "rejection" ? 402 : 202 }));
    await processNotificationJobs();
    const first = await notification(r.id, "ABANDONED_CHECKOUT");
    expect(first.status).toBe(failure === "rejection" ? "FAILED" : "UNKNOWN");
    expect(first.lastError).toBeTruthy(); expect(first.dispatchStartedAt).toBeInstanceOf(Date);
    await queueNotifications(); await processNotificationJobs();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await db.notification.count({ where: { reservationId: r.id, template: "ABANDONED_CHECKOUT_2" } })).toBe(0);
  });

  it("keeps the durable claim when the database rolls back after the provider accepted the SMS", async () => {
    const r = await booking();
    await queueNotifications();
    // A failing audit write forces PostgreSQL to abort the send transaction after acceptance.
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_sms_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = 'NOTIFICATION_SENT' THEN RAISE EXCEPTION 'simulated local failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_sms_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_sms_audit()`);
    try { await processNotificationJobs(); } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_sms_audit ON "AuditLog"');
      await db.$executeRawUnsafe('DROP FUNCTION fail_sms_audit()');
    }
    const saved = await notification(r.id, "ABANDONED_CHECKOUT");
    expect(saved.status).toBe("UNKNOWN"); expect(saved.attempts).toBe(1);
    await processNotificationJobs(); expect(provider).toHaveBeenCalledTimes(1);
  });

  it("records OTP provider failure, expires the challenge and throttles an immediate server retry", async () => {
    const phone = newPhone();
    provider.mockImplementation(async () => Response.json({}, { status: 503 }));
    expect((await requestOtp(post("/api/otp/request", { phone }))).status).toBe(502);
    const saved = await db.sMSVerification.findFirstOrThrow({ where: { phone } });
    expect(saved.sendStatus).toBe("UNKNOWN"); expect(saved.lastError).toBeTruthy();
    expect(saved.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await requestOtp(post("/api/otp/request", { phone }))).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("requires cron authorization and rejects invalid schedule/OTP configuration", async () => {
    process.env.CRON_SECRET = "isolated-cron-secret";
    expect((await notificationCron(new Request("http://localhost/api/jobs/notifications"))).status).toBe(401);
    expect((await notificationCron(new Request("http://localhost/api/jobs/notifications", { headers: { authorization: "Bearer isolated-cron-secret" } }))).status).toBe(200);
    delete process.env.CRON_SECRET;
    process.env.ABANDONED_CHECKOUT_SECOND_FOLLOWUP_MINUTES = "10";
    expect(() => checkoutRecoverySchedule()).toThrow();
    process.env.ABANDONED_CHECKOUT_SECOND_FOLLOWUP_MINUTES = "20";
    process.env.OTP_EXPIRATION_MINUTES = "10"; expect(() => otpExpirationMinutes()).toThrow();
    process.env.OTP_EXPIRATION_MINUTES = "5";
    expect(RECOVERY_TEMPLATES).toHaveLength(3); // two automated slots plus the existing manual payment-link slot
  });
});
