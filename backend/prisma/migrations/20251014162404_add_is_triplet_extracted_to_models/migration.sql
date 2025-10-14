-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "isTripletExtracted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "isTripletExtracted" BOOLEAN NOT NULL DEFAULT false;
