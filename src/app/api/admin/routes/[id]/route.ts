import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { validWhatsappGroupUrl } from "@/lib/config";
import { occupiedReservations } from "@/lib/capacity";

const schema = z.object({
  capacity: z.number().int().min(1).max(1000),
  active: z.boolean(),
  whatsappGroupUrl: z.string().trim().max(180).refine((value) => !value || validWhatsappGroupUrl(value), "Indica um convite válido de chat.whatsapp.com."),
  pickupPoints: z.array(z.object({
    id: z.string().min(8).max(40), name: z.string().trim().min(2).max(100), address: z.string().trim().min(3).max(300),
    departureAt: z.string().datetime().nullable(), operationalConfirmed: z.boolean(),
  }).refine((point) => !point.operationalConfirmed || Boolean(point.departureAt), "Confirma o horário de embarque.")).min(1).max(50),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const { id } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      const route = await tx.route.findUnique({ where: { id }, include: { vehicle: true, pickupPoints: true } });
      if (!route) throw new Error("Rota não encontrada.");
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${route.eventId} FOR UPDATE`;
      const occupied = await tx.reservation.aggregate({ where: { routeId: id, ...occupiedReservations(new Date()) }, _sum: { quantity: true } });
      if (parsed.data.capacity < (occupied._sum.quantity ?? 0) || (route.vehicle && parsed.data.capacity > route.vehicle.capacity))
        throw new Error("A capacidade deve respeitar os lugares ocupados e o veículo atribuído.");
      const ids = new Set(parsed.data.pickupPoints.map((point) => point.id));
      if (ids.size !== parsed.data.pickupPoints.length || parsed.data.pickupPoints.some((point) => !route.pickupPoints.some((existing) => existing.id === point.id)))
        throw new Error("Ponto de embarque inválido.");
      await tx.route.update({ where: { id }, data: { capacity: parsed.data.capacity, active: parsed.data.active, whatsappGroupUrl: parsed.data.whatsappGroupUrl || null } });
      for (const point of parsed.data.pickupPoints) await tx.pickupPoint.update({ where: { id: point.id }, data: { name: point.name, address: point.address, departureAt: point.departureAt ? new Date(point.departureAt) : null, operationalConfirmed: point.operationalConfirmed } });
      await tx.auditLog.create({ data: { userId: user.id, action: "ROUTE_OPERATIONS_UPDATED", entityType: "Route", entityId: id,
        metadata: { capacity: parsed.data.capacity, active: parsed.data.active, whatsappConfigured: Boolean(parsed.data.whatsappGroupUrl), pickupPoints: parsed.data.pickupPoints.map((point) => ({ id: point.id, departureAt: point.departureAt, confirmed: point.operationalConfirmed })) } } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const safeMessages = ["Rota não encontrada.", "A capacidade deve respeitar os lugares ocupados e o veículo atribuído.", "Ponto de embarque inválido."];
    return NextResponse.json({ error: error instanceof Error && safeMessages.includes(error.message) ? error.message : "Não foi possível guardar a operação." }, { status: 409 });
  }
}
