import { Router } from 'express';
import { memoriesController } from '../../controllers/memories.controller';

const router = Router();

// Route to reinforce a specific memory
// POST /api/memories/:memoryId/reinforce
router.post('/:memoryId/reinforce', memoriesController.reinforceMemory);

// Route to soft-delete a specific memory
// DELETE /api/memories/:memoryId
router.delete('/:memoryId', memoriesController.deleteMemory);

// Route to get all memories for the placeholder user
// GET /api/memories/all
router.get('/all', memoriesController.getAllMemories);


export default router;
