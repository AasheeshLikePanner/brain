-- AlterTable
ALTER TABLE "entity_links" ADD COLUMN     "chatMessageId" TEXT;

-- AddForeignKey
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
