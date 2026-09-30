"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import { PaymentResult } from "@/components/payment-result";
import { rememberCheckout, type CheckoutAccess } from "@/lib/checkout-session";
import { trackClarityEvent } from "@/lib/clarity";
import { formatKz } from "@/lib/data";

export type PaymentProvider = "wipay" | "paygo" | "ekwanza";

export function PaymentCheckout({ access, reference, eventName, quantity, total, discount, pickupName, departureAt, holdExpiresAt, status, hasPayment, paymentProvider, paymentProviders, paymentsEnabled }: {
  access: CheckoutAccess;
  reference: string;
  eventName: string;
  quantity: number;
  total: number;
  discount: number;
  pickupName: string;
  departureAt: string | null;
  holdExpiresAt: string | null;
  status: string;
  hasPayment: boolean;
  paymentProvider: PaymentProvider;
  paymentProviders: PaymentProvider[];
  paymentsEnabled: boolean;
}) {
  const [provider, setProvider] = useState(paymentProvider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(hasPayment || ["PAID", "PAYMENT_UNCERTAIN", "AWAITING_PAYMENT"].includes(status));
  const [expired, setExpired] = useState(false);
  const inFlight = useRef(false);
  const paymentStartedTracked = useRef(false);
  useEffect(() => { rememberCheckout(access); }, [access]);
  useEffect(() => {
    if (!holdExpiresAt) return;
    const update = () => setExpired(new Date(holdExpiresAt).getTime() <= Date.now());
    update();
    const timer = window.setInterval(update, 10_000);
    return () => window.clearInterval(timer);
  }, [holdExpiresAt]);

  async function startPayment() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/payments/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...access, method: "multicaixa", provider }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível iniciar o pagamento.");
      if (!paymentStartedTracked.current) {
        paymentStartedTracked.current = true;
        trackClarityEvent("payment_started");
      }
      const paymentUrl = result.details?.paymentUrl;
      if (typeof paymentUrl === "string" && /^https:\/\//.test(paymentUrl)) { window.location.assign(paymentUrl); return; }
      setChecking(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A ligação falhou. Consulta o estado antes de tentares novamente.");
      // A lost response can hide a successful provider request. Read the status before retrying.
      setChecking(true);
    } finally { setBusy(false); inFlight.current = false; }
  }

  if (checking) return <PaymentResult reservationId={access.reservationId} accessToken={access.accessToken} cancelled={false} onRetry={() => { setChecking(false); setError(""); }} />;
  const closed = expired || ["EXPIRED", "CANCELLED", "REFUNDED"].includes(status);
  return <main className="pre-page checkout-page"><header className="pre-header"><div className="pre-shell"><Link href="/" aria-label="FestGo — início"><Logo /></Link><span className="checkout-secure"><LockKeyhole size={16} /> Pagamento seguro</span></div></header><div className="checkout-payment-shell"><section className="pre-panel"><p className="eyebrow" data-clarity-mask="true">Reserva {reference}</p><h1>{closed ? "O prazo desta reserva terminou." : "Conclui a tua reserva."}</h1><p className="pre-intro">{closed ? "Os bilhetes só são emitidos após confirmação de pagamento. Podes iniciar uma nova reserva para consultar a disponibilidade." : "O valor foi calculado e validado pela FestGo. Os teus bilhetes aparecem no website assim que o pagamento for confirmado."}</p><dl className="pre-summary-list"><Row label="Evento" value={eventName} /><Row label="Passageiros" value={String(quantity)} /><Row label="Embarque" value={pickupName} /><Row label="Horário" value={departureAt ? new Date(departureAt).toLocaleString("pt-AO", { timeZone: "Africa/Luanda", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "Por confirmar"} />{discount > 0 && <Row label="Desconto aplicado" value={formatKz(discount)} />}<Row label="Total a pagar" value={formatKz(total)} /></dl>{!closed && <>{holdExpiresAt && <p className="checkout-help">Conclui o pagamento até às {new Date(holdExpiresAt).toLocaleTimeString("pt-AO", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" })} (hora de Angola). A disponibilidade é verificada no pagamento.</p>}{paymentProviders.length > 1 && <label className="pre-field-label">Serviço de pagamento<select className="pre-field" disabled={busy} value={provider} onChange={(e) => setProvider(e.target.value as PaymentProvider)}>{paymentProviders.map((item) => <option key={item} value={item}>{providerName(item)}</option>)}</select></label>}<div className="pre-alert mt-5"><LockKeyhole size={18} /><span>{provider === "wipay" ? "Vais abrir o ambiente seguro de pagamento da WiPay e depois regressar à FestGo." : "Segue as instruções do serviço de pagamento. Mantém esta página aberta para acompanhar a confirmação."}</span></div>{!paymentsEnabled && <p className="pre-error" role="status">O pagamento está temporariamente indisponível. A tua referência mantém-se guardada.</p>}{error && <p className="pre-error" role="alert">{error}</p>}<button className="home-cta checkout-pay-button" disabled={busy || !paymentsEnabled} onClick={startPayment}>{busy ? "A iniciar pagamento…" : `Pagar ${formatKz(total)}`}<ArrowRight size={18} /></button></>}{closed && <Link href="/reservar" className="home-cta">Consultar novas reservas</Link>}<p className="checkout-help">Ao continuar, aplicam-se os <Link href="/termos" target="_blank" rel="noreferrer">termos</Link> e as <Link href="/cancelamentos" target="_blank" rel="noreferrer">condições de cancelamento</Link>.</p></section></div></main>;
}
function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function providerName(provider: PaymentProvider) { return provider === "wipay" ? "WiPay" : provider === "ekwanza" ? "É-Kwanza / Multicaixa Express" : "PayGo / Multicaixa Express"; }
