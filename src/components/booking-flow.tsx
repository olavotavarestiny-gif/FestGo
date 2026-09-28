"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BusFront, Check, Info, MapPin, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { event, formatKz } from "@/lib/data";
import { commercialPlans, pickupPreferences, type CommercialPlanCode, type PickupPreferenceCode } from "@/lib/pre-reservations";

type SeatStatus = { number: number; state: "unavailable" | "confirmed" };
type Lead = { reservationId: string; accessToken: string; reference: string };
type Completed = {
  reference: string;
  status: string;
  plan: CommercialPlanCode;
  quantity: number;
  total: number;
  pickupPreference: string;
  pickupOther?: string | null;
  seats: number[];
};

export function BookingFlow() {
  const [step, setStep] = useState(1);
  const [planCode, setPlanCode] = useState<CommercialPlanCode>("INDIVIDUAL");
  const [pickup, setPickup] = useState<PickupPreferenceCode>("CIDADE_PRIMEIRO_MAIO");
  const [pickupOther, setPickupOther] = useState("");
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [seatStatus, setSeatStatus] = useState<SeatStatus[]>([]);
  const [seatLoading, setSeatLoading] = useState(true);
  const [travelDuration, setTravelDuration] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [passengers, setPassengers] = useState([""]);
  const [dataConsent, setDataConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [referral, setReferral] = useState("");
  const [campaign, setCampaign] = useState<Record<string, string>>({});
  const [lead, setLead] = useState<Lead | null>(null);
  const leadRequest = useRef<Promise<Lead> | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [joinWaitlist, setJoinWaitlist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<Completed | null>(null);
  const plan = commercialPlans[planCode];
  const unavailable = useMemo(() => new Map(seatStatus.map((seat) => [seat.number, seat.state])), [seatStatus]);
  const availableCount = event.capacity - seatStatus.length;
  const responsibleValid =
    name.trim().length >= 4 &&
    /^(?:\+?244\s?)?9(?:[\s-]?\d){8}$/.test(phone.trim()) &&
    (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) &&
    (pickup !== "OUTRO" || pickupOther.trim().length >= 3);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setCampaign({
      campaignSource: query.get("source") ?? "",
      utmSource: query.get("utm_source") ?? "",
      utmMedium: query.get("utm_medium") ?? "",
      utmCampaign: query.get("utm_campaign") ?? "",
      utmContent: query.get("utm_content") ?? "",
      utmTerm: query.get("utm_term") ?? "",
    });
    void refreshSeats();
  }, []);

  useEffect(() => {
    setPassengers((current) => Array.from({ length: plan.quantity }, (_, index) => current[index] ?? ""));
    setSelectedSeats([]);
    setJoinWaitlist(false);
    setLead(null);
  }, [plan.quantity]);

  useEffect(() => {
    if (!dataConsent || !responsibleValid || lead || leadRequest.current) return;
    const timeout = window.setTimeout(() => {
      void ensureLead().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Não foi possível guardar o contacto.");
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [dataConsent, responsibleValid, lead]);

  async function refreshSeats() {
    setSeatLoading(true);
    try {
      const response = await fetch("/api/pre-reservations/seats", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar os lugares.");
      setSeatStatus(result.seats ?? []);
      setTravelDuration(result.travelDuration ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao consultar lugares.");
    } finally {
      setSeatLoading(false);
    }
  }

  function choosePlan(code: CommercialPlanCode) {
    setPlanCode(code);
    setStep(2);
    setError("");
  }

  function toggleSeat(number: number) {
    if (unavailable.has(number) || joinWaitlist) return;
    setSelectedSeats((current) =>
      current.includes(number)
        ? current.filter((seat) => seat !== number)
        : current.length < plan.quantity
          ? [...current, number].sort((a, b) => a - b)
          : current,
    );
  }

  const contactValid =
    responsibleValid &&
    passengers.every((passenger) => passenger.trim().length >= 3) &&
    dataConsent &&
    (joinWaitlist || selectedSeats.length === plan.quantity);

  async function ensureLead(forceUpdate = false): Promise<Lead> {
    if (lead && !forceUpdate) return lead;
    if (!leadRequest.current) {
      leadRequest.current = (async () => {
        const response = await fetch("/api/pre-reservations/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, phone, email, plan: planCode, pickupPreference: pickup,
            pickupOther, dataConsent, marketingConsent, idempotencyKey,
            referral,
            ...(lead
              ? { reservationId: lead.reservationId, accessToken: lead.accessToken }
              : {}),
            ...campaign,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.reference ? `${result.error} Referência: ${result.reference}.` : result.error ?? "Não foi possível guardar a inscrição.");
        setLead(result);
        return result as Lead;
      })().finally(() => {
        leadRequest.current = null;
      });
    }
    return leadRequest.current;
  }

  async function saveLeadAndReview() {
    if (!contactValid) return;
    setBusy(true);
    setError("");
    try {
      await ensureLead(true);
      setStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPreReservation() {
    if (!lead || !terms) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pre-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: lead.reservationId,
          accessToken: lead.accessToken,
          passengers,
          seats: joinWaitlist ? [] : selectedSeats,
          joinWaitlist,
          terms,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "SEATS_TAKEN") {
          await refreshSeats();
          setSelectedSeats((current) => current.filter((seat) => !(result.seats ?? []).includes(seat)));
          setStep(3);
        }
        throw new Error(result.error ?? "Não foi possível concluir a pré-reserva.");
      }
      setCompleted(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  if (completed)
    return (
      <main className="pre-success">
        <div className="pre-success-card">
          <span className="pre-success-icon"><Check /></span>
          <p className="eyebrow">{completed.reference}</p>
          <h1>Inscrição recebida! 💜</h1>
          <p>Obrigado por escolheres a FestGo! A tua inscrição para o Brunch Mangais foi registada com sucesso.</p>
          <p>A nossa equipa irá contactar-te através do número indicado para confirmar a disponibilidade, a tua reserva e os próximos passos para o pagamento.</p>
          <div className="pre-alert">A inscrição ainda não garante o lugar. A reserva só ficará confirmada após o pagamento validado e a confirmação operacional da viagem.</div>
          <dl className="pre-summary-list">
            <Summary label="Plano" value={commercialPlans[completed.plan].name} />
            <Summary label="Passageiros" value={String(completed.quantity)} />
            <Summary label="Recolha pretendida" value={completed.pickupOther || completed.pickupPreference} />
            <Summary label="Lugares pretendidos" value={completed.seats.length ? completed.seats.join(", ") : "Lista de espera"} />
          </dl>
          <p className="pre-signoff">Tu curtes, nós conduzimos. 🚌</p>
          <Link href="/" className="home-cta">Voltar ao início</Link>
        </div>
      </main>
    );

  return (
    <main className="pre-page">
      <header className="pre-header">
        <div className="pre-shell"><Link href="/"><Logo /></Link><Link href="/" className="pre-back"><ArrowLeft size={17} /> Voltar</Link></div>
      </header>
      <div className="pre-shell pre-layout">
        <section className="pre-main">
          <div className="pre-progress" aria-label={`Etapa ${step} de 4`}>
            {["Plano", "Recolha", "Lugar e dados", "Rever"].map((label, index) => (
              <div className={step >= index + 1 ? "is-active" : ""} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><small>{label}</small></div>
            ))}
          </div>

          {step === 1 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 1 de 4</p><h1>Escolhe o teu plano.</h1>
              <p className="pre-intro">Todos os planos incluem transporte de ida e volta. O ingresso do Brunch Mangais não está incluído.</p>
              <div className="plan-grid">
                {(["INDIVIDUAL", "DUO", "GROUP"] as CommercialPlanCode[]).map((code) => {
                  const item = commercialPlans[code];
                  return <button className="plan-card" onClick={() => choosePlan(code)} key={code}><span>{item.name}</span><strong>{formatKz(item.total)}</strong><small>{item.description} · ida e volta</small>{item.total < item.listTotal && <em>Poupas {formatKz(item.listTotal - item.total)}</em>}<ArrowRight size={18} /></button>;
                })}
              </div>
              <button className="combo-option" onClick={() => choosePlan("DUO_INDIVIDUAL")}><span><b>Viajam 3 pessoas?</b><small>Combina Dupla + Individual, sem um plano artificial.</small></span><strong>{formatKz(commercialPlans.DUO_INDIVIDUAL.total)}</strong><ArrowRight size={17} /></button>
            </div>
          )}

          {step === 2 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 2 de 4</p><h1>Onde preferes embarcar?</h1>
              <p className="pre-intro">Esta escolha ajuda-nos a optimizar a rota. O ponto final pode ser ajustado pela FestGo e será comunicado antes da viagem.</p>
              <div className="pickup-options">
                {pickupPreferences.map((option) => <label className={pickup === option.code ? "is-selected" : ""} key={option.code}><input type="radio" name="pickup" checked={pickup === option.code} onChange={() => setPickup(option.code)} /><MapPin size={18} /><span>{option.label}</span><Check size={16} /></label>)}
              </div>
              {pickup === "OUTRO" && <label className="pre-field-label">Localização pretendida<input className="pre-field" maxLength={160} value={pickupOther} onChange={(e) => setPickupOther(e.target.value)} placeholder="Ex.: Kilamba, junto ao edifício..." /></label>}
              <Navigation back={() => setStep(1)} next={() => setStep(3)} nextDisabled={pickup === "OUTRO" && pickupOther.trim().length < 3} />
            </div>
          )}

          {step === 3 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 3 de 4</p><h1>Escolhe os lugares.</h1>
              <p className="pre-intro">São preferências, não lugares garantidos. Precisamos de {plan.quantity}{plan.quantity === 1 ? " lugar" : " lugares"} para o plano {plan.name}.</p>
              <div className="seat-legend"><span><i /> Disponível</span><span><i className="selected" /> Seleccionado</span><span><i className="unavailable" /> Indisponível</span><span><i className="confirmed" /> Confirmado</span></div>
              <div className="bus-map">
                <div className="bus-front"><BusFront size={20} /><span>Frente</span></div>
                <div className="seat-grid">
                  {Array.from({ length: event.capacity }, (_, index) => index + 1).map((number) => {
                    const state = unavailable.get(number); const selected = selectedSeats.includes(number);
                    return <button type="button" aria-label={`Lugar ${number}${selected ? ", seleccionado" : state ? `, ${state === "confirmed" ? "confirmado" : "indisponível"}` : ""}`} aria-pressed={selected} disabled={Boolean(state) || joinWaitlist || seatLoading} className={`seat ${selected ? "selected" : ""} ${state ?? ""}`} onClick={() => toggleSeat(number)} key={number}>{number}</button>;
                  })}
                </div>
              </div>
              {availableCount < plan.quantity && <label className="waitlist-option"><input type="checkbox" checked={joinWaitlist} onChange={(e) => { setJoinWaitlist(e.target.checked); setSelectedSeats([]); }} /><span><b>Entrar na lista de espera</b><small>A equipa contacta-te caso surjam lugares.</small></span></label>}
              <div className="contact-block">
                <h2>Dados do responsável</h2>
                <div className="contact-grid">
                  <label className="pre-field-label">Nome completo<input className="pre-field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
                  <label className="pre-field-label">Telefone<input className="pre-field" inputMode="tel" autoComplete="tel" placeholder="+244 923 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                  <label className="pre-field-label full">E-mail <small>(opcional)</small><input type="email" className="pre-field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                </div>
                <h2>Passageiros</h2>
                <div className="passenger-fields">{passengers.map((passenger, index) => <label className="pre-field-label" key={index}>Passageiro {index + 1}<input className="pre-field" value={passenger} onChange={(e) => setPassengers((current) => current.map((value, position) => position === index ? e.target.value : value))} /></label>)}</div>
                <label className="pre-field-label">Código de recomendação <small>(opcional)</small><input className="pre-field" maxLength={80} value={referral} onChange={(e) => setReferral(e.target.value)} /></label>
                <label className="check-row"><input type="checkbox" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} /><span>Aceito o registo destes dados para gerir a minha inscrição e o contacto operacional.</span></label>
                <label className="check-row"><input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} /><span>Quero receber novidades e campanhas FestGo. <em>(opcional)</em></span></label>
              </div>
              {error && <p role="alert" className="pre-error">{error}</p>}
              <div className="pre-navigation"><button className="pre-link-button" onClick={() => setStep(2)}><ArrowLeft size={16} /> Voltar</button><button className="home-cta" disabled={!contactValid || busy} onClick={saveLeadAndReview}>{busy ? "A guardar…" : "Rever inscrição"} {!busy && <ArrowRight size={17} />}</button></div>
            </div>
          )}

          {step === 4 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 4 de 4</p><h1>Revê a pré-reserva.</h1>
              <dl className="pre-summary-list review">
                <Summary label="Plano" value={`${plan.name} · ${plan.description}`} />
                <Summary label="Total indicativo" value={formatKz(plan.total)} />
                {plan.total < plan.listTotal && <Summary label="Desconto do plano" value={`− ${formatKz(plan.listTotal - plan.total)}`} />}
                <Summary label="Recolha pretendida" value={pickup === "OUTRO" ? pickupOther : pickupPreferences.find((item) => item.code === pickup)?.label ?? ""} />
                <Summary label="Lugares pretendidos" value={joinWaitlist ? "Lista de espera" : selectedSeats.join(", ")} />
                <Summary label="Responsável" value={`${name} · ${phone}`} />
                <Summary label="Passageiros" value={passengers.join(", ")} />
              </dl>
              <div className="pre-alert"><Info size={18} /><span>Pré-reserva sem pagamento. O preço inclui ida e volta, mas não inclui o ingresso do evento. A rota, os horários e os lugares só serão confirmados após pagamento validado e confirmação operacional.</span></div>
              <label className="check-row"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>Li e aceito as condições de pré-reserva e a política de privacidade.</span></label>
              {error && <p role="alert" className="pre-error">{error}</p>}
              <div className="pre-navigation"><button className="pre-link-button" onClick={() => setStep(3)}><ArrowLeft size={16} /> Alterar</button><button className="home-cta" disabled={!terms || busy} onClick={confirmPreReservation}>{busy ? "A confirmar…" : "Confirmar pré-reserva"} {!busy && <Check size={17} />}</button></div>
            </div>
          )}
        </section>
        <aside className="pre-aside">
          <span className="pre-aside-icon"><Users size={20} /></span><small>O teu plano</small><h2>{plan.name}</h2><strong>{formatKz(plan.total)}</strong><p>{plan.description} · ida e volta</p><hr /><p><b>Brunch Mangais</b><br />1 de Novembro de 2026 · 10h–20h</p><p>Duração da viagem: {travelDuration ?? "a confirmar"}</p><p className="pre-aside-note">A pré-reserva não garante o lugar nem a realização da rota pretendida.</p>
        </aside>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Navigation({ back, next, nextDisabled }: { back: () => void; next: () => void; nextDisabled?: boolean }) {
  return <div className="pre-navigation"><button className="pre-link-button" onClick={back}><ArrowLeft size={16} /> Voltar</button><button className="home-cta" disabled={nextDisabled} onClick={next}>Continuar <ArrowRight size={17} /></button></div>;
}
