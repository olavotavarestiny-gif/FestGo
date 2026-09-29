import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPreReservationMode, arePaymentsEnabled } from "@/lib/pre-reservations";
import { paymentProductsMatch } from "@/lib/integrations/payments-api";

export const dynamic = "force-dynamic";

function configured(name: string, minimumLength = 1) {
  return (process.env[name]?.trim().length ?? 0) >= minimumLength;
}

function uuidConfigured(name: string) {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    process.env[name]?.trim() ?? "",
  );
}

function configuration() {
  const provider = process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo";
  const paymentUrl = process.env.PAYMENTS_API_URL;
  let paymentEndpointValid = false;
  try {
    const url = new URL(paymentUrl ?? "");
    paymentEndpointValid =
      url.protocol === "https:" &&
      url.hostname === "rouxavcvorjiwhpjhsye.supabase.co" &&
      url.pathname.replace(/\/$/, "") === "/functions/v1/api-v1";
  } catch {}
  let wipayEndpoint = false;
  try {
    const url = new URL(process.env.WIPAY_API_URL ?? "https://api.wipay.ao");
    wipayEndpoint = url.protocol === "https:" && url.hostname === "api.wipay.ao";
  } catch {}
  let wipayAppUrl = false;
  try {
    const url = new URL(process.env.WIPAY_APP_URL ?? process.env.APP_URL ?? "");
    wipayAppUrl = url.protocol === "https:";
  } catch {}
  let wipayCallbackOrigin = false;
  try {
    const url = new URL(
      process.env.WIPAY_CALLBACK_ORIGIN ??
        process.env.WIPAY_APP_URL ??
        process.env.APP_URL ??
        "",
    );
    wipayCallbackOrigin = url.protocol === "https:";
  } catch {}
  return {
    authSecret: configured("AUTH_SECRET", 32),
    cronSecret: configured("CRON_SECRET", 32),
    sms: configured("ZIETT_API_KEY") && configured("ZIETT_SMS_REMITTER_ID"),
    kukugest:
      process.env.KUKUGEST_ENABLED === "true" &&
      configured("KUKUGEST_API_URL") &&
      configured("KUKUGEST_API_KEY"),
    payments: {
      provider,
      endpoint: paymentEndpointValid,
      apiKey: configured("PAYMENTS_API_KEY") || configured("ApiKeyGo"),
      products: {
        individual: uuidConfigured("PAYMENTS_PRODUCT_INDIVIDUAL_ID"),
        duo: uuidConfigured("PAYMENTS_PRODUCT_DUO_ID"),
        duoIndividual: uuidConfigured("PAYMENTS_PRODUCT_DUO_INDIVIDUAL_ID"),
        group: uuidConfigured("PAYMENTS_PRODUCT_GROUP_ID"),
      },
      webhookSecret:
        configured("PAYMENTS_WEBHOOK_SECRET", 32) ||
        configured("Webhook_secret", 32),
      wipay: {
        endpoint: wipayEndpoint,
        appUrl: wipayAppUrl,
        callbackOrigin: wipayCallbackOrigin,
        environment: ["sandbox", "production"].includes(
          process.env.WIPAY_ENVIRONMENT ?? "",
        ),
        clientId: process.env.WIPAY_CLIENT_ID?.startsWith("wp_") ?? false,
        clientSecret:
          process.env.WIPAY_CLIENT_SECRET?.startsWith("WPS_") ?? false,
      },
    },
  };
}

export async function GET() {
  try {
    const provider = process.env.PAYMENTS_PROVIDER === "wipay" ? "wipay" : "paygo";
    const checks: Promise<unknown>[] = [
      Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database timeout")), 3_000),
      ),
      ]),
    ];
    const productsCheck = provider === "paygo"
      ? paymentProductsMatch([
        {
          productId: process.env.PAYMENTS_PRODUCT_INDIVIDUAL_ID,
          amount: 25_000,
        },
        { productId: process.env.PAYMENTS_PRODUCT_DUO_ID, amount: 47_500 },
        { productId: process.env.PAYMENTS_PRODUCT_GROUP_ID, amount: 90_000 },
      ]).catch(() => false)
      : Promise.resolve(null);
    checks.push(productsCheck);
    const [, officialProductsValid] = await Promise.all(checks);
    const config = configuration();
    return NextResponse.json(
      {
        status: "ready",
        sales: process.env.SALES_ENABLED === "true" ? "enabled" : "disabled",
        preReservations: isPreReservationMode() ? "enabled" : "disabled",
        payments: arePaymentsEnabled() ? "enabled" : "disabled",
        configuration: {
          ...config,
          payments: { ...config.payments, officialProductsValid },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        sales: "disabled",
        preReservations: "disabled",
        payments: "disabled",
        configuration: configuration(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
