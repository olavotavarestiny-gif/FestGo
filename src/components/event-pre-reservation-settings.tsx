"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventPreReservationSettings({
  duration: initialDuration,
  confirmed: initialConfirmed,
  individualPrice: initialIndividualPrice,
  duoPrice: initialDuoPrice,
  groupPrice: initialGroupPrice,
  minorAgeLimit: initialMinorAgeLimit,
}: {
  duration: string;
  confirmed: boolean;
  individualPrice: number;
  duoPrice: number;
  groupPrice: number;
  minorAgeLimit: number;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState(initialDuration);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [individualPrice, setIndividualPrice] = useState(initialIndividualPrice);
  const [duoPrice, setDuoPrice] = useState(initialDuoPrice);
  const [groupPrice, setGroupPrice] = useState(initialGroupPrice);
  const [minorAgeLimit, setMinorAgeLimit] = useState(initialMinorAgeLimit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/event/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration, confirmed, individualPrice, duoPrice, groupPrice, minorAgeLimit }),
    });
    const result = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Configuração guardada." : result.error || "Falha ao guardar.");
    if (response.ok) router.refresh();
  }
  return (
    <div className="admin-settings">
      <label>Duração validada<input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Ex.: 1h30" /></label>
      <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Publicar esta estimativa</label>
      <label>Preço individual<input type="number" min={1} value={individualPrice} onChange={(event) => setIndividualPrice(Number(event.target.value))} /></label>
      <label>Preço dupla<input type="number" min={1} value={duoPrice} onChange={(event) => setDuoPrice(Number(event.target.value))} /></label>
      <label>Preço grupo<input type="number" min={1} value={groupPrice} onChange={(event) => setGroupPrice(Number(event.target.value))} /></label>
      <label>Idade mínima de adulto<input type="number" min={1} max={25} value={minorAgeLimit} onChange={(event) => setMinorAgeLimit(Number(event.target.value))} /></label>
      <button disabled={busy} onClick={save}>{busy ? "A guardar…" : "Guardar"}</button>
      {message && <small>{message}</small>}
    </div>
  );
}
