"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function AdminBulkCustomerActions({
  formId,
  eligibleCount,
}: {
  formId: string;
  eligibleCount: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function checkboxes() {
    const form = document.getElementById(formId);
    return form
      ? Array.from(
          form.querySelectorAll<HTMLInputElement>(
            'input[name="customerId"]:not(:disabled)',
          ),
        )
      : [];
  }

  function selectedIds() {
    return [
      ...new Set(
        checkboxes()
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value),
      ),
    ];
  }

  function updateCount() {
    setSelected(selectedIds().length);
  }

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const handleChange = (event: Event) => {
      const changed = event.target;
      if (changed instanceof HTMLInputElement && changed.name === "customerId")
        checkboxes()
          .filter((checkbox) => checkbox.value === changed.value)
          .forEach((checkbox) => {
            checkbox.checked = changed.checked;
          });
      updateCount();
    };
    form.addEventListener("change", handleChange);
    return () => form.removeEventListener("change", handleChange);
  });

  function toggleAll() {
    const inputs = checkboxes();
    const shouldSelect = inputs.some((checkbox) => !checkbox.checked);
    inputs.forEach((checkbox) => {
      checkbox.checked = shouldSelect;
    });
    updateCount();
  }

  async function removeSelected() {
    const ids = selectedIds();
    if (!ids.length) return;
    const confirmation = window.prompt(
      `Vais eliminar ${ids.length} contacto${ids.length === 1 ? "" : "s"} e todas as inscrições não convertidas associadas. Escreve APAGAR para continuar.`,
    );
    if (confirmation !== "APAGAR") return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/customers/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível eliminar os contactos.");
      setMessage(
        `${result.customersDeleted} contacto${result.customersDeleted === 1 ? " eliminado" : "s eliminados"}${result.skipped ? ` · ${result.skipped} protegido${result.skipped === 1 ? "" : "s"}` : ""}.`,
      );
      setSelected(0);
      router.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Não foi possível eliminar os contactos.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-bulk-bar">
      <div>
        <b>{selected ? `${selected} seleccionado${selected === 1 ? "" : "s"}` : "Gestão de contactos"}</b>
        <small>{eligibleCount} contacto{eligibleCount === 1 ? " eliminável" : "s elimináveis"} nesta página</small>
      </div>
      <div className="admin-bulk-actions">
        <button type="button" onClick={toggleAll} disabled={!eligibleCount || busy}>
          {selected === eligibleCount && eligibleCount ? "Limpar selecção" : "Seleccionar elimináveis"}
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={removeSelected}
          disabled={!selected || busy}
        >
          <Trash2 size={15} />
          {busy ? "A eliminar…" : "Eliminar seleccionados"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
