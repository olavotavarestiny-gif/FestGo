"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const options = [
  ["TO_CONTACT", "Por contactar"],
  ["CONTACTED", "Contactado"],
  ["AWAITING_PAYMENT", "A aguardar pagamento"],
  ["NO_RESPONSE", "Sem resposta"],
] as const;

type ApprovalSms = {
  status: string;
  attempts: number;
  providerMessageId: string | null;
  providerStatus: string | null;
  sentAt: string | null;
  lastError: string | null;
} | null;

type SmsPreview = {
  content: string;
  characterCount: number;
  encoding: string;
  segments: number;
  isSingleSegment: boolean;
};

export function PreReservationAdminActions({
  id,
  current,
  reservationStatus,
  canResendSms,
  approvalSms,
  approvalPreview,
}: {
  id: string;
  current: string;
  reservationStatus: string;
  canResendSms: boolean;
  approvalSms: ApprovalSms;
  approvalPreview: SmsPreview;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = ["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"].includes(reservationStatus);

  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/pre-reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(response.ok ? success : result.error || "Não foi possível concluir a acção.");
      if (response.ok) {
        setComment("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateContact(nextStatus = status) {
    setStatus(nextStatus);
    await action(
      { action: "CONTACT", status: nextStatus, comment },
      nextStatus === "CONTACTED" ? "Cliente marcado como contactado." : "Acompanhamento guardado.",
    );
  }

  async function approve() {
    if (!window.confirm("Aprovar esta pré-reserva? O pagamento continuará por confirmar.")) return;
    await action({ action: "APPROVE" }, "Pré-reserva aprovada. Já podes enviar o SMS.");
  }

  async function sendApprovalSms() {
    if (!window.confirm(`Enviar agora este SMS para o cliente?\n\n${approvalPreview.content}`)) return;
    await action({ action: "SEND_APPROVAL_SMS" }, "SMS de aprovação aceite pela Ziett.");
  }

  async function resendRegistrationSms() {
    await action({ action: "RESEND_SMS" }, "SMS de inscrição reagendado.");
  }

  async function release() {
    if (!window.confirm("Cancelar esta inscrição e libertar os lugares pretendidos?")) return;
    await action({ action: "RELEASE" }, "Inscrição cancelada e lugares libertados.");
  }

  const approvalSent = approvalSms?.status === "SENT";
  const approvalSending = approvalSms?.status === "PROCESSING";
  const retryAllowed = (approvalSms?.attempts ?? 0) < 3;

  return (
    <div className="space-y-5">
      {active && (
        <section className="admin-action-card">
          <h3>Acompanhamento</h3>
          <div className="admin-followup mt-3">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Comentário da tentativa" />
            <button disabled={busy} onClick={() => updateContact()}>Guardar acompanhamento</button>
            {current !== "CONTACTED" && <button disabled={busy} onClick={() => updateContact("CONTACTED")}>Marcar como contactado</button>}
          </div>
        </section>
      )}

      {reservationStatus === "PRE_RESERVED" && (
        <section className="admin-action-card">
          <h3>Aprovação manual</h3>
          <p>A aprovação não confirma o pagamento e não envia SMS automaticamente.</p>
          <button className="admin-approve mt-3" disabled={busy} onClick={approve}>Aprovar pré-reserva</button>
        </section>
      )}

      {reservationStatus === "PAYMENT_PENDING" && (
        <section className="admin-action-card">
          <div className="flex items-center justify-between gap-3"><h3>SMS de aprovação</h3><span className={approvalPreview.isSingleSegment ? "sms-cost-ok" : "sms-cost-warning"}>{approvalPreview.segments} segmento{approvalPreview.segments === 1 ? "" : "s"}</span></div>
          <blockquote className="sms-preview">{approvalPreview.content}</blockquote>
          <div className="sms-meta"><span>{approvalPreview.characterCount}/160 caracteres</span><span>{approvalPreview.encoding}</span><span>{approvalSms?.attempts ?? 0}/3 tentativas</span></div>
          {!approvalPreview.isSingleSegment && <p className="sms-warning">Aviso: a mensagem ultrapassa um segmento e o envio está bloqueado.</p>}
          {approvalSms?.lastError && <p className="sms-warning">Última falha: {approvalSms.lastError}</p>}
          {approvalSent ? <p className="mt-3 text-xs font-bold text-emerald-300">SMS enviado em {approvalSms.sentAt ? new Date(approvalSms.sentAt).toLocaleString("pt-AO") : "data registada"}. Estado Ziett: {approvalSms.providerStatus ?? "aceite"}.</p> : <button className="admin-approve mt-3" disabled={busy || approvalSending || !approvalPreview.isSingleSegment || !retryAllowed} onClick={sendApprovalSms}>{approvalSms?.status === "FAILED" ? "Tentar envio novamente" : approvalSending ? "Envio em processamento…" : "Enviar SMS de aprovação"}</button>}
        </section>
      )}

      {canResendSms && active && <button className="admin-secondary-action" disabled={busy} onClick={resendRegistrationSms}>Reenviar SMS de inscrição</button>}
      {active && <button className="admin-danger admin-secondary-action" disabled={busy} onClick={release}>Cancelar e libertar lugares</button>}
      {message && <p role="status" className="text-sm text-violet-200">{message}</p>}
    </div>
  );
}
