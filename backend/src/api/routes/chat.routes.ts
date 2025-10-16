import { Router } from 'express';
import { chatController } from '../../controllers/chat.controller';

const router = Router();

// Route to create a new chat session
// POST /api/chat
router.post('/', chatController.createChat);

// Route to get proactive alerts
// GET /api/chat/proactive
router.get('/proactive', chatController.getProactiveAlerts);

// Route to get all messages for a specific chat
// GET /api/chat/:chatId
router.get('/:chatId', chatController.getChatHistory);


// Keep old routes for now, but we can deprecate them later
router.post('/ingest', chatController.handleIngest);
router.post('/query', chatController.handleRetrieve);

export default router;