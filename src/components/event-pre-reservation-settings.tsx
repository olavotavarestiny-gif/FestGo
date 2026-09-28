"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventPreReservationSettings({
  duration: initialDuration,
  confirmed: initialConfirmed,
}: {
  duration: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState(initialDuration);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/event/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration, confirmed }),
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
      <button disabled={busy} onClick={save}>{busy ? "A guardar…" : "Guardar"}</button>
      {message && <small>{message}</small>}
    </div>
  );
}
