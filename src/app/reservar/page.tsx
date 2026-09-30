import type { Metadata } from "next";
import Link from "next/link";
import { BookingFlow, PreReservationFlow } from "@/components/booking-flow";
import { Logo } from "@/components/logo";
import { isOtpRequired } from "@/lib/config";
import { arePaymentsEnabled, isPreReservationMode } from "@/lib/pre-reservations";
import { getPublicEvent } from "@/lib/public-event";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservar a tua viagem — FestGo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function BookingPage() {
  if (isPreReservationMode()) return <PreReservationFlow />;
  const event = await getPublicEvent();
  if (!arePaymentsEnabled() || !event?.salesOpen || !event.pickups.some((point) => point.available > 0)) {
    return <main className="pre-success"><div className="pre-success-card"><Link href="/" aria-label="FestGo — início"><Logo /></Link><p className="eyebrow mt-8">FestGo · Brunch Mangais</p><h1>{event?.salesOpen && event.pickups.length > 0 && event.pickups.every((point) => point.available === 0) ? "Lugares indisponíveis de momento." : "As reservas estão a ser preparadas."}</h1><p>As vendas ficam disponíveis quando os pontos de embarque, os horários e o pagamento estiverem confirmados. Volta a consultar esta página.</p><Link href="/" className="home-cta mt-6">Voltar ao início</Link></div></main>;
  }
  return <BookingFlow bookingEvent={event} requiresOtp={isOtpRequired()} />;
}
