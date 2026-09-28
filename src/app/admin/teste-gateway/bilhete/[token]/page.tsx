import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Logo } from "@/components/logo";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TestTicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await requireStaff("ADMIN");
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const ticket = await prisma.testTicket.findUnique({
    where: { publicToken: token },
    include: { testReservation: true, validations: true },
  });
  if (!ticket) notFound();
  const appUrl = (process.env.APP_URL ?? "https://festgo.mazanga.digital").replace(/\/$/, "");
  const validationUrl = `${appUrl}/admin/teste-gateway/validar?token=${ticket.publicToken}`;
  const qr = await QRCode.toDataURL(validationUrl, {
    width: 420,
    margin: 2,
    color: { dark: "#13061f", light: "#ffffff" },
  });
  const outbound = ticket.validations.some((item) => item.leg === "OUTBOUND");
  const returning = ticket.validations.some((item) => item.leg === "RETURN");

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-zinc-950">
      <article className="mx-auto max-w-md overflow-hidden rounded-[2rem] border-4 border-amber-300 bg-white shadow-xl">
        <header className="bg-zinc-950 px-7 py-6 text-white"><Logo /><div className="mt-5 inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-black">BILHETE DE TESTE</div><h1 className="mt-3 text-2xl font-black">Brunch Mangais</h1></header>
        <div className="space-y-5 p-7">
          <div><p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Passageiro</p><p className="mt-1 text-xl font-bold">{ticket.testReservation.passengerName}</p><p className="mt-1 text-sm text-zinc-600">{ticket.testReservation.reference}</p></div>
          <img src={qr} alt="QR Code exclusivo do bilhete de teste" className="mx-auto aspect-square w-full max-w-72" />
          <dl className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-5 text-sm"><div><dt className="text-zinc-500">Lugar</dt><dd className="font-bold">{ticket.testReservation.testSeat}</dd></div><div><dt className="text-zinc-500">Recolha</dt><dd className="font-bold">{ticket.testReservation.pickupPreference}</dd></div></dl>
          <div className="rounded-2xl bg-amber-50 p-4 text-center text-sm font-black text-amber-900">TESTE — NÃO ACEITAR NO EMBARQUE OFICIAL</div>
          <p className="text-center text-xs text-zinc-500">Ida: {outbound ? "utilizada" : "disponível"} · Regresso: {returning ? "utilizado" : "disponível"}</p>
          <Link className="btn-primary w-full" href={validationUrl}>Validar QR de teste</Link>
        </div>
      </article>
    </main>
  );
}
