import { memoryWorker } from './queues/memory.queue';

console.log('[Worker] Memory worker process started.');
console.log('[Worker] Memory worker is ready to process jobs.');

// Keep the process alive
process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down memory worker...');
  await memoryWorker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down memory worker...');
  await memoryWorker.close();
  process.exit(0);
});
