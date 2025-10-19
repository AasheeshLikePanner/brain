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

  getProactiveAlerts = async (req: Request, res: Response) => {
    debugger;
    try {
      const userId = (req.user as any).id;
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

  createChat = async (req: Request, res: Response) => {
    debugger;
    console.log('\n[ChatController] Received request to create chat and stream message.');
    const { message } = req.body;
    console.log(`[ChatController] Message: "${message}"`);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    try {
      const userId = (req.user as any).id;

      const newChat = await chatService.createChatSession(userId, message);
      const chatId = newChat.id;
      console.log(`[ChatController] Created new chat with ID: ${chatId}`);

      res.setHeader('X-Chat-Id', chatId);

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
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create chat and stream response.' });
      }
    }
  }

  getChatHistory = async (req: Request, res:Response) => {
    debugger;
    const { chatId } = req.params;
    try {
      const userId = (req.user as any).id;
      const history = await chatService.getChatHistory(chatId, userId);
      res.status(200).json(history);
    } catch (error) {
      console.error('Error getting chat history:', error);
      res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
  }

  streamMessage = async (req: Request, res: Response) => {
    console.time('chatController.streamMessage');
    debugger;
    console.log('\n[ChatController] Received request to stream message.');
    const { chatId } = req.params;
    const { message } = req.body;
    console.log(`[ChatController] Chat ID: ${chatId}, Message: "${message}"`);

    try {
      const userId = (req.user as any).id;
      const stream = await chatService.streamChatResponse(chatId, userId, message);

      res.setHeader('Content-Type', 'application/octet-stream');
      stream.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
          console.timeEnd('chatController.streamMessage');
        }
      }));

    } catch (error) {
      console.error('Error streaming message:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream message.' });
      }
      console.timeEnd('chatController.streamMessage');
    }
  }

  handleIngest = async (req: Request, res: Response) => {
    debugger;
    console.log('[ChatController] Received request to handleIngest.');
    const { content, temporal, type, importance, source } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    try {
      const userId = (req.user as any).id;
      const recordedAtValue = (temporal !== undefined && temporal !== null) ? temporal : null;
      const newMemory = await memoryService.ingest(
        userId,
        content,
        type || 'note',
        importance || 0.5,
        source || 'unknown',
        recordedAtValue as string | null
      );
      res.status(201).json({ message: 'Memory ingested successfully', memory: newMemory });
    } catch (error) {
      console.error('Error ingesting memory:', error);
      res.status(500).json({ error: 'Failed to ingest memory.' });
    }
  }

  handleRetrieve = async (req: Request, res: Response) => {
    debugger;
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    try {
      const userId = (req.user as any).id;
      const response = await memoryService.retrieve(userId, query);
      res.status(200).json({ response });
    } catch (error) {
      console.error('Error retrieving memory:', error);
      res.status(500).json({ error: 'Failed to retrieve memory.' });
    }
  }
}

export const chatController = new ChatController();
