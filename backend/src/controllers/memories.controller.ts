import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';
import prisma from '../db';

class MemoriesController {
  // Hardcoded user for now. In a real app, this would come from auth middleware.
  private placeholderUserId = '123e4567-e89b-12d3-a456-426614174000';

  getAllMemories = async (req: Request, res: Response) => {
    try {
      const memories = await prisma.memory.findMany({
        where: { userId: this.placeholderUserId },
        include: { embeddings: true } // Include embeddings to check if they are populated
      });
      res.status(200).json(memories);
    } catch (error) {
      console.error('Error getting all memories:', error);
      res.status(500).json({ error: 'Failed to retrieve memories.' });
    }
  }

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
