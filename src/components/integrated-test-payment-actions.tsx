"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";

export function IntegratedTestPaymentActions({
  reservationId,
  paymentExists,
  paid,
  initialPaymentUrl,
}: {
  reservationId: string;
  paymentExists: boolean;
  paid: boolean;
  initialPaymentUrl: string | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"multicaixa" | "reference">("multicaixa");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState(initialPaymentUrl);
  const [reference, setReference] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!paymentExists || paid) return;
    let active = true;
    const reconcile = async () => {
      try {
        const response = await fetch(
          `/api/admin/test-reservations/${reservationId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "RECONCILE" }),
          },
        );
        const result = await response.json();
        if (active && response.ok && result.status === "SUCCEEDED")
          router.refresh();
      } catch {}
    };
    const first = window.setTimeout(() => void reconcile(), 1_500);
    const interval = window.setInterval(() => void reconcile(), 10_000);
    return () => {
      active = false;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [paid, paymentExists, reservationId, router]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/test-reservations/${reservationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível concluir a operação.");
      if (result.paymentUrl) setPaymentUrl(result.paymentUrl);
      if (result.reference && typeof result.reference === "object") setReference(result.reference);
      setMessage(body.action === "RECONCILE" ? `Estado consultado: ${result.status}.` : "Cobrança de 100 Kz criada no gateway.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!paymentExists && !paid && (
        <>
          <label className="gateway-test-field">Método<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="multicaixa">Multicaixa / Express</option><option value="reference">Referência</option></select></label>
          <button className="btn-primary w-full" disabled={busy} onClick={() => {
            if (window.confirm("Criar agora a cobrança real e isolada de 100 Kz?")) void action({ action: "START_PAYMENT", method, confirmation: true });
          }}>{busy ? "A comunicar…" : "Pagar 100 Kz"}</button>
        </>
      )}
      {paymentUrl && <a className="btn-primary w-full" href={paymentUrl} target="_blank" rel="noreferrer">Abrir checkout real <ExternalLink size={16} /></a>}
      {reference?.entity && <div className="rounded-xl bg-white/[.05] p-4 text-xs"><p>Entidade: <b>{reference.entity}</b></p><p className="mt-2">Referência: <b>{reference.reference_number}</b></p></div>}
      {paymentExists && !paid && <button className="btn-secondary w-full" disabled={busy} onClick={() => action({ action: "RECONCILE" })}><RefreshCw size={16} /> Consultar gateway</button>}
      {message && <p className="rounded-xl bg-white/[.05] p-3 text-xs text-white/65" role="status">{message}</p>}
    </div>
  );
}
