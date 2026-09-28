import { NextResponse } from "next/server";
import { processCRMJobs } from "@/lib/integrations/crm-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (process.env.KUKUGEST_ENABLED !== "true")
    return NextResponse.json(
      { error: "A sincronização KukuGest está desactivada." },
      { status: 409 },
    );

  return NextResponse.json(await processCRMJobs());
}

export async function GET(request: Request) {
  return POST(request);
}
