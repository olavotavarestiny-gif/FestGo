import { CircleDollarSign, MapPin, MessageSquareText, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { AdminActions } from "@/components/admin-actions";
import { EventPreReservationSettings } from "@/components/event-pre-reservation-settings";
import { PreReservationAdminActions } from "@/components/pre-reservation-admin-actions";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const activeStatuses = ["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"] as const;
const planLabels: Record<string, string> = {
  INDIVIDUAL: "Individual",
  DUO: "Dupla",
  DUO_INDIVIDUAL: "Dupla + Individual",
  GROUP: "Grupo",
};
const contactLabels: Record<string, string> = {
  TO_CONTACT: "Por contactar",
  CONTACTED: "Contactado",
  AWAITING_PAYMENT: "Aguarda pagamento",
  NO_RESPONSE: "Sem resposta",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireStaff("ADMIN");
  const filters = await searchParams;
  const query = filters.q?.trim().slice(0, 100) ?? "";
  const contactFilter = ["TO_CONTACT", "CONTACTED", "AWAITING_PAYMENT", "NO_RESPONSE"].includes(filters.status ?? "")
    ? filters.status
    : undefined;
  const event = await prisma.event.findUnique({ where: { slug: "brunch-mangais" } });
  const eventId = event?.id ?? "missing";
  const where = {
    eventId,
    status: { in: [...activeStatuses] },
    ...(contactFilter ? { contactStatus: contactFilter as "TO_CONTACT" } : {}),
    ...(query
      ? {
          OR: [
            { reference: { contains: query, mode: "insensitive" as const } },
            { customer: { fullName: { contains: query, mode: "insensitive" as const } } },
            { customer: { phone: { contains: query } } },
          ],
        }
      : {}),
  };

  const [recent, totals, paidRevenue, contactPending, planGroups, pickupGroups, campaignGroups, seatGroups, smsFailures, crmFailures] = await Promise.all([
    prisma.reservation.findMany({
      where,
      include: {
        customer: true,
        seatPreferences: { where: { releasedAt: null }, orderBy: { seatNumber: "asc" } },
        notifications: { where: { template: "PRE_RESERVATION_RECEIVED" }, take: 1 },
        contactActivities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.reservation.aggregate({
      where: { eventId, status: { in: [...activeStatuses] } },
      _count: true,
      _sum: { quantity: true, totalAmount: true },
    }),
    prisma.reservation.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { totalAmount: true, quantity: true },
    }),
    prisma.reservation.count({ where: { eventId, status: { in: [...activeStatuses] }, contactStatus: "TO_CONTACT" } }),
    prisma.reservation.groupBy({
      by: ["plan"],
      where: { eventId, status: { in: [...activeStatuses] } },
      _count: true,
      _sum: { quantity: true },
    }),
    prisma.reservation.groupBy({
      by: ["pickupPreference", "pickupOther"],
      where: { eventId, status: { in: [...activeStatuses] } },
      _count: true,
      _sum: { quantity: true },
    }),
    prisma.reservation.groupBy({
      by: ["utmSource"],
      where: { eventId, status: { in: [...activeStatuses] } },
      _count: true,
    }),
    prisma.seatPreference.groupBy({
      by: ["seatNumber"],
      where: { eventId, releasedAt: null },
      _count: true,
      orderBy: { seatNumber: "asc" },
    }),
    prisma.notification.count({ where: { reservation: { eventId }, template: "PRE_RESERVATION_RECEIVED", status: { in: ["FAILED", "RETRY"] } } }),
    prisma.cRMIntegrationJob.count({ where: { reservation: { eventId }, kind: "PRE_RESERVATION_CONTACT", status: { in: ["FAILED", "DEAD_LETTER"] } } }),
  ]);

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <div className="text-right"><b className="block text-sm">{user.name}</b><small className="text-white/35">Administrador</small></div>
        </header>
        <div className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="eyebrow">Painel de pré-reservas</p><h1 className="mt-2 text-3xl font-black">Brunch Mangais</h1><p className="mt-1 text-sm text-white/40">Captação activa · pagamentos e bilhetes desactivados</p></div>
          <AdminActions eventStatus={event?.status ?? "DRAFT"} preReservationMode />
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Users} label="Inscrições" value={String(totals._count)} meta={`${totals._sum.quantity ?? 0} passageiros pretendidos`} />
          <Metric icon={MessageSquareText} label="Por contactar" value={String(contactPending)} meta="Acompanhamento comercial" />
          <Metric icon={CircleDollarSign} label="Receita potencial" value={formatKz(Number(totals._sum.totalAmount ?? 0))} meta={`Recebida: ${formatKz(Number(paidRevenue._sum.totalAmount ?? 0))}`} />
          <Metric icon={MapPin} label="Preferências de lugar" value={`${seatGroups.length} / ${event?.capacity ?? 30}`} meta={`${Math.max(0, (event?.capacity ?? 30) - seatGroups.length)} sem preferência registada`} />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_.65fr]">
          <section className="card overflow-hidden">
            <div className="p-6">
              <h2 className="font-black">Inscrições e acompanhamento</h2>
              <form className="admin-filters mt-4">
                <input name="q" defaultValue={query} placeholder="Pesquisar nome, telefone ou referência" />
                <select name="status" defaultValue={contactFilter ?? ""}><option value="">Todos os contactos</option>{Object.entries(contactLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                <button>Filtrar</button>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-white/[.04] text-xs uppercase tracking-wider text-white/30"><tr>{["Inscrição", "Contacto", "Plano", "Recolha", "Lugares", "Estado", "Acompanhamento"].map((label) => <th className="px-5 py-4" key={label}>{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.06]">
                  {recent.map((reservation) => (
                    <tr className="align-top" key={reservation.id}>
                      <td className="px-5 py-4"><b className="font-mono">{reservation.reference}</b><small className="mt-1 block text-white/35">{reservation.createdAt.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</small></td>
                      <td className="px-5 py-4"><b>{reservation.customer.fullName}</b><small className="mt-1 block text-white/45">{reservation.customer.phone}</small></td>
                      <td className="px-5 py-4">{planLabels[reservation.plan ?? ""] ?? "Por definir"}<small className="mt-1 block text-white/40">{reservation.quantity} · {formatKz(Number(reservation.totalAmount))}</small></td>
                      <td className="px-5 py-4">{reservation.pickupOther || reservation.pickupPreference || "Por definir"}</td>
                      <td className="px-5 py-4">{reservation.seatPreferences.length ? reservation.seatPreferences.map((seat) => seat.seatNumber).join(", ") : reservation.status === "WAITLIST" ? "Espera" : "—"}</td>
                      <td className="px-5 py-4"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{reservation.status}</span><small className="mt-2 block text-white/40">{contactLabels[reservation.contactStatus]}</small></td>
                      <td className="px-5 py-4"><PreReservationAdminActions id={reservation.id} current={reservation.contactStatus} canResendSms={reservation.notifications.length > 0} />{reservation.contactActivities[0]?.comment && <small className="mt-2 block max-w-[260px] text-white/35">Último: {reservation.contactActivities[0].comment}</small>}</td>
                    </tr>
                  ))}
                  {!recent.length && <tr><td colSpan={7} className="px-6 py-10 text-center text-white/35">Nenhuma inscrição encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="space-y-5">
            <Panel title="Planos">{planGroups.map((group) => <Stat key={group.plan ?? "none"} label={planLabels[group.plan ?? ""] ?? "Sem plano"} value={`${group._count} · ${group._sum.quantity ?? 0} pax`} />)}</Panel>
            <Panel title="Recolha pretendida">{pickupGroups.map((group, index) => <Stat key={`${group.pickupPreference}-${group.pickupOther}-${index}`} label={group.pickupOther || group.pickupPreference || "Sem preferência"} value={String(group._sum.quantity ?? 0)} />)}</Panel>
            <Panel title="Origem da campanha">{campaignGroups.map((group) => <Stat key={group.utmSource ?? "direct"} label={group.utmSource || "Directo / não indicado"} value={String(group._count)} />)}</Panel>
            <Panel title="Duração da viagem"><EventPreReservationSettings duration={event?.estimatedTravelDuration ?? ""} confirmed={event?.travelEstimateConfirmed ?? false} /></Panel>
            <Panel title="Integrações"><Stat label="Falhas SMS" value={String(smsFailures)} danger={smsFailures > 0} /><Stat label="Falhas KukuGest" value={String(crmFailures)} danger={crmFailures > 0} /></Panel>
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
