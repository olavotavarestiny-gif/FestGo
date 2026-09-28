import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { PaymentInvitationForm } from "@/components/payment-invitation-form";
import { prisma } from "@/lib/db";
import { parsePaymentInvitationToken } from "@/lib/payment-invitations";
import {
  arePaymentsEnabled,
  pickupPreferences,
  type CommercialPlanCode,
  type PickupPreferenceCode,
} from "@/lib/pre-reservations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar pré-reserva — FestGo",
  robots: { index: false, follow: false },
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
    invitation.reservation.status !== "PAYMENT_PENDING" ||
    !invitation.reservation.plan
  )
    return unavailable();

  const reservation = invitation.reservation;
  const occupied = await prisma.seatPreference.findMany({
    where: {
      eventId: reservation.eventId,
      reservationId: { not: reservation.id },
      releasedAt: null,
    },
    select: { seatNumber: true },
  });
  const pickup = pickupPreferences.find(
    (option) => option.label === reservation.pickupPreference,
  );

  return (
    <>
      <header className="pre-header">
        <div className="pre-shell"><Link href="/"><Logo /></Link></div>
      </header>
      <PaymentInvitationForm
        token={token}
        eventName={reservation.event.name}
        reference={reservation.reference}
        initialPlan={reservation.plan as CommercialPlanCode}
        initialPassengers={reservation.passengers.map((passenger) => passenger.fullName)}
        initialSeats={reservation.seatPreferences.map((seat) => seat.seatNumber)}
        initialPickup={(pickup?.code ?? "OUTRO") as PickupPreferenceCode}
        initialPickupOther={reservation.pickupOther ?? ""}
        capacity={reservation.event.capacity}
        unavailableSeats={occupied.map((seat) => seat.seatNumber)}
        paymentsEnabled={arePaymentsEnabled()}
      />
    </>
  );
}
