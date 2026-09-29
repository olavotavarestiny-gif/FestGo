"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Clock3, RefreshCw, X } from "lucide-react";

type State = {
  status: string;
  reservationReference?: string;
  ticketUrl?: string;
  error?: string;
};

export function PaymentResult({
  reservationId,
  accessToken,
  cancelled,
}: {
  reservationId: string;
  accessToken: string;
  cancelled: boolean;
}) {
  const [state, setState] = useState<State>({
    status: cancelled ? "CANCELLED_BY_CUSTOMER" : "LOADING",
  });
  const [busy, setBusy] = useState(false);
  const paidTracked = useRef(false);

  const refresh = useCallback(async () => {
    if (!reservationId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/payments/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, accessToken }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ?? "Não foi possível consultar o pagamento.",
        );
      setState({
        status: result.status,
        reservationReference: result.reservationReference,
        ticketUrl: result.ticketUrl,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o pagamento.",
      }));
    } finally {
      setBusy(false);
    }
  }, [reservationId, accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (
      cancelled ||
      !["LOADING", "PENDING", "UNKNOWN", "AWAITING_CONFIRMATION", "created", "pending", "processing"].includes(
        state.status,
      )
    )
      return;
    const interval = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(interval);
  }, [cancelled, refresh, state.status]);

  const paid = state.status === "SUCCEEDED";
  const awaitingConfirmation = state.status === "AWAITING_CONFIRMATION";
  const pending = [
    "LOADING",
    "CREATED",
    "PENDING",
    "UNKNOWN",
    "AWAITING_CONFIRMATION",
    "created",
    "pending",
    "processing",
  ].includes(state.status);

  useEffect(() => {
    if (!paid || paidTracked.current) return;
    paidTracked.current = true;
    window.dispatchEvent(new CustomEvent("festgo:analytics", { detail: { name: "purchase_confirmed", reference: state.reservationReference ?? "" } }));
    const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, string>> };
    analyticsWindow.dataLayer?.push({ event: "purchase_confirmed", reference: state.reservationReference ?? "" });
  }, [paid, state.reservationReference]);
  return (
    <main className="min-h-screen bg-[#0c0a12] px-5 py-10 text-white">
      <div className="mx-auto max-w-xl pt-16 text-center">
        <div
          className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${paid ? "bg-emerald-400/15 text-emerald-300" : pending ? "bg-violet/15 text-violet-300" : "bg-amber-400/15 text-amber-300"}`}
        >
          {paid ? (
            <Check size={38} />
          ) : pending ? (
            <Clock3 size={38} />
          ) : (
            <X size={38} />
          )}
        </div>
        {state.reservationReference && (
          <p className="eyebrow mt-8">{state.reservationReference}</p>
        )}
        <h1 className="mt-3 text-4xl font-black tracking-tight">
          {paid
            ? "Pagamento confirmado."
            : awaitingConfirmation
              ? "Pagamento recebido."
            : pending
              ? "Pagamento pendente."
              : cancelled
                ? "Checkout interrompido."
                : "Pagamento não confirmado."}
        </h1>
        <p className="mt-5 leading-7 text-white/55">
          {paid
            ? "O processador confirmou o pagamento e os bilhetes foram emitidos."
            : awaitingConfirmation
              ? "A FestGo recebeu a confirmação do processador. A equipa vai validar o pagamento antes de ocupar os lugares e emitir os bilhetes."
            : pending
              ? "A confirmação ainda não chegou. Podes consultar novamente sem criar outra cobrança."
              : "Não emitimos bilhetes. Se chegaste a pagar, consulta novamente antes de tentar outro pagamento."}
        </p>
        {state.error && (
          <p role="alert" className="mt-4 text-sm text-rose-300">
            {state.error}
          </p>
        )}
        {!paid && (
          <button
            onClick={refresh}
            disabled={busy || !reservationId}
            className="btn-primary mt-7 disabled:opacity-50"
          >
            <RefreshCw size={17} className={busy ? "animate-spin" : ""} />
            {busy ? "A consultar…" : "Consultar novamente"}
          </button>
        )}
        {paid && state.ticketUrl && (
          <div>
            <Link href={state.ticketUrl} className="btn-primary mt-7">
              Abrir os meus bilhetes
            </Link>
          </div>
        )}
        <div>
          <Link href="/" className="btn-secondary mt-5">
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
