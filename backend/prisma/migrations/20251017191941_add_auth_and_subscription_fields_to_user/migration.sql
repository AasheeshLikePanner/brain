-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('FREE', 'PRO', 'PLUS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "googleId" TEXT,
ADD COLUMN "name" TEXT,
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "subscriptionType" "SubscriptionType" NOT NULL DEFAULT 'PLUS',
ADD COLUMN "subscriptionPurchaseDate" TIMESTAMP(3),
ADD COLUMN "subscriptionExpiryDate" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Update existing rows for updatedAt (if any)
UPDATE "users" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
