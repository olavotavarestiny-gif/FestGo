import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { arePaymentsEnabled } from "@/lib/pre-reservations";

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
    const required = [
      "DATABASE_URL",
      "AUTH_SECRET",
      "PAYMENTS_API_URL",
      "PAYMENTS_PRODUCT_INDIVIDUAL_ID",
      "PAYMENTS_PRODUCT_DUO_ID",
      "PAYMENTS_PRODUCT_DUO_INDIVIDUAL_ID",
      "PAYMENTS_PRODUCT_GROUP_ID",
      "ZIETT_API_KEY",
      "ZIETT_SMS_REMITTER_ID",
      "CRON_SECRET",
    ];
    const paymentKey = process.env.PAYMENTS_API_KEY ?? process.env.ApiKeyGo;
    if (
      process.env.SALES_ENABLED !== "true" ||
      !paymentKey ||
      required.some((name) => !process.env[name])
    )
      return NextResponse.json(
        { error: "A abertura está bloqueada pela configuração de produção." },
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
