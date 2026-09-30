-- Additive only: existing reservations, payments and audit history are preserved.
ALTER TABLE "Route" ADD COLUMN "whatsappGroupUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN "provider" TEXT DEFAULT 'ziett';
CREATE INDEX "Reservation_routeId_status_holdExpiresAt_idx" ON "Reservation" ("routeId", "status", "holdExpiresAt");
