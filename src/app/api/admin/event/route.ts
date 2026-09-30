import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { paymentProductsMatch } from "@/lib/integrations/payments-api";
import { validateEkwanzaConfiguration } from "@/lib/integrations/ekwanza";
import { defaultPaymentProvider } from "@/lib/payment-providers";
import { isOtpRequired, publicBaseUrl } from "@/lib/config";
import { wipayCallbackUrl } from "@/lib/integrations/wipay";

const schema = z.object({ status: z.enum(["ON_SALE", "CLOSED"]) });
export async function PATCH(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  if (parsed.data.status === "ON_SALE") {
    if (!arePaymentsEnabled())
      return NextResponse.json(
        { error: "Os pagamentos estão desactivados no modo de pré-reserva." },
        { status: 409 },
      );
    const required = ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", ...(isOtpRequired() ? ["ZIETT_API_KEY", "ZIETT_SMS_REMITTER_ID"] : [])];
    if (process.env.SALES_ENABLED !== "true" || required.some((name) => !process.env[name]) ||
      (process.env.AUTH_SECRET?.length ?? 0) < 32 || (process.env.CRON_SECRET?.length ?? 0) < 32)
      return NextResponse.json(
        { error: "A abertura está bloqueada pela configuração de produção." },
        { status: 409 },
      );
    const event = await prisma.event.findUnique({ where: { slug: "brunch-mangais" }, include: { routes: { where: { active: true }, include: { pickupPoints: true } } } });
    if (!event || event.eventDate <= new Date() || !event.routes.some((route) => route.capacity > 0 && route.pickupPoints.some((point) => point.operationalConfirmed && point.departureAt && point.departureAt > new Date())))
      return NextResponse.json({ error: "Confirma pelo menos um embarque futuro e a capacidade antes de abrir vendas." }, { status: 409 });
    let provider: string;
    try { provider = defaultPaymentProvider(); }
    catch { return NextResponse.json({ error: "O fornecedor de pagamento é inválido." }, { status: 409 }); }
    if (provider === "wipay") {
      try {
        publicBaseUrl();
        wipayCallbackUrl(publicBaseUrl());
        if (!process.env.WIPAY_CALLBACK_URL?.trim() || process.env.WIPAY_ENVIRONMENT !== "production" ||
          !process.env.WIPAY_CLIENT_ID?.startsWith("wp_") || !process.env.WIPAY_CLIENT_SECRET?.startsWith("WPS_"))
          throw new Error("WiPay production configuration is incomplete.");
      } catch {
        return NextResponse.json({ error: "A WiPay de produção, incluindo callback HTTPS e credenciais, ainda não está configurada." }, { status: 409 });
      }
    }
    const officialProductsValid = provider === "wipay" ? true :
      provider === "ekwanza"
        ? await validateEkwanzaConfiguration().catch(() => false)
        : await (async () => {
            const paymentKey = process.env.PAYMENTS_API_KEY ?? process.env.ApiKeyGo;
            if (
              !paymentKey ||
              [
                "PAYMENTS_API_URL",
                "PAYMENTS_PRODUCT_INDIVIDUAL_ID",
                "PAYMENTS_PRODUCT_DUO_ID",
                "PAYMENTS_PRODUCT_DUO_INDIVIDUAL_ID",
                "PAYMENTS_PRODUCT_GROUP_ID",
              ].some((name) => !process.env[name])
            )
              return false;
            return paymentProductsMatch([
              {
                productId: process.env.PAYMENTS_PRODUCT_INDIVIDUAL_ID,
                amount: Number(event.individualPrice),
              },
              { productId: process.env.PAYMENTS_PRODUCT_DUO_ID, amount: Number(event.duoPrice) },
              { productId: process.env.PAYMENTS_PRODUCT_GROUP_ID, amount: Number(event.groupPrice) },
            ]);
          })().catch(() => false);
    if (!officialProductsValid)
      return NextResponse.json(
        { error: "Os produtos oficiais não correspondem aos preços FestGo." },
        { status: 409 },
      );
  }
  const event = await prisma.event.update({
    where: { slug: "brunch-mangais" },
    data: {
      status: parsed.data.status,
      salesOpenAt: parsed.data.status === "ON_SALE" ? new Date() : undefined,
      salesCloseAt: parsed.data.status === "CLOSED" ? new Date() : undefined,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action:
        parsed.data.status === "ON_SALE" ? "SALES_OPENED" : "SALES_CLOSED",
      entityType: "Event",
      entityId: event.id,
      ipAddress: clientIp(request),
    },
  });
  return NextResponse.json({ status: event.status });
}
