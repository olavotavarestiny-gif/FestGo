import Clarity from "@microsoft/clarity";

export type ClarityEvent =
  | "reserve_clicked"
  | "pickup_selected"
  | "passenger_data_started"
  | "passenger_data_completed"
  | "otp_requested"
  | "otp_verified"
  | "payment_started"
  | "payment_success"
  | "payment_failed";

declare global {
  interface Window {
    __festgoClarityInitialized?: boolean;
  }
}

export function initializeClarity(projectId: string | undefined) {
  if (typeof window === "undefined" || !projectId || window.__festgoClarityInitialized)
    return;

  try {
    Clarity.init(projectId);
    window.__festgoClarityInitialized = true;
  } catch {
    // Analytics must never interrupt a reservation or payment.
  }
}

export function trackClarityEvent(eventName: ClarityEvent) {
  if (typeof window === "undefined" || !window.__festgoClarityInitialized) return;

  try {
    Clarity.event(eventName);
  } catch {
    // Analytics must never interrupt a reservation or payment.
  }
}
