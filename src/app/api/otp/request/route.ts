import { randomInt, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { ZiettError, sendOtpSms } from "@/lib/integrations/ziett";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { maxOtpAttempts, otpExpirationMinutes } from "@/lib/config";

export const runtime = "nodejs";

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("244") ? digits.slice(3) : digits;
  return /^9\d{8}$/.test(national) ? `+244${national}` : null;
}

function hashCode(challengeId: string, phone: string, code: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET is missing or too short.");
  return createHmac("sha256", secret)
    .update(`${challengeId}:${phone}:${code}`)
    .digest("hex");
}

export async function POST(request: Request) {
  let body: { phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const phone = normalizePhone(body?.phone);
  if (!phone)
    return NextResponse.json(
      { error: "Indica um número angolano válido." },
      { status: 400 },
    );
  if (process.env.SALES_ENABLED !== "true")
    return NextResponse.json(
      { error: "As reservas ainda não estão abertas." },
      { status: 409 },
    );
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    return NextResponse.json(
      { error: "A verificação não está configurada." },
      { status: 503 },
    );
  }

  const now = new Date();
  try {
    await Promise.all([
      enforceRateLimit({
        namespace: "otp-ip",
        identifier: clientIp(request),
        limit: 8,
        windowMs: 60 * 60_000,
      }),
      enforceRateLimit({
        namespace: "otp-phone",
        identifier: phone,
        limit: 5,
        windowMs: 60 * 60_000,
      }),
    ]);
    const recent = await prisma.sMSVerification.findFirst({
      where: { phone, lastSentAt: { gt: new Date(now.getTime() - 30_000) } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (recent)
      return NextResponse.json(
        { error: "Espera 30 segundos antes de pedir outro código." },
        { status: 429 },
      );

    await prisma.sMSVerification.updateMany({
      where: { phone, verifiedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const challenge = await prisma.sMSVerification.create({
      data: {
        phone,
        codeHash: "pending",
        expiresAt: new Date(now.getTime() + otpExpirationMinutes() * 60_000),
        maxAttempts: maxOtpAttempts(),
        lastSentAt: now,
      },
    });
    const codeHash = hashCode(challenge.id, phone, code);
    await prisma.sMSVerification.update({
      where: { id: challenge.id },
      data: { codeHash },
    });

    try {
      const sent = await sendOtpSms({
        phone,
        code,
        idempotencyKey: `festgo-otp-${challenge.id}`,
      });
      return NextResponse.json({
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
        messageId: sent.messageId,
      });
    } catch (error) {
      if (error instanceof ZiettError) {
        return NextResponse.json(
          { error: error.message, traceId: error.traceId },
          { status: error.status === 429 ? 429 : 502 },
        );
      }
      return NextResponse.json(
        { error: "Não foi possível enviar o SMS. Tenta novamente." },
        { status: 502 },
      );
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    ) {
      return NextResponse.json(
        { error: "Limite de códigos atingido. Tenta novamente mais tarde." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "O serviço de verificação está temporariamente indisponível." },
      { status: 503 },
    );
  }
}
