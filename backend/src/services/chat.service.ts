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

  async createChatSession(userId: string, title: string): Promise<Chat> {
    const chat = await prisma.chat.create({
      data: {
        userId,
        title: title.substring(0, 50),
      }
    });
    return chat;
  }

  async streamChatResponse(
    chatId: string,
    userId: string,
    message: string
  ): Promise<ReadableStream<Uint8Array>> {
    
    console.log('[ChatService] Starting streamChatResponse - OPTIMIZED');
    
    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL DATA GATHERING (CRITICAL PATH)
    // ═══════════════════════════════════════════════════════════════
    const startTime = Date.now();
    
    // Don't await message save - let it happen in parallel
    const saveMessagePromise = prisma.chatMessage.create({
      data: { chatId, role: 'user', content: message }
    }).catch(err => {
      console.error('[ChatService] Error saving user message:', err);
      throw err;
    });

    // Run ALL data gathering in parallel
    const [history, contextEntities, relevantMemories] = await Promise.all([
      this.getChatHistory(chatId, userId),
      this.extractContextEntitiesQuick(message), // NEW: Fast entity extraction
      memoryIndexService.searchMemories(userId, message, 5, []), // Will enhance with entities later
      saveMessagePromise // Ensure save completes
    ]);

    console.log(`[ChatService] Phase 1 complete: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: PARALLEL MEMORY FETCH + REASONING
    // ═══════════════════════════════════════════════════════════════
    const phase2Start = Date.now();

    // Fetch memory details and run reasoning IN PARALLEL
    const [memoryDetails, implications, graphReasoning] = await Promise.all([
      prisma.memory.findMany({
        where: { id: { in: relevantMemories.map(m => m.id) } },
        select: {
          id: true,
          content: true,
          type: true,
          metadata: true,
          recordedAt: true
        }
      }),
      // Run both reasoning calls in parallel - key optimization!
      this.reasoningService.detectImplications(userId, relevantMemories, message),
      this.reasoningService.graphReasoning(userId, message)
    ]);

    console.log(`[ChatService] Phase 2 complete: ${Date.now() - phase2Start}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: PROMPT CONSTRUCTION (FAST)
    // ═══════════════════════════════════════════════════════════════
    const contextString = memoryDetails
      .map(mem => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');

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

    const systemPrompt = `You are a helpful assistant with access to the user's personal knowledge base and reasoning capabilities.

You have analyzed the context and identified some insights:${reasoningContext}

When responding:
1. Use the provided insights to give more helpful, proactive answers
2. If implications suggest actions, offer them naturally
3. If there are connections the user might not have considered, mention them
4. Always cite sources using <Source id="..." />

Your answers must be formatted in MDX.
When you mention a date, wrap it in <DateHighlight>component</DateHighlight>.
When you reference a memory, wrap key insights in <MemoryHighlight>component</MemoryHighlight>.
When you use information from memories, cite with <Source id="memory-id" />.

Current context:
- Current Date/Time: ${currentDate}
- User Location: [Location not provided]`;

    const userPrompt = `Here is the relevant context, including memories from our past conversations, that you should use to answer the question:

Relevant Memories:
${contextString}

Chat History:
${historyText}

User's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    console.log(`[ChatService] Total time to first token: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: STREAM RESPONSE
    // ═══════════════════════════════════════════════════════════════
    const llmStream = await llmService.generateCompletionStream(prompt);
    console.log('[ChatService] Streaming started');

    let fullResponse = '';
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        try {
          const json = JSON.parse(text);
          if (json.response) {
            fullResponse += json.response;
          }
        } catch (e) {
          fullResponse += text;
        }
        controller.enqueue(chunk);
      },
      
      async flush(controller) {
        console.log('[ChatService] Stream finished. Saving assistant message...');
        
        await prisma.chatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: fullResponse,
          },
        });

        console.log(`[ChatService] Saved assistant response for chat ${chatId}`);

        // Queue memory extraction - don't await
        memoryQueue.add('extract', { 
          userId, 
          chatId, 
          userMessage: message, 
          assistantMessage: fullResponse 
        }).catch(err => console.error('[ChatService] Queue error:', err));
        
        console.log(`[ChatService] Memory extraction queued for chat ${chatId}`);
      }
    });

    return llmStream.pipeThrough(transformStream);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Quick entity extraction using regex (no DB, no LLM)
   * Falls back to empty array if no entities found
   */
  private extractContextEntitiesQuick(message: string): string[] {
    // Extract capitalized words/phrases
    const matches = message.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
    
    // Filter out common stop words
    const stopWords = new Set([
      'I', 'The', 'A', 'An', 'This', 'That', 'My', 'Your', 
      'We', 'They', 'He', 'She', 'It', 'Could', 'Should', 'Would'
    ]);
    
    const entities = matches.filter(w => !stopWords.has(w));
    
    // Return unique entities, limit to 5 most relevant
    return [...new Set(entities)].slice(0, 5);
  }

  /**
   * Get chat history with optimized query
   */
  public async getChatHistory(chatId: string, userId: string, limit: number = 10) {
    return prisma.chatMessage.findMany({
      where: {
        chatId: chatId,
        chat: { userId: userId } // Add userId filter for security
      },
      select: { 
        role: true, 
        content: true 
      },
      orderBy: { createdAt: 'asc' }, // Changed to asc for chronological order
      take: limit
    });
  }

  // ... other methods ...
}

export const chatService = new ChatService();
