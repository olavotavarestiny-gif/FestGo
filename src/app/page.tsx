import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  BusFront,
  CalendarDays,
  ChevronDown,
  Clock3,
  MapPin,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { event, formatKz } from "@/lib/data";

const questions = [
  [
    "O ingresso do brunch está incluído?",
    "Não. A reserva FestGO cobre apenas o transporte de ida e regresso. O ingresso do Brunch Mangais é comprado à parte.",
  ],
  [
    "Posso reservar para outras pessoas?",
    "Sim. Podes reservar até seis lugares. Cada passageiro recebe o seu próprio bilhete digital.",
  ],
  [
    "Como recebo o bilhete?",
    "Depois da confirmação do pagamento, o bilhete fica disponível digitalmente com os detalhes de embarque.",
  ],
];

export default function Home() {
  return (
    <main className="festgo-home">
      <header className="home-header">
        <div className="home-shell flex h-[72px] items-center justify-between">
          <Link href="#inicio" aria-label="FestGO — início">
            <Logo />
          </Link>
          <nav
            aria-label="Navegação principal"
            className="hidden items-center gap-8 text-sm font-bold text-[#5a5663] sm:flex"
          >
            <Link href="#brunch">O brunch</Link>
            <Link href="#pontos">Pontos de recolha</Link>
            <Link href="#viagem">A viagem</Link>
          </nav>
          <Link href="/reservar" className="home-cta home-cta-small">
            Reservar lugar <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <section id="inicio" className="home-hero home-shell">
        <div className="hero-copy">
          <span className="edition-label">
            <span /> Brunch Mangais · 01 Novembro · 10h–20h
          </span>
          <h1>
            FestGO <span>—</span>
            <br className="sm:hidden" /> Brunch Mangais
          </h1>
          <p className="hero-slogan">
            Tu curtes, <span>nós conduzimos.</span>
          </p>
          <div className="hero-actions">
            <Link href="/reservar" className="home-cta">
              Reservar o meu lugar <ArrowRight size={18} />
            </Link>
            <Link href="#brunch" className="text-link">
              Conhecer a viagem <ArrowDownRight size={18} />
            </Link>
          </div>
          <p className="hero-note">
            Transporte de ida e volta. O ingresso do brunch é adquirido à parte.
          </p>
        </div>
        <div
          className="hero-journey"
          aria-label="Ilustração animada de um autocarro FestGO numa estrada"
        >
          <div className="journey-heading">
            <span>Luanda</span>
            <span className="journey-line" />
            <span>Mangais</span>
          </div>
          <BusRouteArtwork />
          <div className="journey-caption">
            <span>Uma viagem tranquila até ao teu próximo grande dia.</span>
            <span className="journey-distance">FESTGO · 2026</span>
          </div>
        </div>
        <Link
          href="#brunch"
          className="hero-scroll"
          aria-label="Descer para informações"
        >
          <span>Explorar</span>
          <ChevronDown size={16} />
        </Link>
      </section>

      <section id="brunch" className="info-section">
        <div className="home-shell info-grid">
          <div className="section-intro">
            <p className="section-kicker">01 / A experiência</p>
            <h2>
              Um bom brunch.
              <br />
              <span>Uma viagem sem pressa.</span>
            </h2>
            <p>
              Desfruta do Brunch Mangais. A FestGO trata do caminho para
              aproveitares o dia do primeiro encontro até à viagem de regresso.
            </p>
          </div>
          <div className="event-facts">
            <div className="fact-price">
              <span>Transporte por pessoa</span>
              <strong>{formatKz(event.price)}</strong>
              <small>Ida e regresso incluídos</small>
              <Link
                href="/reservar"
                className="price-arrow"
                aria-label="Reservar por 25 mil kwanzas"
              >
                <ArrowRight size={20} />
              </Link>
            </div>
            <div className="fact-row">
              <span className="fact-icon">
                <CalendarDays size={19} />
              </span>
              <div>
                <small>Data do brunch</small>
                <strong>{event.date}</strong>
              </div>
            </div>
            <div className="fact-row">
              <span className="fact-icon">
                <Clock3 size={19} />
              </span>
              <div>
                <small>Horário do brunch</small>
                <strong>{event.hours}</strong>
              </div>
            </div>
            <div className="fact-row">
              <span className="fact-icon">
                <MapPin size={19} />
              </span>
              <div>
                <small>Destino</small>
                <strong>{event.location}</strong>
              </div>
            </div>
            <p className="ticket-note">
              A reserva FestGO é exclusivamente para transporte. A entrada no
              evento não está incluída.
            </p>
          </div>
        </div>
      </section>

      <section id="pontos" className="pickup-section">
        <div className="home-shell">
          <div className="pickup-heading">
            <div>
              <p className="section-kicker">02 / A rota</p>
              <h2>
                Escolhe onde
                <br className="sm:hidden" /> embarcar.
              </h2>
            </div>
            <p>
              Três pontos de recolha em Luanda.
              <br />
              Um destino: Mangais.
            </p>
          </div>
          <div className="pickup-list">
            {event.pickupPoints.map((point, index) => (
              <article className="pickup-stop" key={point.name}>
                <span className="stop-number">0{index + 1}</span>
                <div className="stop-name">
                  <h3>{point.name}</h3>
                  <p>{point.detail}</p>
                </div>
                <div className="stop-time">
                  <Clock3 size={16} />
                  <span>{point.time}</span>
                </div>
                <MapPin className="stop-pin" size={18} />
              </article>
            ))}
          </div>
          <p className="route-footnote">
            A hora e o local exactos serão confirmados no teu bilhete digital.
          </p>
        </div>
      </section>

      <section id="viagem" className="how-section">
        <div className="home-shell">
          <div className="how-heading">
            <p className="section-kicker">03 / Sem complicações</p>
            <h2>
              A festa começa
              <br />
              no caminho.
            </h2>
            <p>Três passos simples para aproveitares do início ao fim.</p>
          </div>
          <div className="how-steps">
            {[
              [
                "01",
                "Reserva",
                "Escolhe o ponto de recolha e indica quem vai contigo.",
              ],
              [
                "02",
                "Confirma",
                "Verifica o teu número e escolhe o método de pagamento.",
              ],
              [
                "03",
                "Embarca",
                "Apresenta o bilhete digital. Tratamos da ida e do regresso.",
              ],
            ].map(([number, title, description]) => (
              <article className="how-step" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="reservar" className="booking-section">
        <div className="home-shell booking-grid">
          <div className="booking-invite">
            <p className="section-kicker">04 / O teu lugar</p>
            <h2>
              Vamos
              <br />
              nessa?
            </h2>
            <p>
              Reserva em poucos minutos. Recebes um bilhete individual para cada
              passageiro.
            </p>
            <Link href="/reservar" className="home-cta">
              Iniciar reserva <ArrowRight size={18} />
            </Link>
            <div className="booking-assurance">
              <BusFront size={18} />
              <span>Ida e volta · Bilhete digital · Apoio FestGO</span>
            </div>
          </div>
          <div className="faq-list">
            <p className="section-kicker">Dúvidas essenciais</p>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
            <p className="faq-contact">
              O canal oficial de apoio será publicado antes da abertura das
              vendas.
            </p>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-shell footer-inner">
          <Link href="#inicio">
            <Logo />
          </Link>
          <div className="footer-links">
            <Link href="/termos">Termos</Link>
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/cancelamentos">Cancelamentos</Link>
          </div>
          <span>© 2026 FestGO Angola</span>
        </div>
      </footer>
    </main>
  );
}

function BusRouteArtwork() {
  return (
    <svg
      className="bus-route-svg"
      viewBox="0 0 1000 245"
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        className="road-edge"
        d="M-25 186 C190 144 270 218 464 171 S765 110 1025 148"
      />
      <path
        className="road-center"
        d="M-25 186 C190 144 270 218 464 171 S765 110 1025 148"
      />
      <path
        className="route-glint"
        d="M-25 135 C190 93 270 167 464 120 S765 59 1025 97"
      />
      <g className="bus-motion">
        <g transform="translate(0 0)">
          <path
            d="M-104 119h130a16 16 0 0 1 16 16v53h-12a22 22 0 0 1-44 0h-52a22 22 0 0 1-44 0h-10v-46a23 23 0 0 1 16-23Z"
            fill="#17151d"
          />
          <path
            d="M-84 128h42v31h-53v-15a16 16 0 0 1 11-16Zm49 0h38a7 7 0 0 1 7 7v24h-45Z"
            fill="#d9c2f7"
          />
          <path d="M-95 165h98v6h-98z" fill="#8a2be2" />
          <circle cx="-72" cy="188" r="12" fill="#fff" />
          <circle cx="-72" cy="188" r="5" fill="#8a2be2" />
          <circle cx="19" cy="188" r="12" fill="#fff" />
          <circle cx="19" cy="188" r="5" fill="#8a2be2" />
          <path
            d="M-20 172h45"
            stroke="#8a2be2"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      </g>
      <circle cx="830" cy="58" r="5" fill="#8a2be2" />
      <circle cx="850" cy="58" r="2" fill="#c8a5f0" />
    </svg>
  );
}
