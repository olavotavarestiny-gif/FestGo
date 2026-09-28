"use client";

import { useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { formatKz } from "@/lib/data";

const TEST_CHECKOUT_URL =
  "https://app.paygochekout.com/checkout/20d032f3-e0c2-48d3-8ce1-c93bc682dd37";

type Result = {
  paymentId: string;
  status: string;
  method: string;
  amount: number;
  currency: string;
  paymentUrl: string | null;
  reference: {
    entity?: string;
    reference_number?: string;
    expiration_date?: string;
  } | null;
  instructions: string | null;
};

export function GatewayTestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"multicaixa" | "reference">("multicaixa");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function createTestPayment() {
    if (
      !window.confirm(
        "Criar uma cobrança administrativa de teste no valor de 100 Kz? Esta acção chama o gateway real, mas não afecta reservas ou bilhetes.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/payment-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, method, confirmation: confirmed }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Não foi possível criar o teste.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no teste.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="card p-6 sm:p-8">
        <p className="eyebrow">Teste administrativo isolado</p>
        <h1 className="mt-2 text-3xl font-black">Gateway · 100 Kz</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
          Este teste utiliza exclusivamente o produto de 100 Kz. Não altera
          preços oficiais, reservas, lugares ou bilhetes.
        </p>
        <a
          className="btn-secondary mt-5 inline-flex"
          href={TEST_CHECKOUT_URL}
          target="_blank"
          rel="noreferrer"
        >
          Pré-visualizar checkout de 100 Kz <ExternalLink size={16} />
        </a>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <label className="gateway-test-field sm:col-span-2">
            Nome para o teste
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>
          <label className="gateway-test-field">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} />
          </label>
          <label className="gateway-test-field">
            Telefone angolano
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+244 9XX XXX XXX" maxLength={24} />
          </label>
          <label className="gateway-test-field sm:col-span-2">
            Método devolvido pelo gateway
            <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option value="multicaixa">Multicaixa / Express</option>
              <option value="reference">Referência</option>
            </select>
          </label>
        </div>

        <label className="mt-6 flex items-start gap-3 text-sm text-white/65">
          <input className="mt-1 accent-violet-500" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Confirmo que pretendo criar uma cobrança externa isolada de exactamente 100 Kz.
        </label>
        {error && <p className="mt-5 rounded-xl bg-rose-400/10 p-4 text-sm text-rose-200" role="alert">{error}</p>}
        <button
          className="btn-primary mt-6"
          disabled={busy || !confirmed || !name || !email || !phone || Boolean(result)}
          onClick={createTestPayment}
        >
          {busy ? "A criar no gateway…" : "Criar pagamento de teste de 100 Kz"}
        </button>
      </section>

      <aside className="card h-fit p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet-300"><ShieldCheck size={21} /></span>
        <h2 className="mt-5 font-black">Resultado do gateway</h2>
        {!result && <p className="mt-2 text-xs leading-5 text-white/40">O identificador, estado, referência ou página de pagamento aparecerão aqui.</p>}
        {result && (
          <dl className="gateway-test-result">
            <div><dt>Valor confirmado</dt><dd>{formatKz(result.amount)}</dd></div>
            <div><dt>Estado</dt><dd>{result.status}</dd></div>
            <div><dt>ID do pagamento</dt><dd className="break-all">{result.paymentId}</dd></div>
            {result.reference?.entity && <div><dt>Entidade</dt><dd>{result.reference.entity}</dd></div>}
            {result.reference?.reference_number && <div><dt>Referência</dt><dd>{result.reference.reference_number}</dd></div>}
            {result.reference?.expiration_date && <div><dt>Validade</dt><dd>{result.reference.expiration_date}</dd></div>}
          </dl>
        )}
        {result?.instructions && <p className="mt-4 rounded-xl bg-white/[.05] p-3 text-xs leading-5 text-white/60">{result.instructions}</p>}
        {result?.paymentUrl && (
          <a className="btn-primary mt-5 w-full" href={result.paymentUrl} target="_blank" rel="noreferrer">
            Abrir página de pagamento <ExternalLink size={16} />
          </a>
        )}
        {result && !result.paymentUrl && (
          <p className="mt-4 text-xs leading-5 text-amber-200">
            O gateway não devolveu uma página externa. Utiliza a entidade e a referência apresentadas acima.
          </p>
        )}
      </aside>
    </div>
  );
}
