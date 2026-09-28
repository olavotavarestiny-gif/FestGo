import { after } from "next/server";

export function schedulePostPaymentJobs(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const headers = { authorization: `Bearer ${secret}` };
  after(async () => {
    const jobs = [
      fetch(new URL("/api/jobs/notifications", request.url), {
        method: "POST",
        headers,
        cache: "no-store",
      }),
    ];
    if (process.env.KUKUGEST_ENABLED === "true")
      jobs.push(fetch(new URL("/api/jobs/crm", request.url), {
        method: "POST",
        headers,
        cache: "no-store",
      }));
    await Promise.allSettled(jobs);
  });
}
