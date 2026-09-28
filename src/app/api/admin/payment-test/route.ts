import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createPayment,
  paymentMethodMatches,
  paymentPageUrl,
  PaymentsApiError,
} from "@/lib/integrations/payments-api";
import { normalizeAngolanPhone } from "@/lib/pre-reservations";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const TEST_PRODUCT_ID = "20d032f3-e0c2-48d3-8ce1-c93bc682dd37";
const TEST_AMOUNT = 100;

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(9).max(24),
  method: z.enum(["multicaixa", "reference"]),
  confirmation: z.literal(true),
});

export async function POST(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Preenche os dados de teste e confirma a operação." },
      { status: 400 },
    );
  const phone = normalizeAngolanPhone(parsed.data.phone);
  if (!phone)
    return NextResponse.json(
      { error: "Indica um número angolano válido para o teste." },
      { status: 400 },
    );

  try {
    await enforceRateLimit({
      namespace: "admin-gateway-payment-test",
      identifier: user.id,
      limit: 1,
      windowMs: 10 * 60_000,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Já foi iniciado um teste nos últimos 10 minutos. Consulta o resultado antes de criar outro.",
      },
      { status: 429 },
    );
  }

  try {
    const result = await createPayment({
      productId: TEST_PRODUCT_ID,
      quantity: 1,
      method: parsed.data.method,
      customer: {
        name: parsed.data.name,
        email: parsed.data.email,
        phone,
      },
    });
    const matchesExpectedAmount =
      result.total_amount === TEST_AMOUNT &&
      result.currency === "AOA" &&
      paymentMethodMatches(parsed.data.method, result.payment_method);
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: matchesExpectedAmount
          ? "GATEWAY_TEST_PAYMENT_CREATED"
          : "GATEWAY_TEST_PAYMENT_AMOUNT_MISMATCH",
        entityType: "GatewayTest",
        entityId: result.payment_id,
        metadata: {
          productId: TEST_PRODUCT_ID,
          amount: result.total_amount,
          currency: result.currency,
          method: result.payment_method,
          status: result.status,
        },
        ipAddress: clientIp(request),
      },
    });
    if (!matchesExpectedAmount)
      return NextResponse.json(
        {
          error:
            "O gateway devolveu um valor diferente de 100 Kz. Não avances com o pagamento.",
          paymentId: result.payment_id,
          amount: result.total_amount,
          currency: result.currency,
        },
        { status: 502 },
      );
    return NextResponse.json(
      {
        ok: true,
        testOnly: true,
        productId: TEST_PRODUCT_ID,
        paymentId: result.payment_id,
        status: result.status,
        method: result.payment_method,
        amount: result.total_amount,
        currency: result.currency,
        paymentUrl: paymentPageUrl(result),
        reference: result.reference ?? null,
        instructions: result.instructions ?? result.message ?? null,
        statusCheckUrl: result.status_check_url ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof PaymentsApiError
            ? error.message
            : "Não foi possível criar o pagamento de teste.",
      },
      { status: 502 },
    );
  }
}
