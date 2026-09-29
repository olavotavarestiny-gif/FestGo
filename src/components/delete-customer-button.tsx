"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCustomerButton({
  customerId,
  disabled,
}: {
  customerId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const confirmation = window.prompt(
      "Esta acção elimina definitivamente o contacto e as inscrições sem pagamento. Escreve APAGAR para continuar.",
    );
    if (confirmation !== "APAGAR") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/customers/${customerId}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível eliminar o contacto.");
      router.push("/admin");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível eliminar o contacto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <button
        className="rounded-xl bg-rose-900 px-4 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || busy}
        onClick={remove}
      >
        {busy ? "A eliminar…" : "Eliminar contacto"}
      </button>
      <p className="mt-2 text-xs leading-5 text-white/35">
        {disabled
          ? "Protegido porque possui pagamento, bilhete ou reserva activa."
          : "Disponível apenas para contactos sem pagamentos ou bilhetes."}
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
