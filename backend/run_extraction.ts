import { extractTripletsForUser } from './src/jobs/triplet_extraction.job';

async function runExtraction() {
  const userId = process.argv[2]; // Get userId from command line argument
  if (!userId) {
    console.error('Usage: ts-node run_extraction.ts <userId>');
    process.exit(1);
  }
  console.log(`Manually triggering triplet extraction for user ${userId}...`);
  await extractTripletsForUser(userId);
  console.log('Triplet extraction finished.');
}

runExtraction();