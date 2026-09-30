import { prisma } from "@/lib/db";
import { finalizeVerifiedPayment, type VerifiedPayment } from "@/lib/payment-finalization";
import {
  EkwanzaError,
  getEkwanzaCharge,
  mapEkwanzaChargeStatus,
} from "@/lib/integrations/ekwanza";

export type PaymentsApiMethod = "multicaixa" | "reference";

export type PaymentsApiCreateResult = {
  success: boolean;
  payment_id: string;
  status: string;
  payment_method: string;
  total_amount: number;
  currency: string;
  message?: string;
  thank_you_url?: string;
  status_check_url?: string;
  payment_url?: string;
  payment_link?: string;
  checkout_url?: string;
  redirect_url?: string;
  url?: string;
  reference?: {
    entity?: string;
    reference_number?: string;
    expiration_date?: string;
  };
  instructions?: string;
  diagnostics: {
    source: string;
    responseKeys: string[];
  };
  [key: string]: unknown;
};

type PaymentsApiStatusResult = {
  payment: {
    id: string;
    product_id?: string;
    amount: number;
    currency: string;
    status: string;
    payment_method: string;
    customer?: { name?: string; email?: string; phone?: string };
    merchant_transaction_id?: string;
    paid_at?: string | null;
  };
};

export type PaymentsApiSale = {
  id: string;
  product_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  customer_email: string | undefined;
  customer_phone: string | undefined;
  created_at: string;
  paid_at: string | null;
};

export type PaymentsApiProduct = {
  id: string;
  price: number;
  active: boolean;
};

export class PaymentsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly diagnosticCode?: string,
  ) {
    super(message);
    this.name = "PaymentsApiError";
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

export function normalizeProductId(value: string | undefined) {
  return value
    ?.trim()
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

export function paymentMethodMatches(
  expected: PaymentsApiMethod | string,
  received: string,
) {
  const normalize = (value: string) => {
    const method = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (["multicaixa", "multicaixa_express", "express"].includes(method))
      return "multicaixa";
    if (
      [
        "reference",
        "referencia",
        "multicaixa_reference",
        "multicaixa_referencia",
      ].includes(method)
    )
      return "reference";
    return method;
  };
  return normalize(expected) === normalize(received);
}

function config() {
  const apiKey = process.env.PAYMENTS_API_KEY ?? process.env.ApiKeyGo;
  const baseUrl = process.env.PAYMENTS_API_URL;
  if (!apiKey || !baseUrl)
    throw new PaymentsApiError(
      "Falta configurar PAYMENTS_API_KEY e PAYMENTS_API_URL.",
    );
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "rouxavcvorjiwhpjhsye.supabase.co"
  ) {
    throw new PaymentsApiError(
      "PAYMENTS_API_URL não corresponde ao endpoint autorizado.",
    );
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new PaymentsApiError(
      data.error ?? "A API de pagamentos rejeitou o pedido.",
      response.status,
    );
  return data;
}

export async function createPayment(input: {
  productId: string;
  quantity: number;
  method: PaymentsApiMethod;
  customer: { name: string; email: string; phone: string };
}) {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.productId) ||
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 6
  ) {
    throw new PaymentsApiError("Produto ou quantidade inválida.");
  }
  const payload = await request<unknown>("/payments", {
    method: "POST",
    body: JSON.stringify({
      items: [{ product_id: input.productId, quantity: input.quantity }],
      payment_method: input.method,
      customer_name: input.customer.name,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone,
    }),
  });
  const root = objectValue(payload);
  const data = objectValue(root.data);
  const candidates = [
    ["payment", objectValue(root.payment)],
    ["data.payment", objectValue(data.payment)],
    ["data", data],
    ["root", root],
  ] as const;
  const selected =
    candidates.find(([, value]) =>
      /^[0-9a-f-]{36}$/i.test(
        stringValue(value.payment_id, value.id) ?? "",
      ),
    ) ?? ["root", root];
  const [source, payment] = selected;
  const paymentId = stringValue(payment.payment_id, payment.id);
  if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
    throw new PaymentsApiError(
      "O gateway criou uma resposta sem identificador de transacção utilizável.",
      undefined,
      "CREATE_RESPONSE_MISSING_ID",
    );
  }
  const reference = objectValue(payment.reference ?? root.reference);
  return {
    ...root,
    success: root.success !== false,
    payment_id: paymentId,
    status: stringValue(payment.status, root.status) ?? "unknown",
    payment_method:
      stringValue(
        payment.payment_method,
        payment.method,
        root.payment_method,
        root.method,
      ) ?? "unknown",
    total_amount: numberValue(
      payment.total_amount,
      payment.amount,
      root.total_amount,
      root.amount,
    ),
    currency: stringValue(payment.currency, root.currency) ?? "unknown",
    message: stringValue(payment.message, root.message),
    thank_you_url: stringValue(payment.thank_you_url, root.thank_you_url),
    status_check_url: stringValue(
      payment.status_check_url,
      root.status_check_url,
    ),
    payment_url: stringValue(payment.payment_url, root.payment_url),
    payment_link: stringValue(payment.payment_link, root.payment_link),
    checkout_url: stringValue(payment.checkout_url, root.checkout_url),
    redirect_url: stringValue(payment.redirect_url, root.redirect_url),
    url: stringValue(payment.url, root.url),
    reference:
      Object.keys(reference).length > 0
        ? {
            entity: stringValue(reference.entity),
            reference_number: stringValue(reference.reference_number),
            expiration_date: stringValue(reference.expiration_date),
          }
        : undefined,
    instructions: stringValue(payment.instructions, root.instructions),
    diagnostics: {
      source,
      responseKeys: Object.keys(root).sort().slice(0, 30),
    },
  };
}

export function paymentPageUrl(result: PaymentsApiCreateResult) {
  const candidates = [
    result.payment_url,
    result.payment_link,
    result.checkout_url,
    result.redirect_url,
    result.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") return url.toString();
    } catch {}
  }
  return null;
}

export async function getPayment(providerPaymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(providerPaymentId))
    throw new PaymentsApiError("Identificador de pagamento inválido.");
  const result = await request<PaymentsApiStatusResult>(
    `/payment-status/${encodeURIComponent(providerPaymentId)}`,
  );
  if (!result.payment || result.payment.id !== providerPaymentId)
    throw new PaymentsApiError("A API devolveu um pagamento inválido.");
  return result.payment;
}

export async function listPaymentsSales(limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await request<unknown>(`/sales?limit=${safeLimit}`);
  const root = objectValue(result);
  const sales = Array.isArray(root.sales) ? root.sales : [];
  return sales
    .map((value) => objectValue(value))
    .map((sale) => ({
      id: stringValue(sale.id) ?? "",
      product_id: stringValue(sale.product_id) ?? "",
      amount: numberValue(sale.amount),
      currency: stringValue(sale.currency) ?? "",
      status: stringValue(sale.status) ?? "unknown",
      payment_method: stringValue(sale.payment_method) ?? "unknown",
      customer_email: stringValue(sale.customer_email),
      customer_phone: stringValue(sale.customer_phone),
      created_at: stringValue(sale.created_at) ?? "",
      paid_at: stringValue(sale.paid_at) ?? null,
    }))
    .filter(
      (sale): sale is PaymentsApiSale =>
        /^[0-9a-f-]{36}$/i.test(sale.id) &&
        /^[0-9a-f-]{36}$/i.test(sale.product_id) &&
        Number.isFinite(sale.amount) &&
        Boolean(sale.created_at),
    );
}

export async function paymentProductMatches(
  productId: string,
  expectedAmount: number,
) {
  if (!/^[0-9a-f-]{36}$/i.test(productId) || !Number.isFinite(expectedAmount))
    return false;
  const result = await request<unknown>("/products?limit=100");
  const root = objectValue(result);
  const products = Array.isArray(root.products) ? root.products : [];
  const product = products
    .map((value) => objectValue(value))
    .find((value) => stringValue(value.id) === productId);
  return Boolean(
    product &&
      numberValue(product.price, product.amount) === expectedAmount &&
      product.active !== false &&
      product.status !== "inactive",
  );
}

export async function paymentProductsMatch(
  expected: Array<{ productId: string | undefined; amount: number }>,
) {
  if (
    expected.some(
      (item) =>
        !item.productId || !/^[0-9a-f-]{36}$/i.test(item.productId),
    )
  )
    return false;
  const result = await request<unknown>("/products?limit=100");
  const root = objectValue(result);
  const products = (Array.isArray(root.products) ? root.products : []).map(
    (value) => objectValue(value),
  );
  return expected.every((item) => {
    const product = products.find(
      (value) => stringValue(value.id) === item.productId,
    );
    return Boolean(
      product &&
        numberValue(product.price, product.amount) === item.amount &&
        product.active !== false &&
        product.status !== "inactive",
    );
  });
}

export function mapStatus(status: string) {
  switch (status.toLowerCase()) {
    case "paid":
    case "completed":
    case "succeeded":
      return "SUCCEEDED" as const;
    case "failed":
    case "expired":
      return "FAILED" as const;
    case "cancelled":
    case "canceled":
      return "CANCELLED" as const;
    case "refunded":
      return "REFUNDED" as const;
    case "unknown":
      return "UNKNOWN" as const;
    default:
      return "PENDING" as const;
  }
}

export async function reconcilePayment(localPaymentId: string, webhook?: VerifiedPayment["webhook"]) {
  const local = await prisma.payment.findUnique({
    where: { id: localPaymentId },
    include: { reservation: { include: { customer: true } } },
  });
  if (!local?.providerPaymentId || local.provider !== "paygo")
    throw new PaymentsApiError("Pagamento não encontrado.", 404);
  const remote = await getPayment(local.providerPaymentId);
  const details = objectValue(local.providerDetails);
  if (
    remote.amount !== Number(local.amount) ||
    remote.currency.toUpperCase() !== local.currency.toUpperCase() ||
    !paymentMethodMatches(local.method, remote.payment_method) ||
    (remote.product_id && remote.product_id !== details.productId) ||
    (local.providerReference && remote.merchant_transaction_id !== local.providerReference) ||
    (remote.customer?.email && remote.customer.email.toLowerCase() !== local.reservation.customer.email?.toLowerCase())
  ) throw new PaymentsApiError("O pagamento remoto não corresponde à reserva guardada.", 409);
  return finalizeVerifiedPayment({
    localPaymentId: local.id,
    provider: "paygo",
    providerPaymentId: remote.id,
    providerReference: remote.merchant_transaction_id,
    amount: remote.amount,
    currency: remote.currency,
    status: mapStatus(remote.status),
    rawStatus: remote.status,
    webhook,
  });
}

export async function reconcileEkwanzaPayment(localPaymentId: string, webhook?: VerifiedPayment["webhook"]) {
  const local = await prisma.payment.findUnique({ where: { id: localPaymentId } });
  if (!local?.providerPaymentId || local.provider !== "ekwanza")
    throw new EkwanzaError("Pagamento É-Kwanza não encontrado.", 404);
  const remote = await getEkwanzaCharge(local.providerPaymentId);
  if (
    remote.id !== local.providerPaymentId ||
    remote.merchantTransactionId !== local.providerReference ||
    remote.amount !== Number(local.amount) ||
    remote.currency.toUpperCase() !== local.currency.toUpperCase() ||
    (remote.source && remote.source.toUpperCase() !== (local.method === "gpo" ? "GPO" : "REF"))
  ) throw new EkwanzaError("A cobrança É-Kwanza não corresponde à reserva guardada.", 409, "PAYMENT_MISMATCH");
  return finalizeVerifiedPayment({
    localPaymentId: local.id,
    provider: "ekwanza",
    providerPaymentId: remote.id,
    providerReference: remote.merchantTransactionId,
    amount: remote.amount,
    currency: remote.currency,
    status: mapEkwanzaChargeStatus(remote.status, remote.statusCode),
    rawStatus: `${remote.status}:${remote.statusCode}`,
    webhook,
  });
}
