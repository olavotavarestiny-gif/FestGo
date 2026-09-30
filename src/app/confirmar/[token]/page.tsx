import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createReservationToken } from "@/lib/reservation-access";
import { Logo } from "@/components/logo";
import { PaymentInvitationForm } from "@/components/payment-invitation-form";
import { prisma } from "@/lib/db";
import { parsePaymentInvitationToken } from "@/lib/payment-invitations";
import {
  arePaymentsEnabled,
  pickupPreferences,
  type PickupPreferenceCode,
} from "@/lib/pre-reservations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar pré-reserva — FestGo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function unavailable() {
  return (
    <main className="pre-success">
      <div className="pre-success-card">
        <Logo />
        <h1>Este convite não está disponível.</h1>
        <p>O link pode ter expirado ou sido revogado. Contacta a equipa FestGo para receber um novo convite.</p>
        <Link className="home-cta" href="/">Voltar ao início</Link>
      </div>
    </main>
  );
}

export default async function PaymentInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const parsed = parsePaymentInvitationToken(token);
  if (!parsed) return unavailable();
  const invitation = await prisma.paymentInvitation.findUnique({
    where: { id: parsed.id },
    include: {
      reservation: {
        include: {
          event: true,
          passengers: { orderBy: { id: "asc" } },
          seatPreferences: {
            where: { releasedAt: null },
            orderBy: { seatNumber: "asc" },
          },
        },
      },
    },
  });
  if (
    !invitation ||
    invitation.nonce !== parsed.nonce ||
    Math.floor(invitation.expiresAt.getTime() / 1000) !==
      Math.floor(parsed.expiresAt.getTime() / 1000) ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date() ||
    !["PAYMENT_PENDING", "HELD", "AWAITING_PAYMENT"].includes(invitation.reservation.status)
  )
    return unavailable();

  const reservation = invitation.reservation;
  if (reservation.routeId && reservation.pickupPointId) {
    if (!reservation.holdExpiresAt || reservation.holdExpiresAt <= new Date()) return unavailable();
    redirect(`/checkout/${encodeURIComponent(reservation.id)}?token=${encodeURIComponent(createReservationToken(reservation.id))}`);
  }
  const occupied = await prisma.seatPreference.findMany({
    where: {
      eventId: reservation.eventId,
      reservationId: { not: reservation.id },
      status: "CONFIRMED",
      releasedAt: null,
    },
    select: { seatNumber: true },
  });
  const pickup = pickupPreferences.find(
    (option) => option.label === reservation.pickupPreference,
  );
  const paymentProvider =
    process.env.PAYMENTS_PROVIDER === "wipay"
      ? "wipay"
      : process.env.PAYMENTS_PROVIDER === "ekwanza"
        ? "ekwanza"
        : "paygo";
  const paymentProviders = new Set(
    (process.env.PAYMENTS_AVAILABLE_PROVIDERS ?? paymentProvider)
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider): provider is "wipay" | "paygo" | "ekwanza" =>
        ["wipay", "paygo", "ekwanza"].includes(provider),
      ),
  );
  paymentProviders.add(paymentProvider);

  return (
    <>
      <header className="pre-header">
        <div className="pre-shell"><Link href="/"><Logo /></Link></div>
      </header>
      <PaymentInvitationForm
        token={token}
        eventName={reservation.event.name}
        reference={reservation.reference}
        initialQuantity={reservation.quantity}
        initialPassengers={reservation.passengers.map((passenger) => ({
          fullName: passenger.fullName,
          birthDate: passenger.birthDate?.toISOString().slice(0, 10) ?? "",
        }))}
        initialSeats={reservation.seatPreferences.map((seat) => seat.seatNumber)}
        initialPickup={(pickup?.code ?? "OUTRO") as PickupPreferenceCode}
        initialPickupOther={reservation.pickupOther ?? ""}
        initialGuardianName={reservation.minorGuardianName ?? ""}
        initialGuardianPhone={reservation.minorGuardianPhone ?? ""}
        capacity={reservation.event.capacity}
        unavailableSeats={occupied.map((seat) => seat.seatNumber)}
        prices={{
          individual: Number(reservation.event.individualPrice),
          duo: Number(reservation.event.duoPrice),
          group: Number(reservation.event.groupPrice),
        }}
        eventDate={reservation.event.eventDate.toISOString().slice(0, 10)}
        minorAgeLimit={reservation.event.minorAgeLimit}
        paymentsEnabled={arePaymentsEnabled()}
        paymentProvider={paymentProvider}
        paymentProviders={[...paymentProviders]}
      />
    </>
  );
}
