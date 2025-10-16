import { extractTriplets } from './src/jobs/triplet_extraction.job';

async function runExtraction() {
  console.log('Manually triggering triplet extraction...');
  await extractTriplets();
  console.log('Triplet extraction finished.');
}

runExtraction();