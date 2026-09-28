"use client";

import { useMemo, useState } from "react";
import { BusFront, Check, MapPin, Users } from "lucide-react";
import { formatKz } from "@/lib/data";
import {
  commercialPlans,
  pickupPreferences,
  type CommercialPlanCode,
  type PickupPreferenceCode,
} from "@/lib/pre-reservations";

type SelectablePlan = CommercialPlanCode;

export function PaymentInvitationForm({
  token,
  eventName,
  reference,
  initialPlan,
  initialPassengers,
  initialSeats,
  initialPickup,
  initialPickupOther,
  capacity,
  unavailableSeats,
}: {
  token: string;
  eventName: string;
  reference: string;
  initialPlan: CommercialPlanCode;
  initialPassengers: string[];
  initialSeats: number[];
  initialPickup: PickupPreferenceCode;
  initialPickupOther: string;
  capacity: number;
  unavailableSeats: number[];
}) {
  const [planCode, setPlanCode] = useState<SelectablePlan>(initialPlan);
  const [passengers, setPassengers] = useState(() =>
    Array.from(
      { length: commercialPlans[initialPlan].quantity },
      (_, index) => initialPassengers[index] ?? "",
    ),
  );
  const [seats, setSeats] = useState(() =>
    initialSeats.slice(0, commercialPlans[initialPlan].quantity),
  );
  const [unavailable, setUnavailable] = useState(unavailableSeats);
  const [pickup, setPickup] = useState(initialPickup);
  const [pickupOther, setPickupOther] = useState(initialPickupOther);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const plan = commercialPlans[planCode];
  const planOptions: SelectablePlan[] = initialPlan === "DUO_INDIVIDUAL"
    ? ["DUO_INDIVIDUAL", "INDIVIDUAL", "DUO", "GROUP"]
    : ["INDIVIDUAL", "DUO", "GROUP"];
  const unavailableSet = useMemo(() => new Set(unavailable), [unavailable]);

  function choosePlan(code: SelectablePlan) {
    const next = commercialPlans[code];
    setPlanCode(code);
    setPassengers((current) =>
      Array.from({ length: next.quantity }, (_, index) => current[index] ?? ""),
    );
    setSeats((current) => current.slice(0, next.quantity));
    setError("");
    setSuccess("");
  }

  function toggleSeat(number: number) {
    if (unavailableSet.has(number)) return;
    setSeats((current) =>
      current.includes(number)
        ? current.filter((seat) => seat !== number)
        : current.length < plan.quantity
          ? [...current, number].sort((a, b) => a - b)
          : current,
    );
  }

  async function confirm() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/payment-invitations/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan: planCode,
            passengers,
            seats,
            pickupPreference: pickup,
            pickupOther,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (Array.isArray(result.seats))
          setUnavailable((current) => [...new Set([...current, ...result.seats])]);
        throw new Error(result.error ?? "Não foi possível confirmar os dados.");
      }
      setSuccess(result.message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível confirmar.",
      );
    } finally {
      setBusy(false);
    }
  }

  const valid =
    passengers.every((name) => name.trim().length >= 3) &&
    seats.length === plan.quantity &&
    (pickup !== "OUTRO" || pickupOther.trim().length >= 3);

  return (
    <main className="pre-page">
      <div className="pre-shell invite-shell">
        <section className="pre-main space-y-5">
          <div className="pre-panel">
            <p className="eyebrow">{reference}</p>
            <h1>Confirma a tua pré-reserva.</h1>
            <p className="pre-intro">
              {eventName}. Confirma o plano, os passageiros, os lugares e a
              recolha. Nenhum pagamento será iniciado nesta página.
            </p>

            <h2 className="invite-heading">Plano</h2>
            <div className="plan-grid">
              {planOptions.map(
                (code) => {
                  const item = commercialPlans[code];
                  return (
                    <button
                      type="button"
                      className={`plan-card invite-plan ${planCode === code ? "is-selected" : ""}`}
                      onClick={() => choosePlan(code)}
                      key={code}
                    >
                      <span>{item.name}</span>
                      <strong>{formatKz(item.total)}</strong>
                      <small>{item.description}</small>
                      {planCode === code && <Check size={18} />}
                    </button>
                  );
                },
              )}
            </div>

            <div className="contact-block">
              <h2>Passageiros</h2>
              <div className="passenger-fields">
                {passengers.map((passenger, index) => (
                  <label className="pre-field-label" key={index}>
                    Nome do passageiro {index + 1}
                    <input
                      className="pre-field"
                      maxLength={120}
                      value={passenger}
                      onChange={(event) =>
                        setPassengers((current) =>
                          current.map((name, currentIndex) =>
                            currentIndex === index ? event.target.value : name,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="contact-block">
              <h2>Ponto de recolha</h2>
              <div className="pickup-options mt-4">
                {pickupPreferences.map((option) => (
                  <label
                    className={pickup === option.code ? "is-selected" : ""}
                    key={option.code}
                  >
                    <input
                      type="radio"
                      checked={pickup === option.code}
                      onChange={() => setPickup(option.code)}
                    />
                    <MapPin size={18} />
                    <span>{option.label}</span>
                    <Check size={16} />
                  </label>
                ))}
              </div>
              {pickup === "OUTRO" && (
                <label className="pre-field-label">
                  Localização pretendida
                  <input
                    className="pre-field"
                    maxLength={160}
                    value={pickupOther}
                    onChange={(event) => setPickupOther(event.target.value)}
                  />
                </label>
              )}
            </div>

            <div className="contact-block">
              <h2>Lugares pretendidos</h2>
              <p className="pre-intro">
                Escolhe {plan.quantity} lugar{plan.quantity === 1 ? "" : "es"}.
              </p>
              <div className="bus-map">
                <div className="bus-front"><BusFront size={17} /> Frente</div>
                <div className="seat-grid">
                  {Array.from({ length: capacity }, (_, index) => index + 1).map(
                    (number) => {
                      const blocked = unavailableSet.has(number);
                      const selected = seats.includes(number);
                      return (
                        <button
                          type="button"
                          className={`seat ${blocked ? "unavailable" : selected ? "selected" : ""}`}
                          disabled={blocked}
                          onClick={() => toggleSeat(number)}
                          key={number}
                          aria-label={`Lugar ${number}${blocked ? " indisponível" : selected ? " seleccionado" : ""}`}
                        >
                          {number}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            </div>

            {error && <p className="pre-error" role="alert">{error}</p>}
            {success && <div className="invite-success" role="status"><Check size={18} /> {success}</div>}
            <button
              className="home-cta mt-6"
              type="button"
              disabled={busy || !valid}
              onClick={confirm}
            >
              {busy ? "A guardar…" : "Confirmar plano e dados"}
            </button>
          </div>
        </section>

        <aside className="pre-aside">
          <span className="pre-aside-icon"><Users size={20} /></span>
          <small>Resumo actualizado</small>
          <h2>{plan.name}</h2>
          <strong>{formatKz(plan.total)}</strong>
          <p>{plan.quantity} passageiro{plan.quantity === 1 ? "" : "s"} · ida e volta</p>
          <hr />
          <p className="pre-aside-note">
            Pagamentos reais continuam desactivados. A FestGo enviará as
            instruções quando esta fase estiver disponível.
          </p>
        </aside>
      </div>
    </main>
  );
}
