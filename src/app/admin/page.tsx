import Link from "next/link";
import { ReservationStatus } from "@prisma/client";
import {
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  MapPin,
  TicketCheck,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { AdminActions } from "@/components/admin-actions";
import { EventPreReservationSettings } from "@/components/event-pre-reservation-settings";
import {
  filtersQuery,
  parseAdminReservationFilters,
  pickupLabels,
  planLabels,
  reservationStatusLabels,
  reservationWhere,
} from "@/lib/admin-reservations";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
const pageSize = 50;
const contactLabels: Record<string, string> = {
  TO_CONTACT: "Por contactar",
  CONTACTED: "Contactado",
  AWAITING_PAYMENT: "Aguarda pagamento",
  NO_RESPONSE: "Sem resposta",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    event?: string;
    plan?: string;
    pickup?: string;
    status?: string;
    minors?: string;
    page?: string;
  }>;
}) {
  const user = await requireStaff("ADMIN");
  const input = await searchParams;
  const filters = parseAdminReservationFilters(input);
  const page = Math.max(1, Number.parseInt(input.page ?? "1", 10) || 1);
  const [events, event] = await Promise.all([
    prisma.event.findMany({
      select: { slug: true, name: true },
      orderBy: { eventDate: "desc" },
    }),
    prisma.event.findUnique({ where: { slug: filters.event } }),
  ]);
  const eventId = event?.id ?? "missing";
  const listWhere = reservationWhere(filters);
  const completedStatuses = {
    notIn: ["LEAD", "CANCELLED", "EXPIRED"] as ReservationStatus[],
  };
  const approvedStatuses = [
    "PAYMENT_PENDING",
    "HELD",
    "AWAITING_PAYMENT",
    "PAYMENT_UNCERTAIN",
    "PAID",
  ] as const;
  const awaitingStatuses = [
    "PAYMENT_PENDING",
    "HELD",
    "AWAITING_PAYMENT",
    "PAYMENT_UNCERTAIN",
  ] as const;

  const [
    reservations,
    filteredCount,
    totalRegistrations,
    pendingReview,
    approved,
    awaitingPayment,
    paid,
    passengerTotals,
    pickupGroups,
    planGroups,
    soldSeats,
    smsFailures,
  ] = await Promise.all([
    prisma.reservation.findMany({
      where: listWhere,
      include: {
        customer: true,
        passengers: { orderBy: { fullName: "asc" } },
        seatPreferences: {
          where: { releasedAt: null },
          orderBy: { seatNumber: "asc" },
        },
        contactActivities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.reservation.count({ where: listWhere }),
    prisma.reservation.count({
      where: { eventId, status: { not: "LEAD" } },
    }),
    prisma.reservation.count({
      where: { eventId, status: { in: ["PRE_RESERVED", "WAITLIST"] } },
    }),
    prisma.reservation.count({
      where: { eventId, status: { in: [...approvedStatuses] } },
    }),
    prisma.reservation.count({
      where: { eventId, status: { in: [...awaitingStatuses] } },
    }),
    prisma.reservation.count({ where: { eventId, status: "PAID" } }),
    prisma.reservation.aggregate({
      where: { eventId, status: completedStatuses },
      _sum: { quantity: true },
    }),
    prisma.reservation.groupBy({
      by: ["pickupPreference", "pickupOther"],
      where: { eventId, status: completedStatuses },
      _count: true,
      _sum: { quantity: true },
    }),
    prisma.reservation.groupBy({
      by: ["plan"],
      where: { eventId, status: completedStatuses },
      _count: true,
      _sum: { quantity: true },
    }),
    prisma.seatPreference.count({
      where: { eventId, status: "CONFIRMED", releasedAt: null },
    }),
    prisma.notification.count({
      where: {
        reservation: { eventId },
        status: { in: ["FAILED", "RETRY"] },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const exportQuery = filtersQuery(filters);
  const previousQuery = filtersQuery(filters, { page: String(page - 1) });
  const nextQuery = filtersQuery(filters, { page: String(page + 1) });

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <div className="text-right"><b className="block text-sm">{user.name}</b><small className="text-white/35">Administrador</small></div>
        </header>
        <div className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="eyebrow">Painel administrativo</p><h1 className="mt-2 text-3xl font-black">{event?.name ?? "Evento"}</h1><p className="mt-1 text-sm text-white/40">Dados operacionais da PostgreSQL · pagamentos desactivados</p></div>
          <AdminActions eventStatus={event?.status ?? "DRAFT"} preReservationMode exportHref={`/api/admin/passengers.csv${exportQuery ? `?${exportQuery}` : ""}`} />
        </div>

        <section aria-label="Indicadores" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={ClipboardCheck} label="Total de inscrições" value={String(totalRegistrations)} meta="Formulários concluídos" />
          <Metric icon={UserRoundSearch} label="Por analisar" value={String(pendingReview)} meta="Pré-reservas e lista de espera" />
          <Metric icon={TicketCheck} label="Pré-reservas aprovadas" value={String(approved)} meta="Inclui pagamentos posteriores" />
          <Metric icon={Clock3} label="A aguardar pagamento" value={String(awaitingPayment)} meta="Aprovadas ainda não pagas" />
          <Metric icon={CircleDollarSign} label="Pagamentos confirmados" value={String(paid)} meta="Reservas no estado pago" />
          <Metric icon={Users} label="Total de passageiros" value={String(passengerTotals._sum?.quantity ?? 0)} meta="Inscrições activas" />
          <Metric icon={MapPin} label="Pontos procurados" value={String(pickupGroups.length)} meta="Preferências registadas" />
          <Metric icon={TicketCheck} label="Lugares vendidos" value={`${soldSeats} / ${event?.capacity ?? 0}`} meta="Lugares pagos e confirmados" />
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_.65fr]">
          <section className="card overflow-hidden">
            <div className="p-5 sm:p-6">
              <div><h2 className="font-black">Clientes e reservas</h2><p className="mt-1 text-xs text-white/40">{filteredCount} resultado{filteredCount === 1 ? "" : "s"}</p></div>
              <form className="admin-filters mt-4">
                <input name="q" defaultValue={filters.q} placeholder="Nome, passageiro, telefone ou referência" />
                <select name="event" defaultValue={filters.event}>{events.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select>
                <select name="plan" defaultValue={filters.plan ?? ""}><option value="">Todos os planos</option>{Object.entries(planLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                <select name="pickup" defaultValue={filters.pickup ?? ""}><option value="">Todos os pontos</option>{pickupLabels.map((label) => <option value={label} key={label}>{label}</option>)}</select>
                <select name="status" defaultValue={filters.status ?? ""}><option value="">Todos os estados</option>{Object.entries(reservationStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                <select name="minors" defaultValue={filters.minors ? "1" : ""}><option value="">Adultos e menores</option><option value="1">Inclui menores</option></select>
                <button>Filtrar</button>
              </form>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-white/[.04] text-xs uppercase tracking-wider text-white/30"><tr>{["Inscrição", "Contacto e passageiros", "Plano", "Recolha", "Lugares", "Estado", "Acompanhamento"].map((label) => <th className="px-5 py-4" key={label}>{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.06]">
                  {reservations.map((reservation) => (
                    <tr className="align-top" key={reservation.id}>
                      <td className="px-5 py-4"><b className="font-mono">{reservation.reference}</b><small className="mt-1 block text-white/35">{reservation.createdAt.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</small></td>
                      <td className="px-5 py-4"><Link className="font-bold text-violet-300 hover:text-violet-200" href={`/admin/clientes/${reservation.customer.id}`}>{reservation.customer.fullName}</Link><small className="mt-1 block text-white/45">{reservation.customer.phone}</small><small className="mt-2 block max-w-[230px] text-white/45">{reservation.passengers.map((passenger) => passenger.fullName).join(" · ") || "Sem passageiros concluídos"}</small></td>
                      <td className="px-5 py-4">{planLabels[reservation.plan ?? ""] ?? "Composição automática"}<small className="mt-1 block text-white/40">{reservation.quantity} pax · {reservation.minorCount} menor{reservation.minorCount === 1 ? "" : "es"} · {formatKz(Number(reservation.totalAmount))}</small></td>
                      <td className="px-5 py-4">{reservation.pickupOther || reservation.pickupPreference || "Por definir"}</td>
                      <td className="px-5 py-4">{reservation.seatPreferences.length ? reservation.seatPreferences.map((seat) => seat.seatNumber).join(", ") : reservation.status === "WAITLIST" ? "Espera" : "—"}</td>
                      <td className="px-5 py-4"><StatusBadge status={reservation.status} /><small className="mt-2 block text-white/40">{contactLabels[reservation.contactStatus]}</small></td>
                      <td className="px-5 py-4"><Link className="btn-primary min-h-9 px-4 py-2 text-xs" href={`/admin/reservas/${reservation.id}`}>Abrir reserva</Link>{reservation.contactActivities[0]?.comment && <small className="mt-2 block max-w-[260px] text-white/35">Último: {reservation.contactActivities[0].comment}</small>}</td>
                    </tr>
                  ))}
                  {!reservations.length && <tr><td colSpan={7} className="px-6 py-10 text-center text-white/35">Nenhuma inscrição encontrada.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-white/[.07] md:hidden">
              {reservations.map((reservation) => (
                <article className="space-y-4 p-5" key={reservation.id}>
                  <div className="flex items-start justify-between gap-3"><div><b className="font-mono text-sm">{reservation.reference}</b><small className="mt-1 block text-white/35">{reservation.createdAt.toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda" })}</small></div><StatusBadge status={reservation.status} /></div>
                  <div><Link className="font-bold text-violet-300" href={`/admin/clientes/${reservation.customer.id}`}>{reservation.customer.fullName}</Link><p className="mt-1 text-xs text-white/45">{reservation.customer.phone}</p><p className="mt-2 text-xs text-white/55">{reservation.passengers.map((passenger) => passenger.fullName).join(" · ") || "Sem passageiros concluídos"}</p></div>
                  <div className="grid grid-cols-2 gap-3 text-xs"><Data label="Plano" value={planLabels[reservation.plan ?? ""] ?? "Composição automática"} /><Data label="Recolha" value={reservation.pickupOther || reservation.pickupPreference || "Por definir"} /><Data label="Passageiros" value={`${reservation.quantity} (${reservation.minorCount} menores)`} /><Data label="Total" value={formatKz(Number(reservation.totalAmount))} /></div>
                  <Link className="btn-primary w-full" href={`/admin/reservas/${reservation.id}`}>Abrir reserva</Link>
                </article>
              ))}
              {!reservations.length && <p className="p-8 text-center text-sm text-white/35">Nenhuma inscrição encontrada.</p>}
            </div>

            {totalPages > 1 && <nav aria-label="Paginação" className="flex items-center justify-between border-t border-white/[.07] p-5 text-sm"><span className="text-white/40">Página {Math.min(page, totalPages)} de {totalPages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={`/admin?${previousQuery}`}>Anterior</Link>}{page < totalPages && <Link className="btn-secondary" href={`/admin?${nextQuery}`}>Seguinte</Link>}</div></nav>}
          </section>

          <aside className="space-y-5">
            <Panel title="Planos">{planGroups.map((group) => <Stat key={group.plan ?? "none"} label={planLabels[group.plan ?? ""] ?? "Sem plano"} value={`${group._count} · ${group._sum?.quantity ?? 0} pax`} />)}</Panel>
            <Panel title="Distribuição por recolha">{pickupGroups.map((group, index) => <Stat key={`${group.pickupPreference}-${group.pickupOther}-${index}`} label={group.pickupOther || group.pickupPreference || "Sem preferência"} value={`${group._count} · ${group._sum?.quantity ?? 0} pax`} />)}</Panel>
            <Panel title="Configuração comercial"><EventPreReservationSettings duration={event?.estimatedTravelDuration ?? ""} confirmed={event?.travelEstimateConfirmed ?? false} individualPrice={Number(event?.individualPrice ?? 25_000)} duoPrice={Number(event?.duoPrice ?? 47_500)} groupPrice={Number(event?.groupPrice ?? 90_000)} minorAgeLimit={event?.minorAgeLimit ?? 18} /></Panel>
            <Panel title="Notificações"><Stat label="Falhas de SMS" value={String(smsFailures)} danger={smsFailures > 0} /></Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value, meta }: { icon: typeof Users; label: string; value: string; meta: string }) {
  return <article className="card p-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-300"><Icon size={20} /></span><p className="mt-6 text-sm text-white/40">{label}</p><p className="mt-1 text-2xl font-black">{value}</p><p className="mt-2 text-xs font-bold text-white/40">{meta}</p></article>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card p-6"><h2 className="font-black">{title}</h2><div className="mt-5 space-y-3">{children}</div></section>;
}
function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="flex justify-between gap-3 text-sm"><span className="text-white/50">{label}</span><b className={danger ? "text-rose-300" : ""}>{value}</b></div>;
}
function StatusBadge({ status }: { status: keyof typeof reservationStatusLabels }) {
  return <span className="inline-flex max-w-[180px] rounded-full bg-violet/15 px-3 py-1 text-[10px] font-bold text-violet-200">{reservationStatusLabels[status]}</span>;
}
function Data({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-white/35">{label}</span><b className="mt-1 block text-white/80">{value}</b></div>;
}
