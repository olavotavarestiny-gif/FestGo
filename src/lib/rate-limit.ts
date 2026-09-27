import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";

export function clientIp(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function enforceRateLimit(input: {
  namespace: string;
  identifier: string;
  limit: number;
  windowMs: number;
}) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET is not configured.");
  const now = Date.now();
  const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
  const key = createHmac("sha256", secret)
    .update(`${input.namespace}:${input.identifier}:${windowStart}`)
    .digest("hex");
  const bucket = await prisma.requestRateLimit.upsert({
    where: { key },
    create: {
      key,
      count: 1,
      windowStart: new Date(windowStart),
      expiresAt: new Date(windowStart + input.windowMs * 2),
    },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (bucket.count > input.limit) {
    const error = new Error(
      "Muitos pedidos. Tenta novamente mais tarde.",
    ) as Error & { status: number };
    error.status = 429;
    throw error;
  }
}
