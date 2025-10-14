import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { Chat, ChatMessage } from '@prisma/client';

class ChatService {

  async createChat(userId: string, initialMessage: string): Promise<Chat> {
    const chat = await prisma.chat.create({
      data: {
        userId,
        title: initialMessage.substring(0, 50),
        messages: {
          create: {
            role: 'user',
            content: initialMessage,
          }
        }
      },
      include: {
        messages: true,
      }
    });
    return chat;
  }

  async getChatHistory(chatId: string, userId: string): Promise<ChatMessage[]> {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    return chat?.messages || [];
  }

  async streamChatResponse(chatId: string, userId: string, message: string): Promise<ReadableStream<Uint8Array>> {
    console.log('[ChatService] Starting streamChatResponse.');
    // 1. Save user message
    await prisma.chatMessage.create({
      data: {
        chatId,
        role: 'user',
        content: message,
      },
    });
    console.log('[ChatService] Saved user message.');

    // 2. Get chat history and relevant memories
    const history = await this.getChatHistory(chatId, userId);
    console.log(`[ChatService] Retrieved ${history.length} messages from chat history.`);
    
    const memoryContext = await memoryService.getContext(userId, message, 3); // Get top 3 memories
    console.log(`[ChatService] Retrieved memory context:\n---\n${memoryContext}\n---`);

    // 3. Construct the prompt
    const historyText = history.map(m => `${m.role}: ${m.content}`).join('\n');
    const currentDate = new Date().toUTCString();

    const systemPrompt = `You are a helpful assistant. Your answers must be formatted in MDX.
When you mention a date, wrap it in a <DateHighlight>component</DateHighlight>. Example: <DateHighlight>2025-10-15</DateHighlight>.
When you reference a specific memory from the context provided, wrap the key insight in a <MemoryHighlight>component</MemoryHighlight>. Example: <MemoryHighlight>the user prefers coffee in the morning</MemoryHighlight>.
Keep your answers concise and clear.

Here is the current context for the user:
- Current Date/Time: ${currentDate}
- User Location: [Location not provided]

Use this context to provide more relevant and personalized answers.`;

    const userPrompt = `Based on the following memories and the recent chat history, answer the user's question.\n\nRelevant Memories:\n${memoryContext}\n\nChat History:\n${historyText}\n\nUser's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    console.log(`[ChatService] Constructed prompt for LLM.`);

    // 4. Get the stream from the LLM service
    const llmStream = await llmService.generateCompletionStream(prompt);
    console.log('[ChatService] Received stream from LLM service.');

    // 5. Use a TransformStream to save the full response while streaming
    let fullResponse = '';
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        // Extract content from the Ollama stream format
        try {
          const json = JSON.parse(text);
          if (json.response) {
            fullResponse += json.response;
          }
        } catch (e) {
          // In case of malformed JSON, just append the raw text
          fullResponse += text;
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        // When the stream is done, save the assistant's message
        await prisma.chatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: fullResponse,
          },
        });
        console.log(`[ChatService] Saved assistant response for chat ${chatId}.\n---\n${fullResponse}\n---`);
      }
    });

    return llmStream.pipeThrough(transformStream);
  }
}

export const chatService = new ChatService();