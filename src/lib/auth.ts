import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifySessionToken } from "@/lib/auth-crypto";

export const SESSION_COOKIE =
  process.env.SESSION_COOKIE_NAME || "festgo_session";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user?.active || user.role !== payload.role) return null;
  return user;
}

export async function requireStaff(role?: "ADMIN") {
  const user = await currentUser();
  if (!user || (role && user.role !== role)) redirect("/admin/login");
  return user;
}

export async function staffFromRequest(request: Request, role?: "ADMIN") {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const payload = verifySessionToken(
    cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : "",
  );
  if (!payload || (role && payload.role !== role)) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  return user?.active && (!role || user.role === role) ? user : null;
}
