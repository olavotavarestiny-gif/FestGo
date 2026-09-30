import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export type EkwanzaTicket = {
  code: string;
  qrCode: string | null;
  status: number;
  expirationDate: string | null;
};

export type EkwanzaTicketStatus = {
  amount: number;
  code: string;
  creationDate: string | null;
  expirationDate: string | null;
  status: number;
};

export type EkwanzaChargeMethod = "gpo" | "reference";

export type EkwanzaCharge = {
  id: string;
  merchantTransactionId: string;
  status: string;
  paymentUrl: string | null;
  reference: Record<string, string> | null;
  responseKeys: string[];
};

let cachedGpoToken: { value: string; expiresAt: number } | null = null;

export class EkwanzaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "EkwanzaError";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string");
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function config() {
  const baseUrl = process.env.EKWANZA_API_URL?.trim().replace(/\/$/, "");
  const notificationToken = (
    process.env.EKWANZA_NOTIFICATION_TOKEN ?? process.env.TOKENNOTIFICACAO
  )?.trim();
  if (!baseUrl || !notificationToken)
    throw new EkwanzaError(
      "Falta configurar EKWANZA_API_URL e EKWANZA_NOTIFICATION_TOKEN.",
      undefined,
      "CONFIG_MISSING",
    );
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new EkwanzaError(
      "EKWANZA_API_URL não é um endereço válido.",
      undefined,
      "CONFIG_ENDPOINT",
    );
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV !== "test")
    throw new EkwanzaError(
      "O endpoint É-Kwanza deve usar HTTPS.",
      undefined,
      "CONFIG_ENDPOINT",
    );
  return { baseUrl, notificationToken };
}

async function responseJson(response: Response) {
  return objectValue(await response.json().catch(() => ({})));
}

function gpoConfig() {
  const authUrl = (process.env.EKWANZA_AUTH_URL ?? process.env.Url)?.trim();
  const chargesUrl = (
    process.env.EKWANZA_CHARGES_URL ??
    "https://gwy-api.appypay.co.ao/v2.0/charges"
  )
    .trim()
    .replace(/\/$/, "");
  const clientId = (process.env.EKWANZA_CLIENT_ID ?? process.env.ClientID)?.trim();
  const clientSecret = (
    process.env.EKWANZA_CLIENT_SECRET ?? process.env.ClientSecret
  )?.trim();
  const resource = (process.env.EKWANZA_RESOURCE ?? process.env.Resource)?.trim();
  const apiKey = (process.env.EKWANZA_API_KEY ?? process.env.APIKEY)?.trim();
  const merchantIdentifier = process.env.EKWANZA_MERCHANT_IDENTIFIER?.trim();
  if (
    !authUrl ||
    !chargesUrl ||
    !clientId ||
    !clientSecret ||
    !resource ||
    !apiKey ||
    !merchantIdentifier
  )
    throw new EkwanzaError(
      "Falta configurar EKWANZA_CHARGES_URL ou EKWANZA_MERCHANT_IDENTIFIER.",
      undefined,
      "GPO_CONFIG_MISSING",
    );
  for (const [name, value] of [
    ["EKWANZA_AUTH_URL", authUrl],
    ["EKWANZA_CHARGES_URL", chargesUrl],
  ] as const) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new EkwanzaError(
        `${name} não é um endereço válido.`,
        undefined,
        "GPO_ENDPOINT",
      );
    }
    if (url.protocol !== "https:" && process.env.NODE_ENV !== "test")
      throw new EkwanzaError(
        `${name} deve usar HTTPS.`,
        undefined,
        "GPO_ENDPOINT",
      );
    if (
      name === "EKWANZA_CHARGES_URL" &&
      process.env.NODE_ENV !== "test" &&
      (url.hostname !== "gwy-api.appypay.co.ao" ||
        !url.pathname.endsWith("/v2.0/charges"))
    )
      throw new EkwanzaError(
        "EKWANZA_CHARGES_URL deve apontar para o endpoint AppyPay de produção v2.0.",
        undefined,
        "GPO_ENDPOINT",
      );
  }
  return {
    authUrl,
    chargesUrl,
    clientId,
    clientSecret,
    resource,
    apiKey,
    merchantIdentifier,
  };
}

async function gpoAccessToken() {
  if (cachedGpoToken && cachedGpoToken.expiresAt > Date.now() + 60_000)
    return cachedGpoToken.value;
  const configuration = gpoConfig();
  const response = await fetch(configuration.authUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      resource: configuration.resource,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await responseJson(response);
  const token = stringValue(payload.access_token);
  if (!response.ok || !token)
    throw new EkwanzaError(
      "O gateway É-Kwanza recusou a autenticação.",
      response.status,
      "GPO_AUTH_FAILED",
    );
  const expiresIn = numberValue(payload.expires_in);
  cachedGpoToken = {
    value: token,
    expiresAt:
      Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
  return token;
}

export async function validateEkwanzaConfiguration() {
  gpoConfig();
  await gpoAccessToken();
  return true;
}

export async function createEkwanzaCharge(input: {
  amount: number;
  merchantTransactionId: string;
  method: EkwanzaChargeMethod;
  phoneNumber?: string;
  description?: string;
}): Promise<EkwanzaCharge> {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new EkwanzaError("Montante É-Kwanza inválido.");
  if (!/^[A-Za-z0-9]{8,15}$/.test(input.merchantTransactionId))
    throw new EkwanzaError("Identificador da transacção É-Kwanza inválido.");
  const configuration = gpoConfig();
  const configuredMethod = (
    input.method === "gpo"
      ? process.env.EKWANZA_PAYMENT_METHOD_GPO ?? process.env.paymentMethodGPO
      : process.env.EKWANZA_PAYMENT_METHOD_REF ?? process.env.paymentMethodREF
  )?.trim();
  const apiKey = (
    process.env.EKWANZA_API_KEY ?? process.env.APIKEY
  )?.trim();
  if (!configuredMethod || !apiKey)
    throw new EkwanzaError(
      "O método e a API Key É-Kwanza não estão configurados.",
      undefined,
      "GPO_METHOD_MISSING",
    );
  const methodPrefix = input.method === "gpo" ? "GPO_" : "REF_";
  const paymentMethod = configuredMethod.startsWith(methodPrefix)
    ? configuredMethod
    : `${methodPrefix}${configuredMethod}`;
  const phoneNumber = input.phoneNumber?.replace(/\D/g, "").replace(/^244/, "");
  if (input.method === "gpo" && !/^9\d{8}$/.test(phoneNumber ?? ""))
    throw new EkwanzaError("Telefone GPO inválido.");
  const token = await gpoAccessToken();
  const referenceDueDate = new Date(Date.now() + 72 * 60 * 60_000)
    .toISOString()
    .slice(0, 19);
  const response = await fetch(configuration.chargesUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: "AOA",
      description: input.description ?? "FestGO - teste administrativo",
      merchantTransactionId: input.merchantTransactionId,
      paymentMethod,
      paymentInfo:
        input.method === "gpo"
          ? { phoneNumber }
          : {
              referenceNumber: String(randomInt(100_000_000, 1_000_000_000)),
              dueDate: referenceDueDate,
            },
      options: {
        MerchantIdentifier: configuration.merchantIdentifier,
        ApiKey: apiKey,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responseJson(response);
  if (!response.ok)
    throw new EkwanzaError(
      "O gateway É-Kwanza recusou a cobrança.",
      response.status,
      "GPO_CHARGE_REJECTED",
    );
  const responseStatus = objectValue(payload.responseStatus);
  if (responseStatus.successful === false)
    throw new EkwanzaError(
      "O gateway É-Kwanza não aceitou a cobrança.",
      response.status,
      `GPO_STATUS_${String(responseStatus.code ?? "REJECTED")}`,
    );
  const data = objectValue(payload.data);
  const id = stringValue(payload.id, data.id);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    throw new EkwanzaError(
      "A AppyPay não devolveu o identificador da cobrança.",
      undefined,
      "GPO_CHARGE_INVALID",
    );
  const reference = objectValue(payload.reference ?? data.reference);
  const stringReference = Object.fromEntries(
    Object.entries(reference).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const candidateUrl = stringValue(
    payload.paymentUrl,
    payload.payment_url,
    payload.redirectUrl,
    data.paymentUrl,
    data.payment_url,
  );
  let paymentUrl: string | null = null;
  try {
    if (candidateUrl && new URL(candidateUrl).protocol === "https:")
      paymentUrl = candidateUrl;
  } catch {}
  return {
    id,
    merchantTransactionId: input.merchantTransactionId,
    status:
      stringValue(payload.status, data.status, payload.message) ?? "created",
    paymentUrl,
    reference:
      Object.keys(stringReference).length > 0 ? stringReference : null,
    responseKeys: Object.keys(payload).sort().slice(0, 30),
  };
}

export async function getEkwanzaCharge(chargeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(chargeId))
    throw new EkwanzaError("Identificador da cobrança É-Kwanza inválido.");
  const configuration = gpoConfig();
  const token = await gpoAccessToken();
  const response = await fetch(
    `${configuration.chargesUrl}/${encodeURIComponent(chargeId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const payload = await responseJson(response);
  if (!response.ok)
    throw new EkwanzaError(
      "Não foi possível consultar o estado da cobrança É-Kwanza.",
      response.status,
      "GPO_STATUS_FAILED",
    );
  const responseStatus = objectValue(payload.responseStatus);
  const id = stringValue(payload.id);
  const merchantTransactionId = stringValue(payload.merchantTransactionId);
  const amount = numberValue(payload.amount);
  if (!id || !merchantTransactionId || !Number.isFinite(amount))
    throw new EkwanzaError(
      "O gateway devolveu um estado de cobrança incompleto.",
      undefined,
      "GPO_STATUS_INVALID",
    );
  return {
    id,
    merchantTransactionId,
    amount,
    currency: stringValue(payload.currency) ?? "",
    status: stringValue(responseStatus.status, payload.status) ?? "Unknown",
    statusCode: numberValue(responseStatus.code),
    successful: responseStatus.successful === true,
    source: stringValue(responseStatus.source),
    reference: objectValue(payload.reference),
  };
}

export function mapEkwanzaChargeStatus(status: string, statusCode: number) {
  const value = status.trim().toLowerCase();
  // AppyPay returns status "Success" with code 101 when the charge is
  // merely accepted for processing. Only documented final code 100 is paid.
  if (statusCode === 100 && ["success", "successful", "paid", "completed", "processed"].includes(value))
    return "SUCCEEDED" as const;
  if (["failed", "failure", "rejected", "error"].includes(value))
    return "FAILED" as const;
  if (["expired", "cancelled", "canceled", "voided"].includes(value))
    return "CANCELLED" as const;
  if (statusCode === 101 || ["pending", "created", "processing"].includes(value)) return "PENDING" as const;
  return "UNKNOWN" as const;
}

export function resetEkwanzaTokenCacheForTests() {
  cachedGpoToken = null;
}

export async function createEkwanzaTicket(input: {
  amount: number;
  referenceCode: string;
  mobileNumber: string;
}): Promise<EkwanzaTicket> {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new EkwanzaError("Montante É-Kwanza inválido.");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.referenceCode))
    throw new EkwanzaError("Referência É-Kwanza inválida.");
  const mobileNumber = input.mobileNumber.replace(/\D/g, "").replace(/^244/, "");
  if (!/^9\d{8}$/.test(mobileNumber))
    throw new EkwanzaError("Número É-Kwanza inválido.");

  const { baseUrl, notificationToken } = config();
  const url = new URL(
    `${baseUrl}/Ticket/${encodeURIComponent(notificationToken)}`,
  );
  url.searchParams.set("amount", input.amount.toFixed(2));
  url.searchParams.set("referenceCode", input.referenceCode);
  url.searchParams.set("mobileNumber", mobileNumber);
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responseJson(response);
  const status = numberValue(payload.Status, payload.status);
  const code = stringValue(payload.Code, payload.code);
  if (!response.ok || !code || status !== 0)
    throw new EkwanzaError(
      "O É-Kwanza recusou a criação do código de pagamento.",
      response.status,
      Number.isFinite(status) ? `EKWANZA_STATUS_${status}` : "CREATE_REJECTED",
    );
  return {
    code,
    qrCode: stringValue(payload.QRCode, payload.qrCode) ?? null,
    status,
    expirationDate:
      stringValue(payload.ExpirationDate, payload.expirationDate) ?? null,
  };
}

export async function getEkwanzaTicket(
  ticketCode: string,
): Promise<EkwanzaTicketStatus> {
  if (!ticketCode || ticketCode.length > 200)
    throw new EkwanzaError("Código É-Kwanza inválido.");
  const { baseUrl, notificationToken } = config();
  const url = new URL(
    `${baseUrl}/Ticket/${encodeURIComponent(notificationToken)}/${encodeURIComponent(ticketCode)}`,
  );
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await responseJson(response);
  const amount = numberValue(payload.Amount, payload.amount);
  const code = stringValue(payload.Code, payload.code);
  const status = numberValue(payload.Status, payload.status);
  if (
    !response.ok ||
    !code ||
    !Number.isFinite(amount) ||
    !Number.isInteger(status) ||
    status < 0 ||
    status > 3
  )
    throw new EkwanzaError(
      response.status === 404
        ? "Código de pagamento É-Kwanza não encontrado."
        : "O É-Kwanza devolveu um estado inválido.",
      response.status,
      response.status === 404 ? "TICKET_NOT_FOUND" : "STATUS_INVALID",
    );
  return {
    amount,
    code,
    status,
    creationDate: stringValue(payload.CreationDate, payload.creationDate) ?? null,
    expirationDate:
      stringValue(payload.ExpirationDate, payload.expirationDate) ?? null,
  };
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyEkwanzaSignature(input: {
  code: string;
  operationCode: string;
  signature: string | null;
}) {
  const apiKey = (process.env.EKWANZA_API_KEY ?? process.env.APIKEY)?.trim();
  const notificationToken = (
    process.env.EKWANZA_NOTIFICATION_TOKEN ?? process.env.TOKENNOTIFICACAO
  )?.trim();
  const partnerRegistration = process.env.EKWANZA_PARTNER_REGISTRATION?.trim();
  if (!apiKey || !notificationToken || !partnerRegistration)
    throw new EkwanzaError(
      "Falta configurar a validação do callback É-Kwanza.",
      undefined,
      "CALLBACK_CONFIG_MISSING",
    );
  const supplied = input.signature?.trim().replace(/^sha256=/i, "");
  if (!supplied) return false;
  const digest = createHmac("sha256", apiKey)
    .update(
      `${input.code}${input.operationCode}${partnerRegistration}${notificationToken}`,
    )
    .digest();
  return (
    safeEqual(supplied.toLowerCase(), digest.toString("hex")) ||
    safeEqual(supplied, digest.toString("base64"))
  );
}

export function mapEkwanzaStatus(status: number) {
  if (status === 1) return "SUCCEEDED" as const;
  if (status === 2) return "FAILED" as const;
  if (status === 3) return "CANCELLED" as const;
  return "PENDING" as const;
}
