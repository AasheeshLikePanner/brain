import { Request, Response } from 'express';
import { memoryService } from '../services/memory.service';
import { chatService } from '../services/chat.service';
import prisma from '../db';
import { ProactiveService } from '../services/proactive.service';

class ChatController {
  private proactiveService: ProactiveService;

  constructor() {
    this.proactiveService = new ProactiveService();
  }

  // Hardcoded user for now. In a real app, this would come from auth middleware.
  private placeholderUserId = '123e4567-e89b-12d3-a456-426614174000';

  private ensureUser = async (id: string | undefined = undefined): Promise<string> => {
    const targetUserId = id || this.placeholderUserId;
    try {
      console.log(`[ChatController] Ensuring user ${targetUserId} exists...`);

      // Try to find user first
      let user = await prisma.user.findUnique({
        where: { id: targetUserId }
      });

      if (!user) {
        console.log(`[ChatController] Creating user ${targetUserId}...`);
        user = await prisma.user.create({
          data: {
            id: targetUserId,
            email: 'placeholder@example.com'
          }
        });
        console.log(`[ChatController] User ${targetUserId} created.`);
      } else {
        console.log(`[ChatController] User ${targetUserId} already exists.`);
      }

      return targetUserId;
    } catch (error) {
      console.error("Failed to ensure user exists", error);
      throw error; // Don't handle response here, let the calling method handle it
    }
  }

  getProactiveAlerts = async (req: Request, res: Response) => {
    try {
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);
      const alerts = await this.proactiveService.generateProactiveAlerts(userId);
      console.log('[ChatController] Generated proactive alerts:', alerts);
      const formatted = this.proactiveService.formatAlertsForDisplay(alerts);

      res.status(200).json({
        alerts,
        formatted,
        count: alerts.length
      });
    } catch (error) {
      console.error('Error getting proactive alerts:', error);
      res.status(500).json({ error: 'Failed to generate proactive alerts' });
    }
  }

  /**
   * ENHANCED: Creates a new chat and immediately streams the response,
   * returning the new chat's ID in the X-Chat-Id header.
   */
  createChat = async (req: Request, res: Response) => {
    console.log('\n[ChatController] Received request to create chat and stream message.');
    const { message } = req.body;
    console.log(`[ChatController] Message: "${message}"`);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    try {
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);

      // 1. Create a new chat session to get a chatId
      const newChat = await chatService.createChatSession(userId, message);
      const chatId = newChat.id;
      console.log(`[ChatController] Created new chat with ID: ${chatId}`);

      // 2. Set the chatId in a header so the frontend can perform routing
      res.setHeader('X-Chat-Id', chatId);

      // 3. Stream the response for the initial message
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
      console.error('Error creating chat and streaming response:', error);
      // Ensure response is sent only if headers haven't been sent
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create chat and stream response.' });
      }
    }
  }
  getChatHistory = async (req: Request, res:Response) => {
    const { chatId } = req.params;
    try {
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);
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

    try {
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);
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
    console.log('[ChatController] Raw req.body:', req.body);
    const { content, temporal, type, importance, source } = req.body; // Extract temporal, type, importance, source
    console.log(`[ChatController] handleIngest: Extracted - content: ${content}, type: ${type}, importance: ${importance}, source: ${source}, temporal: ${temporal}`);

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    try {
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);
      console.log('[ChatController] ensureUser completed. Proceeding with memory ingestion...');

      const recordedAtValue = (temporal !== undefined && temporal !== null) ? temporal : null;
      const newMemory = await memoryService.ingest(
        userId,
        content,
        type || 'note', // Use provided type or default to 'note'
        importance || 0.5, // Use provided importance or default to 0.5
        source || 'unknown', // Use provided source or default to 'unknown'
        recordedAtValue as string | null
      );
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
      // For testing without auth, get userId from header. In production, this would come from auth middleware.
      const userId = await this.ensureUser(req.headers['x-user-id'] as string | undefined);
      const response = await memoryService.retrieve(userId, query);
      res.status(200).json({ response });
    } catch (error) {
      // ensureUser will have already sent a response on failure
    }
  }
}

export const chatController = new ChatController();