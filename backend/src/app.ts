import 'dotenv/config';
console.log('--- NODEMON APP.TS CHANGE TEST ---');
import express, { Request, Response } from 'express';
import chatRoutes from './api/routes/chat.routes';
import memoriesRoutes from './api/routes/memories.routes';
import cors from 'cors';
import cron from 'node-cron';
import { archiveOldMemories } from './jobs/archiving.job';
import { generateDailySummaries } from './jobs/summarization.job';
import { extractTriplets } from './jobs/triplet_extraction.job';
import graphRoutes from './api/routes/graph.routes';
import { memoryWorker } from './queues/memory.queue';
import { memoryIndexService } from './services/memory-index.service';
import { memoryDeduplicationService } from './services/memory-deduplication.service';
import { applyConfidenceDecay } from './jobs/confidence-decay.job';
import { MemoryAssociationService } from './services/memory-association.service';
import { ProactiveService } from './services/proactive.service';
import prisma from './db';


const app = express();
const proactiveService = new ProactiveService();
const port = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(express.json());

// Enable CORS for all routes
app.use(cors());

// Health check route
app.get('/', (req: Request, res: Response) => {
  res.send('Second Brain Backend is running!');
});

app.get('/test', (req, res) => {
  console.log('[App] /test route hit!');
  res.send('Test route works!');
});

// app.get('/api/chat/proactive', async (req, res) => {
//   console.log('[App] /api/chat/proactive route hit directly in app.ts!');
//   const userId = '123e4567-e89b-12d3-a456-426614174000'; // Hardcode for testing
//   const alerts = await proactiveService.generateProactiveAlerts(userId);
//   console.log('[App] Generated proactive alerts directly in app.ts:', alerts);
//   res.json(alerts);
// });

// Use the chat routes
app.use('/api/chat', chatRoutes);

// Use the memories routes
app.use('/api/memories', memoriesRoutes);

// Use the graph routes
app.use('/api/graph', graphRoutes);

app.listen(port, async () => {
  console.log(`Server is listening on port ${port}`);

  // Only initialize worker if not running in a separate worker process
  if (process.env.RUN_WORKER !== 'true') {
    // Initialize memory index (placeholder for now, actual indexing is via migrations)
    await memoryIndexService.buildIndex('system');

    // Schedule the archiving job to run at 2:00 AM every day
    cron.schedule('0 2 * * *', () => {
      console.log('\n---\nRunning scheduled job: archiveOldMemories\n---');
      archiveOldMemories();
    }, {
      timezone: "America/New_York" // Example timezone, should be configured based on user preference
    });
    console.log('Scheduled daily memory archiving job.');

    // Schedule the summarization job to run at 3:00 AM every day
    cron.schedule('0 3 * * *', () => {
      console.log('\n---\nRunning scheduled job: generateDailySummaries\n---');
      generateDailySummaries();
    }, {
      timezone: "America/New_York" // Example timezone, should be configured based on user preference
    });
    console.log('Scheduled daily summarization job.');

    // Schedule the deduplication job to run at 2:30 AM every day
    cron.schedule('30 2 * * *', async () => {
      console.log('\n---\nRunning scheduled job: findAndMergeDuplicates\n---');
      await memoryDeduplicationService.findAndMergeDuplicates();
    }, {
      timezone: "America/New_York" // Example timezone
    });
    console.log('Scheduled daily memory deduplication job.');

    // Schedule the triplet extraction job to run every hour
    cron.schedule('* * * * *', () => {
      console.log('\n---\nRunning scheduled job: extractTriplets\n---');
      extractTriplets();
    }, {
      timezone: "America/New_York" // Example timezone
    });
    console.log('Scheduled hourly triplet extraction job.');

    // Schedule the confidence decay job to run at 2:15 AM every day
    cron.schedule('15 2 * * *', () => {
      console.log('\n---\nRunning scheduled job: applyConfidenceDecay\n---');
      applyConfidenceDecay();
    }, {
      timezone: "America/New_York" // Example timezone
    });
    console.log('Scheduled daily confidence decay job.');

    // Schedule the memory association computation job to run at 3 AM every Sunday
    const associationService = new MemoryAssociationService();
    cron.schedule('0 3 * * 0', async () => {
      console.log('\n---\nRunning scheduled job: computeMemoryAssociations\n---');
      const users = await prisma.user.findMany();
      for (const user of users) {
        await associationService.computeMemoryAssociations(user.id);
      }
    }, {
      timezone: "America/New_York" // Example timezone
    });
    console.log('Scheduled weekly memory association computation job.');

    // Schedule the proactive alert generation job to run every hour
    const proactiveService = new ProactiveService();
    const alertCache = new Map<string, any>();
    cron.schedule('0 * * * *', async () => {
      console.log('\n---\nRunning scheduled job: pre-computing proactive alerts\n---');
      const users = await prisma.user.findMany();
      for (const user of users) {
        const alerts = await proactiveService.generateProactiveAlerts(user.id);
        if (alerts.length > 0) {
          alertCache.set(user.id, {
            alerts,
            timestamp: new Date()
          });
          console.log(`[Proactive] Found ${alerts.length} alerts for user ${user.id}`);
        }
      }
    });
    console.log('Scheduled hourly proactive alert generation job.');
  }
});
