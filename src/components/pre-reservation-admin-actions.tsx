"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const options = [
  ["TO_CONTACT", "Por contactar"],
  ["CONTACTED", "Contactado"],
  ["AWAITING_PAYMENT", "Aguarda pagamento"],
  ["NO_RESPONSE", "Sem resposta"],
] as const;

export function PreReservationAdminActions({
  id,
  current,
  canResendSms,
}: {
  id: string;
  current: string;
  canResendSms: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updateContact() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/pre-reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CONTACT", status, comment }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.error || "Falha ao guardar.");
    setComment(""); setMessage("Guardado."); router.refresh();
  }

  async function resendSms() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/pre-reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RESEND_SMS" }),
    });
    const result = await response.json();
    setBusy(false);
    setMessage(response.ok ? "SMS reagendado." : result.error || "Falha no reenvio.");
    if (response.ok) router.refresh();
  }

  async function release() {
    if (!window.confirm("Cancelar esta inscrição e libertar os lugares pretendidos?")) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/pre-reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RELEASE" }),
    });
    const result = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Inscrição cancelada." : result.error || "Falha ao cancelar.");
    if (response.ok) router.refresh();
  }

  return (
    <div className="admin-followup">
      <select value={status} onChange={(event) => setStatus(event.target.value)}>
        {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Comentário da tentativa" />
      <button disabled={busy} onClick={updateContact}>Guardar</button>
      {canResendSms && <button disabled={busy} onClick={resendSms}>Reenviar SMS</button>}
      <button className="admin-danger" disabled={busy} onClick={release}>Cancelar e libertar</button>
      {message && <small>{message}</small>}
    </div>
  );
}
