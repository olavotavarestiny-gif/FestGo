import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight, ArrowRight, Baby, BatteryCharging, BusFront,
  CalendarDays, CheckCircle2, ChevronDown, Clock3, CupSoda, Heart,
  MapPin, Music2, QrCode, Route, ShieldCheck, Sparkles, UserRoundCheck,
} from "lucide-react";
import { CampaignLink, ExperienceAnalytics } from "@/components/experience-actions";
import { Logo } from "@/components/logo";
import { event, formatKz } from "@/lib/data";

const services: Array<{ name: string; tagline: string; description: string; benefit: string; status: "included" | "preparing"; icon: LucideIcon }> = [
  { name: "FestGo Welcome", tagline: "Um começo especial.", description: "Água, sumo e aperitivos de boas-vindas assim que embarcares.", benefit: "Começa o dia já no ambiente certo.", status: "included", icon: CupSoda },
  { name: "FestGo Power", tagline: "Aproveita. Nós tratamos da bateria.", description: "Carregamento e guarda controlada do telemóvel, com registo e comprovativo.", benefit: "Mais bateria para aproveitares o evento.", status: "preparing", icon: BatteryCharging },
  { name: "FestGo Playlist", tagline: "A tua música faz parte da viagem.", description: "Sugere uma música na pré-reserva e ajuda-nos a criar o ambiente a bordo.", benefit: "Uma playlist feita com os passageiros.", status: "included", icon: Music2 },
  { name: "FestGo Quiz", tagline: "Uma viagem cheia de surpresas.", description: "Jogos, perguntas e pequenos desafios conduzidos pelo anfitrião FestGo.", benefit: "Diversão e brindes durante o caminho.", status: "included", icon: Sparkles },
  { name: "FestGo Care", tagline: "Pensámos nos pequenos detalhes.", description: "Papel higiénico, toalhitas e guardanapos disponíveis durante a experiência.", benefit: "Conforto quando mais precisas.", status: "included", icon: Heart },
  { name: "FestGo Kids", tagline: "Os pequenos também fazem parte.", description: "Desenhos, jogos de memória, histórias e actividades criativas durante a viagem.", benefit: "Um caminho mais divertido para as crianças.", status: "included", icon: Baby },
];

const steps = [
  ["01", "Escolhe a tua zona", "Indica onde preferes embarcar e a zona aproximada de regresso."],
  ["02", "Faz a pré-reserva", "Regista os passageiros, o plano e os lugares pretendidos."],
  ["03", "Começa a experiência", "Embarca, recebe o Welcome Drink e entra no ambiente FestGo."],
  ["04", "Aproveita o brunch", "Desfruta do evento e dos serviços confirmados para esta edição."],
  ["05", "Regressa com tranquilidade", "No final, tratamos do regresso dentro das zonas previamente confirmadas."],
];

const questions = [
  ["O que está incluído nos 25.000 Kz?", "Ida e volta, Welcome Drink, actividades a bordo, FestGo Playlist, Quiz, Care e acompanhamento da equipa, conforme confirmação operacional."],
  ["O ingresso do Brunch Mangais está incluído?", "Não. O ingresso do evento é adquirido separadamente."],
  ["Como funciona o FestGo Power?", "Está em preparação operacional. Quando confirmado, terá registo do equipamento, comprovativo e verificação na devolução, sem garantia absoluta contra perdas ou danos."],
  ["Posso sugerir músicas?", "Sim. Existe um campo opcional na pré-reserva para indicares o artista e a música."],
  ["Que entretenimento haverá?", "Playlist colaborativa, quiz, jogos, desafios e pequenos brindes, sujeitos à programação final."],
  ["Que actividades existem para crianças?", "Durante a viagem teremos actividades adequadas às idades, como desenhos, jogos de memória, histórias e desafios criativos."],
  ["O Kids Club estará disponível no evento?", "Ainda não está activo. Só será anunciado após autorização, espaço adequado, equipa e procedimentos de segurança confirmados."],
  ["A FestGo vai buscar-me e deixar-me em casa?", "Podes indicar preferências de embarque e regresso. As zonas e os pontos finais serão organizados e confirmados antes da viagem; não prometemos cobertura de qualquer morada."],
  ["Posso reservar para um grupo?", "Sim. Podes registar vários passageiros e o sistema aplica a combinação disponível mais económica."],
  ["Como funcionam pré-reserva e pagamento?", "Primeiro registamos o teu interesse sem cobrança. A equipa confirma a operação e envia os próximos passos; o lugar só fica garantido após pagamento validado."],
  ["Quais são as condições de cancelamento?", "As condições aplicáveis estarão disponíveis antes do pagamento e podem ser consultadas na página de cancelamentos."],
  ["Como contacto a equipa?", "Após a inscrição, a equipa usa o contacto indicado para o acompanhamento operacional da reserva."],
];

export default function Home() {
  return (
    <main className="festgo-home experience-home">
      <ExperienceAnalytics />
      <header className="home-header"><div className="home-shell experience-nav">
        <Link href="#inicio" aria-label="FestGo — início"><Logo /></Link>
        <nav aria-label="Navegação principal"><Link href="#experiencia">Experiência</Link><Link href="#servicos">Serviços</Link><Link href="#rotas">Rotas</Link><Link href="#faq">FAQ</Link></nav>
        <CampaignLink className="home-cta home-cta-small" eventName="header_pre_reservation_click">Pré-reservar <ArrowRight size={16} /></CampaignLink>
      </div></header>

      <section id="inicio" className="experience-hero"><div className="home-shell experience-hero-grid">
        <div className="experience-hero-copy">
          <p className="experience-label">FestGo Experience · Brunch Mangais · 01 Novembro</p>
          <h1>O brunch começa <em>antes de chegares.</em></h1>
          <p className="experience-lead">Muito mais do que uma viagem. Conforto, aperitivos, música, entretenimento e regresso organizado para aproveitares o dia do princípio ao fim.</p>
          <div className="experience-price"><strong>{formatKz(event.price)}</strong><span>/ pessoa</span></div>
          <p className="experience-includes">Ida e volta <i /> Welcome Drink <i /> FestGo Power* <i /> Entretenimento <i /> Regresso organizado</p>
          <div className="hero-actions"><CampaignLink className="home-cta" eventName="hero_pre_reservation_click">Quero viver esta experiência <ArrowRight size={18} /></CampaignLink><Link href="#servicos" className="text-link">Descobrir o que está incluído <ArrowDownRight size={18} /></Link></div>
          <p className="hero-note">Pré-reserva sem pagamento. O ingresso do Brunch Mangais não está incluído. Serviços e zonas sujeitos a confirmação operacional.</p>
        </div>
        <div className="experience-visual" aria-label="Percurso FestGo entre Luanda e o Brunch Mangais">
          <div className="visual-top"><span>Luanda</span><span>01 · 11 · 2026</span><span>Mangais</span></div><BusRouteArtwork />
          <div className="visual-card visual-card-primary"><CupSoda size={19} /><span><small>Ao embarcar</small>Welcome Drink</span></div>
          <div className="visual-card visual-card-secondary"><Music2 size={19} /><span><small>Durante o caminho</small>Playlist + Quiz</span></div>
          <p>Tu curtes, nós conduzimos.</p>
        </div>
      </div></section>

      <section id="experiencia" className="experience-story"><div className="home-shell story-grid">
        <div><p className="section-kicker">A experiência</p><h2>Não é apenas o destino. <span>É tudo o que acontece pelo caminho.</span></h2></div>
        <div className="story-copy"><p>Imagina começares o dia sem te preocupares com a condução, o estacionamento ou o regresso.</p><p>Entras no autocarro, recebes o teu aperitivo, escolhes o teu lugar e começas a aproveitar a música e o ambiente. Quando o brunch terminar, nós tratamos do caminho de volta.</p><blockquote>Um dia especial merece começar e terminar de forma especial.</blockquote></div>
      </div><div className="home-shell experience-facts">
        <div><CalendarDays /><span><small>Quando</small>1 de Novembro de 2026</span></div><div><Clock3 /><span><small>Evento</small>10h00 às 20h00</span></div><div><BusFront /><span><small>Experiência</small>Ida, bordo e regresso</span></div><div><MapPin /><span><small>Destino</small>Mangais Golf Resort</span></div>
      </div></section>

      <section id="servicos" className="services-section"><div className="home-shell">
        <div className="section-heading"><div><p className="section-kicker">Descobre os nossos serviços</p><h2>O caminho também merece ser memorável.</h2></div><p>Seis detalhes que transformam transporte em experiência — com comunicação clara sobre o que está incluído e o que ainda está em preparação.</p></div>
        <div className="service-grid">{services.map(({ icon: Icon, ...service }, index) => <article className={`service-card ${service.status === "preparing" ? "is-preparing" : ""}`} key={service.name}><div className="service-art"><span>0{index + 1}</span><Icon aria-hidden="true" /></div><div className="service-status"><i />{service.status === "included" ? "Incluído na experiência" : "Sujeito a confirmação"}</div><h3>{service.name}</h3><strong>{service.tagline}</strong><p>{service.description}</p><small>{service.benefit}</small></article>)}</div>
      </div></section>

      <section className="kids-section"><div className="home-shell kids-grid">
        <div className="kids-copy"><p className="section-kicker">FestGo Kids</p><h2>A diversão dos pequenos também começa no caminho.</h2><p>Uma experiência pensada para que as crianças se divirtam e os pais aproveitem o dia com maior tranquilidade.</p><div className="kids-tags"><span>Desenhos</span><span>Lápis de cor</span><span>Memória</span><span>Histórias</span><span>Desafios</span></div></div>
        <aside className="kids-club"><Baby size={28} /><span>Kids Club · Durante o evento</span><h3>Em preparação</h3><p>Esta opção permanece inactiva até confirmação da organização, espaço, climatização, equipa de supervisão e procedimentos de segurança.</p></aside>
      </div></section>

      <section className="trust-section"><div className="home-shell trust-grid">
        <div><p className="section-kicker">Segurança e tranquilidade</p><h2>A tua tranquilidade também faz parte da experiência.</h2><p>Organização, acompanhamento e controlo em cada etapa, sem promessas que ultrapassem as condições confirmadas.</p></div>
        <div className="trust-list">{[[QrCode,"Bilhetes individuais com QR Code"],[UserRoundCheck,"Controlo de embarque e regresso"],[BusFront,"Motorista profissional e autocarro segurado"],[ShieldCheck,"Equipa FestGo e procedimentos operacionais"],[BatteryCharging,"Registo de equipamentos no FestGo Power"]].map(([Icon,label]) => { const TrustIcon = Icon as LucideIcon; return <div key={label as string}><TrustIcon /><span>{label as string}</span><CheckCircle2 /></div>; })}</div>
      </div></section>

      <section id="como-funciona" className="journey-section"><div className="home-shell"><div className="section-heading"><div><p className="section-kicker">Como funciona</p><h2>Da partida ao regresso. Nós tratamos do caminho.</h2></div></div><div className="journey-steps">{steps.map(([number,title,copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>

      <section id="rotas" className="routes-section"><div className="home-shell routes-grid">
        <div><p className="section-kicker">Rotas e recolhas</p><h2>O caminho começa perto de ti.</h2><p>Escolhe a tua zona de embarque e indica onde gostarias de regressar. A equipa organizará as rotas e confirmará os detalhes antes da viagem.</p><p className="route-warning"><Route size={17} /> Preferências, não rotas ou moradas garantidas.</p></div>
        <div className="route-options">{event.pickupPoints.map((point,index) => <article key={point.name}><span>0{index+1}</span><div><h3>{point.name}</h3><p>{point.detail}</p></div><MapPin /></article>)}</div>
      </div></section>

      <section id="reservar" className="conversion-section"><div className="home-shell conversion-card">
        <div><p className="section-kicker">O teu lugar nesta experiência começa aqui</p><h2>A tua próxima grande experiência começa aqui.</h2><p>Junta os teus amigos, prepara o teu melhor outfit e deixa o caminho connosco.</p></div>
        <div className="conversion-action"><span>Desde</span><strong>{formatKz(event.price)} <small>/ pessoa</small></strong><CampaignLink className="home-cta" eventName="final_pre_reservation_click">Quero pré-reservar <ArrowRight size={18} /></CampaignLink><small>Sem cobrança agora · sujeito a confirmação</small></div>
      </div></section>

      <section id="faq" className="experience-faq"><div className="home-shell faq-grid"><div><p className="section-kicker">Perguntas frequentes</p><h2>Antes de embarcares.</h2><p>Informação directa sobre a experiência, os serviços e a pré-reserva.</p></div><div className="faq-list">{questions.map(([question,answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></div></section>

      <footer className="home-footer"><div className="home-shell footer-inner"><Link href="#inicio"><Logo /></Link><div className="footer-links"><Link href="/termos">Termos</Link><Link href="/privacidade">Privacidade</Link><Link href="/cancelamentos">Cancelamentos</Link></div><span>© 2026 FestGo Angola</span></div></footer>
    </main>
  );
}

function BusRouteArtwork() {
  return <svg className="experience-bus-svg" viewBox="0 0 760 310" aria-hidden="true"><path className="experience-road" d="M-20 254 C136 194 239 302 389 229 S614 168 790 210"/><path className="experience-road-mark" d="M-20 254 C136 194 239 302 389 229 S614 168 790 210"/><g className="experience-bus"><rect x="-104" y="144" width="155" height="68" rx="22" fill="#17151d"/><path d="M-83 154h48v34h-58v-18c0-8 4-14 10-16Zm55 0h47c8 0 13 5 13 13v21h-60Z" fill="#d9c2f7"/><path d="M-93 193h124v7H-93z" fill="#8a2be2"/><circle cx="-67" cy="211" r="14" fill="#fff"/><circle cx="-67" cy="211" r="6" fill="#8a2be2"/><circle cx="22" cy="211" r="14" fill="#fff"/><circle cx="22" cy="211" r="6" fill="#8a2be2"/></g><circle cx="641" cy="91" r="7" fill="#8a2be2"/><circle cx="665" cy="91" r="3" fill="#c8a5f0"/></svg>;
}
