import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as registerRefund } from "@/app/api/admin/reservations/[id]/refund/route";
import { POST as validateTicket } from "@/app/api/tickets/[token]/validate/route";
import { createSessionToken } from "@/lib/auth-crypto";
import { hashPassword } from "@/lib/auth-crypto";
import { queueNotifications } from "@/lib/notification-jobs";
import { processCRMJobs } from "@/lib/integrations/crm-jobs";

const enabled = Boolean(process.env.FESTGO_ISOLATED_TEST);
const prisma = new PrismaClient();

describe.skipIf(!enabled)("manual refund recording", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("enforces the 50% customer rule, revokes every ticket and is idempotent", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "brunch-mangais" } });
    const user = await prisma.user.create({ data: { email: `refund-${randomUUID()}@example.test`, name: "Admin Refund", role: "ADMIN", passwordHash: hashPassword("test-password-refund") } });
    const cookie = `festgo_session=${createSessionToken({ userId: user.id, role: user.role, sessionVersion: user.sessionVersion, exp: Math.floor(Date.now() / 1000) + 60 })}`;
    const customer = await prisma.customer.create({ data: { fullName: "Cliente Reembolso", phone: "+244923555555" } });
    const reservation = await prisma.reservation.create({ data: {
      eventId: event.id, customerId: customer.id, reference: `FG-${event.eventDate.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "PAID", quantity: 2, unitPrice: 25000, totalAmount: 47500, idempotencyKey: randomUUID(), paidAt: new Date(),
      passengers: { create: [{ fullName: "Passageiro Um", ticket: { create: {} } }, { fullName: "Passageiro Dois", ticket: { create: {} } }] },
      payments: { create: { provider: "wipay", providerPaymentId: randomUUID(), providerReference: randomUUID(), idempotencyKey: randomUUID(), method: "hosted", status: "SUCCEEDED", amount: 47500, currency: "AOA" } },
    }, include: { passengers: { include: { ticket: true } } } });
    const route = await prisma.route.findFirstOrThrow({ where: { eventId: event.id }, include: { pickupPoints: true } });
    await prisma.pickupPoint.update({ where: { id: route.pickupPoints[0].id }, data: { operationalConfirmed: true, address: "Entrada principal", departureAt: new Date(event.eventDate.getTime() - 2 * 60 * 60_000) } });
    await prisma.reservation.update({ where: { id: reservation.id }, data: { routeId: route.id, pickupPointId: route.pickupPoints[0].id } });
    await queueNotifications(new Date(event.eventDate.getTime() - 6 * 24 * 60 * 60_000));
    expect(await prisma.notification.count({ where: { reservationId: reservation.id, template: "PICKUP_DETAILS" } })).toBe(1);
    process.env.KUKUGEST_API_URL = "https://example.test/api/integrations/v1";
    process.env.KUKUGEST_API_KEY = "isolated-test-key";
    const crmFetch = vi.fn().mockResolvedValue(Response.json({ success: true, saleId: "isolated-sale" }));
    vi.stubGlobal("fetch", crmFetch);
    await prisma.cRMIntegrationJob.create({ data: { reservationId: reservation.id, kind: "SALE" } });
    expect((await processCRMJobs({ reservationId: reservation.id })).succeeded).toBe(1);
    expect(crmFetch).toHaveBeenCalledTimes(1);
    expect((await prisma.cRMIntegrationJob.findFirstOrThrow({ where: { reservationId: reservation.id } })).status).toBe("SUCCEEDED");
    vi.unstubAllGlobals();
    const url = `http://localhost:3000/api/admin/reservations/${reservation.id}/refund`;
    const context = { params: Promise.resolve({ id: reservation.id }) };
    const request = (amount: number, proof: string, withCookie = true) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(withCookie ? { cookie } : {}) }, body: JSON.stringify({ reason: "CUSTOMER", requestedAt: new Date().toISOString(), refundedAmount: amount, providerRefundReference: proof }) });
    expect((await registerRefund(request(23750, "refund-auth", false), context)).status).toBe(401);
    expect((await registerRefund(request(47500, "refund-wrong"), context)).status).toBe(409);
    expect((await registerRefund(request(23750, "refund-ok-001"), context)).status).toBe(200);
    expect((await registerRefund(request(23750, "refund-ok-001"), context)).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("REFUNDED");
    expect(await prisma.ticket.count({ where: { passenger: { reservationId: reservation.id }, status: "REVOKED" } })).toBe(2);
    expect((await validateTicket(new Request(`http://localhost:3000/api/tickets/${reservation.passengers[0].ticket!.publicToken}/validate`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ leg: "OUTBOUND" }) }), { params: Promise.resolve({ token: reservation.passengers[0].ticket!.publicToken }) })).status).toBe(409);

    const operatorCase = await prisma.reservation.create({ data: {
      eventId: event.id, customerId: customer.id, reference: `FG-${event.eventDate.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "PAID", quantity: 1, unitPrice: 25000, totalAmount: 25000, idempotencyKey: randomUUID(), paidAt: new Date(),
      passengers: { create: { fullName: "Passageiro Operador", ticket: { create: {} } } },
      payments: { create: { provider: "wipay", providerPaymentId: randomUUID(), providerReference: randomUUID(), idempotencyKey: randomUUID(), method: "hosted", status: "SUCCEEDED", amount: 25000, currency: "AOA" } },
    } });
    const operatorUrl = `http://localhost:3000/api/admin/reservations/${operatorCase.id}/refund`;
    const operatorContext = { params: Promise.resolve({ id: operatorCase.id }) };
    const lateRequest = new Date(event.eventDate.getTime() - 6 * 24 * 60 * 60_000).toISOString();
    expect((await registerRefund(new Request(operatorUrl, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ reason: "CUSTOMER", requestedAt: lateRequest, refundedAmount: 12500, providerRefundReference: "refund-late" }) }), operatorContext)).status).toBe(409);
    expect((await registerRefund(new Request(operatorUrl, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ reason: "OPERATOR", refundedAmount: 25000, providerRefundReference: "refund-operator" }) }), operatorContext)).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: operatorCase.id } })).status).toBe("REFUNDED");
  });
});
