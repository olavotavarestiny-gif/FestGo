import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("244") ? digits.slice(3) : digits;
  return /^9\d{8}$/.test(national) ? `+244${national}` : null;
}

export async function POST(request: Request) {
  let body: { challengeId?: unknown; phone?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const phone = normalizePhone(body?.phone);
  const challengeId =
    typeof body?.challengeId === "string" ? body.challengeId : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (!phone || !challengeId || challengeId.length > 40 || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Código ou número inválido." },
      { status: 400 },
    );
  }

  try {
    await enforceRateLimit({ namespace: "otp-verify-ip", identifier: clientIp(request), limit: 30, windowMs: 15 * 60_000 });
    const challenge = await prisma.sMSVerification.findUnique({
      where: { id: challengeId },
    });
    if (
      !challenge ||
      challenge.phone !== phone ||
      challenge.sendStatus !== "SENT" ||
      challenge.verifiedAt ||
      challenge.expiresAt <= new Date()
    ) {
      return NextResponse.json(
        { error: "O código expirou ou já foi utilizado. Pede um novo código." },
        { status: 400 },
      );
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      return NextResponse.json(
        { error: "Atingiste o limite de tentativas. Pede um novo código." },
        { status: 429 },
      );
    }

    const claimed = await prisma.sMSVerification.updateMany({
      where: {
        id: challenge.id,
        sendStatus: "SENT",
        verifiedAt: null,
        usedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: challenge.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (!claimed.count)
      return NextResponse.json(
        { error: "Atingiste o limite de tentativas. Pede um novo código." },
        { status: 429 },
      );

    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32)
      return NextResponse.json(
        { error: "A verificação não está configurada." },
        { status: 503 },
      );
    const expected = Buffer.from(challenge.codeHash, "hex");
    const supplied = createHmac("sha256", secret)
      .update(`${challenge.id}:${phone}:${code}`)
      .digest();
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      return NextResponse.json(
        { error: "O código introduzido não está correcto." },
        { status: 400 },
      );
    }

    const verified = await prisma.sMSVerification.updateMany({
      where: { id: challenge.id, verifiedAt: null, usedAt: null, expiresAt: { gt: new Date() } },
      data: { verifiedAt: new Date() },
    });
    if (!verified.count)
      return NextResponse.json(
        { error: "Este código já foi utilizado." },
        { status: 409 },
      );
    return NextResponse.json({ verified: true });
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && error.status === 429)
      return NextResponse.json({ error: "Demasiadas tentativas. Tenta mais tarde." }, { status: 429 });
    return NextResponse.json(
      { error: "O serviço de verificação está temporariamente indisponível." },
      { status: 503 },
    );
  }
}
