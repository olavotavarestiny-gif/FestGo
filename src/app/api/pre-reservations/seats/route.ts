import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPreReservationMode } from "@/lib/pre-reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isPreReservationMode())
    return NextResponse.json(
      { error: "As pré-reservas ainda não estão abertas." },
      { status: 409 },
    );
  try {
    const event = await prisma.event.findUnique({
      where: { slug: "brunch-mangais" },
      select: {
        id: true,
        capacity: true,
        estimatedTravelDuration: true,
        travelEstimateConfirmed: true,
      },
    });
    if (!event)
      return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
    const preferences = await prisma.seatPreference.findMany({
      where: { eventId: event.id, releasedAt: null },
      select: { seatNumber: true, status: true },
    });
    return NextResponse.json(
      {
        capacity: event.capacity,
        seats: preferences.map((seat) => ({
          number: seat.seatNumber,
          state: seat.status === "CONFIRMED" ? "confirmed" : "unavailable",
        })),
        travelDuration:
          event.travelEstimateConfirmed && event.estimatedTravelDuration
            ? event.estimatedTravelDuration
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível consultar os lugares." },
      { status: 503 },
    );
  }
}
