import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { TERMS_VERSION } from "@/lib/terms";

const titles: Record<string, string> = {
  termos: "Termos e Condições",
  cancelamentos: "Política de Cancelamento e Reembolso",
  reembolsos: "Política de Cancelamento e Reembolso",
  privacidade: "Política de Privacidade",
};

export default async function LegalPage({ params }: { params: Promise<{ legal: string }> }) {
  const { legal } = await params;
  const refunds = legal === "cancelamentos" || legal === "reembolsos";
  const privacy = legal === "privacidade";
  return <main className="min-h-screen bg-[#0c0a12]">
    <header className="border-b border-white/10"><div className="shell flex h-20 items-center justify-between"><Logo /><Link href="/" className="flex items-center gap-2 text-sm text-white/50"><ArrowLeft size={16} /> Voltar</Link></div></header>
    <article className="shell max-w-3xl py-20">
      <p className="eyebrow">Informação legal · versão {TERMS_VERSION}</p>
      <h1 className="mt-4 text-5xl font-black tracking-tight">{titles[legal] ?? titles.termos}</h1>
      <div className="mt-12 space-y-8 leading-8 text-white/70">
        {privacy ? <>
          <section><h2 className="text-xl font-black text-white">Dados usados na reserva</h2><p>Usamos os nomes dos passageiros, o contacto do responsável e os dados da compra para gerir a reserva, o pagamento, os bilhetes e as comunicações operacionais. O e-mail e a autorização para receber novidades são opcionais.</p></section>
          <section><h2 className="text-xl font-black text-white">Prestadores</h2><p>O pagamento é tratado pela WiPay; o envio de SMS, quando configurado, pela Ziett. Os dados necessários à operação ficam acessíveis à equipa FestGo autorizada.</p></section>
          <section><h2 className="text-xl font-black text-white">Contacto</h2><p>Para questões sobre os teus dados, contacta a FestGo pelo <a href="https://wa.me/244932511161" className="underline">+244 932 511 161</a>.</p></section>
        </> : refunds ? <>
          <section><h2 className="text-xl font-black text-white">Pedido do cliente</h2><p>O pedido de cancelamento com reembolso pode ser feito até 7 dias antes do evento pelo contacto oficial <a href="https://wa.me/244932511161" className="underline">+244 932 511 161</a>. Após aprovação, a FestGo devolve 50% do valor pago em até 30 dias. Com menos de 7 dias para o evento, não há reembolso normal.</p></section>
          <section><h2 className="text-xl font-black text-white">Reserva e bilhetes</h2><p>Uma reserva reembolsada fica cancelada para embarque. Os QR Codes dos seus bilhetes são invalidados para ida e regresso.</p></section>
          <section><h2 className="text-xl font-black text-white">Alteração ou cancelamento pela FestGo</h2><p>Se a FestGo cancelar o transporte, a regra de 50% não é aplicada automaticamente; o caso recebe tratamento administrativo próprio. Se não conseguir confirmar o ponto de embarque escolhido, a FestGo oferece outro ponto ou reembolso integral ao passageiro afectado.</p></section>
        </> : <>
          <section><h2 className="text-xl font-black text-white">O que compras</h2><p>A FestGo vende transporte colectivo de ida e volta para eventos. O ingresso do evento não está incluído, salvo indicação expressa antes da compra.</p></section>
          <section><h2 className="text-xl font-black text-white">Pagamento e bilhetes</h2><p>A reserva só fica paga após confirmação segura do fornecedor de pagamentos. Cada passageiro recebe um bilhete individual com QR Code. A ida e o regresso são validados separadamente; um bilhete não pago, cancelado, reembolsado ou já utilizado nesse trajecto não permite embarque.</p></section>
          <section><h2 className="text-xl font-black text-white">Embarque e segurança</h2><p>O passageiro deve comparecer dentro do horário comunicado. Os horários e as instruções finais de embarque serão enviados por SMS e WhatsApp cerca de uma semana antes do evento. A FestGo pode impedir o embarque de passageiros que coloquem pessoas, o veículo ou a operação em risco.</p></section>
          <section><h2 className="text-xl font-black text-white">Cancelamentos e contacto</h2><p>Consulta a <Link href="/reembolsos" className="underline">Política de Cancelamento e Reembolso</Link>. Contacto oficial FestGo: <a href="https://wa.me/244932511161" className="underline">+244 932 511 161</a>.</p></section>
        </>}
      </div>
    </article>
  </main>;
}
