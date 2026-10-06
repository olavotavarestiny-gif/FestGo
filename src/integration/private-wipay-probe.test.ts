import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as createProbe } from "@/app/api/admin/private-wipay-probe/route";
import { POST as createIntent } from "@/app/api/payments/intent/route";
import { POST as callback } from "@/app/api/webhooks/wipay/route";
import { POST as paymentStatus } from "@/app/api/payments/status/route";
import TicketsPage from "@/app/reserva/[reference]/bilhetes/page";
import TicketPage from "@/app/bilhete/[token]/page";
import { POST as validateTicket } from "@/app/api/tickets/[token]/validate/route";
import { createSessionToken, hashPassword } from "@/lib/auth-crypto";
import { resetWiPayTokenCacheForTests } from "@/lib/integrations/wipay";
import { PRIVATE_WIPAY_PROBE_SLUG } from "@/lib/private-wipay-probe";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient();
const signingToken = "private-probe-signature-token-at-least-32-characters";
const paymentId = randomUUID();
let postedCheckout: Record<string, string> | null = null;

describe.skipIf(!enabled)("private real-reservation WiPay probe", () => {
  beforeAll(() => {
    process.env.SALES_ENABLED = "false";
    process.env.PAYMENTS_ENABLED = "false";
    process.env.BOOKING_MODE = "PRE_RESERVATION";
    process.env.PRE_RESERVATIONS_ENABLED = "true";
    process.env.PUBLIC_BASE_URL = "https://festgo.example.test";
    process.env.WIPAY_CALLBACK_URL = "https://festgo.example.test/api/webhooks/wipay";
    process.env.WIPAY_ENVIRONMENT = "production";
    process.env.WIPAY_API_URL = "https://api.wipay.ao";
    process.env.WIPAY_CLIENT_ID = "wp_private_probe_test";
    process.env.WIPAY_CLIENT_SECRET = "WPS_private_probe_test";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/credentials/token")) {
        const body = JSON.parse(String(init?.body)) as { scope: string };
        return Response.json({ access_token: body.scope === "signature" ? signingToken : "payment-token-at-least-32-characters-long", scope: body.scope, expires_in: 86_400 });
      }
      if (url.endsWith("/v1/hosts/payments")) {
        postedCheckout = JSON.parse(String(init?.body));
        return new Response(null, { status: 303, headers: { location: `https://hosted.wipay.ao/?id=${paymentId}&nonce=abc123` } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetWiPayTokenCacheForTests();
    await prisma.$disconnect();
  });

  it("keeps public sales closed and confirms one 100 AOA real-model reservation via the public callback", async () => {
    const admin = await prisma.user.create({ data: { email: `private-probe-${randomUUID()}@example.test`, name: "Admin Probe", passwordHash: hashPassword("safe-test-password-123"), role: "ADMIN" } });
    const cookie = `festgo_session=${createSessionToken({ userId: admin.id, role: "ADMIN", sessionVersion: 1, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const body = JSON.stringify({ name: "Comprador Teste", phone: "923000001" });
    const anonymous = await createProbe(new Request("https://festgo.example.test/api/admin/private-wipay-probe", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(anonymous.status).toBe(401);
    const created = await createProbe(new Request("https://festgo.example.test/api/admin/private-wipay-probe", { method: "POST", headers: { cookie, "content-type": "application/json" }, body }));
    expect(created.status).toBe(201);
    const data = await created.json() as { reference: string; url: string };
    const checkout = new URL(data.url, "https://festgo.example.test");
    const reservationId = checkout.pathname.split("/").at(-1)!;
    const accessToken = checkout.searchParams.get("token")!;
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { event: true } });
    expect(reservation.totalAmount.toNumber()).toBe(100);
    expect(reservation.event.slug).toBe(PRIVATE_WIPAY_PROBE_SLUG);
    expect(reservation.event.status).toBe("DRAFT");
    expect(process.env.SALES_ENABLED).toBe("false");
    const duplicate = await createProbe(new Request("https://festgo.example.test/api/admin/private-wipay-probe", { method: "POST", headers: { cookie, "content-type": "application/json" }, body }));
    expect(duplicate.status).toBe(409);
    const intent = await createIntent(new Request("https://festgo.example.test/api/payments/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reservationId, accessToken, method: "multicaixa", provider: "wipay" }) }));
    expect(intent.status).toBe(200);
    expect(postedCheckout).toMatchObject({ amount: "100.00", currency: "aoa", callback_url: "https://festgo.example.test/api/webhooks/wipay" });
    const payment = await prisma.payment.findFirstOrThrow({ where: { reservationId } });
    const payload = { id: paymentId, amount: "100.00", status: "accepted", status_reason: "2000", status_datetime: new Date().toISOString(), currency: "aoa", customer: "923000001", reference_id: payment.providerReference, processor: "gpo" };
    const raw = JSON.stringify(payload);
    const signature = createHmac("sha256", signingToken).update(raw).digest("hex");
    const confirmed = await callback(new Request("https://festgo.example.test/api/webhooks/wipay", { method: "POST", headers: { signature, "content-type": "application/json" }, body: raw }));
    expect(confirmed.status).toBe(200);
    const status = await paymentStatus(new Request("https://festgo.example.test/api/payments/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reservationId, accessToken }) }));
    const statusData = await status.json() as { status: string; reservationStatus: string; total: number; ticketUrl: string };
    expect(statusData).toMatchObject({ status: "SUCCEEDED", reservationStatus: "PAID", total: 100 });
    expect(await prisma.ticket.count({ where: { passenger: { reservationId } } })).toBe(1);
    const ticketLink = new URL(statusData.ticketUrl, "https://festgo.example.test");
    await expect(TicketsPage({ params: Promise.resolve({ reference: data.reference }), searchParams: Promise.resolve({ token: ticketLink.searchParams.get("token")! }) })).resolves.toBeTruthy();
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { passenger: { reservationId } } });
    await expect(TicketPage({ params: Promise.resolve({ token: ticket.publicToken }) })).resolves.toBeTruthy();
    const checkIn = await validateTicket(new Request(`https://festgo.example.test/api/tickets/${ticket.publicToken}/validate`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ leg: "OUTBOUND" }) }), { params: Promise.resolve({ token: ticket.publicToken }) });
    expect(checkIn.status).toBe(409);
    expect(await prisma.notification.count({ where: { reservationId } })).toBe(0);
    expect(await prisma.cRMIntegrationJob.count({ where: { reservationId } })).toBe(0);
  });
});
