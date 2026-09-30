"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const options = [
  ["TO_CONTACT", "Por contactar"],
  ["CONTACTED", "Contactado"],
  ["AWAITING_PAYMENT", "A aguardar pagamento"],
  ["NO_RESPONSE", "Sem resposta"],
] as const;

export function PreReservationAdminActions({
  id,
  current,
  reservationStatus,
}: {
  id: string;
  current: string;
  reservationStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = ["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"].includes(reservationStatus);

  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/pre-reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(response.ok ? success : result.error || "Não foi possível concluir a acção.");
      if (response.ok) {
        setComment("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateContact(nextStatus = status) {
    setStatus(nextStatus);
    await action(
      { action: "CONTACT", status: nextStatus, comment },
      nextStatus === "CONTACTED" ? "Cliente marcado como contactado." : "Acompanhamento guardado.",
    );
  }

  async function approve() {
    if (!window.confirm("Aprovar esta pré-reserva? O pagamento continuará por confirmar.")) return;
    await action({ action: "APPROVE" }, "Pré-reserva aprovada. O link de checkout pode ser enviado manualmente.");
  }

  async function release() {
    if (!window.confirm("Cancelar esta inscrição e libertar os lugares pretendidos?")) return;
    await action({ action: "RELEASE" }, "Inscrição cancelada e lugares libertados.");
  }

  return (
    <div className="space-y-5">
      {active && (
        <section className="admin-action-card">
          <h3>Acompanhamento</h3>
          <div className="admin-followup mt-3">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Comentário da tentativa" />
            <button disabled={busy} onClick={() => updateContact()}>Guardar acompanhamento</button>
            {current !== "CONTACTED" && <button disabled={busy} onClick={() => updateContact("CONTACTED")}>Marcar como contactado</button>}
          </div>
        </section>
      )}

      {reservationStatus === "PRE_RESERVED" && (
        <section className="admin-action-card">
          <h3>Aprovação manual</h3>
          <p>A aprovação não confirma o pagamento e não envia SMS automaticamente.</p>
          <button className="admin-approve mt-3" disabled={busy} onClick={approve}>Aprovar pré-reserva</button>
        </section>
      )}

      {active && <button className="admin-danger admin-secondary-action" disabled={busy} onClick={release}>Cancelar e libertar lugares</button>}
      {message && <p role="status" className="text-sm text-violet-200">{message}</p>}
    </div>
  );
}
