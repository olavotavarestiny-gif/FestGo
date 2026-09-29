import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { IntegratedTestPaymentActions } from "@/components/integrated-test-payment-actions";
import { Logo } from "@/components/logo";
import { requireStaff } from "@/lib/auth";
import { formatKz } from "@/lib/data";
import { prisma } from "@/lib/db";
import { planLabels } from "@/lib/admin-reservations";
import { jsonObject, TEST_AMOUNT, TEST_PRODUCT_ID } from "@/lib/test-payments";

export const dynamic = "force-dynamic";

export default async function IntegratedTestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await requireStaff("ADMIN");
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const reservation = await prisma.testReservation.findUnique({
    where: { accessToken: token },
    include: {
      payment: { include: { webhookEvents: { orderBy: { receivedAt: "desc" } } } },
      ticket: true,
    },
  });
  if (!reservation) notFound();
  const details = jsonObject(reservation.payment?.providerDetails ?? null);
  const paymentUrl = typeof details.paymentUrl === "string" ? details.paymentUrl : null;
  const lastWebhook = reservation.payment?.webhookEvents[0];
  const paymentProvider = process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo";

  return (
    <main className="min-h-screen bg-[#100e17] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.04] px-5 py-4"><Logo /><Link className="inline-flex items-center gap-2 text-sm font-bold text-white/55" href="/admin/teste-gateway"><ArrowLeft size={17} /> Testes</Link></header>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
          <section className="card p-6 sm:p-8">
            <div className="inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-black">TESTE — NÃO VÁLIDO PARA EMBARQUE</div>
            <p className="mt-5 font-mono text-sm font-bold text-violet-300">{reservation.reference}</p>
            <h1 className="mt-2 text-3xl font-black">{reservation.eventName}</h1>
            <dl className="gateway-test-result mt-7">
              <div><dt>Plano seleccionado</dt><dd>{planLabels[reservation.plan]}</dd></div>
              <div><dt>Passageiro de teste</dt><dd>{reservation.passengerName}</dd></div>
              <div><dt>Lugar fictício</dt><dd>{reservation.testSeat}</dd></div>
              <div><dt>Ponto de recolha</dt><dd>{reservation.pickupPreference}</dd></div>
              <div><dt>Valor exclusivo deste teste</dt><dd>{formatKz(TEST_AMOUNT)}</dd></div>
              <div><dt>Produto fixo</dt><dd className="break-all">{paymentProvider === "wipay" ? "WiPay Sandbox" : TEST_PRODUCT_ID}</dd></div>
              <div><dt>Estado</dt><dd>{reservation.status}</dd></div>
              {reservation.payment?.providerPaymentId && <div><dt>Transacção</dt><dd className="break-all">{reservation.payment.providerPaymentId}</dd></div>}
              {typeof details.diagnosticDetail === "string" && <div><dt>Host devolvido</dt><dd className="break-all">{details.diagnosticDetail}</dd></div>}
              {lastWebhook && <div><dt>Último webhook</dt><dd>{lastWebhook.signatureValid ? "Assinatura válida" : "Assinatura inválida"} · {lastWebhook.processedAt ? "processado" : "pendente"}</dd></div>}
            </dl>
            {reservation.ticket && <Link className="btn-primary mt-6" href={`/admin/teste-gateway/bilhete/${reservation.ticket.publicToken}`}>Visualizar bilhete de teste <ExternalLink size={16} /></Link>}
          </section>
          <aside className="card h-fit p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet-300"><ShieldCheck size={21} /></span>
            <h2 className="mt-5 font-black">Pagamento integrado</h2>
            <p className="mt-2 text-xs leading-5 text-white/40">A cobrança só é criada depois da tua confirmação. O valor vem exclusivamente do servidor.</p>
            <div className="mt-5"><IntegratedTestPaymentActions reservationId={reservation.id} paymentExists={Boolean(reservation.payment)} paid={reservation.status === "PAID"} initialPaymentUrl={paymentUrl} paymentProvider={paymentProvider} /></div>
          </aside>
        </div>
      </div>
    </main>
  );
}
