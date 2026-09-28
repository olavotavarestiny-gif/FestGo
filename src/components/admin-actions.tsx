"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminActions({
  eventStatus,
  preReservationMode = false,
  exportHref = "/api/admin/passengers.csv",
}: {
  eventStatus: string;
  preReservationMode?: boolean;
  exportHref?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function setSales(status: "ON_SALE" | "CLOSED") {
    setBusy(true);
    setError("");
    const response = await fetch("/api/admin/event", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok)
      return setError(result.error || "Não foi possível alterar as vendas.");
    router.refresh();
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href={exportHref} className="btn-secondary">
        Exportar passageiros
      </a>
      {!preReservationMode && (eventStatus === "ON_SALE" ? (
        <button
          disabled={busy}
          onClick={() => setSales("CLOSED")}
          className="btn-secondary"
        >
          Fechar vendas
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={() => setSales("ON_SALE")}
          className="btn-primary"
        >
          Abrir vendas
        </button>
      ))}
      {!preReservationMode && <a href="/operacoes/check-in" className="btn-secondary">
        Check-in
      </a>}
      <button onClick={logout} className="text-sm text-white/45">
        Sair
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
