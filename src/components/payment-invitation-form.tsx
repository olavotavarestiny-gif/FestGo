"use client";

import { useMemo, useState } from "react";
import { BusFront, Check, MapPin, Users } from "lucide-react";
import { formatKz } from "@/lib/data";
import {
  ageOnDate,
  calculateTicketPricing,
  pickupPreferences,
  pricingLabel,
  type PickupPreferenceCode,
  type TicketPrices,
} from "@/lib/pre-reservations";

type PassengerInput = { fullName: string; birthDate: string };

export function PaymentInvitationForm({
  token,
  eventName,
  reference,
  initialQuantity,
  initialPassengers,
  initialSeats,
  initialPickup,
  initialPickupOther,
  initialGuardianName,
  initialGuardianPhone,
  capacity,
  unavailableSeats,
  prices,
  eventDate,
  minorAgeLimit,
  paymentsEnabled,
  paymentProvider,
}: {
  token: string;
  eventName: string;
  reference: string;
  initialQuantity: number;
  initialPassengers: PassengerInput[];
  initialSeats: number[];
  initialPickup: PickupPreferenceCode;
  initialPickupOther: string;
  initialGuardianName: string;
  initialGuardianPhone: string;
  capacity: number;
  unavailableSeats: number[];
  prices: TicketPrices;
  eventDate: string;
  minorAgeLimit: number;
  paymentsEnabled: boolean;
  paymentProvider: "wipay" | "paygo";
}) {
  const [quantity, setQuantity] = useState(initialQuantity);
  const [passengers, setPassengers] = useState<PassengerInput[]>(() =>
    Array.from({ length: initialQuantity }, (_, index) =>
      initialPassengers[index] ?? { fullName: "", birthDate: "" },
    ),
  );
  const [seats, setSeats] = useState(initialSeats.slice(0, initialQuantity));
  const [unavailable, setUnavailable] = useState(unavailableSeats);
  const [pickup, setPickup] = useState(initialPickup);
  const [pickupOther, setPickupOther] = useState(initialPickupOther);
  const [guardianName, setGuardianName] = useState(initialGuardianName);
  const [guardianPhone, setGuardianPhone] = useState(initialGuardianPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [paymentAccess, setPaymentAccess] = useState<{ reservationId: string; accessToken: string } | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const pricing = useMemo(() => calculateTicketPricing(quantity, prices), [quantity, prices]);
  const unavailableSet = useMemo(() => new Set(unavailable), [unavailable]);
  const availableCount = capacity - unavailable.length;
  const eventDay = useMemo(() => new Date(`${eventDate}T00:00:00.000Z`), [eventDate]);
  const includesMinors = passengers.some((passenger) =>
    passenger.birthDate
      ? ageOnDate(new Date(`${passenger.birthDate}T00:00:00.000Z`), eventDay) < minorAgeLimit
      : false,
  );

  function invalidatePayment() {
    setPaymentAccess(null);
    setSuccess("");
  }

  function changeQuantity(next: number) {
    const safe = Math.max(1, Math.min(availableCount, next || 1));
    setQuantity(safe);
    setPassengers((current) => Array.from(
      { length: safe },
      (_, index) => current[index] ?? { fullName: "", birthDate: "" },
    ));
    setSeats((current) => current.slice(0, safe));
    invalidatePayment();
  }

  function toggleSeat(number: number) {
    if (unavailableSet.has(number)) return;
    invalidatePayment();
    setSeats((current) =>
      current.includes(number)
        ? current.filter((seat) => seat !== number)
        : current.length < quantity
          ? [...current, number].sort((a, b) => a - b)
          : current,
    );
  }

  async function confirm() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/payment-invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          passengers,
          seats,
          pickupPreference: pickup,
          pickupOther,
          minorGuardianName: guardianName,
          minorGuardianPhone: guardianPhone,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (Array.isArray(result.seats))
          setUnavailable((current) => [...new Set([...current, ...result.seats])]);
        throw new Error(result.error ?? "Não foi possível confirmar os dados.");
      }
      setSuccess(result.message);
      if (result.paymentsEnabled && result.reservationId && result.accessToken)
        setPaymentAccess({ reservationId: result.reservationId, accessToken: result.accessToken });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar.");
    } finally {
      setBusy(false);
    }
  }

  async function payWithExpress() {
    if (!paymentAccess) return;
    setPaymentBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...paymentAccess, method: "multicaixa" }),
      });
      const result = await response.json();
      if (!response.ok && response.status !== 202)
        throw new Error(result.error ?? "Não foi possível iniciar o pagamento.");
      const paymentUrl = result.details?.paymentUrl;
      if (typeof paymentUrl === "string" && paymentUrl.startsWith("https://")) {
        window.location.assign(paymentUrl);
        return;
      }
      const statusUrl = new URL("/pagamento", window.location.origin);
      statusUrl.searchParams.set("reservation", paymentAccess.reservationId);
      statusUrl.searchParams.set("token", paymentAccess.accessToken);
      window.location.assign(statusUrl.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível pagar.");
      setPaymentBusy(false);
    }
  }

  const valid =
    passengers.every((passenger) => passenger.fullName.trim().length >= 3 && passenger.birthDate) &&
    seats.length === quantity &&
    (pickup !== "OUTRO" || pickupOther.trim().length >= 3) &&
    (!includesMinors || (guardianName.trim().length >= 4 && /^(?:\+?244\s?)?9(?:[\s-]?\d){8}$/.test(guardianPhone.trim())));

  return (
    <main className="pre-page">
      <div className="pre-shell invite-shell">
        <section className="pre-main space-y-5">
          <div className="pre-panel">
            <p className="eyebrow">{reference}</p>
            <h1>Confirma a tua pré-reserva.</h1>
            <p className="pre-intro">{eventName}. Confirma a quantidade, os passageiros, os lugares e a recolha. O pagamento só começa quando clicares no botão abaixo.</p>

            <h2 className="invite-heading">Bilhetes</h2>
            <label className="pre-field-label">Quantidade
              <input className="pre-field" type="number" min={1} max={availableCount} value={quantity} onChange={(event) => changeQuantity(Number(event.target.value))} />
            </label>
            <div className="pre-summary-list review mt-4">
              <Summary label="Composição" value={pricingLabel(pricing.composition)} />
              <Summary label="Total" value={formatKz(pricing.total)} />
            </div>

            <div className="contact-block">
              <h2>Passageiros</h2>
              <div className="passenger-fields">
                {passengers.map((passenger, index) => (
                  <div className="rounded-xl border border-white/10 p-3" key={index}>
                    <label className="pre-field-label">Nome do passageiro {index + 1}<input className="pre-field" value={passenger.fullName} onChange={(event) => { invalidatePayment(); setPassengers((current) => current.map((item, position) => position === index ? { ...item, fullName: event.target.value } : item)); }} /></label>
                    <label className="pre-field-label">Data de nascimento<input className="pre-field" type="date" max={eventDate} value={passenger.birthDate} onChange={(event) => { invalidatePayment(); setPassengers((current) => current.map((item, position) => position === index ? { ...item, birthDate: event.target.value } : item)); }} /></label>
                  </div>
                ))}
              </div>
              {includesMinors && <div className="contact-grid mt-4"><label className="pre-field-label">Adulto responsável pelos menores<input className="pre-field" value={guardianName} onChange={(event) => { invalidatePayment(); setGuardianName(event.target.value); }} /></label><label className="pre-field-label">Telefone do responsável<input className="pre-field" inputMode="tel" value={guardianPhone} onChange={(event) => { invalidatePayment(); setGuardianPhone(event.target.value); }} /></label></div>}
            </div>

            <div className="contact-block">
              <h2>Ponto de recolha</h2>
              <div className="pickup-options mt-4">{pickupPreferences.map((option) => <label className={pickup === option.code ? "is-selected" : ""} key={option.code}><input type="radio" checked={pickup === option.code} onChange={() => { invalidatePayment(); setPickup(option.code); }} /><MapPin size={18} /><span>{option.label}</span><Check size={16} /></label>)}</div>
              {pickup === "OUTRO" && <label className="pre-field-label">Localização pretendida<input className="pre-field" maxLength={160} value={pickupOther} onChange={(event) => { invalidatePayment(); setPickupOther(event.target.value); }} /></label>}
            </div>

            <div className="contact-block">
              <h2>Lugares pretendidos</h2>
              <p className="pre-intro">Escolhe {quantity} lugar{quantity === 1 ? "" : "es"}.</p>
              <div className="bus-map"><div className="bus-front"><BusFront size={17} /> Frente</div><div className="seat-grid">{Array.from({ length: capacity }, (_, index) => index + 1).map((number) => { const blocked = unavailableSet.has(number); const selected = seats.includes(number); return <button type="button" className={`seat ${blocked ? "unavailable" : selected ? "selected" : ""}`} disabled={blocked} onClick={() => toggleSeat(number)} key={number} aria-label={`Lugar ${number}${blocked ? " indisponível" : selected ? " seleccionado" : ""}`}>{number}</button>; })}</div></div>
            </div>

            {error && <p className="pre-error" role="alert">{error}</p>}
            {success && <div className="invite-success" role="status"><Check size={18} /> {success}</div>}
            <button className="home-cta mt-6" type="button" disabled={busy || !valid} onClick={confirm}>{busy ? "A guardar…" : "Confirmar bilhetes e dados"}</button>
            {paymentAccess && <button className="home-cta mt-3" type="button" disabled={paymentBusy} onClick={payWithExpress}>{paymentBusy ? "A iniciar…" : `Pagar ${formatKz(pricing.total)} com ${paymentProvider === "wipay" ? "WiPay" : "Multicaixa Express"}`}</button>}
          </div>
        </section>
        <aside className="pre-aside"><span className="pre-aside-icon"><Users size={20} /></span><small>Resumo actualizado</small><h2>{quantity} passageiro{quantity === 1 ? "" : "s"}</h2><strong>{formatKz(pricing.total)}</strong><p>{pricingLabel(pricing.composition)} · ida e volta</p><hr /><p className="pre-aside-note">{paymentsEnabled ? `Pagamento disponível através da ${paymentProvider === "wipay" ? "WiPay" : "Multicaixa Express"}.` : "Pagamentos reais continuam desactivados. A FestGo enviará as instruções quando esta fase estiver disponível."}</p></aside>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
