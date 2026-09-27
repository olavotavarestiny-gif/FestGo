import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database timeout")), 3_000),
      ),
    ]);
    return NextResponse.json(
      {
        status: "ready",
        sales: process.env.SALES_ENABLED === "true" ? "enabled" : "disabled",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", sales: "disabled" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
