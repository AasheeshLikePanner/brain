/*
  Warnings:

  - Made the column `email` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('active', 'historical', 'deprecated');

-- AlterTable
ALTER TABLE "entity_links" ADD COLUMN     "status" "RelationshipStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;
