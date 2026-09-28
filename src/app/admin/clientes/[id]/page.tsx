import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { planLabels, reservationStatusLabels } from "@/lib/admin-reservations";
import { requireStaff } from "@/lib/auth";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("ADMIN");
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      reservations: {
        include: {
          event: { select: { name: true, eventDate: true } },
          passengers: { orderBy: { fullName: "asc" } },
          seatPreferences: {
            where: { releasedAt: null },
            orderBy: { seatNumber: "asc" },
          },
          contactActivities: {
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
          },
          payments: {
            select: {
              id: true,
              status: true,
              amount: true,
              currency: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) notFound();

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <Link className="inline-flex items-center gap-2 text-sm font-bold text-white/55 hover:text-white" href="/admin"><ArrowLeft size={17} /> Painel</Link>
        </header>

        <section className="card mt-6 p-6 sm:p-8">
          <p className="eyebrow">Ficha do cliente</p>
          <h1 className="mt-3 text-3xl font-black">{customer.fullName}</h1>
          <div className="mt-5 flex flex-wrap gap-3 text-sm text-white/60">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2"><Phone size={15} /> {customer.phone}</span>
            {customer.email && <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2"><Mail size={15} /> {customer.email}</span>}
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2"><Users size={15} /> {customer.reservations.length} reserva{customer.reservations.length === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-4 text-xs text-white/35">Comunicações promocionais: {customer.marketingConsent ? "autorizadas" : "não autorizadas"}</p>
        </section>

        <div className="mt-6 space-y-5">
          {customer.reservations.map((reservation) => (
            <article className="card p-5 sm:p-7" key={reservation.id}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div><p className="font-mono text-sm font-bold text-violet-300">{reservation.reference}</p><h2 className="mt-2 text-xl font-black">{reservation.event.name}</h2><p className="mt-1 text-xs text-white/40">{reservation.createdAt.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</p></div>
                <span className="w-fit rounded-full bg-violet/15 px-3 py-1 text-xs font-bold text-violet-200">{reservationStatusLabels[reservation.status]}</span>
              </div>
              <dl className="mt-6 grid gap-4 border-t border-white/[.08] pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Data label="Plano" value={planLabels[reservation.plan ?? ""] ?? "Por definir"} />
                <Data label="Valor" value={formatKz(Number(reservation.totalAmount))} />
                <Data label="Recolha" value={reservation.pickupOther || reservation.pickupPreference || "Por definir"} />
                <Data label="Lugares" value={reservation.seatPreferences.map((seat) => seat.seatNumber).join(", ") || "—"} />
              </dl>
              <div className="mt-6 grid gap-5 lg:grid-cols-3">
                <History title="Passageiros" empty="Nenhum passageiro concluído.">{reservation.passengers.map((passenger) => <li key={passenger.id}>{passenger.fullName}</li>)}</History>
                <History title="Acompanhamento" empty="Sem acompanhamento.">{reservation.contactActivities.map((activity) => <li key={activity.id}><b>{activity.user?.name ?? "Sistema"}</b> · {activity.outcome}<small>{activity.comment || "Sem comentário"} · {activity.createdAt.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</small></li>)}</History>
                <History title="Pagamentos" empty="Sem pagamentos registados.">{reservation.payments.map((payment) => <li key={payment.id}><b>{payment.status}</b> · {formatKz(Number(payment.amount))}<small>{payment.createdAt.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</small></li>)}</History>
              </div>
              <Link className="btn-primary mt-6" href={`/admin/reservas/${reservation.id}`}>Gerir reserva</Link>
            </article>
          ))}
          {!customer.reservations.length && <p className="card p-8 text-center text-sm text-white/40">Este contacto ainda não tem reservas.</p>}
        </div>
      </div>
    </main>
  );
}

function Data({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-white/35">{label}</dt><dd className="mt-1 font-bold text-white/80">{value}</dd></div>;
}

function History({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section><h3 className="text-sm font-black">{title}</h3>{hasChildren ? <ul className="mt-3 space-y-3 text-xs text-white/65 [&_small]:mt-1 [&_small]:block [&_small]:text-white/35">{children}</ul> : <p className="mt-3 text-xs text-white/35">{empty}</p>}</section>;
}
