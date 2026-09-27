import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, verifyPassword } from "@/lib/auth-crypto";
import { SESSION_COOKIE } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  try {
    await enforceRateLimit({
      namespace: "staff-login",
      identifier: clientIp(request),
      limit: 8,
      windowMs: 15 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Demasiadas tentativas. Aguarda 15 minutos." },
      { status: 429 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Credenciais inválidas." },
      { status: 401 },
    );
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (
    !user?.active ||
    !verifyPassword(parsed.data.password, user.passwordHash)
  ) {
    return NextResponse.json(
      { error: "Credenciais inválidas." },
      { status: 401 },
    );
  }
  const token = createSessionToken({
    userId: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  });
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "STAFF_LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: clientIp(request),
    },
  });
  return response;
}
