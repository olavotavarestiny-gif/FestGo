import { NextResponse } from "next/server";
import { reconcilePayment } from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function providerPaymentId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown> : {};
  const payment = root.payment && typeof root.payment === "object" && !Array.isArray(root.payment)
    ? root.payment as Record<string, unknown> : data.payment && typeof data.payment === "object" && !Array.isArray(data.payment)
      ? data.payment as Record<string, unknown> : {};
  const candidate = root.payment_id ?? root.paymentId ?? data.payment_id ?? data.paymentId ?? payment.id ?? data.id;
  return typeof candidate === "string" && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  }
  const remoteId = providerPaymentId(payload);
  if (!remoteId) return NextResponse.json({ error: "Falta o identificador do pagamento." }, { status: 400 });

  try {
    const payment = await prisma.payment.findUnique({ where: { providerPaymentId: remoteId } });
    if (!payment || payment.provider !== "paygo") return NextResponse.json({ error: "Pagamento desconhecido." }, { status: 404 });
    const result = await reconcilePayment(payment.id);
    return NextResponse.json({ received: true, status: result.status });
  } catch {
    // A resposta não é confirmada para que o fornecedor possa repetir a entrega.
    return NextResponse.json({ error: "Não foi possível reconciliar o pagamento." }, { status: 503 });
  }
}
