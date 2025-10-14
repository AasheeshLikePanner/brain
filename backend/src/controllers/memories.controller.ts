import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';

class MemoriesController {
  async reinforceMemory(req: Request, res: Response) {
    const { memoryId } = req.params;
    if (!memoryId) {
      return res.status(400).json({ error: 'Memory ID is required' });
    }

    try {
      const updatedMemory = await memoryService.reinforce(memoryId);
      res.status(200).json({ message: 'Memory reinforced successfully', memory: updatedMemory });
    } catch (error) {
      console.error(error);
      if (error instanceof Error && error.message === 'Memory not found') {
        return res.status(404).json({ error: 'Memory not found' });
      }
      res.status(500).json({ error: 'Failed to reinforce memory' });
    }
  }

  async deleteMemory(req: Request, res: Response) {
    const { memoryId } = req.params;
    if (!memoryId) {
      return res.status(400).json({ error: 'Memory ID is required' });
    }

    try {
      await memoryService.softDelete(memoryId);
      res.status(200).json({ message: 'Memory deleted successfully' });
    } catch (error) {
      console.error(error);
      if (error instanceof Error && error.message === 'Memory not found') {
        return res.status(404).json({ error: 'Memory not found' });
      }
      res.status(500).json({ error: 'Failed to delete memory' });
    }
  }
}

export const memoriesController = new MemoriesController();
