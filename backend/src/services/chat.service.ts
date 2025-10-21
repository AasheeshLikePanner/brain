import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { graphService } from './graph.service'; // NEW
import { memoryIndexService } from './memory-index.service';
import { Chat } from '@prisma/client';
import { memoryQueue } from '../queues/memory.queue';
import { ReasoningService } from './reasoning.service';
import { queryAnalyzerService, QueryAnalysis } from './query-analyzer.service';
import { smartCacheService } from './smart-cache.service';
import { metricsService } from './metrics.service';
import { instantResponseService } from './instant-response.service'; // NEW

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
    const startTime = Date.now();
    console.log('[ChatService] Starting streamChatResponse');

    // Step 1: Save user message and analyze query in parallel
    const saveMessagePromise = prisma.chatMessage.create({
      data: { chatId, role: 'user', content: message }
    });
    const queryAnalysis = queryAnalyzerService.analyzeQuery(message);

    // Step 2: Fetch relevant data in parallel
    const [_, history, relevantMemories] = await Promise.all([
      saveMessagePromise,
      this.getChatHistory(chatId, userId),
      memoryIndexService.searchMemories(userId, message, 10, [])
    ]);

    // Step 3: Get memory details
    const memoryDetails = await prisma.memory.findMany({
      where: { id: { in: relevantMemories.map((m:any) => m.id) } },
      select: {
        id: true,
        content: true,
        type: true,
        metadata: true,
        recordedAt: true,
        confidenceScore: true
      }
    });

    // Step 4: Perform advanced reasoning in parallel
    const [implications, graphInsights] = await Promise.all([
        this.reasoningService.detectImplications(userId, memoryDetails, message),
        this.reasoningService.graphReasoning(userId, message)
    ]);

    // Step 5: Build context for the LLM
    const contextString = memoryDetails
      .map((mem:any) => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');

    let reasoningContext = '';
    if (implications.length > 0) {
        reasoningContext += '\n\n**Insights from your memories:**\n';
        implications.forEach(imp => {
            reasoningContext += `- ${imp.content}\n`;
        });
    }
    if (graphInsights.reasoning) {
        reasoningContext += `\n\n**Connections from your knowledge graph:**\n${graphInsights.reasoning}`;
    }

    // Step 6: Generate the prompt
    const currentDate = new Date().toUTCString();
    const historyText = history.map((m:any) => `${m.role}: ${m.content}`).join('\n');

    const systemPrompt = `You are a helpful assistant with access to the user's personal knowledge base and reasoning capabilities.

${reasoningContext ? `You have analyzed the context and identified some insights:${reasoningContext}` : ''}

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

    // Step 7: Stream the response from the LLM
    const llmStream = await llmService.generateCompletionStream(prompt);

    let fullResponseText = '';
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const jsonString = new TextDecoder().decode(chunk);
        const lines = jsonString.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullResponseText += parsed.response;
            }
          } catch (e) {
            console.warn('Could not parse JSON chunk from stream:', line);
          }
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        await prisma.chatMessage.create({
          data: { chatId, role: 'assistant', content: fullResponseText },
        });
        memoryQueue.add('extract', {
          userId,
          chatId,
          userMessage: message,
          assistantMessage: fullResponseText,
        });
      },
    });

    return llmStream.pipeThrough(transformStream);
  }

  // ... other methods ...


  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════


  /**
   * Get chat history with optimized query
   */
  public async getChatHistory(chatId: string, userId: string, limit: number = 3) {
    console.time('chatService.getChatHistory');
    const history = await prisma.chatMessage.findMany({
      where: { chatId, chat: { userId } },
      select: { role: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 3  // Only last 3 messages (1.5 turns)
    });
    console.timeEnd('chatService.getChatHistory');
    return history.reverse(); // Chronological order
  }

  // ... other methods ...
}

export const chatService = new ChatService();
