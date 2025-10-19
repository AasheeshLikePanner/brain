import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { graphService } from './graph.service'; // NEW
import { memoryIndexService } from './memory-index.service';
import { Chat, ChatMessage } from '@prisma/client';
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
    const timings: { [key: string]: number } = {};
    let t0 = Date.now();
    let queryAnalysis: QueryAnalysis; // Declared once here
    console.time('chatService.streamChatResponse');
    const startTime = Date.now(); // Moved to top for instant response timing
    console.log('[ChatService] Starting streamChatResponse - OPTIMIZED');
    
    // ══════════════════════════════════════════════════════════
    // STEP 1: TRY INSTANT RESPONSE (50-100ms)
    // ══════════════════════════════════════════════════════════
    t0 = Date.now();
    const instantResponse = await instantResponseService.tryInstantResponse(userId, message);
    timings.instantResponseCheck = Date.now() - t0;
    
    // Temporarily disabled instant response for prompt logging
    /*
    if (instantResponse) {
      console.log(`[ChatService] Instant response generated in ${Date.now() - startTime}ms`);
      
      // Save messages
      await prisma.chatMessage.create({
        data: { chatId, role: 'user', content: message }
      });
      await prisma.chatMessage.create({
        data: { chatId, role: 'assistant', content: instantResponse }
      });
      
      // Return instantly
      return new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(JSON.stringify({
            response: instantResponse
          })));
          controller.close();
        }
      });
    }
    */
    
    console.log('[ChatService] No instant response, calling LLM...');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL DATA GATHERING (CRITICAL PATH)
    // ═══════════════════════════════════════════════════════════════
    console.log(`[ChatService] Starting Phase 1 at ${startTime}ms`);

    const saveMessageStart = Date.now();
    t0 = Date.now();
    const saveMessagePromise = prisma.chatMessage.create({
      data: { chatId, role: 'user', content: message }
    }).catch(err => {
      console.error('[ChatService] Error saving user message:', err);
      throw err;
    });
    timings.dbSave = Date.now() - t0;
    console.log(`[ChatService] User message save initiated: ${Date.now() - saveMessageStart}ms`);

    console.time('chatService.getChatHistory');
    t0 = Date.now();
    const historyPromise = this.getChatHistory(chatId, userId);
    timings.getHistory = Date.now() - t0;
    console.timeEnd('chatService.getChatHistory');
    console.time('chatService.extractContextEntitiesQuick');
    const entitiesPromise = this.extractContextEntitiesQuick(message);
    console.timeEnd('chatService.extractContextEntitiesQuick');
    // Analyze query FIRST to determine how many memories to fetch
    queryAnalysis = queryAnalyzerService.analyzeQuery(message);

    // Adaptive memory limit based on query type
    const memoryLimit = queryAnalysis.isFactual ? 1 :
                        !queryAnalysis.isComplex ? 2 : // Simple queries (not factual, not complex)
                        5; // default for complex queries

    console.time('memoryIndexService.searchMemories');
    t0 = Date.now();
    const searchMemoriesPromise = memoryIndexService.searchMemories(
      userId,
      message,
      memoryLimit, // Dynamic limit
      []
    );
    timings.searchMemories = Date.now() - t0;
    console.timeEnd('memoryIndexService.searchMemories');

    const [history, contextEntities, relevantMemories] = await Promise.all([
      historyPromise,
      entitiesPromise,
      searchMemoriesPromise,
      saveMessagePromise // Ensure save completes
    ]);

    console.log(`[ChatService] getChatHistory took: ${Date.now() - saveMessageStart}ms`); // Re-using saveMessageStart for relative timing
    console.log(`[ChatService] extractContextEntitiesQuick took: ${Date.now() - saveMessageStart}ms`);
    console.log(`[ChatService] memoryIndexService.searchMemories took: ${Date.now() - saveMessageStart}ms`);
    console.log(`[ChatService] Phase 1 complete: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: JUST GET MEMORY DETAILS (FAST PATH)
    // ═══════════════════════════════════════════════════════════════
    const phase2Start = Date.now();
    console.log(`[ChatService] Starting Phase 2 at ${phase2Start}ms`);

    // Only get memory details - no expensive reasoning
    t0 = Date.now();
    const memoryDetails = await prisma.memory.findMany({
      where: { id: { in: relevantMemories.map(m => m.id) } },
      select: {
        id: true,
        content: true,
        type: true,
        metadata: true,
        recordedAt: true
      }
    });
    timings.getMemoryDetails = Date.now() - t0;

    // We'll handle reasoning smartly in next steps
    console.log(`[ChatService] Phase 2 complete: ${Date.now() - phase2Start}ms`);

    console.log(`[ChatService] prisma.memory.findMany took: ${Date.now() - phase2Start}ms`);
    console.log(`[ChatService] reasoningService.detectImplications took: ${Date.now() - phase2Start}ms`);
    console.log(`[ChatService] reasoningService.graphReasoning took: ${Date.now() - phase2Start}ms`);
    console.log(`[ChatService] Phase 2 complete: ${Date.now() - phase2Start}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: SMART CONTEXT BUILDING WITH CACHING
    // ═══════════════════════════════════════════════════════════════
    const phase3Start = Date.now();
    console.log(`[ChatService] Starting Phase 3 (Smart Context)`);

    // Analyze query complexity
    console.time('queryAnalyzerService.analyzeQuery');
    queryAnalysis = queryAnalyzerService.analyzeQuery(message);
    console.timeEnd('queryAnalyzerService.analyzeQuery');
    console.log(`[ChatService] Query analysis:`, queryAnalysis);

    const contextString = memoryDetails
      .map(mem => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');

    let reasoningContext = '';

    // If complex query, check cache or compute insights
    if (queryAnalysis.isComplex && queryAnalysis.entities.length > 0) {
      console.log(`[ChatService] Complex query detected, loading insights...`);
      
      for (const entityName of queryAnalysis.entities) {
        // Try to get cached insights first (fast!)
        console.time(`smartCacheService.getCachedInsights(${entityName})`);
        let insights = await smartCacheService.getCachedInsights(entityName);
        console.timeEnd(`smartCacheService.getCachedInsights(${entityName})`);
        
        // If not cached, compute lazily (only when needed!)
        if (!insights) {
          console.time(`smartCacheService.lazyComputeAndCache(${entityName})`);
          insights = await smartCacheService.lazyComputeAndCache(
            userId,
            entityName,
            queryAnalysis.needsGraph,
            queryAnalysis.needsTimeline
          );
          console.timeEnd(`smartCacheService.lazyComputeAndCache(${entityName})`);
        }
        
        // Add insights to context
        if (insights.graph && queryAnalysis.needsGraph) {
          reasoningContext += `\n\n**Relationships for ${entityName}:**\n`;
          insights.graph.relationships.forEach((r: any) => {
            reasoningContext += `- ${r.subject} ${r.predicate} ${r.object}\n`;
          });
        }
        
        if (insights.timeline && queryAnalysis.needsTimeline) {
          reasoningContext += `\n\n**Timeline for ${entityName}:**\n`;
          reasoningContext += insights.timeline.narrative + '\n';
        }
      }
    }

    console.log(`[ChatService] Phase 3 complete: ${Date.now() - phase3Start}ms`);

    const currentDate = new Date().toUTCString();
    const historyText = history.map(m => `${m.role}: ${m.content}`).join('\n');

    const systemPrompt = queryAnalysis.isComplex 
      ? `You are a helpful assistant with access to the user's personal knowledge base and reasoning capabilities.

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
- User Location: [Location not provided]`
      : `You are a helpful assistant with access to the user's personal knowledge base.

Your answers must be formatted in MDX.
Always cite sources using <Source id="memory-id" />.

Current Date/Time: ${currentDate}`;

    const userPrompt = `Here is the relevant context, including memories from our past conversations, that you should use to answer the question:

Relevant Memories:
${contextString}

Chat History:
${historyText}

User's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    console.log("--- Final LLM Prompt (System) ---");
    console.log(systemPrompt);
    console.log("--- Final LLM Prompt (User) ---");
    console.log(userPrompt);
    console.log("--- Final LLM Prompt (Combined) ---");
    console.log(prompt);
    console.log(`--- Prompt Word Count (Rough Estimate): ${prompt.split(/\s+/).length} ---`);
    console.log("-----------------------------------");


    console.log(`[ChatService] Total time to first token: ${Date.now() - startTime}ms`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: STREAM RESPONSE
    // ═══════════════════════════════════════════════════════════════
    const llmCallStart = Date.now();
    console.time('llmService.generateCompletionStream');
    t0 = Date.now();
    const llmStream = await llmService.generateCompletionStream(prompt);
    timings.llmGeneration = Date.now() - t0;
    console.timeEnd('llmService.generateCompletionStream');
    console.log(`[ChatService] LLM generateCompletionStream initiated: ${Date.now() - llmCallStart}ms`);
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
          data: { chatId, role: 'assistant', content: fullResponse }
        });
        
        console.time('instantResponseService.cacheResponse');
        await instantResponseService.cacheResponse(userId, message, fullResponse);
        console.timeEnd('instantResponseService.cacheResponse');

        console.time('metricsService.trackQuery');
        await metricsService.trackQuery(userId, message, {
          isComplex: queryAnalysis.isComplex,
          cacheHit: reasoningContext.length > 0, // Had cached insights
          responseTime: Date.now() - startTime,
          memoriesRetrieved: relevantMemories.length
        });
        console.timeEnd('metricsService.trackQuery');
        
        console.time('memoryQueue.add');
        memoryQueue.add('extract', { 
          userId, chatId, 
          userMessage: message, 
          assistantMessage: fullResponse 
        }).catch(err => console.error('[ChatService] Queue error:', err));
        console.timeEnd('memoryQueue.add');
      }
    });

    console.timeEnd('chatService.streamChatResponse');
    console.log('[TIMING BREAKDOWN]', JSON.stringify(timings, null, 2));
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
    console.time('chatService.extractContextEntitiesQuick');
    // Extract capitalized words/phrases
    const matches = message.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
    
    // Filter out common stop words
    const stopWords = new Set([
      'I', 'The', 'A', 'An', 'This', 'That', 'My', 'Your', 
      'We', 'They', 'He', 'She', 'It', 'Could', 'Should', 'Would'
    ]);
    
    const entities = matches.filter(w => !stopWords.has(w));
    
    // Return unique entities, limit to 5 most relevant
    const result = [...new Set(entities)].slice(0, 5);
    console.timeEnd('chatService.extractContextEntitiesQuick');
    return result;
  }

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
