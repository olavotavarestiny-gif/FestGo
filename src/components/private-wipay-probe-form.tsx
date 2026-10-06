"use client";

import { useState } from "react";

export function PrivateWiPayProbeForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ reference: string; url: string } | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/private-wipay-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível preparar o teste.");
      setResult({ reference: data.reference, url: data.url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível preparar o teste.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card p-6 sm:p-8">
    <h2 className="text-xl font-black">Teste privado do checkout público · 100 Kz</h2>
    <p className="mt-2 text-sm text-white/65">Cria uma única reserva técnica, sem viagem, com a WiPay de produção. O pagamento regressa à página pública e usa o callback real. Introduz o teu próprio número de Multicaixa Express. Não envia SMS nem abre vendas gerais.</p>
    {!result ? <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={create}>
      <label className="text-sm font-bold">Nome para o teste<input className="pre-field mt-2" autoComplete="name" required minLength={4} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="text-sm font-bold">Telemóvel para pagar<input className="pre-field mt-2" autoComplete="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <button className="home-cta sm:col-span-2" type="submit" disabled={busy}>{busy ? "A preparar…" : "Criar link privado de 100 Kz"}</button>
    </form> : <div className="mt-5 space-y-3"><p className="font-mono text-violet-300">{result.reference}</p><a className="home-cta" href={result.url}>Abrir checkout público de 100 Kz</a><p className="text-xs text-white/50">Guarda este link antes de pagar. Só esta reserva pode usar a excepção privada.</p></div>}
    {error && <p className="mt-4 text-sm text-red-300" role="alert">{error}</p>}
  </section>;
}
