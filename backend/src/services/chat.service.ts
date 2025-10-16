import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { graphService } from './graph.service'; // NEW
import { memoryIndexService } from './memory-index.service';
import { Chat, ChatMessage } from '@prisma/client';
import { memoryQueue } from '../queues/memory.queue';
import { ReasoningService } from './reasoning.service';

class ChatService {
  private reasoningService: ReasoningService;

  constructor() {
    this.reasoningService = new ReasoningService();
  }

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

  async streamChatResponse(
    chatId: string,
    userId: string,
    message: string
  ): Promise<ReadableStream<Uint8Array>> {
    
    // ... existing code to save user message ...
    console.log('[ChatService] Starting streamChatResponse.');
    // 1. Save user message
    console.log('[ChatService] Attempting to save user message...');
    try {
      await prisma.chatMessage.create({
        data: {
          chatId,
          role: 'user',
          content: message,
        },
      });
      console.log('[ChatService] Saved user message. Proceeding to get chat history and memories.');
    } catch (error) {
      console.error('[ChatService] Error saving user message:', error);
      throw error; // Re-throw to propagate the error
    }

    // Get chat history
    const history = await this.getChatHistory(chatId, userId);

    // EXTRACT ENTITIES from recent conversation for contextual boosting
    const contextEntities = await this.extractContextEntities(history, message, userId);

    // Search memories with smart scoring
    const relevantMemories = await memoryIndexService.searchMemories(
      userId,
      message,
      5,
      contextEntities
    );

    // Get memory objects with full details
    const memoryDetails = await prisma.memory.findMany({
      where: {
        id: { in: relevantMemories.map(m => m.id) }
      }
    });

    // PERFORM REASONING on the retrieved memories
    const implications = await this.reasoningService.detectImplications(
      userId,
      memoryDetails,
      message
    );

    // Try graph-based reasoning if query seems relational
    const graphReasoning = await this.reasoningService.graphReasoning(
      userId,
      message
    );

    // ... existing graph query detection ...
    const contextString = relevantMemories
      .map(mem => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');

    // ENHANCED PROMPT CONSTRUCTION with reasoning
    let reasoningContext = '';
    
    if (implications.length > 0) {
      reasoningContext += '\n\n**Relevant Insights:**\n';
      implications.forEach((imp, i) => {
        reasoningContext += `${i + 1}. ${imp.content}\n`;
      });
    }

    if (graphReasoning.reasoning) {
      reasoningContext += '\n\n**Graph Analysis:**\n';
      reasoningContext += graphReasoning.reasoning + '\n';
      
      if (graphReasoning.relevantPaths.length > 0) {
        reasoningContext += '\nRelevant connections:\n';
        graphReasoning.relevantPaths.forEach(p => {
          reasoningContext += `- ${p.explanation}\n`;
        });
      }
    }

    const currentDate = new Date().toUTCString();
    const historyText = history.map(m => `${m.role}: ${m.content}`).join('\n');

    const systemPrompt = `You are a helpful assistant with access to the user's personal knowledge base and reasoning capabilities.\n\nYou have analyzed the context and identified some insights:${reasoningContext}\n\nWhen responding:\n1. Use the provided insights to give more helpful, proactive answers\n2. If implications suggest actions, offer them naturally\n3. If there are connections the user might not have considered, mention them\n4. Always cite sources using <Source id=\"...\" />\n\nYour answers must be formatted in MDX.\nWhen you mention a date, wrap it in <DateHighlight>component</DateHighlight>.\nWhen you reference a memory, wrap key insights in <MemoryHighlight>component</MemoryHighlight>.\nWhen you use information from memories, cite with <Source id=\"memory-id\" />.\n\nCurrent context:\n- Current Date/Time: ${currentDate}\n- User Location: [Location not provided]`;

    const userPrompt = `Here is the relevant context, including memories from our past conversations, that you should use to answer the question:\nRelevant Memories:\n${contextString}\n\nChat History:\n${historyText}\n\nUser's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    // ... rest of existing streaming logic ...
    const llmStream = await llmService.generateCompletionStream(prompt);
    console.log('[ChatService] Received stream from LLM service. Piping to transform stream...');

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
        console.log('[ChatService] Stream finished. Saving assistant message...');
        await prisma.chatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: fullResponse,
          },
        });
        console.log(`[ChatService] Saved assistant response for chat ${chatId}.\n---\n${fullResponse}\n---`);

        // Add a job to the memory extraction queue
        await memoryQueue.add('extract', { userId, chatId, userMessage: message, assistantMessage: fullResponse });
        console.log(`[ChatService] Added memory extraction job for chat ${chatId} to queue.`);
      }
    });

    return llmStream.pipeThrough(transformStream);
  }

  /**
 * Extract key entities from recent conversation for contextual boosting
 */
  private async extractContextEntities(
    history: ChatMessage[],
    currentMessage: string,
    userId: string
  ): Promise<string[]> {
    // Get last 5 messages for context
    const recentMessages = history.slice(-5);
    const conversationText = recentMessages
      .map(m => m.content)
      .join(' ') + ' ' + currentMessage;

    // Simple entity extraction (you can enhance this)
    const entities: string[] = [];

    // Extract capitalized words (potential named entities)
    const capitalizedWords = conversationText.match(/\b[A-Z][a-z]+\b/g) || [];
    entities.push(...capitalizedWords);

    // Extract entities from your graph
    const graphEntities = await prisma.entity.findMany({
      where: { userId: userId },
      select: { name: true }
    });

    const graphEntityNames = graphEntities.map(e => e.name);

    // Find which graph entities are mentioned in conversation
    const mentionedEntities = graphEntityNames.filter(name =>
      conversationText.toLowerCase().includes(name.toLowerCase())
    );

    entities.push(...mentionedEntities);

    // Return unique entities
    return [...new Set(entities)];
  }
}

export const chatService = new ChatService();
