"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Route = { id: string; name: string; capacity: number; active: boolean; whatsappGroupUrl: string | null; pickupPoints: { id: string; name: string; address: string; departureAt: string | null; operationalConfirmed: boolean }[] };
function luandaTime(value: string | null) { return value ? new Date(new Date(value).getTime() + 3600_000).toISOString().slice(0, 16) : ""; }
export function RouteOperationsSettings({ route }: { route: Route }) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(route.capacity);
  const [active, setActive] = useState(route.active);
  const [whatsapp, setWhatsapp] = useState(route.whatsappGroupUrl ?? "");
  const [points, setPoints] = useState(route.pickupPoints.map((point) => ({ ...point, departureAt: luandaTime(point.departureAt) })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/routes/${route.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capacity, active, whatsappGroupUrl: whatsapp, pickupPoints: points.map((point) => ({ ...point, departureAt: point.departureAt ? new Date(`${point.departureAt}:00+01:00`).toISOString() : null })) }) });
      const result = await response.json(); setMessage(response.ok ? "Operação guardada." : result.error);
      if (response.ok) router.refresh();
    } catch { setMessage("Falha de ligação. Tenta novamente."); } finally { setBusy(false); }
  }
  return <details className="card p-5"><summary className="cursor-pointer font-bold">{route.name} · operação e grupo</summary><div className="admin-settings mt-4">
    <label>Capacidade da rota<input type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></label>
    <label className="admin-check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Rota activa</label>
    <label>Grupo WhatsApp privado<input type="url" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="https://chat.whatsapp.com/…" autoComplete="off" /></label>
    <small>Disponível apenas aos clientes com pagamento confirmado nesta rota.</small>
    {points.map((point, index) => <fieldset key={point.id} className="mt-3 space-y-3 border-t border-white/10 pt-4"><legend>{point.name}</legend>
      <label>Nome<input value={point.name} onChange={(event) => setPoints((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
      <label>Morada exacta<input value={point.address} onChange={(event) => setPoints((current) => current.map((item, i) => i === index ? { ...item, address: event.target.value } : item))} /></label>
      <label>Partida · hora de Luanda<input type="datetime-local" value={point.departureAt} onChange={(event) => setPoints((current) => current.map((item, i) => i === index ? { ...item, departureAt: event.target.value } : item))} /></label>
      <label className="admin-check"><input type="checkbox" checked={point.operationalConfirmed} onChange={(event) => setPoints((current) => current.map((item, i) => i === index ? { ...item, operationalConfirmed: event.target.checked } : item))} /> Zona disponível para venda</label>
      <small>O horário e a morada exacta podem ser confirmados até 25/10/2026. Preenche ambos antes dessa data para enviar o SMS de embarque.</small>
    </fieldset>)}
    <button disabled={busy} onClick={save}>{busy ? "A guardar…" : "Guardar operação"}</button><p role="status">{message}</p>
  </div></details>;
}
