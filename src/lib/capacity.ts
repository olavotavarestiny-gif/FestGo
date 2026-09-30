import { Prisma } from "@prisma/client";

/** Uncertain charges remain occupied until reconciliation; ordinary holds expire. */
export function occupiedReservations(now: Date): Prisma.ReservationWhereInput {
  return { OR: [
    { status: { in: ["PAID", "PAYMENT_UNCERTAIN"] } },
    { status: { in: ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"] }, holdExpiresAt: { gt: now } },
  ] };
}

export async function availableCapacity(tx: Prisma.TransactionClient, event: { id: string; capacity: number }, route: { id: string; capacity: number; vehicle?: { capacity: number } | null }, now: Date) {
  const [eventOccupied, routeOccupied] = await Promise.all([
    tx.reservation.aggregate({ where: { eventId: event.id, ...occupiedReservations(now) }, _sum: { quantity: true } }),
    tx.reservation.aggregate({ where: { routeId: route.id, ...occupiedReservations(now) }, _sum: { quantity: true } }),
  ]);
  return Math.max(0, Math.min(
    event.capacity - (eventOccupied._sum.quantity ?? 0),
    Math.min(route.capacity, route.vehicle?.capacity ?? route.capacity) - (routeOccupied._sum.quantity ?? 0),
  ));
}
