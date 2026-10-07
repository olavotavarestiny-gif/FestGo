-- Additive audit fields; never infer verification from a customer phone alone.
ALTER TABLE "Reservation" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3), ADD COLUMN "verifiedPhone" TEXT;
ALTER TABLE "SMSVerification" ADD COLUMN "sendStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "sentAt" TIMESTAMP(3), ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerStatus" TEXT, ADD COLUMN "lastError" TEXT;
ALTER TABLE "Notification" ADD COLUMN "dispatchStartedAt" TIMESTAMP(3);
-- Historical attempts may have reached the provider. Do not automatically replay them.
UPDATE "Notification" SET "dispatchStartedAt" = COALESCE("sentAt", "updatedAt") WHERE "attempts" > 0 OR "status" IN ('SENT', 'PROCESSING');
UPDATE "Notification" SET "status" = 'UNKNOWN', "lastError" = 'Tentativa histórica sem confirmação; reenvio automático bloqueado.'
WHERE "dispatchStartedAt" IS NOT NULL AND "status" IN ('PENDING', 'RETRY', 'PROCESSING');
UPDATE "SMSVerification" SET "sendStatus" = CASE WHEN "verifiedAt" IS NOT NULL THEN 'SENT' ELSE 'UNKNOWN' END;
-- Only consumed challenges at reservation creation are evidence of verification.
UPDATE "Reservation" r SET "phoneVerifiedAt" = v."verifiedAt", "verifiedPhone" = c."phone"
FROM "Customer" c, "SMSVerification" v
WHERE r."customerId" = c."id" AND v."phone" = c."phone" AND v."verifiedAt" IS NOT NULL
  AND v."usedAt" = r."termsAcceptedAt";
