import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/logo";
import { publicBaseUrl } from "@/lib/config";
import { isPrivateWiPayProbe } from "@/lib/private-wipay-probe";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const ticket = await prisma.ticket.findUnique({
    where: { publicToken: token },
    include: {
      passenger: {
        include: {
          reservation: { include: { event: true, pickupPoint: true } },
        },
      },
      validations: true,
    },
  });
  if (!ticket) notFound();

  const appUrl = publicBaseUrl();
  const qr = await QRCode.toDataURL(
    `${appUrl}/operacoes/check-in?token=${ticket.publicToken}`,
    {
      width: 420,
      margin: 2,
      color: { dark: "#13061f", light: "#ffffff" },
    },
  );
  const reservation = ticket.passenger.reservation;
  const privateProbe = isPrivateWiPayProbe(reservation);
  const valid = ticket.status === "VALID" && reservation.status === "PAID";
  const usedOutbound = ticket.validations.some(
    (item) => item.leg === "OUTBOUND",
  );
  const usedReturn = ticket.validations.some((item) => item.leg === "RETURN");

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-zinc-950">
      <article className="mx-auto max-w-md overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-xl shadow-purple-950/10">
        <header className="bg-zinc-950 px-7 py-6 text-white">
          <Logo />
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.24em] text-purple-300">
            {privateProbe ? "Bilhete técnico de teste" : "Bilhete digital"}
          </p>
          <h1 className="mt-2 text-2xl font-black">{reservation.event.name}</h1>
        </header>
        <div className="space-y-6 p-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Passageiro
            </p>
            <p className="mt-1 text-xl font-bold">
              {ticket.passenger.fullName}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Reserva {reservation.reference}
            </p>
          </div>
          {/* QR codes are generated as data URIs and already have an exact bitmap size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {privateProbe ? <p className="rounded-xl bg-amber-100 p-4 text-center text-sm font-black text-amber-900">TESTE PRIVADO — não é válido para embarque.</p> : <img
            src={qr}
            alt="Código QR do bilhete"
            className="mx-auto aspect-square w-full max-w-72"
          />}
          {!privateProbe && <dl className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-5 text-sm">
            <div>
              <dt className="text-zinc-500">Data</dt>
              <dd className="font-bold">
                {reservation.event.eventDate.toLocaleDateString("pt-AO", {
                  timeZone: "Africa/Luanda",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Embarque</dt>
              <dd className="font-bold">
                {reservation.pickupPoint?.departureAt?.toLocaleTimeString(
                  "pt-AO",
                  {
                    timeZone: "Africa/Luanda",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                ) ?? "A confirmar por SMS até 25/10/2026"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-zinc-500">Ponto de recolha</dt>
              <dd className="font-bold">{reservation.pickupPoint?.name ?? "Por confirmar"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-zinc-500">Regresso</dt>
              <dd className="font-bold">
                {reservation.event.returnAt?.toLocaleTimeString("pt-AO", {
                  timeZone: "Africa/Luanda",
                  hour: "2-digit",
                  minute: "2-digit",
                }) ?? "A confirmar"}
              </dd>
            </div>
          </dl>}
          <div
            className={`rounded-2xl px-4 py-3 text-center text-sm font-bold ${valid ? "bg-purple-50 text-purple-800" : "bg-red-50 text-red-700"}`}
          >
            {privateProbe ? "Pagamento de teste confirmado · bilhete técnico emitido" : valid
              ? `Válido · Ida ${usedOutbound ? "usada" : "disponível"} · Volta ${usedReturn ? "usada" : "disponível"}`
              : "Bilhete inválido ou revogado"}
          </div>
        </div>
      </article>
    </main>
  );
}
