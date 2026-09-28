"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pickupPreferences } from "@/lib/pre-reservations";

export function IntegratedTestReservationForm() {
  const router = useRouter();
  const [passengerName, setPassengerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState("INDIVIDUAL");
  const [testSeat, setTestSeat] = useState("TESTE-A1");
  const [pickupPreference, setPickupPreference] = useState("CIDADE_PRIMEIRO_MAIO");
  const [pickupOther, setPickupOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createReservation() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/test-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passengerName,
          email,
          phone,
          plan,
          testSeat,
          pickupPreference,
          pickupOther,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível criar o teste.");
      router.push(new URL(result.url).pathname);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar o teste.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-6 sm:p-8">
      <p className="eyebrow">Circuito completo isolado</p>
      <h1 className="mt-2 text-3xl font-black">Nova compra de teste · 100 Kz</h1>
      <p className="mt-3 text-sm leading-6 text-white/50">
        Cria dados exclusivos de teste. Nenhum cliente, lugar ou bilhete oficial será utilizado.
      </p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <label className="gateway-test-field sm:col-span-2">Nome do passageiro de teste<input value={passengerName} onChange={(event) => setPassengerName(event.target.value)} /></label>
        <label className="gateway-test-field">Email de teste<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="gateway-test-field">Telefone para o checkout<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+244 9XX XXX XXX" /></label>
        <label className="gateway-test-field">Plano apresentado<select value={plan} onChange={(event) => setPlan(event.target.value)}><option value="INDIVIDUAL">Individual</option><option value="DUO">Dupla</option><option value="GROUP">Grupo</option></select></label>
        <label className="gateway-test-field">Lugar fictício<input value={testSeat} onChange={(event) => setTestSeat(event.target.value)} maxLength={20} /></label>
        <label className="gateway-test-field sm:col-span-2">Ponto de recolha<select value={pickupPreference} onChange={(event) => setPickupPreference(event.target.value)}>{pickupPreferences.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>
        {pickupPreference === "OUTRO" && <label className="gateway-test-field sm:col-span-2">Localização de teste<input value={pickupOther} onChange={(event) => setPickupOther(event.target.value)} /></label>}
      </div>
      {error && <p className="mt-5 rounded-xl bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}
      <button className="btn-primary mt-6" disabled={busy || !passengerName || !email || !phone || !testSeat} onClick={createReservation}>{busy ? "A criar…" : "Criar reserva e link de teste"}</button>
    </section>
  );
}
