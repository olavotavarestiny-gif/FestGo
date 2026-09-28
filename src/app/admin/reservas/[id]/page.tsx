import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { PreReservationAdminActions } from "@/components/pre-reservation-admin-actions";
import { PaymentInvitationAdminActions } from "@/components/payment-invitation-admin-actions";
import { planLabels, reservationStatusLabels } from "@/lib/admin-reservations";
import { requireStaff } from "@/lib/auth";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";
import { analyzeSms, smsTemplates } from "@/lib/sms";
import { invitationState, paymentInvitationLink } from "@/lib/payment-invitations";

export const dynamic = "force-dynamic";

const contactLabels: Record<string, string> = {
  TO_CONTACT: "Por contactar",
  CONTACTED: "Contactado",
  AWAITING_PAYMENT: "A aguardar pagamento",
  NO_RESPONSE: "Sem resposta",
};

const notificationLabels: Record<string, string> = {
  PRE_RESERVATION_RECEIVED: "SMS de inscrição",
  PRE_RESERVATION_APPROVED: "SMS de aprovação",
  PAYMENT_LINK: "SMS de pagamento",
  BOOKING_PAID: "SMS de compra confirmada",
  EVENT_REMINDER: "Lembrete do evento",
};

export default async function ReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("ADMIN");
  const { id } = await params;
  const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        customer: true,
        event: { select: { name: true } },
        passengers: { orderBy: { fullName: "asc" } },
        seatPreferences: {
          where: { releasedAt: null },
          orderBy: { seatNumber: "asc" },
        },
        contactActivities: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        notifications: {
          include: { requestedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        paymentInvitation: true,
      },
    });
  if (!reservation) notFound();
  const auditLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "Reservation", entityId: id },
          ...(reservation.paymentInvitation
            ? [{ entityType: "PaymentInvitation", entityId: reservation.paymentInvitation.id }]
            : []),
        ],
      },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

  const approvalContent = smsTemplates.preReservationApproved(reservation.reference);
  const approvalAnalysis = analyzeSms(approvalContent);
  const approvalSms = reservation.notifications.find(
    (notification) => notification.template === "PRE_RESERVATION_APPROVED",
  );
  const registrationSms = reservation.notifications.find(
    (notification) => notification.template === "PRE_RESERVATION_RECEIVED",
  );
  const paymentLinkSms = reservation.notifications.find(
    (notification) => notification.template === "PAYMENT_LINK",
  );
  const paymentInvitation = reservation.paymentInvitation;
  const paymentLink = paymentInvitation && !paymentInvitation.revokedAt
    ? paymentInvitationLink(paymentInvitation)
    : null;
  const paymentSmsContent = paymentLink
    ? smsTemplates.paymentInvitation(paymentLink, reservation.reference)
    : null;
  const paymentSmsAnalysis = paymentSmsContent
    ? analyzeSms(paymentSmsContent)
    : null;

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4">
          <Logo />
          <Link className="inline-flex items-center gap-2 text-sm font-bold text-white/55 hover:text-white" href="/admin"><ArrowLeft size={17} /> Painel</Link>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <section className="card p-6 sm:p-8">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div><p className="font-mono text-sm font-bold text-violet-300">{reservation.reference}</p><h1 className="mt-2 text-3xl font-black">{reservation.customer.fullName}</h1><p className="mt-1 text-sm text-white/40">{reservation.event.name}</p></div>
                <div className="flex flex-col items-start gap-2 sm:items-end"><span className="rounded-full bg-violet/15 px-3 py-1 text-xs font-bold text-violet-200">{reservationStatusLabels[reservation.status]}</span><small className="text-white/40">{contactLabels[reservation.contactStatus]}</small></div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3 text-sm text-white/60">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2"><Phone size={15} /> {reservation.customer.phone}</span>
                {reservation.customer.email && <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2"><Mail size={15} /> {reservation.customer.email}</span>}
                <Link className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2 hover:bg-white/[.1]" href={`/admin/clientes/${reservation.customer.id}`}><Users size={15} /> Histórico do cliente</Link>
              </div>
              <dl className="mt-7 grid gap-5 border-t border-white/[.08] pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <Data label="Plano" value={planLabels[reservation.plan ?? ""] ?? "Por definir"} />
                <Data label="Valor" value={formatKz(Number(reservation.totalAmount))} />
                <Data label="Recolha pretendida" value={reservation.pickupOther || reservation.pickupPreference || "Por definir"} icon={<MapPin size={14} />} />
                <Data label="Lugares pretendidos" value={reservation.seatPreferences.map((seat) => seat.seatNumber).join(", ") || (reservation.status === "WAITLIST" ? "Lista de espera" : "—")} />
              </dl>
            </section>

            <section className="card p-6 sm:p-8">
              <h2 className="font-black">Passageiros</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">{reservation.passengers.map((passenger, index) => <li className="rounded-xl bg-white/[.05] p-3 text-sm text-white/75" key={passenger.id}><small className="block text-white/35">Passageiro {index + 1}</small><b>{passenger.fullName}</b></li>)}</ul>
              {!reservation.passengers.length && <p className="mt-3 text-sm text-white/35">A inscrição ainda não tem passageiros concluídos.</p>}
            </section>

            <section className="card p-6 sm:p-8">
              <h2 className="font-black">Histórico de comunicações</h2>
              <div className="mt-5 space-y-3">
                {reservation.notifications.map((notification) => <article className="rounded-xl border border-white/[.07] bg-white/[.03] p-4" key={notification.id}><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{notificationLabels[notification.template] ?? notification.template}</b><span className="text-xs font-bold text-violet-300">{notification.status}</span></div>{notification.content && <p className="mt-3 text-xs leading-5 text-white/60">{notification.content}</p>}<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-white/35"><span>{notification.characterCount ?? "—"} caracteres</span><span>{notification.segmentCount ?? "—"} segmentos</span><span>{notification.encoding ?? "Codificação não registada"}</span><span>{notification.attempts}/3 tentativas</span><span>{notification.requestedBy?.name ?? "Sistema"}</span><span>{(notification.sentAt ?? notification.updatedAt).toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</span></div>{notification.providerMessageId && <small className="mt-2 block break-all text-white/30">Ziett: {notification.providerMessageId} · {notification.providerStatus ?? "aceite"}</small>}{notification.lastError && <p className="sms-warning">{notification.lastError}</p>}</article>)}
                {!reservation.notifications.length && <p className="text-sm text-white/35">Nenhuma comunicação registada.</p>}
              </div>
            </section>

            <section className="card p-6 sm:p-8">
              <h2 className="font-black">Operações e acompanhamento</h2>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <History items={reservation.contactActivities.map((activity) => ({ id: activity.id, title: contactLabels[activity.outcome], detail: activity.comment || "Sem comentário", actor: activity.user?.name ?? "Sistema", date: activity.createdAt }))} empty="Sem acompanhamento comercial." />
                <History items={auditLogs.map((log) => ({ id: log.id, title: log.action, detail: "Operação administrativa", actor: log.user?.name ?? "Sistema", date: log.createdAt }))} empty="Sem operações administrativas." />
              </div>
            </section>
          </div>

          <aside className="card h-fit p-5 lg:sticky lg:top-5">
            <h2 className="font-black">Acções da reserva</h2>
            <p className="mt-1 text-xs leading-5 text-white/40">Cada operação guarda o administrador e a data.</p>
            <div className="mt-5">
              <PreReservationAdminActions
                id={reservation.id}
                current={reservation.contactStatus}
                reservationStatus={reservation.status}
                canResendSms={Boolean(registrationSms && ["FAILED", "RETRY"].includes(registrationSms.status) && registrationSms.attempts < 3)}
                approvalSms={approvalSms ? {
                  status: approvalSms.status,
                  attempts: approvalSms.attempts,
                  providerMessageId: approvalSms.providerMessageId,
                  providerStatus: approvalSms.providerStatus,
                  sentAt: approvalSms.sentAt?.toISOString() ?? null,
                  lastError: approvalSms.lastError,
                } : null}
                approvalPreview={{
                  content: approvalContent,
                  characterCount: approvalAnalysis.characterCount,
                  encoding: approvalAnalysis.encoding,
                  segments: approvalAnalysis.segments,
                  isSingleSegment: approvalAnalysis.isSingleSegment && approvalAnalysis.encoding === "GSM-7",
                }}
              />
              <div className="mt-5">
                <PaymentInvitationAdminActions
                  reservationId={reservation.id}
                  reservationStatus={reservation.status}
                  invitation={paymentInvitation ? {
                    state: invitationState(paymentInvitation),
                    link: paymentLink,
                    expiresAt: paymentInvitation.expiresAt.toISOString(),
                    confirmedAt: paymentInvitation.confirmedAt?.toISOString() ?? null,
                  } : null}
                  sms={paymentLinkSms ? {
                    status: paymentLinkSms.status,
                    attempts: paymentLinkSms.attempts,
                    providerStatus: paymentLinkSms.providerStatus,
                    sentAt: paymentLinkSms.sentAt?.toISOString() ?? null,
                    lastError: paymentLinkSms.lastError,
                  } : null}
                  preview={paymentSmsContent && paymentSmsAnalysis ? {
                    content: paymentSmsContent,
                    characterCount: paymentSmsAnalysis.characterCount,
                    encoding: paymentSmsAnalysis.encoding,
                    segments: paymentSmsAnalysis.segments,
                  } : null}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Data({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div><dt className="flex items-center gap-1 text-xs text-white/35">{icon}{label}</dt><dd className="mt-1 text-sm font-bold text-white/80">{value}</dd></div>;
}

function History({ items, empty }: { items: Array<{ id: string; title: string; detail: string; actor: string; date: Date }>; empty: string }) {
  if (!items.length) return <p className="text-sm text-white/35">{empty}</p>;
  return <ul className="space-y-3">{items.map((item) => <li className="border-l border-violet/40 pl-3 text-xs" key={item.id}><b className="text-white/75">{item.title}</b><p className="mt-1 text-white/45">{item.detail}</p><small className="mt-1 block text-white/30">{item.actor} · {item.date.toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</small></li>)}</ul>;
}
