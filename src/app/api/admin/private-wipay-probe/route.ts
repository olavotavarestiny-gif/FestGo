import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { normalizeAngolanPhone } from "@/lib/pre-reservations";
import { createReservationToken } from "@/lib/reservation-access";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_WIPAY_PROBE_AMOUNT, PRIVATE_WIPAY_PROBE_SLUG } from "@/lib/private-wipay-probe";
import { publicBaseUrl } from "@/lib/config";
import { wipayCallbackUrl } from "@/lib/integrations/wipay";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(4).max(120),
  phone: z.string().trim().min(9).max(24),
}).strict();

export async function POST(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? normalizeAngolanPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return NextResponse.json({ error: "Indica o nome e um telefone angolano válido." }, { status: 400 });
  try {
    if (process.env.WIPAY_ENVIRONMENT !== "production" || new URL(wipayCallbackUrl(publicBaseUrl())).origin !== new URL(publicBaseUrl()).origin)
      throw new Error("Invalid production WiPay callback");
  } catch {
    return NextResponse.json({ error: "A WiPay de produção e o callback público devem estar configurados." }, { status: 409 });
  }
  try {
    await enforceRateLimit({ namespace: "private-wipay-probe", identifier: user.id, limit: 3, windowMs: 60 * 60_000 });
    const reservation = await prisma.$transaction(async (tx) => {
      let event = await tx.event.findUnique({ where: { slug: PRIVATE_WIPAY_PROBE_SLUG }, include: { routes: { include: { pickupPoints: true } } } });
      if (!event) {
        const eventDate = new Date(Date.now() + 30 * 24 * 60 * 60_000);
        const departureAt = new Date(eventDate.getTime() - 60 * 60_000);
        event = await tx.event.create({ data: {
          slug: PRIVATE_WIPAY_PROBE_SLUG,
          name: "Teste privado de pagamento WiPay — sem viagem",
          venue: "Teste técnico FestGo",
          eventDate,
          basePrice: PRIVATE_WIPAY_PROBE_AMOUNT,
          individualPrice: PRIVATE_WIPAY_PROBE_AMOUNT,
          duoPrice: PRIVATE_WIPAY_PROBE_AMOUNT,
          groupPrice: PRIVATE_WIPAY_PROBE_AMOUNT,
          currency: "AOA",
          capacity: 1,
          status: "DRAFT",
          routes: { create: { name: "Rota técnica — sem transporte", capacity: 1, active: true,
            pickupPoints: { create: { name: "Teste técnico — sem embarque", address: "Sem viagem", departureAt, operationalConfirmed: true, sortOrder: 0 } },
          } },
        }, include: { routes: { include: { pickupPoints: true } } } });
      }
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;
      const count = await tx.reservation.count({ where: { eventId: event.id } });
      if (count > 0) return null;
      const route = event.routes[0];
      const pickup = route?.pickupPoints[0];
      if (!route || !pickup || event.eventDate <= new Date() || !pickup.departureAt || pickup.departureAt <= new Date()) return null;
      const customer = await tx.customer.upsert({ where: { phone }, create: { fullName: parsed.data.name, phone, marketingConsent: false }, update: {} });
      const now = new Date();
      const created = await tx.reservation.create({ data: {
        reference: `FG-TEST-${randomBytes(5).toString("hex").toUpperCase()}`,
        eventId: event.id, routeId: route.id, pickupPointId: pickup.id, customerId: customer.id,
        status: "HELD", quantity: 1, plan: "INDIVIDUAL", unitPrice: PRIVATE_WIPAY_PROBE_AMOUNT,
        totalAmount: PRIVATE_WIPAY_PROBE_AMOUNT, currency: "AOA", operationalConfirmed: true,
        pickupPreference: pickup.name, holdExpiresAt: new Date(now.getTime() + 60 * 60_000),
        idempotencyKey: randomUUID(), termsAcceptedAt: now,
        passengers: { create: { fullName: parsed.data.name } },
      } });
      await tx.auditLog.create({ data: { userId: user.id, action: "PRIVATE_WIPAY_PROBE_CREATED", entityType: "Reservation", entityId: created.id,
        metadata: { amount: PRIVATE_WIPAY_PROBE_AMOUNT, callback: "/api/webhooks/wipay" }, ipAddress: clientIp(request) } });
      return created;
    });
    if (!reservation) return NextResponse.json({ error: "O teste privado já foi criado. Usa o link existente ou consulta o resultado no painel." }, { status: 409 });
    const token = createReservationToken(reservation.id);
    return NextResponse.json({ reference: reservation.reference, amount: PRIVATE_WIPAY_PROBE_AMOUNT,
      url: `/checkout/${encodeURIComponent(reservation.id)}?token=${encodeURIComponent(token)}` }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && error.status === 429)
      return NextResponse.json({ error: "Limite de testes atingido. Aguarda uma hora." }, { status: 429 });
    return NextResponse.json({ error: "Não foi possível criar o teste privado." }, { status: 503 });
  }
}
