"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Clock3, ExternalLink, RefreshCw, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { checkoutUrl, readCheckout, rememberCheckout, type CheckoutAccess } from "@/lib/checkout-session";
import { trackClarityEvent } from "@/lib/clarity";
import { formatKz } from "@/lib/data";

type PaymentState = {
  status: string;
  reservationStatus?: string;
  reservationReference?: string;
  ticketUrl?: string;
  whatsappGroupUrl?: string;
  eventName?: string;
  eventDate?: string;
  quantity?: number;
  total?: number;
  pickupName?: string;
  departureAt?: string;
  canRetry?: boolean;
  details?: { paymentUrl?: string; entity?: string; reference?: string; instructions?: string };
  error?: string;
};

export function PaymentResult({ reservationId, accessToken, cancelled, onRetry }: { reservationId: string; accessToken: string; cancelled: boolean; onRetry?: () => void }) {
  const [access, setAccess] = useState<CheckoutAccess | null>(reservationId && accessToken ? { reservationId, accessToken } : null);
  const [state, setState] = useState<PaymentState>({ status: "LOADING" });
  const [busy, setBusy] = useState(false);
  const paidTracked = useRef(false);
  const failedTracked = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (reservationId && accessToken) rememberCheckout({ reservationId, accessToken });
    else {
      const saved = readCheckout();
      if (saved && (!reservationId || saved.reservationId === reservationId)) setAccess(saved);
      else setState({ status: "MISSING_ACCESS", error: "Abre o link privado da tua reserva para consultar o pagamento." });
    }
  }, [reservationId, accessToken]);

  const refresh = useCallback(async () => {
    if (!access || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch("/api/payments/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(access) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar o pagamento.");
      setState(result);
    } catch (cause) {
      setState((current) => ({ ...current, error: cause instanceof Error ? cause.message : "Não foi possível consultar o pagamento." }));
    } finally { setBusy(false); inFlight.current = false; }
  }, [access]);

  useEffect(() => { void refresh(); }, [refresh]);
  const paid = state.reservationStatus === "PAID" && Boolean(state.ticketUrl);
  const awaitingConfirmation = state.status === "AWAITING_CONFIRMATION";
  const terminal = ["FAILED", "EXPIRED", "CANCELLED", "REFUNDED", "MISSING_ACCESS", "NOT_STARTED", "NONE"].includes(state.status.toUpperCase()) || ["EXPIRED", "CANCELLED", "REFUNDED"].includes(state.reservationStatus ?? "");
  const pending = !paid && !terminal;
  useEffect(() => {
    if (!access || !pending) return;
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 25_000);
    return () => window.clearInterval(interval);
  }, [access, pending, refresh]);
  useEffect(() => {
    if (!paid || paidTracked.current) return;
    paidTracked.current = true;
    trackClarityEvent("payment_success");
    window.dispatchEvent(new CustomEvent("festgo:analytics", { detail: { name: "purchase_confirmed", reference: state.reservationReference ?? "" } }));
    const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, string>> };
    analyticsWindow.dataLayer?.push({ event: "purchase_confirmed", reference: state.reservationReference ?? "" });
  }, [paid, state.reservationReference]);
  useEffect(() => {
    if (state.status.toUpperCase() !== "FAILED" || failedTracked.current) return;
    failedTracked.current = true;
    trackClarityEvent("payment_failed");
  }, [state.status]);

  const paymentUrl = state.details?.paymentUrl;
  const groupUrl = state.whatsappGroupUrl;
  const safePaymentUrl = typeof paymentUrl === "string" && paymentUrl.startsWith("https://") ? paymentUrl : null;
  const safeGroupUrl = typeof groupUrl === "string" && /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(?:\?.*)?$/.test(groupUrl) ? groupUrl : null;
  const notStarted = ["NOT_STARTED", "NONE"].includes(state.status);
  const title = paid ? "Pagamento confirmado." : awaitingConfirmation ? "Pagamento em validação." : state.status === "REFUNDED" || state.reservationStatus === "REFUNDED" ? "Pagamento reembolsado." : state.status === "LOADING" ? "A consultar o pagamento…" : notStarted ? "Pagamento por iniciar." : pending ? "A aguardar confirmação." : cancelled ? "Checkout interrompido." : "Pagamento não confirmado.";

  return <main className="pre-page"><header className="pre-header"><div className="pre-shell"><Link href="/" aria-label="FestGo — início"><Logo /></Link></div></header><div className="checkout-payment-shell"><section className="pre-panel payment-result" aria-live="polite" aria-busy={busy}><span className={`payment-result-icon ${paid ? "is-paid" : ""}`}>{paid ? <Check size={34} /> : pending ? <Clock3 size={34} /> : <X size={34} />}</span>{state.reservationReference && <p className="eyebrow" data-clarity-mask="true">Reserva {state.reservationReference}</p>}<h1>{title}</h1><p className="pre-intro">{paid ? "A tua reserva está confirmada e os bilhetes estão disponíveis aqui. Não precisas de esperar pelo SMS para os abrir." : awaitingConfirmation ? "Recebemos uma indicação do serviço de pagamento e estamos a validar a reserva. A confirmação final e os bilhetes aparecem nesta página." : notStarted ? "Ainda não existe uma cobrança iniciada para esta reserva. Podes continuar para o pagamento." : pending ? "Mantém esta página para acompanhar o estado. Não inicies outra cobrança enquanto a confirmação estiver pendente." : "Ainda não existe uma confirmação válida para emitir bilhetes. Se pagaste, consulta novamente antes de tentar outro pagamento."}</p>
    {paid && <dl className="pre-summary-list">{state.eventName && <Row label="Evento" value={state.eventName} />}{state.eventDate && <Row label="Data" value={new Date(state.eventDate).toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda", day: "numeric", month: "long", year: "numeric" })} />}{state.quantity !== undefined && <Row label="Passageiros" value={String(state.quantity)} />}{state.total !== undefined && <Row label="Total pago" value={formatKz(state.total)} />}{state.pickupName && <Row label="Ponto de embarque" value={state.pickupName} />}{state.departureAt && <Row label="Horário de embarque" value={new Date(state.departureAt).toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" })} />}</dl>}
    {!paid && state.details?.instructions && <div className="pre-alert" data-clarity-mask="true">{state.details.instructions}</div>}
    {!paid && (state.details?.entity || state.details?.reference) && <dl className="pre-summary-list" data-clarity-mask="true">{state.details.entity && <Row label="Entidade" value={state.details.entity} />}{state.details.reference && <Row label="Referência de pagamento" value={state.details.reference} />}</dl>}
    {state.error && <p role="alert" className="pre-error">{state.error}</p>}
    <div className="payment-result-actions">
      {paid && state.ticketUrl && <Link href={state.ticketUrl} className="home-cta">Ver os meus bilhetes <Check size={17} /></Link>}
      {paid && safeGroupUrl && <a href={safeGroupUrl} className="checkout-secondary-button" target="_blank" rel="noopener noreferrer">Entrar no grupo WhatsApp <ExternalLink size={17} /></a>}
      {!paid && safePaymentUrl && pending && <a href={safePaymentUrl} className="home-cta" rel="noreferrer">Continuar no pagamento <ExternalLink size={17} /></a>}
      {!paid && access && <button onClick={refresh} disabled={busy} className="checkout-secondary-button"><RefreshCw size={17} className={busy ? "animate-spin" : ""} />{busy ? "A consultar…" : "Consultar novamente"}</button>}
      {!paid && state.canRetry && (onRetry ? <button onClick={onRetry} className="home-cta">Continuar para pagamento</button> : access && <Link href={`${checkoutUrl(access)}&retry=1`} className="home-cta">Continuar para pagamento</Link>)}
      <Link href="/" className="checkout-text-button">Voltar ao início</Link>
    </div>
  </section></div></main>;
}
function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
