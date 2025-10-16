import { memoryDeduplicationService } from "./src/services/memory-deduplication.service";
import prisma from "./src/db";

async function runDeduplication() {
  console.log('Manually triggering memory deduplication...');
  await memoryDeduplicationService.findAndMergeDuplicates();
  console.log('Memory deduplication finished.');
}1

runDeduplication().catch(e => {
  console.error(e);
  prisma.$disconnect();
});
