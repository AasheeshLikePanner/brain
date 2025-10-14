import express, { Request, Response } from 'express';
import chatRoutes from './api/routes/chat.routes';
import cors from 'cors';

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

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});