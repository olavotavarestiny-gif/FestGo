import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

const OFFICIAL_HOST = "https://api.wipay.ao";
export const WIPAY_PRODUCTION_CALLBACK_PATH = "/api/webhooks/wipay";
export const WIPAY_SANDBOX_TEST_CALLBACK_PATH = "/api/webhooks/wipay-test";

/** A payment must carry the public server-to-server URL, never a browser return URL. */
export function wipayCallbackUrl(baseUrl: string, test = false) {
  const configured = process.env.WIPAY_CALLBACK_URL?.trim();
  if (!test && !configured)
    throw new WiPayError("A URL de callback WiPay não está configurada.", undefined, "CALLBACK_URL_MISSING");
  const path = test ? WIPAY_SANDBOX_TEST_CALLBACK_PATH : WIPAY_PRODUCTION_CALLBACK_PATH;
  const url = new URL(test ? path : configured!, baseUrl);
  if (url.protocol !== "https:" && process.env.NODE_ENV !== "test")
    throw new WiPayError("O callback WiPay requer HTTPS.", undefined, "CALLBACK_URL_INVALID");
  if (url.pathname !== path || url.username || url.password || url.search || url.hash || url.port ||
      !url.hostname || url.hostname === "localhost" || url.hostname === "127.0.0.1")
    throw new WiPayError("A URL de callback WiPay é inválida.", undefined, "CALLBACK_URL_INVALID");
  return url.toString();
}

type Scope = "payment" | "signature";
type CachedToken = { value: string; expiresAt: number };
const tokens: Partial<Record<Scope, CachedToken>> = {};
const SIGNATURE_REFRESH_WINDOW_MS = 5 * 60_000;
const SIGNATURE_HISTORY_MS = 48 * 60 * 60_000;

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

async function requestAccessToken(scope: Scope): Promise<CachedToken> {
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
  return {
    value: result.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
}

async function accessToken(scope: Scope) {
  const cached = tokens[scope];
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const issued = await requestAccessToken(scope);
  tokens[scope] = issued;
  return issued.value;
}

function signatureTokenKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new WiPayError("A chave de protecção WiPay não está configurada.", undefined, "SIGNATURE_STORAGE_UNAVAILABLE");
  return createHash("sha256").update(`festgo:wipay-signature:${secret}`).digest();
}

function sealSignatureToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", signatureTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function openSignatureToken(sealed: string) {
  const [version, iv, tag, encrypted] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new WiPayError("O token WiPay guardado é inválido.", undefined, "SIGNATURE_STORAGE_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", signatureTokenKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new WiPayError("Não foi possível abrir o token WiPay guardado.", undefined, "SIGNATURE_STORAGE_INVALID");
  }
}

function signatureCacheId() {
  const { clientId } = config();
  return `wipay-signature:${createHash("sha256").update(clientId).digest("hex").slice(0, 24)}`;
}

/** Reuse one issued signing token across serverless instances and payment requests. */
export async function ensureWiPaySignatureToken() {
  const id = signatureCacheId();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(771530913)::text`;
    const stored = await tx.gatewayToken.findUnique({ where: { id } });
    if (stored && stored.expiresAt.getTime() > Date.now() + SIGNATURE_REFRESH_WINDOW_MS)
      return openSignatureToken(stored.encryptedValue);
    const issued = await requestAccessToken("signature");
    const now = new Date();
    await tx.gatewayToken.upsert({
      where: { id },
      create: { id, encryptedValue: sealSignatureToken(issued.value), expiresAt: new Date(issued.expiresAt) },
      update: {
        encryptedValue: sealSignatureToken(issued.value),
        expiresAt: new Date(issued.expiresAt),
        previousEncryptedValue: stored?.encryptedValue ?? null,
        previousExpiresAt: stored ? new Date(now.getTime() + SIGNATURE_HISTORY_MS) : null,
      },
    });
    return issued.value;
  }, { maxWait: 10_000, timeout: 20_000 });
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

export type WiPaySignatureResult = "valid" | "missing" | "malformed" | "mismatch";

export async function checkWiPaySignature(rawBody: string, supplied: string | null): Promise<WiPaySignatureResult> {
  if (!supplied) return "missing";
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return "malformed";
  const stored = await prisma.gatewayToken.findUnique({ where: { id: signatureCacheId() } });
  if (!stored)
    throw new WiPayError("A chave de assinatura WiPay não foi guardada antes da cobrança.", undefined, "SIGNATURE_TOKEN_NOT_PREPARED");
  const candidates = [openSignatureToken(stored.encryptedValue)];
  if (stored.previousEncryptedValue && stored.previousExpiresAt && stored.previousExpiresAt > new Date())
    candidates.push(openSignatureToken(stored.previousEncryptedValue));
  return candidates.some((key) => matchesWiPayHmac(rawBody, supplied, key)) ? "valid" : "mismatch";
}

export function matchesWiPayHmac(rawBody: string, supplied: string, key: string) {
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", key).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyWiPaySignature(rawBody: string, supplied: string | null) {
  return (await checkWiPaySignature(rawBody, supplied)) === "valid";
}

export function resetWiPayTokenCacheForTests() {
  delete tokens.payment;
  delete tokens.signature;
}
