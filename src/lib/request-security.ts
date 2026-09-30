/** Cookie-authenticated writes only accept same-origin browser requests. */
export function isSameOriginRequest(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients authenticate independently.
  try {
    const allowed = new URL(process.env.PUBLIC_BASE_URL ?? process.env.APP_URL ?? request.url).origin;
    return new URL(origin).origin === allowed;
  } catch { return false; }
}
