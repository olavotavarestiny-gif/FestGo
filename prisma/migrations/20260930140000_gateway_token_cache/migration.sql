CREATE TABLE "GatewayToken" (
    "id" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "previousEncryptedValue" TEXT,
    "previousExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GatewayToken_pkey" PRIMARY KEY ("id")
);
