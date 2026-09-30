import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, verifyPassword } from "@/lib/auth-crypto";
import { SESSION_COOKIE } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";
const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const emailKey = parsed.success
    ? parsed.data.email.toLowerCase()
    : "invalid-email";
  try {
    await Promise.all([
      enforceRateLimit({
        namespace: "staff-login-ip",
        identifier: clientIp(request),
        limit: 8,
        windowMs: 15 * 60_000,
      }),
      enforceRateLimit({
        namespace: "staff-login-account",
        identifier: emailKey,
        limit: 8,
        windowMs: 15 * 60_000,
      }),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Demasiadas tentativas. Aguarda 15 minutos." },
      { status: 429 },
    );
  }
  if (!parsed.success)
    return NextResponse.json(
      { error: "Credenciais inválidas." },
      { status: 401 },
    );
  return authenticate(request, parsed.data);
}

async function authenticate(
  request: Request,
  credentials: z.infer<typeof schema>,
) {
  const user = await prisma.user.findUnique({
    where: { email: credentials.email.toLowerCase() },
  });
  if (
    !user?.active ||
    !verifyPassword(credentials.password, user.passwordHash)
  ) {
    return NextResponse.json(
      { error: "Credenciais inválidas." },
      { status: 401 },
    );
  }
  const token = createSessionToken({
    userId: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
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
