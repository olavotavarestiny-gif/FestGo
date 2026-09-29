import { createHmac, timingSafeEqual } from "node:crypto";

const OFFICIAL_HOST = "https://api.wipay.ao";

type Scope = "payment" | "signature";
type CachedToken = { value: string; expiresAt: number };
const tokens: Partial<Record<Scope, CachedToken>> = {};

export class WiPayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "WiPayError";
  }
}

function isOfficialHostedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "wipay.ao" ||
    normalized.endsWith(".wipay.ao") ||
    normalized === "pay.wiza.ao"
  );
}

function config() {
  const baseUrl = (process.env.WIPAY_API_URL || OFFICIAL_HOST).replace(/\/$/, "");
  const clientId = process.env.WIPAY_CLIENT_ID?.trim();
  const clientSecret = process.env.WIPAY_CLIENT_SECRET?.trim();
  const environment = process.env.WIPAY_ENVIRONMENT;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== "api.wipay.ao")
    throw new WiPayError("O endpoint WiPay não é o host oficial.", undefined, "CONFIG_ENDPOINT");
  if (!clientId?.startsWith("wp_") || !clientSecret?.startsWith("WPS_"))
    throw new WiPayError("As credenciais WiPay não estão configuradas.", undefined, "CONFIG_CREDENTIALS");
  if (!(["sandbox", "production"] as const).includes(environment as "sandbox" | "production"))
    throw new WiPayError("WIPAY_ENVIRONMENT deve ser sandbox ou production.", undefined, "CONFIG_ENVIRONMENT");
  return { baseUrl, clientId, clientSecret, environment };
}

async function accessToken(scope: Scope) {
  const cached = tokens[scope];
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const { baseUrl, clientId, clientSecret } = config();
  const response = await fetch(`${baseUrl}/v1/credentials/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as
    | { access_token?: unknown; expires_in?: unknown; scope?: unknown }
    | null;
  if (
    !response.ok ||
    typeof result?.access_token !== "string" ||
    result.access_token.length < 32 ||
    result.scope !== scope
  )
    throw new WiPayError("A WiPay recusou a autenticação.", response.status, "AUTH_FAILED");
  const expiresIn = Number(result.expires_in);
  tokens[scope] = {
    value: result.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
  return result.access_token;
}

export async function createWiPayPayment(input: {
  amount: number;
  currency: string;
  customerPhone: string;
  referenceId: string;
  successUrl: string;
  failureUrl: string;
  callbackUrl: string;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new WiPayError("Montante WiPay inválido.");
  if (!/^9\d{8}$/.test(input.customerPhone))
    throw new WiPayError("Telefone WiPay inválido.");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.referenceId))
    throw new WiPayError("Referência WiPay inválida.");
  const { baseUrl } = config();
  const token = await accessToken("payment");
  const response = await fetch(`${baseUrl}/v1/hosts/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount: input.amount.toFixed(2),
      currency: input.currency.toLowerCase(),
      customer: input.customerPhone,
      reference_id: input.referenceId,
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      callback_url: input.callbackUrl,
    }),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 303)
    throw new WiPayError("A WiPay recusou a criação do checkout.", response.status, "CHECKOUT_HTTP");
  const location = response.headers.get("location");
  if (!location) throw new WiPayError("A WiPay não devolveu o checkout.", undefined, "CHECKOUT_LOCATION_MISSING");
  const checkout = new URL(location);
  const paymentId = checkout.searchParams.get("id");
  if (checkout.protocol !== "https:")
    throw new WiPayError(
      "A WiPay devolveu um protocolo de checkout inseguro.",
      undefined,
      "CHECKOUT_PROTOCOL_INVALID",
      checkout.protocol,
    );
  if (!isOfficialHostedHostname(checkout.hostname))
    throw new WiPayError(
      "A WiPay devolveu um domínio de checkout não documentado.",
      undefined,
      "CHECKOUT_HOST_INVALID",
      checkout.hostname.toLowerCase().replace(/\.$/, ""),
    );
  if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId))
    throw new WiPayError("A WiPay devolveu um identificador inválido.", undefined, "CHECKOUT_ID_INVALID");
  if (!checkout.searchParams.get("nonce"))
    throw new WiPayError("A WiPay devolveu um checkout sem nonce.", undefined, "CHECKOUT_NONCE_MISSING");
  return { paymentId, checkoutUrl: checkout.toString() };
}

export async function verifyWiPaySignature(rawBody: string, supplied: string | null) {
  if (!supplied || !/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const signatureToken = await accessToken("signature");
  const expected = createHmac("sha256", signatureToken)
    .update(rawBody)
    .digest("hex");
  const left = Buffer.from(supplied.toLowerCase(), "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function resetWiPayTokenCacheForTests() {
  delete tokens.payment;
  delete tokens.signature;
}
