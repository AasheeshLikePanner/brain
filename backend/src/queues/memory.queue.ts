import { Queue, Worker, Job } from 'bullmq';
import redis from './redis';

// Define the interface for the job data
export interface MemoryExtractionJob {
  userId: string;
  chatId: string;
  userMessage: string;
  assistantMessage: string;
}

// Initialize the queue
export const memoryQueue = new Queue<MemoryExtractionJob>('memory-extraction', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

// Implement the worker
export const memoryWorker = new Worker<MemoryExtractionJob>(
  'memory-extraction',
  async (job: Job<MemoryExtractionJob>) => {
    console.log(`[MemoryWorker] Processing job ${job.id}:`, job.data);
    // Simulate a delay for placeholder
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`[MemoryWorker] Finished processing job ${job.id}.`);
    // In a later phase, this will call the MemoryExtractorService
  },
  { connection: redis }
);

memoryWorker.on('completed', (job) => {
  console.log(`[MemoryWorker] Job ${job.id} completed successfully.`);
});

memoryWorker.on('failed', (job, err) => {
  console.error(`[MemoryWorker] Job ${job?.id} failed with error:`, err);
});

console.log('[MemoryQueue] Memory extraction queue and worker initialized.');
