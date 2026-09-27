import {
  BusFront,
  CircleDollarSign,
  Clock3,
  TicketCheck,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { AdminActions } from "@/components/admin-actions";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireStaff("ADMIN");
  const event = await prisma.event.findUnique({
    where: { slug: "brunch-mangais" },
    include: { routes: true },
  });
  const eventId = event?.id ?? "missing";
  const [
    recent,
    paid,
    activeHolds,
    revenue,
    discounts,
    validations,
    smsFailures,
    crmFailures,
    pickupGroups,
  ] = await Promise.all([
    prisma.reservation.findMany({
      where: { eventId },
      include: { customer: true, pickupPoint: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.reservation.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { quantity: true },
      _count: true,
    }),
    prisma.reservation.aggregate({
      where: {
        eventId,
        status: { in: ["HELD", "AWAITING_PAYMENT", "PAYMENT_UNCERTAIN"] },
        holdExpiresAt: { gt: new Date() },
      },
      _sum: { quantity: true },
    }),
    prisma.reservation.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { totalAmount: true },
    }),
    prisma.reservation.aggregate({
      where: { eventId, status: "PAID" },
      _sum: { discountAmount: true },
    }),
    prisma.ticketValidation.count({
      where: { ticket: { passenger: { reservation: { eventId } } } },
    }),
    prisma.notification.count({
      where: { reservation: { eventId }, status: { in: ["FAILED", "RETRY"] } },
    }),
    prisma.cRMIntegrationJob.count({
      where: {
        reservation: { eventId },
        status: { in: ["FAILED", "DEAD_LETTER"] },
      },
    }),
    prisma.reservation.groupBy({
      by: ["pickupPointId"],
      where: { eventId, status: "PAID" },
      _sum: { quantity: true },
    }),
  ]);
  const pointIds = pickupGroups.map((group) => group.pickupPointId);
  const points = await prisma.pickupPoint.findMany({
    where: { id: { in: pointIds } },
    select: { id: true, name: true },
  });
  const pointNames = new Map(points.map((point) => [point.id, point.name]));
  const sold = paid._sum.quantity ?? 0;
  const routeCapacities =
    event?.routes
      .filter((route) => route.active)
      .map((route) => route.capacity) ?? [];
  const capacity = event
    ? Math.min(
        event.capacity,
        ...(routeCapacities.length ? routeCapacities : [event.capacity]),
      )
    : 0;

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <div className="text-right">
            <b className="block text-sm">{user.name}</b>
            <small className="text-white/35">Administrador</small>
          </div>
        </header>
        <div className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Painel operacional</p>
            <h1 className="mt-2 text-3xl font-black">Brunch Mangais</h1>
            <p className="mt-1 text-sm text-white/40">
              Dados reais · {event?.status ?? "Evento não configurado"}
            </p>
          </div>
          <AdminActions eventStatus={event?.status ?? "DRAFT"} />
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={TicketCheck}
            label="Lugares pagos"
            value={`${sold} / ${capacity}`}
            meta={`${Math.max(0, capacity - sold)} disponíveis`}
          />
          <Metric
            icon={Clock3}
            label="Reservados/pendentes"
            value={String(activeHolds._sum.quantity ?? 0)}
            meta="Prazo activo ou incerto"
          />
          <Metric
            icon={CircleDollarSign}
            label="Receita bruta"
            value={formatKz(Number(revenue._sum.totalAmount ?? 0))}
            meta={`${formatKz(Number(discounts._sum.discountAmount ?? 0))} em descontos`}
          />
          <Metric
            icon={Users}
            label="Check-ins"
            value={String(validations)}
            meta={`${paid._count} reservas pagas`}
          />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_.7fr]">
          <section className="card overflow-hidden">
            <div className="p-6">
              <h2 className="font-black">Reservas recentes</h2>
              <p className="mt-1 text-xs text-white/35">
                Sem dados demonstrativos
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-white/[.04] text-xs uppercase tracking-wider text-white/30">
                  <tr>
                    {[
                      "Referência",
                      "Cliente",
                      "Embarque",
                      "Lugares",
                      "Estado",
                    ].map((label) => (
                      <th className="px-6 py-4" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[.06]">
                  {recent.map((reservation) => (
                    <tr key={reservation.id}>
                      <td className="px-6 py-4 font-mono">
                        {reservation.reference}
                      </td>
                      <td className="px-6 py-4">
                        {reservation.customer.fullName}
                      </td>
                      <td className="px-6 py-4">
                        {reservation.pickupPoint.name}
                      </td>
                      <td className="px-6 py-4">{reservation.quantity}</td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                          {reservation.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-10 text-center text-white/35"
                      >
                        Ainda não existem reservas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="space-y-5">
            <div className="card p-6">
              <div className="flex items-center gap-3">
                <BusFront className="text-violet-300" />
                <h2 className="font-black">Por embarque</h2>
              </div>
              <div className="mt-6 space-y-4">
                {pickupGroups.map((group) => (
                  <div
                    className="flex justify-between text-sm"
                    key={group.pickupPointId}
                  >
                    <span>
                      {pointNames.get(group.pickupPointId) ?? "Ponto"}
                    </span>
                    <b>{group._sum.quantity ?? 0}</b>
                  </div>
                ))}
                {pickupGroups.length === 0 && (
                  <p className="text-sm text-white/35">
                    Sem passageiros pagos.
                  </p>
                )}
              </div>
            </div>
            <div className="card p-6">
              <h2 className="font-black">Integrações</h2>
              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-white/45">Falhas SMS</dt>
                  <dd
                    className={
                      smsFailures ? "text-rose-300" : "text-emerald-300"
                    }
                  >
                    {smsFailures}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/45">Falhas KukuGest</dt>
                  <dd
                    className={
                      crmFailures ? "text-rose-300" : "text-emerald-300"
                    }
                  >
                    {crmFailures}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  meta,
}: {
  icon: typeof TicketCheck;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <article className="card p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-300">
        <Icon size={20} />
      </span>
      <p className="mt-6 text-sm text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="mt-2 text-xs font-bold text-white/40">{meta}</p>
    </article>
  );
}
