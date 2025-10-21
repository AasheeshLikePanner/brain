import { Queue } from 'bullmq';
import redis from './queues/redis'; // Assuming redis connection is exported from here

const queueName = 'memory-extraction'; // The name of your queue

async function checkQueueStatus() {
  const queue = new Queue(queueName, { connection: redis });

  try {
    const counts = await queue.getJobCounts('active', 'completed', 'failed', 'delayed', 'waiting');
    console.log(`--- BullMQ Queue Status for '${queueName}' ---`);
    console.log(`Active jobs: ${counts.active}`);
    console.log(`Completed jobs: ${counts.completed}`);
    console.log(`Failed jobs: ${counts.failed}`);
    console.log(`Delayed jobs: ${counts.delayed}`);
    console.log(`Waiting jobs: ${counts.waiting}`);

    if (counts.failed > 0) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.question(`There are ${counts.failed} failed jobs. Do you want to retry them all? (yes/no): `, async (answer: string) => {
        if (answer.toLowerCase() === 'yes') {
          console.log('Retrying failed jobs...');
          const failedJobs = await queue.getFailed();
          for (const job of failedJobs) {
            try {
              await job.retry();
              console.log(`Successfully retried job ${job.id}`);
            } catch (retryError) {
              console.error(`Failed to retry job ${job.id}:`, retryError);
            }
          }
          console.log('Finished retrying failed jobs.');
        } else {
          console.log('Skipping retry of failed jobs.');
        }
        readline.close();
        await queue.close();
        await redis.disconnect();
      });
    } else {
      await queue.close();
      await redis.disconnect();
    }
  } catch (error) {
    console.error('Error fetching queue status:', error);
    await queue.close();
    await redis.disconnect();
  }
}

checkQueueStatus();
