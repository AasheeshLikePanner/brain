import { Router } from 'express';
import { chatController } from '../../controllers/chat.controller';

const router = Router();

// Route to create a new chat session
// POST /api/chat
router.post('/', chatController.createChat);

// Route to get all messages for a specific chat
// GET /api/chat/:chatId
router.get('/:chatId', chatController.getChatHistory);

// Route to send a message to a chat and get a streamed response
// POST /api/chat/:chatId/messages
router.post('/:chatId/messages', chatController.streamMessage);

// Keep old routes for now, but we can deprecate them later
router.post('/ingest', chatController.handleIngest);
router.post('/query', chatController.handleRetrieve);

export default router;