import { notFound } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { prisma } from "@/lib/db";
import { verifyTicketBundleToken } from "@/lib/ticket-access";

export const dynamic = "force-dynamic";
export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  if (process.env.BOOKING_MODE === "PRE_RESERVATION") notFound();
  const { reference } = await params;
  const { token = "" } = await searchParams;
  if (
    !/^FG-\d{4}-[A-F0-9]{8}$/.test(reference) ||
    !verifyTicketBundleToken(reference, token)
  )
    notFound();
  const reservation = await prisma.reservation.findUnique({
    where: { reference },
    include: {
      event: true,
      pickupPoint: true,
      passengers: { include: { ticket: true } },
      referralRedemption: true,
      customer: {
        include: { referralCodes: { where: { active: true }, take: 1 } },
      },
    },
  });
  if (!reservation || reservation.status !== "PAID") notFound();
  return (
    <main className="min-h-screen bg-[#100e17] px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <Logo />
        <p className="eyebrow mt-10">Reserva {reservation.reference}</p>
        <h1 className="mt-3 text-4xl font-black">Os teus bilhetes</h1>
        <p className="mt-3 text-white/50">
          {reservation.pickupPoint?.name ?? "Por confirmar"} ·{" "}
          {reservation.pickupPoint?.departureAt?.toLocaleTimeString("pt-AO", {
            timeZone: "Africa/Luanda",
            hour: "2-digit",
            minute: "2-digit",
          }) ?? "horário por confirmar"}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {reservation.passengers.map((passenger) => (
            <article className="card p-5" key={passenger.id}>
              <p className="text-lg font-black">{passenger.fullName}</p>
              <p className="mt-1 text-xs text-white/40">Bilhete individual</p>
              {passenger.ticket ? (
                <Link
                  className="btn-primary mt-5 w-full"
                  href={`/bilhete/${passenger.ticket.publicToken}`}
                >
                  Abrir bilhete
                </Link>
              ) : (
                <p className="mt-5 text-sm text-amber-300">Emissão pendente</p>
              )}
            </article>
          ))}
        </div>
        {reservation.customer.referralCodes[0] && (
          <div className="card mt-6 p-6">
            <p className="text-sm text-white/45">
              O teu código de recomendação
            </p>
            <p className="mt-2 font-mono text-2xl font-black">
              {reservation.customer.referralCodes[0].code}
            </p>
            <p className="mt-2 text-xs text-white/40">
              Partilha com um novo cliente para oferecer 5% de desconto.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
