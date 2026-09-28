const ZIETT_MESSAGES_URL = "https://api.ziett.co/c/v1/messages";

type ZiettMessageResponse = {
  message_id?: string;
  id?: string;
  status?: string;
};

export class ZiettError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "ZiettError";
  }
}

function normalizeAngolanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("244") ? digits.slice(3) : digits;
  if (!/^9\d{8}$/.test(national)) {
    throw new ZiettError("Indica um número de telemóvel angolano válido.");
  }
  return `+244${national}`;
}

export async function sendSms({
  phone,
  content,
  idempotencyKey,
}: {
  phone: string;
  content: string;
  idempotencyKey: string;
}): Promise<{ messageId: string; providerStatus: string }> {
  const apiKey = process.env.ZIETT_API_KEY ?? process.env.SMS_PROVIDER_API_KEY;
  const remitterId = process.env.ZIETT_SMS_REMITTER_ID;
  if (!apiKey)
    throw new ZiettError("Falta configurar ZIETT_API_KEY no servidor.");
  if (!remitterId)
    throw new ZiettError("Falta configurar ZIETT_SMS_REMITTER_ID no servidor.");
  if (!content.trim() || content.length > 1600)
    throw new ZiettError("O conteúdo do SMS é inválido.");

  const response = await fetch(ZIETT_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      remitter_id: remitterId,
      channel_type: "SMS",
      target_e164: normalizeAngolanPhone(phone),
      content,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  const data = (await response
    .json()
    .catch(() => ({}))) as ZiettMessageResponse & { trace_id?: string };
  if (response.status !== 202)
    throw new ZiettError(
      "A Ziett não aceitou o envio do SMS.",
      response.status,
      data.trace_id,
    );
  const messageId = data.message_id ?? data.id;
  if (!messageId)
    throw new ZiettError(
      "A Ziett aceitou o pedido sem devolver o identificador da mensagem.",
    );
  return { messageId, providerStatus: data.status ?? "ACCEPTED" };
}

export async function sendOtpSms({
  phone,
  code,
  idempotencyKey,
}: {
  phone: string;
  code: string;
  idempotencyKey: string;
}): Promise<{ messageId: string }> {
  if (!/^\d{6}$/.test(code))
    throw new ZiettError("O código OTP deve ter seis dígitos.");
  return sendSms({
    phone,
    idempotencyKey,
    content: `FestGO: O teu codigo de verificacao e ${code}. Valido por 5 minutos. Nao partilhes este codigo.`,
  });
}
