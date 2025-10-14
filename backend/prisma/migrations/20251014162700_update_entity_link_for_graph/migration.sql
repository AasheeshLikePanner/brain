-- AlterTable
ALTER TABLE "entity_links" ADD COLUMN     "objectId" TEXT,
ALTER COLUMN "memoryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
