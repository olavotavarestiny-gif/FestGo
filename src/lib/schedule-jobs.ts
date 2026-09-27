import { after } from "next/server";

export function schedulePostPaymentJobs(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const headers = { authorization: `Bearer ${secret}` };
  after(async () => {
    await Promise.allSettled([
      fetch(new URL("/api/jobs/notifications", request.url), {
        method: "POST",
        headers,
        cache: "no-store",
      }),
      fetch(new URL("/api/jobs/crm", request.url), {
        method: "POST",
        headers,
        cache: "no-store",
      }),
    ]);
  });
}
