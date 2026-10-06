import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as reserve } from "@/app/api/reservations/route";
import { calculateTicketPricing } from "@/lib/pre-reservations";
import { getPublicEvent } from "@/lib/public-event";

const enabled = Boolean(process.env.FESTGO_ISOLATED_TEST);
const prisma = new PrismaClient();

describe.skipIf(!enabled)("public checkout safeguards on isolated PostgreSQL", () => {
  let pickupId = "";
  let routeId = "";
  beforeAll(async () => {
    process.env.SALES_ENABLED = "true";
    process.env.PAYMENTS_ENABLED = "true";
    process.env.CHECKOUT_REQUIRE_OTP = "false";
    const event = await prisma.event.update({ where: { slug: "brunch-mangais" }, data: { status: "ON_SALE", salesOpenAt: new Date(Date.now() - 60_000), salesCloseAt: null } });
    const route = await prisma.route.findFirstOrThrow({ where: { eventId: event.id } });
    routeId = route.id;
    await prisma.route.update({ where: { id: route.id }, data: { capacity: 1, active: true } });
    const pickup = await prisma.pickupPoint.findFirstOrThrow({ where: { routeId: route.id } });
    pickupId = pickup.id;
    await prisma.pickupPoint.update({ where: { id: pickupId }, data: { departureAt: new Date(Date.now() + 24 * 60 * 60_000), operationalConfirmed: true, address: "Ponto de teste confirmado" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  function body(suffix: string) {
    return {
      eventSlug: "brunch-mangais", name: `Cliente ${suffix}`, phone: `+244923${suffix.padStart(6, "0")}`,
      email: `cliente${suffix}@example.test`, pickupPointId: pickupId, passengers: [`Passageiro ${suffix}`],
      terms: true, marketing: false, idempotencyKey: randomUUID(),
    };
  }
  function request(value: Record<string, unknown>, ip: string) {
    return new Request("http://localhost/api/reservations", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(value) });
  }

  it("rejects browser-controlled money and respects the last route seat concurrently", async () => {
    const first = body("101");
    const second = body("102");
    const manipulated = await reserve(request({ ...first, totalAmount: 1, status: "PAID" }, "10.1.0.10"));
    expect(manipulated.status).toBe(400);
    const responses = await Promise.all([reserve(request(first, "10.1.0.11")), reserve(request(second, "10.1.0.12"))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses[0].status === 201 ? first : second;
    const accepted = await (responses[0].status === 201 ? responses[0] : responses[1]).json();
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "brunch-mangais" } });
    expect(accepted.total).toBe(calculateTicketPricing(1, { individual: Number(event.individualPrice), duo: Number(event.duoPrice), group: Number(event.groupPrice) }).total);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: accepted.reservationId } })).routeId).toBe(routeId);
    const replay = await reserve(request(winner, "10.1.0.13"));
    expect(replay.status).toBe(200);
    expect((await replay.json()).reservationId).toBe(accepted.reservationId);
  });

  it("offers a confirmed zone and creates a paid-flow hold while its departure time is pending", async () => {
    await prisma.route.update({ where: { id: routeId }, data: { capacity: 3 } });
    await prisma.pickupPoint.update({ where: { id: pickupId }, data: { departureAt: null, address: "Preferência; ponto exacto por confirmar" } });
    const event = await getPublicEvent();
    expect(event?.pickups.find((point) => point.id === pickupId)?.departureAt).toBeNull();
    const response = await reserve(request(body("103"), "10.1.0.14"));
    expect(response.status).toBe(201);
    const created = await prisma.reservation.findUniqueOrThrow({ where: { id: (await response.json()).reservationId } });
    expect(created.pickupPointId).toBe(pickupId);
    expect(created.holdExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });
});
