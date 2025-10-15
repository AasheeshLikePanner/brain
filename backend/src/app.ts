import express, { Request, Response } from 'express';
import chatRoutes from './api/routes/chat.routes';
import memoriesRoutes from './api/routes/memories.routes';
import cors from 'cors';
import cron from 'node-cron';
import { archiveOldMemories } from './jobs/archiving.job';
import { generateDailySummaries } from './jobs/summarization.job';
import { extractTriplets } from './jobs/triplet_extraction.job';
import graphRoutes from './api/routes/graph.routes';

const app = express();
const port = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(express.json());

// Enable CORS for all routes
app.use(cors());

// Health check route
app.get('/', (req: Request, res: Response) => {
  res.send('Second Brain Backend is running!');
});

// Use the chat routes
app.use('/api/chat', chatRoutes);

// Use the memories routes
app.use('/api/memories', memoriesRoutes);

// Use the graph routes
app.use('/api/graph', graphRoutes);

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);

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

  // Schedule the triplet extraction job to run every hour
  cron.schedule('* * * * *', () => {
    console.log('\n---\nRunning scheduled job: extractTriplets\n---');
    extractTriplets();
  }, {
    timezone: "America/New_York" // Example timezone
  });
  console.log('Scheduled hourly triplet extraction job.');
});
