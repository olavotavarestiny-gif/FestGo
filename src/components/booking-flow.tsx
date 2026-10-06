"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BusFront, Check, Info, LoaderCircle, MapPin, MessageCircle, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { event, formatKz } from "@/lib/data";
import type { PublicEvent } from "@/lib/public-event";
import { checkoutUrl, forgetCheckout, readCheckout, rememberCheckout, type CheckoutAccess } from "@/lib/checkout-session";
import { trackClarityEvent } from "@/lib/clarity";
import { buildWhatsAppReservationUrl } from "@/lib/whatsapp";
import {
  ageOnDate,
  calculateTicketPricing,
  defaultTicketPrices,
  pickupPreferences,
  pricingLabel,
  type PickupPreferenceCode,
  type TicketPrices,
} from "@/lib/pre-reservations";

type SeatStatus = { number: number; state: "unavailable" | "confirmed" };
type Lead = { reservationId: string; accessToken: string; reference: string };
type PassengerInput = { fullName: string; birthDate: string };
type Completed = {
  reference: string;
  status: string;
  plan: string | null;
  quantity: number;
  total: number;
  pickupPreference: string;
  pickupOther?: string | null;
  seats: number[];
};

export function PreReservationFlow() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [prices, setPrices] = useState<TicketPrices>(defaultTicketPrices);
  const [eventDate, setEventDate] = useState("2026-11-01");
  const [minorAgeLimit, setMinorAgeLimit] = useState(18);
  const [pickup, setPickup] = useState<PickupPreferenceCode>("CIDADE_PRIMEIRO_MAIO");
  const [pickupOther, setPickupOther] = useState("");
  const [returnArea, setReturnArea] = useState("");
  const [playlistSuggestion, setPlaylistSuggestion] = useState("");
  const [kidsInterest, setKidsInterest] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [seatStatus, setSeatStatus] = useState<SeatStatus[]>([]);
  const [seatLoading, setSeatLoading] = useState(true);
  const [travelDuration, setTravelDuration] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [passengers, setPassengers] = useState<PassengerInput[]>([
    { fullName: "", birthDate: "" },
  ]);
  const [minorGuardianName, setMinorGuardianName] = useState("");
  const [minorGuardianPhone, setMinorGuardianPhone] = useState("");
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
  const completionTracked = useRef(false);
  const pickupTracked = useRef(false);
  const passengerDataStartedTracked = useRef(false);
  const passengerDataCompletedTracked = useRef(false);
  const pricing = useMemo(
    () => calculateTicketPricing(quantity, prices),
    [quantity, prices],
  );
  const unavailable = useMemo(() => new Map(seatStatus.map((seat) => [seat.number, seat.state])), [seatStatus]);
  const availableCount = event.capacity - seatStatus.length;
  function whatsappUrlFor(completion: Completed) {
    return buildWhatsAppReservationUrl({
        reference: completion.reference,
        eventName: "Brunch Mangais",
        responsibleName: name,
        phone,
        email,
        quantity: completion.quantity,
        total: formatKz(completion.total),
        pickup: completion.pickupOther || pickupPreferences.find((item) => item.code === completion.pickupPreference)?.label || completion.pickupPreference,
        returnArea,
        seats: completion.seats.length ? completion.seats.join(", ") : "Lista de espera",
        passengers,
        guardianName: minorGuardianName,
        guardianPhone: minorGuardianPhone,
        playlistSuggestion,
        kidsInterest,
      });
  }
  const whatsappUrl = completed ? whatsappUrlFor(completed) : "";
  const responsibleValid =
    name.trim().length >= 4 &&
    /^(?:\+?244\s?)?9(?:[\s-]?\d){8}$/.test(phone.trim()) &&
    (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) &&
    (pickup !== "OUTRO" || pickupOther.trim().length >= 3);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("festgo:analytics", { detail: { name: "pre_reservation_started" } }));
    const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, string>> };
    analyticsWindow.dataLayer?.push({ event: "pre_reservation_started" });
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
    if (!completed || completionTracked.current) return;
    completionTracked.current = true;
    window.dispatchEvent(new CustomEvent("festgo:analytics", { detail: { name: "pre_reservation_completed", reference: completed.reference } }));
    const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, string>> };
    analyticsWindow.dataLayer?.push({ event: "pre_reservation_completed", reference: completed.reference });
  }, [completed]);

  useEffect(() => {
    setPassengers((current) => Array.from(
      { length: quantity },
      (_, index) => current[index] ?? { fullName: "", birthDate: "" },
    ));
    setSelectedSeats((current) => current.slice(0, quantity));
    setJoinWaitlist(false);
    setLead(null);
  }, [quantity]);

  useEffect(() => {
    if (!dataConsent || !responsibleValid || lead || leadRequest.current) return;
    const timeout = window.setTimeout(() => {
      void ensureLead().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Não foi possível guardar o contacto.");
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureLead reads the latest form state after the debounce.
  }, [dataConsent, responsibleValid, lead]);

  async function refreshSeats() {
    setSeatLoading(true);
    try {
      const response = await fetch("/api/pre-reservations/seats", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar os lugares.");
      setSeatStatus(result.seats ?? []);
      setTravelDuration(result.travelDuration ?? null);
      if (result.prices) setPrices(result.prices);
      if (result.eventDate) setEventDate(result.eventDate.slice(0, 10));
      if (Number.isInteger(result.minorAgeLimit)) setMinorAgeLimit(result.minorAgeLimit);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao consultar lugares.");
    } finally {
      setSeatLoading(false);
    }
  }

  function toggleSeat(number: number) {
    if (unavailable.has(number) || joinWaitlist) return;
    setSelectedSeats((current) =>
      current.includes(number)
        ? current.filter((seat) => seat !== number)
        : current.length < quantity
          ? [...current, number].sort((a, b) => a - b)
          : current,
    );
  }

  const contactValid =
    responsibleValid &&
    passengers.every((passenger) => passenger.fullName.trim().length >= 3 && passenger.birthDate) &&
    (!passengers.some((passenger) => {
      const birth = passenger.birthDate ? new Date(`${passenger.birthDate}T00:00:00.000Z`) : null;
      return birth && ageOnDate(birth, new Date(`${eventDate}T00:00:00.000Z`)) < minorAgeLimit;
    }) || (minorGuardianName.trim().length >= 4 && /^(?:\+?244\s?)?9(?:[\s-]?\d){8}$/.test(minorGuardianPhone.trim()))) &&
    dataConsent &&
    (joinWaitlist || selectedSeats.length === quantity);

  async function ensureLead(forceUpdate = false): Promise<Lead> {
    if (lead && !forceUpdate) return lead;
    if (!leadRequest.current) {
      leadRequest.current = (async () => {
        const response = await fetch("/api/pre-reservations/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, phone, email, quantity, pickupPreference: pickup,
            pickupOther, returnArea, playlistSuggestion, kidsInterest,
            dataConsent, marketingConsent, idempotencyKey,
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
      if (!passengerDataCompletedTracked.current) {
        passengerDataCompletedTracked.current = true;
        trackClarityEvent("passenger_data_completed");
      }
      setStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }

  function trackPickupSelected() {
    if (pickupTracked.current) return;
    pickupTracked.current = true;
    trackClarityEvent("pickup_selected");
  }

  function trackPassengerDataStarted() {
    if (passengerDataStartedTracked.current) return;
    passengerDataStartedTracked.current = true;
    trackClarityEvent("passenger_data_started");
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
          minorGuardianName,
          minorGuardianPhone,
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
      window.location.assign(whatsappUrlFor(result));
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
          <div className="pre-success-brand"><Logo className="brand-logo" /></div>
          <span className="pre-success-icon"><Check /></span>
          <p className="pre-success-badge"><Check size={13} /> Pré-reserva guardada</p>
          <h1>Está tudo pronto.</h1>
          <p>A tua inscrição para o Brunch Mangais foi guardada com a referência <b>{completed.reference}</b>.</p>
          <div className="pre-whatsapp-status" role="status" aria-live="polite">
            <span><LoaderCircle size={20} /></span>
            <div><b>A abrir o WhatsApp automaticamente…</b><small>A mensagem já vai preenchida com os dados da reserva.</small></div>
          </div>
          <dl className="pre-summary-list">
            <Summary label="Bilhetes" value={`${completed.quantity} · ${pricingLabel(pricing.composition)}`} />
            <Summary label="Recolha pretendida" value={completed.pickupOther || completed.pickupPreference} />
            <Summary label="Lugares pretendidos" value={completed.seats.length ? completed.seats.join(", ") : "Lista de espera"} />
          </dl>
          <div className="pre-alert">A reserva fica confirmada depois da validação do pagamento e da confirmação operacional da viagem.</div>
          <div className="pre-success-actions">
            <a href={whatsappUrl} className="pre-whatsapp-cta"><MessageCircle size={20} /> Abrir WhatsApp agora</a>
            <Link href="/" className="pre-success-home">Voltar ao início</Link>
          </div>
          <p className="pre-signoff">Tu curtes, nós conduzimos. 🚌</p>
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
            {["Bilhetes", "Recolha", "Lugar e dados", "Rever"].map((label, index) => (
              <div className={step >= index + 1 ? "is-active" : ""} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><small>{label}</small></div>
            ))}
          </div>

          {step === 1 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 1 de 4</p><h1>Quantas pessoas vão viajar?</h1>
              <p className="pre-intro">Escolhe qualquer quantidade até aos lugares disponíveis. Aplicamos automaticamente a combinação mais económica.</p>
              <label className="pre-field-label">Quantidade de bilhetes
                <select className="pre-field" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>
                  {Array.from({ length: Math.max(1, availableCount) }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value} {value === 1 ? "passageiro" : "passageiros"}</option>)}
                </select>
              </label>
              <div className="pre-summary-list review mt-5">
                <Summary label="Composição" value={pricingLabel(pricing.composition)} />
                <Summary label="Total" value={formatKz(pricing.total)} />
                {pricing.discount > 0 && <Summary label="Poupança" value={formatKz(pricing.discount)} />}
              </div>
              <Navigation back={() => router.push("/")} next={() => setStep(2)} nextDisabled={quantity > availableCount} />
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
              <label className="pre-field-label">Zona aproximada de regresso <small>(opcional)</small><input className="pre-field" maxLength={160} value={returnArea} onChange={(e) => setReturnArea(e.target.value)} placeholder="Ex.: Talatona, Benfica, Cidade..." /></label>
              <Navigation back={() => setStep(1)} next={() => { trackPickupSelected(); setStep(3); }} nextDisabled={pickup === "OUTRO" && pickupOther.trim().length < 3} />
            </div>
          )}

          {step === 3 && (
            <div className="pre-panel">
              <p className="eyebrow">Etapa 3 de 4</p><h1>Escolhe os lugares.</h1>
              <p className="pre-intro">São preferências, não lugares garantidos. Precisamos de {quantity}{quantity === 1 ? " lugar" : " lugares"}.</p>
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
              {availableCount < quantity && <label className="waitlist-option"><input type="checkbox" checked={joinWaitlist} onChange={(e) => { setJoinWaitlist(e.target.checked); setSelectedSeats([]); }} /><span><b>Entrar na lista de espera</b><small>A equipa contacta-te caso surjam lugares.</small></span></label>}
              <div className="contact-block" data-clarity-mask="true" onChangeCapture={trackPassengerDataStarted}>
                <h2>Dados do responsável</h2>
                <div className="contact-grid">
                  <label className="pre-field-label">Nome completo<input className="pre-field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
                  <label className="pre-field-label">Telefone<input className="pre-field" inputMode="tel" autoComplete="tel" placeholder="+244 923 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                  <label className="pre-field-label full">E-mail <small>(opcional)</small><input type="email" className="pre-field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                </div>
                <h2>Passageiros</h2>
                <div className="passenger-fields">{passengers.map((passenger, index) => <div className="rounded-xl border border-white/10 p-3" key={index}><label className="pre-field-label">Nome do passageiro {index + 1}<input className="pre-field" autoComplete="off" placeholder={`Nome completo do passageiro ${index + 1}`} value={passenger.fullName} onChange={(e) => setPassengers((current) => current.map((value, position) => position === index ? { ...value, fullName: e.target.value } : value))} /></label><label className="pre-field-label">Data de nascimento<input className="pre-field" type="date" max={eventDate} value={passenger.birthDate} onChange={(e) => setPassengers((current) => current.map((value, position) => position === index ? { ...value, birthDate: e.target.value } : value))} /></label></div>)}</div>
                {passengers.some((passenger) => passenger.birthDate && ageOnDate(new Date(`${passenger.birthDate}T00:00:00.000Z`), new Date(`${eventDate}T00:00:00.000Z`)) < minorAgeLimit) && <div className="contact-block"><h2>Adulto responsável pelos menores</h2><div className="contact-grid"><label className="pre-field-label">Nome completo<input className="pre-field" value={minorGuardianName} onChange={(e) => setMinorGuardianName(e.target.value)} /></label><label className="pre-field-label">Telefone<input className="pre-field" inputMode="tel" value={minorGuardianPhone} onChange={(e) => setMinorGuardianPhone(e.target.value)} /></label></div></div>}
                <label className="pre-field-label">Código de recomendação <small>(opcional)</small><input className="pre-field" maxLength={80} value={referral} onChange={(e) => setReferral(e.target.value)} /></label>
                <label className="pre-field-label">Sugere uma música para a FestGo Playlist <small>(opcional)</small><input className="pre-field" maxLength={160} value={playlistSuggestion} onChange={(e) => setPlaylistSuggestion(e.target.value)} placeholder="Artista e nome da música" /></label>
                <label className="check-row"><input type="checkbox" checked={kidsInterest} onChange={(e) => setKidsInterest(e.target.checked)} /><span>Viajo com crianças e quero receber informações sobre as actividades infantis confirmadas para a viagem.</span></label>
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
              <dl className="pre-summary-list review" data-clarity-mask="true">
                <Summary label="Bilhetes" value={`${quantity} · ${pricingLabel(pricing.composition)}`} />
                <Summary label="Total indicativo" value={formatKz(pricing.total)} />
                {pricing.discount > 0 && <Summary label="Desconto dos pacotes" value={`− ${formatKz(pricing.discount)}`} />}
                <Summary label="Recolha pretendida" value={pickup === "OUTRO" ? pickupOther : pickupPreferences.find((item) => item.code === pickup)?.label ?? ""} />
                <Summary label="Zona de regresso" value={returnArea || "A combinar"} />
                <Summary label="Lugares pretendidos" value={joinWaitlist ? "Lista de espera" : selectedSeats.join(", ")} />
                <Summary label="Responsável" value={`${name} · ${phone}`} />
                <Summary label="Passageiros" value={passengers.map((passenger) => passenger.fullName).join(", ")} />
                {playlistSuggestion && <Summary label="Música sugerida" value={playlistSuggestion} />}
                {kidsInterest && <Summary label="Experiência infantil" value="Tenho interesse" />}
              </dl>
              <div className="pre-alert"><Info size={18} /><span>Pré-reserva sem pagamento. O preço inclui ida e volta, mas não inclui o ingresso do evento. A rota, os horários e os lugares só serão confirmados após pagamento validado e confirmação operacional.</span></div>
              <label className="check-row"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>Li e aceito as condições de pré-reserva e a política de privacidade.</span></label>
              {error && <p role="alert" className="pre-error">{error}</p>}
              <div className="pre-navigation"><button className="pre-link-button" onClick={() => setStep(3)}><ArrowLeft size={16} /> Alterar</button><button className="home-cta pre-confirm-whatsapp" disabled={!terms || busy} onClick={confirmPreReservation}>{busy ? "A guardar e abrir…" : "Confirmar e abrir WhatsApp"} {!busy && <MessageCircle size={18} />}</button></div>
            </div>
          )}
        </section>
        <aside className="pre-aside">
          <span className="pre-aside-icon"><Users size={20} /></span><small>Os teus bilhetes</small><h2>{quantity} passageiro{quantity === 1 ? "" : "s"}</h2><strong>{formatKz(pricing.total)}</strong><p>{pricingLabel(pricing.composition)} · ida e volta</p><hr /><p><b>Brunch Mangais</b><br />1 de Novembro de 2026 · 10h–20h</p><p>Duração da viagem: {travelDuration ?? "a confirmar"}</p><p className="pre-aside-note">A pré-reserva não garante o lugar nem a realização da rota pretendida.</p>
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

export function BookingFlow({ bookingEvent, requiresOtp }: { bookingEvent: PublicEvent; requiresOtp: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pickupId, setPickupId] = useState(bookingEvent.pickups.find((point) => point.available > 0)?.id ?? "");
  const [passengerNames, setPassengerNames] = useState([""]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [seatStatus, setSeatStatus] = useState<SeatStatus[]>([]);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatReady, setSeatReady] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [referral, setReferral] = useState("");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resume, setResume] = useState<CheckoutAccess | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const submitLock = useRef(false);
  const pickupTracked = useRef(false);
  const passengerDataStartedTracked = useRef(false);
  const passengerDataCompletedTracked = useRef(false);
  const pickup = bookingEvent.pickups.find((point) => point.id === pickupId);
  const quantity = passengerNames.length;
  const maxQuantity = Math.min(100, pickup?.available ?? 0);
  const pricing = calculateTicketPricing(quantity, bookingEvent.prices);
  const phoneValid = /^(?:\+?244\s?)?9(?:[\s-]?\d){8}$/.test(phone.trim());
  const detailsValid = name.trim().length >= 4 && phoneValid && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) && passengerNames.every((passenger) => passenger.trim().length >= 3);

  const refreshSeats = useCallback(async () => {
    setSeatLoading(true); setSeatReady(false);
    try {
      const response = await fetch("/api/reservations/seats", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.capacity !== bookingEvent.capacity || !Array.isArray(result.seats))
        throw new Error(result.error ?? "Não foi possível consultar os lugares.");
      const unavailable = new Set<number>(result.seats.map((seat: SeatStatus) => seat.number));
      setSeatStatus(result.seats);
      setSelectedSeats((current) => current.filter((seat) => !unavailable.has(seat)));
      setSeatReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar os lugares.");
    } finally { setSeatLoading(false); }
  }, [bookingEvent.capacity]);

  useEffect(() => { setResume(readCheckout()); }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (step === 2) void refreshSeats(); }, [step, refreshSeats]);
  useEffect(() => { setSelectedSeats((current) => current.slice(0, quantity)); }, [quantity]);

  function toggleSeat(number: number) {
    if (seatStatus.some((seat) => seat.number === number)) return;
    setSelectedSeats((current) => current.includes(number)
      ? current.filter((seat) => seat !== number)
      : current.length < quantity ? [...current, number].sort((a, b) => a - b) : current);
  }

  function nextStep(next: number) { setError(""); setMessage(""); setStep(next); }
  function changePhone(value: string) { setPhone(value); setChallengeId(""); setVerificationId(""); setCode(""); }

  async function requestCode() {
    if (!phoneValid || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar o código.");
      setChallengeId(result.challengeId); setVerificationId(""); setCode("");
      trackClarityEvent("otp_requested");
      setMessage("Enviámos um código por SMS para o número indicado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "O envio falhou. Tenta novamente."); }
    finally { setBusy(false); }
  }

  async function verifyCode() {
    if (!challengeId || !/^\d{6}$/.test(code) || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, phone, code }) });
      const result = await response.json();
      if (!response.ok || !result.verified) throw new Error(result.error ?? "Não foi possível verificar o código.");
      setVerificationId(challengeId); setCode(""); setMessage("Número de telefone confirmado.");
      trackClarityEvent("otp_verified");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o número."); }
    finally { setBusy(false); }
  }

  async function reserve() {
    if (submitLock.current || !detailsValid || !terms || !pickup || quantity > maxQuantity || selectedSeats.length !== quantity || (requiresOtp && !verificationId)) return;
    submitLock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventSlug: bookingEvent.slug, pickupPointId: pickup.id, name, phone, email, passengers: passengerNames, seats: selectedSeats, referral, terms, marketing, ...(verificationId ? { verificationId } : {}), idempotencyKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível criar a reserva.");
      const access = { reservationId: result.reservationId, accessToken: result.accessToken };
      rememberCheckout(access);
      router.push(checkoutUrl(access));
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "A ligação falhou. Podes tentar novamente sem duplicar a reserva.";
      if (/lugar/i.test(text)) setStep(2);
      setError(text);
      submitLock.current = false; setBusy(false);
    }
  }

  function selectPickupAndContinue() {
    if (!pickupTracked.current) {
      pickupTracked.current = true;
      trackClarityEvent("pickup_selected");
    }
    nextStep(2);
  }

  function trackPassengerDataStarted() {
    if (passengerDataStartedTracked.current) return;
    passengerDataStartedTracked.current = true;
    trackClarityEvent("passenger_data_started");
  }

  function completePassengerData() {
    if (!detailsValid) return;
    if (!passengerDataCompletedTracked.current) {
      passengerDataCompletedTracked.current = true;
      trackClarityEvent("passenger_data_completed");
    }
    nextStep(4);
  }

  return <main className="pre-page checkout-page">
    <header className="pre-header"><div className="pre-shell"><Link href="/" aria-label="FestGo — início"><Logo /></Link><Link href="/" className="pre-back"><ArrowLeft size={17} /> Início</Link></div></header>
    <div className="pre-shell pre-layout">
      <section className="pre-main">
        {resume && <div className="checkout-resume"><p>Tens um checkout guardado nesta sessão.</p><Link className="home-cta" href={checkoutUrl(resume)}>Retomar pagamento <ArrowRight size={16} /></Link><button className="checkout-text-button" onClick={() => { forgetCheckout(); setResume(null); }}>Começar uma nova reserva</button></div>}
        <div className="checkout-intro-price"><span>{quantity} {quantity === 1 ? "passageiro" : "passageiros"} · ida e volta</span><strong>{formatKz(pricing.total)}</strong></div>
        <ol className="checkout-progress" aria-label="Progresso da reserva">{["Embarque", "Lugares", "Passageiros", "Resumo"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step >= index + 1 ? "is-active" : ""}><span aria-hidden="true">{step > index + 1 ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
        <div className="pre-panel">
          <p className="eyebrow">{bookingEvent.name} · Etapa {step} de 4</p>
          <h1 ref={heading} tabIndex={-1}>{step === 1 ? "Onde vais embarcar?" : step === 2 ? "Escolhe os lugares." : step === 3 ? "Quem vai contigo?" : "Tudo pronto para pagar?"}</h1>
          {step === 1 && <>
            <p className="pre-intro">Escolhe a tua zona de embarque. O ponto exacto e a hora serão comunicados por SMS até 25/10/2026. O transporte inclui ida e volta.</p>
            <fieldset className="checkout-fieldset"><legend className="sr-only">Ponto de embarque</legend><div className="pickup-options">{bookingEvent.pickups.map((point) => <label key={point.id} className={`${pickupId === point.id ? "is-selected" : ""} ${point.available === 0 ? "is-unavailable" : ""}`}><input type="radio" name="pickup" disabled={point.available === 0} checked={pickupId === point.id} onChange={() => { setPickupId(point.id); setPassengerNames((current) => current.slice(0, Math.max(1, point.available))); setSelectedSeats([]); }} /><MapPin size={20} /><span>{point.name}<small>{/por confirmar/i.test(point.address) ? "Ponto exacto por confirmar" : point.address}</small><small>{point.routeName} · {point.departureAt ? tripTime(point.departureAt) : "Horário por confirmar"}{point.available === 0 ? " · Esgotado" : ""}</small></span><Check size={17} /></label>)}</div></fieldset>
            <label className="pre-field-label">Número de passageiros<select className="pre-field" value={quantity} onChange={(e) => setPassengerNames((current) => Array.from({ length: Number(e.target.value) }, (_, index) => current[index] ?? ""))}>{Array.from({ length: Math.max(1, maxQuantity) }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} {value === 1 ? "passageiro" : "passageiros"}</option>)}</select></label>
            <p className="checkout-help">Aplicamos automaticamente os pacotes de dupla e grupo quando reduzirem o total.</p>
            <Navigation back={() => router.push("/")} next={selectPickupAndContinue} nextDisabled={!pickup || !maxQuantity || quantity > maxQuantity} />
          </>}
          {step === 2 && <>
            <p className="pre-intro">Escolhe {quantity} {quantity === 1 ? "lugar" : "lugares"} no autocarro. Ao continuares para pagamento, ficam temporariamente reservados; a confirmação chega após o pagamento.</p>
            <div className="checkout-seat-toolbar"><strong>{selectedSeats.length} de {quantity} seleccionados</strong><button type="button" className="checkout-text-button" disabled={seatLoading} onClick={() => void refreshSeats()}>{seatLoading ? "A actualizar…" : "Actualizar lugares"}</button></div>
            <div className="seat-legend"><span><i /> Disponível</span><span><i className="selected" /> Seleccionado</span><span><i className="unavailable" /> Temporariamente reservado</span><span><i className="confirmed" /> Confirmado</span></div>
            <div className="bus-map" aria-label="Mapa de lugares do autocarro"><div className="bus-front">Frente do autocarro <BusFront size={18} /></div><div className="seat-grid">{Array.from({ length: bookingEvent.capacity }, (_, index) => index + 1).map((number) => {
              const state = seatStatus.find((seat) => seat.number === number)?.state;
              const selected = selectedSeats.includes(number);
              return <button type="button" key={number} aria-label={`Lugar ${number}${selected ? ", seleccionado" : state ? ", indisponível" : ""}`} aria-pressed={selected} disabled={!seatReady || seatLoading || Boolean(state)} className={`seat ${selected ? "selected" : ""} ${state ?? ""}`} onClick={() => toggleSeat(number)}>{number}</button>;
            })}</div></div>
            <p className="checkout-help">{selectedSeats.length === quantity ? `Lugares escolhidos: ${selectedSeats.join(", ")}.` : `Faltam ${quantity - selectedSeats.length} ${quantity - selectedSeats.length === 1 ? "lugar" : "lugares"}.`}</p>
            <Navigation back={() => nextStep(1)} next={() => nextStep(3)} nextDisabled={!seatReady || seatLoading || selectedSeats.length !== quantity} />
          </>}
          {step === 3 && <form data-clarity-mask="true" onChangeCapture={trackPassengerDataStarted} onSubmit={(e) => { e.preventDefault(); completePassengerData(); }}>
            <p className="pre-intro">Estes nomes aparecem nos bilhetes. Usamos o contacto do responsável para acompanhar a viagem.</p>
            <div className="contact-grid"><label className="pre-field-label">Nome completo do responsável<input required minLength={4} maxLength={120} className="pre-field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="pre-field-label">Telemóvel angolano<input required className="pre-field" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="+244 923 000 000" value={phone} onChange={(e) => changePhone(e.target.value)} aria-describedby="phone-help" /></label><label className="pre-field-label full">E-mail <small>(opcional)</small><input type="email" maxLength={254} className="pre-field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label></div>
            <p id="phone-help" className="checkout-help">Indica 9 dígitos, com ou sem +244. Confirma o número antes de continuar.</p>
            <fieldset className="checkout-fieldset contact-block"><legend>Passageiros</legend><button type="button" className="checkout-text-button" disabled={name.trim().length < 3} onClick={() => setPassengerNames((current) => [name.trim(), ...current.slice(1)])}>Sou o primeiro passageiro</button><div className="passenger-fields">{passengerNames.map((passenger, index) => <label key={index} className="pre-field-label">Passageiro {index + 1}<input required minLength={3} maxLength={120} autoComplete="off" className="pre-field" value={passenger} onChange={(e) => setPassengerNames((current) => current.map((value, position) => position === index ? e.target.value : value))} /></label>)}</div></fieldset>
            <label className="pre-field-label">Código promocional ou de recomendação <small>(opcional)</small><input className="pre-field" maxLength={80} autoComplete="off" value={referral} onChange={(e) => setReferral(e.target.value)} /></label>
            <label className="check-row"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /><span>Quero receber novidades FestGo. <em>(opcional)</em></span></label>
            <div className="pre-navigation"><button type="button" className="pre-link-button" onClick={() => nextStep(2)}><ArrowLeft size={16} /> Voltar</button><button className="home-cta" type="submit">Rever reserva <ArrowRight size={17} /></button></div>
            {!detailsValid && phone && !phoneValid && <p className="pre-error" role="alert">Confirma o número angolano: 9 dígitos começados por 9.</p>}
          </form>}
          {step === 4 && <>
            <p className="pre-intro">Confirma os dados. O valor final, incluindo qualquer código válido, será apresentado antes de iniciares o pagamento.</p>
            <dl className="pre-summary-list" data-clarity-mask="true"><Summary label="Evento" value={bookingEvent.name} /><Summary label="Data" value={tripDate(bookingEvent.date)} /><Summary label="Embarque" value={`${pickup?.name} · ${pickup?.departureAt ? tripTime(pickup.departureAt) : "horário por confirmar"}`} /><Summary label="Lugares" value={selectedSeats.join(", ")} /><Summary label="Passageiros" value={passengerNames.join(", ")} /><Summary label="Contacto" value={`${name} · ${phone}`} /><Summary label="Preço individual" value={formatKz(bookingEvent.prices.individual)} /><Summary label="Bilhetes" value={`${quantity} · ${pricingLabel(pricing.composition)}`} />{pricing.discount > 0 && <Summary label="Poupança dos pacotes" value={formatKz(pricing.discount)} />}<Summary label={referral ? "Subtotal antes do código" : "Total a pagar"} value={formatKz(pricing.total)} />{referral && <Summary label="Código a validar" value={referral} />}</dl>
            <div className="pre-alert"><Info size={18} /><span>{bookingEvent.ticketIncludesEntry ? "O ingresso do evento está incluído." : "O ingresso do Brunch Mangais não está incluído."} Os lugares ficam confirmados depois do pagamento. O ponto exacto e a hora serão enviados por SMS até 25/10/2026. Se não pudermos confirmar o embarque escolhido, oferecemos outro ponto ou reembolso integral.</span></div>
            <label className="check-row"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>Li e aceito os <Link href="/termos" target="_blank" rel="noreferrer">Termos e Condições</Link> e a <Link href="/reembolsos" target="_blank" rel="noreferrer">Política de Cancelamento e Reembolso</Link> da FestGo.</span></label>
            {requiresOtp && <section className="checkout-otp" data-clarity-mask="true" aria-label="Verificar telemóvel"><h2>{verificationId ? "Telemóvel confirmado" : "Confirma o teu telemóvel"}</h2><p className="checkout-help">{verificationId ? "Podes continuar para o pagamento." : `Vamos enviar um código para ${phone}.`}</p>{!verificationId && <><button type="button" className="pre-link-button" disabled={busy || !terms} onClick={requestCode}>{busy ? "A processar…" : challengeId ? "Enviar novo código" : "Receber código por SMS"}</button>{challengeId && <form className="checkout-otp-form" onSubmit={(e) => { e.preventDefault(); void verifyCode(); }}><label className="pre-field-label">Código de 6 dígitos<input className="pre-field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></label><button className="home-cta" disabled={busy || code.length !== 6} type="submit">Confirmar código</button></form>}</>}</section>}
            <div className="pre-navigation"><button className="pre-link-button" disabled={busy} onClick={() => nextStep(3)}><ArrowLeft size={16} /> Alterar dados</button><button className="home-cta" disabled={busy || !terms || (requiresOtp && !verificationId)} onClick={reserve}>{busy ? "A preparar checkout…" : "Continuar para pagamento"}<ArrowRight size={17} /></button></div>
          </>}
          {message && <p className="invite-success" role="status">{message}</p>}{error && <p className="pre-error" role="alert">{error}</p>}
        </div>
      </section>
      <aside className="pre-aside"><span className="pre-aside-icon"><BusFront size={21} /></span><small>A tua viagem</small><h2>{bookingEvent.name}</h2><p>{tripDate(bookingEvent.date)}<br />{bookingEvent.venue}</p><hr /><strong>{formatKz(pricing.total)}</strong><p>{quantity} {quantity === 1 ? "passageiro" : "passageiros"} · ida e volta<br />{pricingLabel(pricing.composition)}</p>{pickup && <p>{pickup.name} · {pickup.departureAt ? tripTime(pickup.departureAt) : "horário por confirmar"}</p>}{selectedSeats.length > 0 && <p>Lugares: {selectedSeats.join(", ")}</p>}<p className="pre-aside-note">{bookingEvent.ticketIncludesEntry ? "Inclui ingresso do evento." : "Ingresso do evento adquirido separadamente."}<br />Bilhetes disponíveis no website após pagamento confirmado.</p></aside>
    </div>
  </main>;
}

function tripDate(date: string) { return new Date(date).toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda", day: "numeric", month: "long", year: "numeric" }); }
function tripTime(date: string) { return new Date(date).toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" }); }
