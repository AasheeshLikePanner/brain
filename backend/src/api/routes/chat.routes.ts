import { Router } from 'express';
import { chatController } from '../../controllers/chat.controller';

const router = Router();

// Route to handle ingestion of new memories
// POST /api/chat/ingest
router.post('/ingest', chatController.handleIngest);

// Route to handle retrieval of memories
// POST /api/chat/query
router.post('/query', chatController.handleRetrieve);

export default router;
