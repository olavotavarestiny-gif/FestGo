import { cache } from "react";
import { prisma } from "@/lib/db";
import type { TicketPrices } from "@/lib/pre-reservations";
import { pickupAvailableForSale } from "@/lib/pickup-availability";

export type PublicEvent = {
  slug: string;
  name: string;
  venue: string;
  date: string;
  returnAt: string | null;
  prices: TicketPrices;
  ticketIncludesEntry: boolean;
  capacity: number;
  salesOpen: boolean;
  travelDuration: string | null;
  pickups: Array<{ id: string; name: string; address: string; routeName: string; departureAt: string | null; available: number }>;
};

// Explicit field selection keeps operational contacts and private group links server-side.
export const getPublicEvent = cache(async (slug = "brunch-mangais"): Promise<PublicEvent | null> => {
  if (!process.env.DATABASE_URL) return null;
  try {
    const event = await prisma.event.findUnique({
      where: { slug },
      select: {
        id: true, slug: true, name: true, venue: true, eventDate: true, returnAt: true,
        individualPrice: true, duoPrice: true, groupPrice: true, ticketIncludesEntry: true,
        capacity: true, status: true, salesOpenAt: true, salesCloseAt: true,
        estimatedTravelDuration: true, travelEstimateConfirmed: true,
        routes: { where: { active: true }, select: {
          id: true, name: true, capacity: true,
          pickupPoints: { where: { operationalConfirmed: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, address: true, departureAt: true } },
        } },
      },
    });
    if (!event) return null;
    const now = new Date();
    const [held, activeSeats] = await Promise.all([prisma.reservation.groupBy({
      by: ["routeId"],
      where: { eventId: event.id, OR: [
        { status: { in: ["PAID", "PAYMENT_UNCERTAIN"] } },
        { status: { in: ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"] }, holdExpiresAt: { gt: now } },
      ] },
      _sum: { quantity: true },
    }), prisma.seatPreference.count({ where: { eventId: event.id, releasedAt: null } })]);
    const occupied = held.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
    return {
      slug: event.slug, name: event.name, venue: event.venue, date: event.eventDate.toISOString(),
      returnAt: event.returnAt?.toISOString() ?? null,
      prices: { individual: Number(event.individualPrice), duo: Number(event.duoPrice), group: Number(event.groupPrice) },
      ticketIncludesEntry: event.ticketIncludesEntry,
      capacity: event.capacity,
      salesOpen: event.status === "ON_SALE" && event.eventDate > now && (!event.salesOpenAt || event.salesOpenAt <= now) && (!event.salesCloseAt || event.salesCloseAt > now),
      travelDuration: event.travelEstimateConfirmed ? event.estimatedTravelDuration : null,
      pickups: event.routes.flatMap((route) => route.pickupPoints.filter((point) => pickupAvailableForSale({ ...point, operationalConfirmed: true }, now)).map((point) => ({
        id: point.id, name: point.name, address: point.address, routeName: route.name,
        departureAt: point.departureAt?.toISOString() ?? null,
        available: Math.max(0, Math.min(event.capacity - occupied, event.capacity - activeSeats, route.capacity - (held.find((row) => row.routeId === route.id)?._sum.quantity ?? 0))),
      }))),
    };
  } catch {
    // A failed availability check must never display inventory as available.
    return null;
  }
});
