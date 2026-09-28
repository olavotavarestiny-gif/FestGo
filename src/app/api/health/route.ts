import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPreReservationMode, arePaymentsEnabled } from "@/lib/pre-reservations";

export const dynamic = "force-dynamic";

function configured(name: string, minimumLength = 1) {
  return (process.env[name]?.trim().length ?? 0) >= minimumLength;
}

function uuidConfigured(name: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    process.env[name]?.trim() ?? "",
  );
}

function configuration() {
  const paymentUrl = process.env.PAYMENTS_API_URL;
  let paymentEndpointValid = false;
  try {
    const url = new URL(paymentUrl ?? "");
    paymentEndpointValid =
      url.protocol === "https:" &&
      url.hostname === "rouxavcvorjiwhpjhsye.supabase.co" &&
      url.pathname.replace(/\/$/, "") === "/functions/v1/api-v1";
  } catch {}
  return {
    authSecret: configured("AUTH_SECRET", 32),
    cronSecret: configured("CRON_SECRET", 32),
    sms: configured("ZIETT_API_KEY") && configured("ZIETT_SMS_REMITTER_ID"),
    kukugest:
      configured("KUKUGEST_API_URL") && configured("KUKUGEST_API_KEY"),
    payments: {
      endpoint: paymentEndpointValid,
      apiKey: configured("PAYMENTS_API_KEY") || configured("ApiKeyGo"),
      standardProduct: uuidConfigured("PAYMENTS_PRODUCT_ID"),
      discountProduct: uuidConfigured("PAYMENTS_DISCOUNT_PRODUCT_ID"),
      webhookSecret: configured("PAYMENTS_WEBHOOK_SECRET", 32),
    },
  };
}

export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database timeout")), 3_000),
      ),
    ]);
    return NextResponse.json(
      {
        status: "ready",
        sales: process.env.SALES_ENABLED === "true" ? "enabled" : "disabled",
        preReservations: isPreReservationMode() ? "enabled" : "disabled",
        payments: arePaymentsEnabled() ? "enabled" : "disabled",
        configuration: configuration(),
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
