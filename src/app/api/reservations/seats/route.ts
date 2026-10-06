import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { arePaymentsEnabled } from "@/lib/pre-reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!arePaymentsEnabled())
    return NextResponse.json({ error: "As reservas ainda não estão abertas." }, { status: 409 });
  try {
    const event = await prisma.event.findUnique({
      where: { slug: "brunch-mangais" },
      select: { id: true, capacity: true, status: true, eventDate: true },
    });
    if (!event || event.status !== "ON_SALE" || event.eventDate <= new Date())
      return NextResponse.json({ error: "As vendas deste evento não estão abertas." }, { status: 409 });
    const seats = await prisma.seatPreference.findMany({
      // The active-seat index also covers preferences and expired holds until released.
      where: { eventId: event.id, releasedAt: null },
      select: { seatNumber: true, status: true },
    });
    return NextResponse.json({
      capacity: event.capacity,
      seats: seats.map((seat) => ({
        number: seat.seatNumber,
        state: seat.status === "CONFIRMED" ? "confirmed" : "unavailable",
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar os lugares." }, { status: 503 });
  }
}
