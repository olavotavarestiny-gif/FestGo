import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaymentCheckout, type PaymentProvider } from "@/components/payment-checkout";
import { prisma } from "@/lib/db";
import { verifyReservationToken } from "@/lib/reservation-access";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { isPrivateWiPayProbe } from "@/lib/private-wipay-probe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pagamento da reserva — FestGo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ reservationId: string }>; searchParams: Promise<{ token?: string }> }) {
  const { reservationId } = await params;
  const { token = "" } = await searchParams;
  if (!/^[a-zA-Z0-9_-]{8,40}$/.test(reservationId) || typeof token !== "string" || !verifyReservationToken(reservationId, token)) notFound();
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, select: {
    id: true, reference: true, status: true, quantity: true, totalAmount: true, discountAmount: true, holdExpiresAt: true,
    event: { select: { name: true, slug: true } }, pickupPoint: { select: { name: true, departureAt: true } },
    payments: { select: { id: true }, take: 1 },
  } });
  if (!reservation) notFound();
  const privateProbe = isPrivateWiPayProbe(reservation);
  const allowed: PaymentProvider[] = ["wipay", "paygo", "ekwanza"];
  const provider = allowed.includes(process.env.PAYMENTS_PROVIDER as PaymentProvider) ? process.env.PAYMENTS_PROVIDER as PaymentProvider : "paygo";
  const providers = [...new Set([provider, ...(process.env.PAYMENTS_AVAILABLE_PROVIDERS ?? "").split(",").map((value) => value.trim()).filter((value): value is PaymentProvider => allowed.includes(value as PaymentProvider))])];
  return <PaymentCheckout access={{ reservationId, accessToken: token }} reference={reservation.reference} eventName={reservation.event.name} quantity={reservation.quantity} total={Number(reservation.totalAmount)} discount={Number(reservation.discountAmount)} pickupName={reservation.pickupPoint?.name ?? "Por confirmar"} departureAt={reservation.pickupPoint?.departureAt?.toISOString() ?? null} holdExpiresAt={reservation.holdExpiresAt?.toISOString() ?? null} status={reservation.status} hasPayment={reservation.payments.length > 0} paymentProvider={privateProbe ? "wipay" : provider} paymentProviders={privateProbe ? ["wipay"] : providers} paymentsEnabled={privateProbe || arePaymentsEnabled()} />;
}
