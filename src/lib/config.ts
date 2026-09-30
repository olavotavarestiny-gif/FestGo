/** Server-side configuration. Invalid values fail closed instead of silently changing policy. */
function minutes(name: string, fallback: number, maximum = 1440) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`Invalid ${name} configuration.`);
  return value;
}

export const reservationHoldMinutes = () => minutes("RESERVATION_HOLD_MINUTES", 30, 120);
export const abandonedCheckoutFollowupMinutes = () => minutes("ABANDONED_CHECKOUT_FOLLOWUP_MINUTES", 10);
export const otpExpirationMinutes = () => minutes("OTP_EXPIRATION_MINUTES", 5, 15);
export const maxOtpAttempts = () => minutes("MAX_OTP_ATTEMPTS", 5, 10);
export const isOtpRequired = () => process.env.CHECKOUT_REQUIRE_OTP !== "false";

export function publicBaseUrl() {
  const url = new URL(process.env.PUBLIC_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("PUBLIC_BASE_URL must be an origin without credentials.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && process.env.NODE_ENV !== "production"))
    throw new Error("PUBLIC_BASE_URL requires HTTPS.");
  return url.origin;
}

export function validWhatsappGroupUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chat.whatsapp.com" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^\/[A-Za-z0-9_-]{10,80}$/.test(url.pathname);
  } catch { return false; }
}
