import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

const content: Record<string, {title:string; intro:string}> = {
  termos: { title: "Termos de compra", intro: "Condições aplicáveis à reserva do serviço de transporte FestGo." },
  privacidade: { title: "Política de privacidade", intro: "Como recolhemos, utilizamos e protegemos os teus dados pessoais." },
  cancelamentos: { title: "Política de cancelamentos", intro: "Regras de alteração, cancelamento e reembolso de reservas." },
};

export default async function LegalPage({params}:{params:Promise<{legal:string}>}) { const {legal}=await params; const page=content[legal]??content.termos; return <main className="min-h-screen bg-[#0c0a12]"><header className="border-b border-white/10"><div className="shell flex h-20 items-center justify-between"><Logo/><Link href="/" className="flex items-center gap-2 text-sm text-white/50"><ArrowLeft size={16}/> Voltar</Link></div></header><article className="shell max-w-3xl py-20"><p className="eyebrow">Informação legal</p><h1 className="mt-4 text-5xl font-black tracking-tight">{page.title}</h1><p className="mt-5 text-lg text-white/50">{page.intro}</p><div className="mt-12 space-y-8 leading-8 text-white/60"><section><h2 className="text-xl font-black text-white">Versão provisória</h2><p className="mt-2">Este conteúdo será revisto com assessoria jurídica antes da abertura oficial das vendas. A FestGo presta um serviço de transporte colectivo de ida e regresso e não inclui o ingresso do evento, salvo indicação expressa.</p></section><section><h2 className="text-xl font-black text-white">Reservas e pagamentos</h2><p className="mt-2">Uma reserva só é considerada confirmada após a validação fiável do pagamento. Pedidos pendentes podem expirar e libertar os lugares temporariamente reservados.</p></section><section><h2 className="text-xl font-black text-white">Contacto</h2><p className="mt-2">Para questões sobre estes termos, contacta a equipa FestGo através dos canais oficiais indicados no site.</p></section></div></article></main> }
