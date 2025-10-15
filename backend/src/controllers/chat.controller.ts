import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';
import { chatService } from '../services/chat.service';
import prisma from '../db';

class ChatController {

  // Hardcoded user for now. In a real app, this would come from auth middleware.
  private placeholderUserId = '123e4567-e89b-12d3-a456-426614174000';

  private ensureUser = async (): Promise<string> => {
    try {
      console.log(`[ChatController] Ensuring user ${this.placeholderUserId} exists...`);
      
      // Try to find user first
      let user = await prisma.user.findUnique({
        where: { id: this.placeholderUserId }
      });

      if (!user) {
        console.log(`[ChatController] Creating user ${this.placeholderUserId}...`);
        user = await prisma.user.create({
          data: { 
            id: this.placeholderUserId, 
            email: 'placeholder@example.com' 
          }
        });
        console.log(`[ChatController] User ${this.placeholderUserId} created.`);
      } else {
        console.log(`[ChatController] User ${this.placeholderUserId} already exists.`);
      }
      
      return this.placeholderUserId;
    } catch (error) {
      console.error("Failed to ensure user exists", error);
      throw error; // Don't handle response here, let the calling method handle it
    }
  }

  createChat = async (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Initial message is required' });
    }

    try {
      const userId = await this.ensureUser();
      const chat = await chatService.createChat(userId, message);
      res.status(201).json(chat);
    } catch (error) {
      console.error('Error creating chat:', error);
      res.status(500).json({ error: 'Failed to create chat.' });
    }
  }

  getChatHistory = async (req: Request, res: Response) => {
    const { chatId } = req.params;
    try {
      const userId = await this.ensureUser();
      const history = await chatService.getChatHistory(chatId, userId);
      res.status(200).json(history);
    } catch (error) {
      console.error('Error getting chat history:', error);
      res.status(500).json({ error: 'Failed to retrieve chat history.' });
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
      const userId = await this.ensureUser();
      const stream = await chatService.streamChatResponse(chatId, userId, message);
      
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
      console.error('Error streaming message:', error);
      res.status(500).json({ error: 'Failed to stream message.' });
    }
  }

  // --- Legacy Methods ---
  handleIngest = async (req: Request, res: Response) => {
    console.log('[ChatController] Received request to handleIngest.');
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    try {
      console.log('[ChatController] Calling ensureUser...');
      const userId = await this.ensureUser();
      console.log('[ChatController] ensureUser completed. Proceeding with memory ingestion...');
      
      const newMemory = await memoryService.ingest(userId, content);
      res.status(201).json({ message: 'Memory ingested successfully', memory: newMemory });
    } catch (error) {
      console.error('Error ingesting memory:', error);
      res.status(500).json({ error: 'Failed to ingest memory.' });
    }
  }

  handleRetrieve = async (req: Request, res: Response) => {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    try {
      const userId = await this.ensureUser();
      const response = await memoryService.retrieve(this.placeholderUserId, query);
      res.status(200).json({ response });
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }
}

export const chatController = new ChatController();