"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";

export function IntegratedTestPaymentActions({
  reservationId,
  paymentExists,
  paid,
  initialPaymentUrl,
  initialQrCode,
  initialExpirationDate,
  paymentProvider,
}: {
  reservationId: string;
  paymentExists: boolean;
  paid: boolean;
  initialPaymentUrl: string | null;
  initialQrCode: string | null;
  initialExpirationDate: string | null;
  paymentProvider: "wipay" | "paygo" | "ekwanza" | "ekwanza-ticket";
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"multicaixa" | "reference">("multicaixa");
  const [provider, setProvider] = useState(paymentProvider);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState(initialPaymentUrl);
  const [reference, setReference] = useState<Record<string, string> | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(initialQrCode);
  const [expirationDate, setExpirationDate] = useState<string | null>(initialExpirationDate);

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
      if (typeof result.qrCode === "string") setQrCode(result.qrCode);
      if (typeof result.expirationDate === "string") setExpirationDate(result.expirationDate);
      setMessage(
        body.action === "RECONCILE"
          ? `Estado consultado: ${result.status}.${result.diagnosticDetail ? ` Host devolvido: ${result.diagnosticDetail}.` : ""}`
          : `Cobrança isolada de 100 Kz criada em ${provider === "wipay" ? "WiPay" : provider === "ekwanza" ? "É-Kwanza GPO" : provider === "ekwanza-ticket" ? "É-Kwanza QR" : "PayGo"}.`,
      );
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
          <label className="gateway-test-field">Gateway<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="paygo">PayGo (actual)</option><option value="wipay">WiPay</option><option value="ekwanza-ticket">É-Kwanza código / QR</option><option value="ekwanza">É-Kwanza GPO / Referência</option></select></label>
          {provider !== "wipay" && provider !== "ekwanza-ticket" && <label className="gateway-test-field">Método<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="multicaixa">Multicaixa / Express</option><option value="reference">Referência</option></select></label>}
          <button className="btn-primary w-full" disabled={busy} onClick={() => {
            if (window.confirm(`Criar agora uma cobrança real e isolada de 100 Kz em ${provider === "wipay" ? "WiPay" : provider === "ekwanza" ? "É-Kwanza GPO" : provider === "ekwanza-ticket" ? "É-Kwanza QR" : "PayGo"}?`)) void action({ action: "START_PAYMENT", provider, method, confirmation: true });
          }}>{busy ? "A comunicar…" : `Pagar 100 Kz com ${provider === "wipay" ? "WiPay" : provider === "ekwanza" ? "É-Kwanza GPO" : provider === "ekwanza-ticket" ? "É-Kwanza QR" : "PayGo"}`}</button>
        </>
      )}
      {paymentUrl && <a className="btn-primary w-full" href={paymentUrl} target="_blank" rel="noreferrer">Abrir checkout de pagamento <ExternalLink size={16} /></a>}
      {reference && <div className="rounded-xl bg-white/[.05] p-4 text-xs">{Object.entries(reference).map(([key, value]) => <p className="mt-2 first:mt-0" key={key}>{key}: <b>{value}</b></p>)}</div>}
      {qrCode && <div className="rounded-xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline data URI. */}
        <img className="mx-auto h-auto w-full max-w-56" src={qrCode.startsWith("data:image/png;base64,") ? qrCode : `data:image/png;base64,${qrCode}`} alt="Código QR da cobrança É-Kwanza" />
        {expirationDate && <p className="mt-3 text-center text-xs text-black/60">Validade: {expirationDate}</p>}
      </div>}
      {paymentExists && !paid && <button className="btn-secondary w-full" disabled={busy} onClick={() => action({ action: "RECONCILE" })}><RefreshCw size={16} /> Consultar gateway</button>}
      {message && <p className="rounded-xl bg-white/[.05] p-3 text-xs text-white/65" role="status">{message}</p>}
    </div>
  );
}
