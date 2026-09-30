import { Payment, Prisma } from "@prisma/client";
import { reconcileEkwanzaPayment, reconcilePayment } from "@/lib/integrations/payments-api";

export type PaymentProvider = "paygo" | "ekwanza" | "wipay";
const providers: PaymentProvider[] = ["paygo", "ekwanza", "wipay"];

export function defaultPaymentProvider(): PaymentProvider {
  const configured = (process.env.PAYMENT_PROVIDER ?? process.env.PAYMENTS_PROVIDER ?? "paygo").trim().toLowerCase();
  if (!providers.includes(configured as PaymentProvider)) throw new Error("Invalid PAYMENT_PROVIDER.");
  return configured as PaymentProvider;
}

export function availablePaymentProviders() {
  const selected = defaultPaymentProvider();
  return [...new Set([selected, ...(process.env.PAYMENTS_AVAILABLE_PROVIDERS ?? "").split(",").map((value) => value.trim().toLowerCase())])]
    .filter((value): value is PaymentProvider => providers.includes(value as PaymentProvider));
}

/** WiPay is callback-only: polling can read the verified local state, never infer success. */
export async function reconcileProviderPayment(payment: Pick<Payment, "id" | "provider" | "status" | "rawStatus">, reservationReference: string) {
  if (payment.provider === "ekwanza") return reconcileEkwanzaPayment(payment.id);
  if (payment.provider === "paygo") return reconcilePayment(payment.id);
  if (payment.provider === "wipay") return { status: payment.status, rawStatus: payment.rawStatus, reservationReference, newlyConfirmed: false };
  throw new Error("Unsupported payment provider.");
}

/** Never return raw gateway payloads or operational metadata to a browser. */
export function publicPaymentDetails(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const details: Record<string, string> = {};
  for (const key of ["entity", "reference", "instructions", "dueDate", "expiresAt"])
    if (typeof value[key] === "string") details[key] = value[key].slice(0, 1000);
  if (typeof value.paymentUrl === "string") {
    try {
      const url = new URL(value.paymentUrl);
      if (url.protocol === "https:" && !url.username && !url.password) details.paymentUrl = url.toString();
    } catch {}
  }
  return details;
}
