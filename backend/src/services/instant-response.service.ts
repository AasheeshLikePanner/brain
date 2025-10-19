import redis from '../queues/redis';
import prisma from '../db';
import { llmService } from './llm.service';

interface InstantResponse {
  pattern: RegExp;
  handler: (match: RegExpMatchArray, userId: string) => Promise<string | null>;
}

class InstantResponseService {
  
  /**
   * Try to answer WITHOUT calling LLM
   * Returns response if possible, null if needs LLM
   */
  async tryInstantResponse(userId: string, query: string): Promise<string | null> {
    console.time('instantResponseService.tryInstantResponse');
    const lowerQuery = query.toLowerCase().trim();
    
    // ══════════════════════════════════════════════════════════
    // 1. EXACT PATTERN MATCHING (< 1ms)
    // ══════════════════════════════════════════════════════════
    const patterns: InstantResponse[] = [
      // Greetings
      {
        pattern: /^(hi|hello|hey|sup|yo)$/i,
        handler: async () => "Hi! How can I help you today?"
      },
      
      // Thanks
      {
        pattern: /^(thanks|thank you|thx)$/i,
        handler: async () => "You're welcome! 😊"
      },
      
      // Personal info queries - DIRECT MEMORY LOOKUP
      {
        pattern: /what('s| is) my name/i,
        handler: async (_, userId) => {
          return await this.getFactFromMemory(userId, ['name is', 'my name', 'called']);
        }
      },
      
      {
        pattern: /who is my (brother|sister|mother|father|son|daughter)/i,
        handler: async (match, userId) => {
          const relation = match[1];
          return await this.getFactFromMemory(userId, [relation, `${relation} is`, `${relation}'s name`]);
        }
      },
      
      {
        pattern: /what is my (job|role|position|title)/i,
        handler: async (_, userId) => {
          return await this.getFactFromMemory(userId, ['work as', 'job is', 'role is', 'position is']);
        }
      },
      
      {
        pattern: /where do i (work|live)/i,
        handler: async (match, userId) => {
          const type = match[1];
          return await this.getFactFromMemory(userId, [type === 'work' ? 'work at' : 'live in', type]);
        }
      },
    ];
    
    // Try each pattern
    for (const { pattern, handler } of patterns) {
      const match = query.match(pattern);
      if (match) {
        console.log('[InstantResponse] Pattern matched, generating instant response');
        const response = await handler(match, userId);
        if (response) {
          return response;
        }
      }
    }
    
    // ══════════════════════════════════════════════════════════
    // 2. EXACT CACHE CHECK (very fast)
    // ══════════════════════════════════════════════════════════
    const exactCachedResponse = await this.findExact(userId, query);
    if (exactCachedResponse) {
      console.log('[InstantResponse] Exact cache HIT, returning immediately');
      console.timeEnd('instantResponseService.tryInstantResponse');
      return exactCachedResponse;
    }

    // ══════════════════════════════════════════════════════════
    // 3. SEMANTIC CACHE CHECK (50ms)
    // ══════════════════════════════════════════════════════════
    const cachedResponse = await this.checkSemanticCache(userId, query);
    if (cachedResponse) {
      console.log('[InstantResponse] Semantic cache HIT');
      console.timeEnd('instantResponseService.tryInstantResponse');
      return cachedResponse;
    }
    
    // ══════════════════════════════════════════════════════════
    // 4. DIRECT FACT LOOKUP (100ms)
    // For "what is X" queries, try to find exact memory
    // ══════════════════════════════════════════════════════════
    if (/^what (is|are|was|were)/i.test(query)) {
      const directAnswer = await this.tryDirectFactLookup(userId, query);
      if (directAnswer) {
        console.log('[InstantResponse] Direct fact lookup success');
        return directAnswer;
      }
    }
    
    // ══════════════════════════════════════════════════════════
    // 4. NO INSTANT RESPONSE AVAILABLE - NEED LLM
    // ══════════════════════════════════════════════════════════
    console.log('[InstantResponse] No instant response available, needs LLM');
    console.timeEnd('instantResponseService.tryInstantResponse');
    return null;
  }
  
  /**
   * Get specific fact from memories (direct text search)
   * NO embedding, NO LLM - pure SQL search
   */
  private async getFactFromMemory(
    userId: string,
    keywords: string[]
  ): Promise<string | null> {
    console.time('instantResponseService.getFactFromMemory');
    try {
      // Search memories for keywords using SQL LIKE
      for (const keyword of keywords) {
        const memory = await prisma.memory.findFirst({
          where: {
            userId,
            deleted: false,
            content: {
              contains: keyword,
              mode: 'insensitive'
            }
          },
          orderBy: {
            createdAt: 'desc' // Most recent first
          }
        });
        
        if (memory) {
          // Extract the relevant part
          const sentences = memory.content.split(/[.!?]\s+/);
          const relevantSentence = sentences.find(s => 
            s.toLowerCase().includes(keyword.toLowerCase())
          );
          
          if (relevantSentence) {
            console.timeEnd('instantResponseService.getFactFromMemory');
            return relevantSentence.trim() + '.';
          }
          
          console.timeEnd('instantResponseService.getFactFromMemory');
          return memory.content;
        }
      }
      
      console.timeEnd('instantResponseService.getFactFromMemory');
      return null;
    } catch (error) {
      console.error('[InstantResponse] Error getting fact from memory:', error);
      console.timeEnd('instantResponseService.getFactFromMemory');
      return null;
    }
  }
  
  /**
   * Direct fact lookup for "what is X" queries
   * Search memories for exact match
   */
  private async tryDirectFactLookup(
    userId: string,
    query: string
  ): Promise<string | null> {
    console.time('instantResponseService.tryDirectFactLookup');
    try {
      // Extract subject from "what is X" query
      const match = query.match(/what (is|are|was|were)\s+(.+?)(\?|$)/i);
      if (!match) {
        console.timeEnd('instantResponseService.tryDirectFactLookup');
        return null;
      }
      
      const subject = match[2].trim();
      
      // Search for memories containing this subject
      const memories = await prisma.memory.findMany({
        where: {
          userId,
          deleted: false,
          content: {
            contains: subject,
            mode: 'insensitive'
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 3
      });
      
      if (memories.length === 0) {
        console.timeEnd('instantResponseService.tryDirectFactLookup');
        return null;
      }
      
      // If we have clear definition, return it
      for (const mem of memories) {
        const content = mem.content.toLowerCase();
        if (
          content.includes(`${subject.toLowerCase()} is`) ||
          content.includes(`${subject.toLowerCase()} are`) ||
          content.includes(`${subject.toLowerCase()} refers to`)
        ) {
          console.timeEnd('instantResponseService.tryDirectFactLookup');
          return mem.content;
        }
      }
      
      // Otherwise, combine top memories
      if (memories.length === 1) {
        console.timeEnd('instantResponseService.tryDirectFactLookup');
        return memories[0].content;
      }
      
      console.timeEnd('instantResponseService.tryDirectFactLookup');
      return `Based on what I know: ${memories.map(m => m.content).join(' ')}`;
      
    } catch (error) {
      console.error('[InstantResponse] Error in direct fact lookup:', error);
      console.timeEnd('instantResponseService.tryDirectFactLookup');
      return null;
    }
  }
  
  /**
   * Check semantic cache (embedding-based similarity)
   */
  /**
   * Check semantic cache (embedding-based similarity)
   */
  private async findExact(userId: string, query: string): Promise<string | null> {
    console.time('instantResponseService.findExact');
    try {
      const cacheKey = `query_cache:${userId}`;
      const cached = await redis.lrange(cacheKey, 0, 50);

      for (const item of cached) {
        const data = JSON.parse(item);
        if (data.query === query) {
          console.log('[InstantResponse] Exact cache HIT');
          console.timeEnd('instantResponseService.findExact');
          return data.response;
        }
      }
      console.timeEnd('instantResponseService.findExact');
      return null;
    } catch (error) {
      console.error('[InstantResponse] Error in findExact:', error);
      console.timeEnd('instantResponseService.findExact');
      return null;
    }
  }

  private async checkSemanticCache(
    userId: string,
    query: string
  ): Promise<string | null> {
    console.time('instantResponseService.checkSemanticCache');
    try {
      const cacheKey = `query_cache:${userId}`;
      const cached = await redis.lrange(cacheKey, 0, 50);
      
      if (cached.length === 0) {
        console.timeEnd('instantResponseService.checkSemanticCache');
        return null;
      }
      
      // Generate embedding for query
      console.time('llmService.createEmbedding (semantic cache)');
      const queryEmbedding = await llmService.createEmbedding(query);
      console.timeEnd('llmService.createEmbedding (semantic cache)');
      
      // Check similarity with cached queries
      for (const item of cached) {
        const data = JSON.parse(item);
        const similarity = this.cosineSimilarity(queryEmbedding, data.embedding);
        
        // 85% similarity threshold
        if (similarity >= 0.85) {
          console.log(`[InstantResponse] Cache hit with ${(similarity * 100).toFixed(1)}% similarity`);
          console.timeEnd('instantResponseService.checkSemanticCache');
          return data.response;
        }
      }
      
      console.timeEnd('instantResponseService.checkSemanticCache');
      return null;
    } catch (error) {
      console.error('[InstantResponse] Error checking semantic cache:', error);
      console.timeEnd('instantResponseService.checkSemanticCache');
      return null;
    }
  }
  
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magA * magB);
  }
  
  /**
   * Cache the query and response for future use
   */
  async cacheResponse(
    userId: string,
    query: string,
    response: string
  ): Promise<void> {
    console.time('instantResponseService.cacheResponse');
    try {
      console.time('llmService.createEmbedding (cacheResponse)');
      const queryEmbedding = await llmService.createEmbedding(query);
      console.timeEnd('llmService.createEmbedding (cacheResponse)');
      
      const cacheData = JSON.stringify({
        query,
        embedding: queryEmbedding,
        response,
        timestamp: Date.now()
      });
      
      const cacheKey = `query_cache:${userId}`;
      await redis.lpush(cacheKey, cacheData);
      await redis.ltrim(cacheKey, 0, 49); // Keep last 50
      await redis.expire(cacheKey, 7200); // 2 hours
      console.timeEnd('instantResponseService.cacheResponse');
    } catch (error) {
      console.error('[InstantResponse] Error caching response:', error);
      console.timeEnd('instantResponseService.cacheResponse');
    }
  }
}

export const instantResponseService = new InstantResponseService();