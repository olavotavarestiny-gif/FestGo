"use client";

import { useEffect, useState } from "react";

type Info = {
  test: true;
  passenger: string;
  event: string;
  pickupPoint: string;
  seat: string;
  reference: string;
  status: string;
  reservationStatus: string;
  used: string[];
};

function tokenFrom(value: string) {
  return value.trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
}

export function TestCheckInScanner({ initialToken = "" }: { initialToken?: string }) {
  const [token, setToken] = useState(initialToken);
  const [info, setInfo] = useState<Info | null>(null);
  const [leg, setLeg] = useState<"OUTBOUND" | "RETURN">("OUTBOUND");
  const [message, setMessage] = useState("");

  async function lookup(value = token) {
    const parsed = tokenFrom(value);
    if (!parsed) return setMessage("QR de teste inválido.");
    setToken(parsed);
    const response = await fetch(`/api/admin/test-tickets/${parsed}/validate`);
    const result = await response.json();
    if (!response.ok) { setInfo(null); return setMessage(result.error); }
    setInfo(result);
    setMessage("");
  }

  async function validate() {
    const response = await fetch(`/api/admin/test-tickets/${token}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leg, deviceId: navigator.userAgent.slice(0, 120) }),
    });
    const result = await response.json();
    setMessage(response.ok ? `${result.passenger}: trajecto de teste aceite.` : result.error);
    if (response.ok) await lookup(token);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial token is immutable for this mounted scanner.
  useEffect(() => { if (initialToken) void lookup(initialToken); }, [initialToken]);

  return (
    <section className="card mt-6 p-6">
      <div className="rounded-xl bg-amber-300 p-3 text-center text-xs font-black text-black">LEITOR EXCLUSIVO DE TESTE</div>
      <div className="mt-5 flex gap-2"><input className="field" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Código ou link do QR de teste" /><button className="btn-secondary" onClick={() => lookup()}>Consultar</button></div>
      {info && <div className="mt-6 rounded-2xl bg-white/[.06] p-5"><p className="text-xl font-black">{info.passenger}</p><p className="mt-2 text-sm text-white/50">TESTE · {info.seat} · {info.reference}</p><div className="mt-5 grid grid-cols-2 gap-2"><button className={leg === "OUTBOUND" ? "btn-primary" : "btn-secondary"} onClick={() => setLeg("OUTBOUND")}>Ida {info.used.includes("OUTBOUND") ? "✓" : ""}</button><button className={leg === "RETURN" ? "btn-primary" : "btn-secondary"} onClick={() => setLeg("RETURN")}>Regresso {info.used.includes("RETURN") ? "✓" : ""}</button></div><button className="btn-primary mt-4 w-full disabled:opacity-40" disabled={info.used.includes(leg) || info.status !== "VALID" || info.reservationStatus !== "PAID"} onClick={validate}>Confirmar validação de teste</button></div>}
      {message && <p className="mt-5 rounded-xl bg-white/[.06] p-4 text-sm" role="status">{message}</p>}
    </section>
  );
}
