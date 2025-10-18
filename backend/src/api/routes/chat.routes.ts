import { Router } from 'express';
import { chatController } from '../../controllers/chat.controller';
import { isAuthenticated } from '../../middleware/auth.middleware'; // New: Import authentication middleware

const router = Router();

// Route to create a new chat session
// POST /api/chat
router.post('/', isAuthenticated, chatController.createChat);

// Route to get proactive alerts
// GET /api/chat/proactive
router.get('/proactive', isAuthenticated, chatController.getProactiveAlerts);

// Route to get all messages for a specific chat
// GET /api/chat/:chatId
router.get('/:chatId', isAuthenticated, chatController.getChatHistory);

// Route to stream a new message to an existing chat
// POST /api/chat/:chatId/message
router.post('/:chatId/message', isAuthenticated, chatController.streamMessage);


// Keep old routes for now, but we can deprecate them later
router.post('/ingest', isAuthenticated, chatController.handleIngest);
router.post('/query', isAuthenticated, chatController.handleRetrieve);

export default router;