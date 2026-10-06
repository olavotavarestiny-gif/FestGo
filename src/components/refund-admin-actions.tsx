"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatKz } from "@/lib/data";

export function RefundAdminActions({ reservationId, total }: { reservationId: string; total: number }) {
  const router = useRouter();
  const [reason, setReason] = useState<"CUSTOMER" | "OPERATOR">("CUSTOMER");
  const [requestedAt, setRequestedAt] = useState("");
  const [amount, setAmount] = useState(Math.round(total * 50) / 100);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (!confirmed || busy || !reference.trim() || (reason === "CUSTOMER" && !requestedAt)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}/refund`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, refundedAmount: amount, providerRefundReference: reference, ...(reason === "CUSTOMER" ? { requestedAt: new Date(requestedAt).toISOString() } : {}) }),
      });
      const result = await response.json();
      setMessage(response.ok ? "Reembolso registado e QR Codes invalidados." : result.error ?? "Não foi possível registar.");
      if (response.ok) router.refresh();
    } catch { setMessage("Falha de ligação. Tenta novamente."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 border-t border-white/10 pt-5">
    <h3 className="font-bold">Registar reembolso concluído</h3>
    <p className="mt-2 text-xs text-white/50">Efectua primeiro a devolução na WiPay ou pelo meio acordado. Este registo não transfere dinheiro; cancela a reserva para embarque e invalida os bilhetes.</p>
    <div className="admin-settings mt-4 space-y-3">
      <label>Motivo<select value={reason} onChange={(event) => { const next = event.target.value as "CUSTOMER" | "OPERATOR"; setReason(next); setAmount(next === "CUSTOMER" ? Math.round(total * 50) / 100 : total); }}><option value="CUSTOMER">Pedido do cliente · 50%</option><option value="OPERATOR">Cancelamento/alteração FestGo · análise própria</option></select></label>
      {reason === "CUSTOMER" && <label>Data do pedido do cliente<input type="datetime-local" value={requestedAt} onChange={(event) => setRequestedAt(event.target.value)} /></label>}
      <label>Valor já devolvido<input type="number" min="0.01" max={total} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      {reason === "CUSTOMER" && <small>Valor normal: {formatKz(Math.round(total * 50) / 100)}. Pedido até 7 dias antes do evento.</small>}
      <label>Referência/comprovativo do reembolso<input value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} /></label>
      <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo que a devolução já foi efectuada.</label>
      <button disabled={busy || !confirmed || reference.trim().length < 5 || (reason === "CUSTOMER" && !requestedAt)} onClick={save}>{busy ? "A registar…" : "Registar e invalidar QR"}</button>
      <p role="status">{message}</p>
    </div>
  </section>;
}
