import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';
import { chatService } from '../services/chat.service';
import prisma from '../db';

class ChatController {

  // Hardcoded user for now. In a real app, this would come from auth middleware.
  private placeholderUserId = '123e4567-e89b-12d3-a456-426614174000';

  private async ensureUser(res: Response) {
    try {
      await prisma.user.upsert({
        where: { id: this.placeholderUserId },
        update: {},
        create: { id: this.placeholderUserId, email: 'placeholder@example.com' },
      });
    } catch (error) {
      console.error("Failed to ensure user exists", error);
      res.status(500).json({ error: 'Could not verify user.' });
      throw new Error("User verification failed");
    }
  }

  createChat = async (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Initial message is required' });
    }

    try {
      await this.ensureUser(res);
      const chat = await chatService.createChat(this.placeholderUserId, message);
      res.status(201).json(chat);
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }

  getChatHistory = async (req: Request, res: Response) => {
    const { chatId } = req.params;
    try {
      await this.ensureUser(res);
      const history = await chatService.getChatHistory(chatId, this.placeholderUserId);
      res.status(200).json(history);
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }

  streamMessage = async (req: Request, res: Response) => {
    console.log('\n[ChatController] Received request to stream message.');
    const { chatId } = req.params;
    const { message } = req.body;
    console.log(`[ChatController] Chat ID: ${chatId}, Message: "${message}"`);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    try {
      await this.ensureUser(res);
      const stream = await chatService.streamChatResponse(chatId, this.placeholderUserId, message);
      
      res.setHeader('Content-Type', 'application/octet-stream');
      stream.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        }
      }));

    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }

  // --- Legacy Methods ---
  async handleIngest(req: Request, res: Response) {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    try {
      await this.ensureUser(res);
      const newMemory = await memoryService.ingest(this.placeholderUserId, content);
      res.status(201).json({ message: 'Memory ingested successfully', memory: newMemory });
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }

  async handleRetrieve(req: Request, res: Response) {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    try {
      await this.ensureUser(res);
      const response = await memoryService.retrieve(this.placeholderUserId, query);
      res.status(200).json({ response });
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }
}

export const chatController = new ChatController();