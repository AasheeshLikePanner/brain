/*
  Warnings:

  - A unique constraint covering the columns `[userId,name]` on the table `entities` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."idx_embeddings_vector";

-- DropIndex
DROP INDEX "public"."idx_memories_type";

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "accessCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "entities_userId_name_key" ON "entities"("userId", "name");
