import { NextResponse } from "next/server";
import { flushMetaPurchases } from "@/lib/meta-server";
export const runtime = "nodejs";
async function run(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  await flushMetaPurchases(); return NextResponse.json({ processed: true });
}
export { run as GET, run as POST };
