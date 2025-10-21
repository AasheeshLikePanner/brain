/*
  Warnings:

  - The `status` column on the `entity_links` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `confidence` on table `entity_links` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `updatedAt` to the `memories` table without a default value. This is not possible if the table is not empty.

*/

-- Set default for existing NULL confidence values before making it NOT NULL
UPDATE "entity_links" SET "confidence" = 0.7 WHERE "confidence" IS NULL;

-- Step 1: Add new columns to entity_links
ALTER TABLE "entity_links" ADD COLUMN "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "entity_links" ADD COLUMN "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "entity_links" ADD COLUMN "mentions" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "entity_links" ADD COLUMN "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

-- Step 2: Alter confidence column
ALTER TABLE "entity_links" ALTER COLUMN "confidence" SET NOT NULL;
ALTER TABLE "entity_links" ALTER COLUMN "confidence" SET DEFAULT 0.7;

-- Step 3: Handle status column recreation to avoid data loss
-- Add a temporary new status column
ALTER TABLE "entity_links" ADD COLUMN "status_new" TEXT NOT NULL DEFAULT 'active';

-- Copy data from the old status column to the new one
-- Assuming 'active' is a reasonable default for existing data.
-- If you had specific enum values, you'd need a more complex CASE statement here.
UPDATE "entity_links" SET "status_new" = 'active' WHERE "status" IS NOT NULL;

-- Drop the old status column
ALTER TABLE "entity_links" DROP COLUMN "status";

-- Rename the new status column to the original name
ALTER TABLE "entity_links" RENAME COLUMN "status_new" TO "status";


-- AlterTable for memories: Corrected order for 'updatedAt'
-- 1. Add 'updatedAt' column, allowing NULLs initially
ALTER TABLE "memories" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- 2. Update existing rows with a default value for 'updatedAt'
UPDATE "memories" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;

-- 3. Alter 'updatedAt' column to be NOT NULL
ALTER TABLE "memories" ALTER COLUMN "updatedAt" SET NOT NULL;


-- DropEnum
DROP TYPE "public"."RelationshipStatus";

-- CreateIndex
CREATE INDEX "entity_links_entityId_idx" ON "entity_links"("entityId");

-- CreateIndex
CREATE INDEX "entity_links_objectId_idx" ON "entity_links"("objectId");

-- CreateIndex
CREATE INDEX "entity_links_status_idx" ON "entity_links"("status");

-- CreateIndex
CREATE INDEX "entity_links_lastSeen_idx" ON "entity_links"("lastSeen");

-- CreateIndex
CREATE INDEX "memories_userId_idx" ON "memories"("userId");

-- CreateIndex
CREATE INDEX "memories_recordedAt_idx" ON "memories"("recordedAt");

-- CreateIndex
CREATE INDEX "memories_confidenceScore_idx" ON "memories"("confidenceScore");

-- CreateIndex
CREATE INDEX "memories_deleted_idx" ON "memories"("deleted");