import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';
import prisma from '../db';

class ChatController {

  async handleIngest(req: Request, res: Response) {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // In a real application, userId would come from an authentication middleware.
    // For now, we'll use a hardcoded placeholder.
    const placeholderUserId = '123e4567-e89b-12d3-a456-426614174000'; // Example UUID

    try {
      // We need to ensure a user exists with this ID, or create one.
      // For simplicity, let's find or create the user here.
      const user = await prisma.user.upsert({
        where: { id: placeholderUserId },
        update: {},
        create: { id: placeholderUserId, email: 'placeholder@example.com' },
      });

      const newMemory = await memoryService.ingest(user.id, content);
      res.status(201).json({ message: 'Memory ingested successfully', memory: newMemory });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to ingest memory' });
    }
  }
  async handleRetrieve(req: Request, res: Response) {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const placeholderUserId = '123e4567-e89b-12d3-a456-426614174000'; // Same placeholder as ingest

    try {
      // Ensure the user exists before attempting retrieval
      await prisma.user.upsert({
        where: { id: placeholderUserId },
        update: {},
        create: { id: placeholderUserId, email: 'placeholder@example.com' },
      });

      const response = await memoryService.retrieve(placeholderUserId, query);
      res.status(200).json({ response });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to retrieve memory' });
    }
  }
}

export const chatController = new ChatController();
