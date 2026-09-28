"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    } finally {
      setBusy(false);
    }
  }

  if (reservationStatus !== "PAYMENT_PENDING") return null;
  const canUse = invitation && ["ACTIVE", "CONFIRMED"].includes(invitation.state);
  const sent = sms?.status === "SENT";
  const canRetry = (sms?.attempts ?? 0) < 3;

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

      {!canUse && (
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
              <blockquote className="sms-preview">{preview.content}</blockquote>
              <div className="sms-meta">
                <span>{preview.characterCount} caracteres</span>
                <span>{preview.encoding}</span>
                <span>{preview.segments} segmentos</span>
                <span>{sms?.attempts ?? 0}/3 tentativas</span>
              </div>
              {preview.segments > 1 && (
                <p className="sms-warning">
                  Aviso de custo: esta mensagem usa {preview.segments} segmentos. O envio só acontece após confirmação manual.
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
                        `Enviar este SMS agora? Custo estimado: ${preview.segments} segmentos.\n\n${preview.content}`,
                      )
                    )
                      void action(
                        {
                          action: "SEND_SMS",
                          acknowledgeMultipleSegments: preview.segments > 1 || preview.encoding !== "GSM-7",
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
      {message && <p role="status" className="mt-3 text-sm text-violet-200">{message}</p>}
    </section>
  );
}
