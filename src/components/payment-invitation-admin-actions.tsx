"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeSms } from "@/lib/sms";

type Invitation = {
  state: "ACTIVE" | "CONFIRMED" | "EXPIRED" | "REVOKED";
  link: string | null;
  expiresAt: string;
  confirmedAt: string | null;
} | null;

type Sms = {
  status: string;
  attempts: number;
  providerStatus: string | null;
  sentAt: string | null;
  lastError: string | null;
} | null;

export function PaymentInvitationAdminActions({
  reservationId,
  reservationStatus,
  invitation,
  sms,
  preview,
  paymentReference,
}: {
  reservationId: string;
  reservationStatus: string;
  invitation: Invitation;
  sms: Sms;
  preview: {
    content: string;
    characterCount: number;
    encoding: string;
    segments: number;
  } | null;
  paymentReference: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [customMessage, setCustomMessage] = useState(preview?.content ?? "");
  const [transactionReference, setTransactionReference] = useState(paymentReference ?? "");

  useEffect(() => {
    if (preview?.content && !customMessage) setCustomMessage(preview.content);
  }, [customMessage, preview?.content]);

  async function action(
    body: Record<string, unknown>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/payment-invitations/${reservationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      setMessage(response.ok ? success : result.error ?? "Não foi possível concluir a acção.");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Não foi possível comunicar com o servidor. Confirma a ligação e tenta novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (!["PAYMENT_PENDING", "PAYMENT_UNCERTAIN"].includes(reservationStatus))
    return null;
  const canUse = invitation && ["ACTIVE", "CONFIRMED"].includes(invitation.state);
  const sent = sms?.status === "SENT";
  const canRetry = (sms?.attempts ?? 0) < 3;
  const customAnalysis = analyzeSms(customMessage);

  return (
    <section className="admin-action-card">
      <div className="flex items-center justify-between gap-3">
        <h3>Convite de pagamento</h3>
        <span className={canUse ? "sms-cost-ok" : "sms-cost-warning"}>
          {invitation?.state ?? "NÃO GERADO"}
        </span>
      </div>
      <p>
        O link abre primeiro a página FestGo. Nenhuma cobrança é criada nesta fase.
      </p>

      {!canUse && reservationStatus === "PAYMENT_PENDING" && (
        <button
          className="admin-approve mt-3"
          disabled={busy}
          onClick={() => action({ action: "GENERATE" }, "Link individual gerado.")}
        >
          Gerar link de pagamento
        </button>
      )}

      {canUse && invitation.link && (
        <>
          <div className="invite-admin-meta">
            <small>Validade</small>
            <b>{new Date(invitation.expiresAt).toLocaleString("pt-AO")}</b>
            {invitation.confirmedAt && <small>Cliente confirmou os dados em {new Date(invitation.confirmedAt).toLocaleString("pt-AO")}.</small>}
          </div>
          <a
            className="admin-approve admin-link-preview mt-3"
            href={invitation.link}
            target="_blank"
            rel="noreferrer"
          >
            Pré-visualizar link
          </a>

          {preview && (
            <div className="mt-4">
              <label className="gateway-test-field">
                Mensagem SMS
                <textarea
                  className="min-h-32 resize-y py-3"
                  maxLength={800}
                  disabled={sent || busy}
                  value={customMessage}
                  onChange={(event) => setCustomMessage(event.target.value)}
                />
              </label>
              <p className="mt-2 text-[10px] leading-4 text-white/40">
                Podes escrever a mensagem e colar o link directo do gateway. O texto deve incluir um link HTTPS.
              </p>
              <div className="sms-meta">
                <span>{customAnalysis.characterCount} caracteres</span>
                <span>{customAnalysis.encoding}</span>
                <span>{customAnalysis.segments} segmentos</span>
                <span>{sms?.attempts ?? 0}/3 tentativas</span>
              </div>
              {customAnalysis.segments > 1 && (
                <p className="sms-warning">
                  Aviso de custo: esta mensagem usa {customAnalysis.segments} segmentos. O envio só acontece após confirmação manual.
                </p>
              )}
              {sms?.lastError && <p className="sms-warning">Última falha: {sms.lastError}</p>}
              {sent ? (
                <p className="mt-3 text-xs font-bold text-emerald-300">
                  Link enviado em {sms.sentAt ? new Date(sms.sentAt).toLocaleString("pt-AO") : "data registada"}. Estado Ziett: {sms.providerStatus ?? "aceite"}.
                </p>
              ) : (
                <button
                  className="admin-approve mt-3"
                  disabled={busy || !canRetry || sms?.status === "PROCESSING"}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Enviar este SMS agora? Custo estimado: ${customAnalysis.segments} segmentos.\n\n${customMessage}`,
                      )
                    )
                      void action(
                        {
                          action: "SEND_SMS",
                          content: customMessage,
                          acknowledgeMultipleSegments: customAnalysis.segments > 1 || customAnalysis.encoding !== "GSM-7",
                        },
                        "Link aceite pela Ziett.",
                      );
                  }}
                >
                  {sms?.status === "FAILED" ? "Tentar envio novamente" : "Enviar link por SMS"}
                </button>
              )}
            </div>
          )}

          <button
            className="admin-danger admin-secondary-action mt-4"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Revogar este convite? O link deixará de funcionar imediatamente."))
                void action({ action: "REVOKE" }, "Convite revogado.");
            }}
          >
            Revogar convite
          </button>
        </>
      )}
      {invitation && (
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3>Confirmar pagamento recebido</h3>
          <p>Usa esta acção apenas depois de confirmares o movimento no portal ou na conta. Só então os lugares ficam ocupados e os bilhetes são emitidos.</p>
          {paymentReference && (
            <p className="mt-2 break-all text-[10px] text-emerald-300">
              O gateway registou o pagamento: {paymentReference}
            </p>
          )}
          <label className="gateway-test-field mt-3">
            Referência da transacção
            <input
              maxLength={160}
              value={transactionReference}
              onChange={(event) => setTransactionReference(event.target.value)}
              placeholder="ID ou referência confirmada no gateway"
            />
          </label>
          <button
            className="admin-approve mt-3"
            disabled={busy || transactionReference.trim().length < 4}
            onClick={() => {
              if (window.confirm("Confirmas que verificaste este pagamento? Esta acção ocupa os lugares e emite os bilhetes."))
                void action(
                  { action: "CONFIRM_MANUAL_PAYMENT", transactionReference },
                  "Pagamento confirmado, lugares ocupados e bilhetes emitidos.",
                );
            }}
          >
            Confirmar pagamento e ocupar lugares
          </button>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-violet-200">{message}</p>}
    </section>
  );
}
