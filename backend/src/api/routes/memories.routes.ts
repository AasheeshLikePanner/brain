import { Router } from 'express';
import { memoriesController } from '../../controllers/memories.controller';

const router = Router();

// Route to reinforce a specific memory
// POST /api/memories/:memoryId/reinforce
router.post('/:memoryId/reinforce', memoriesController.reinforceMemory);

// Route to soft-delete a specific memory
// DELETE /api/memories/:memoryId
router.delete('/:memoryId', memoriesController.deleteMemory);

export default router;
