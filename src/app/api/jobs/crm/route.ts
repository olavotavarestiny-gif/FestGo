import { NextResponse } from "next/server";
import { processCRMJobs } from "@/lib/integrations/crm-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  return NextResponse.json(await processCRMJobs());
}
