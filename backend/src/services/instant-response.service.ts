import redis from '../queues/redis';
import prisma from '../db';
import { llmService } from './llm.service';
import { HierarchicalNSW } from 'hnswlib-node'; // Import HNSW library

interface InstantResponse {
  pattern: RegExp;
  handler: (match: RegExpMatchArray, userId: string) => Promise<string | null>;
}

class InstantResponseService {
  private hnswIndex: HierarchicalNSW; // Declare HNSW instance
  private inMemoryCache = new Map<string, { response: string, expires: number }>(); // In-memory cache
  private idMap = new Map<string, number>(); // Map string cacheId to numeric ID
  private reverseIdMap = new Map<number, string>(); // Map numeric ID back to string cacheId
  private nextNumericId = 0; // Counter for generating numeric IDs
  private patterns: InstantResponse[] = [
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

  constructor() {
    const numDimensions = 768; // Embedding size
    const maxElements = 10000; // Max number of elements in the index
    this.hnswIndex = new HierarchicalNSW('cosine', numDimensions); // Use cosine distance
    this.hnswIndex.initIndex(maxElements);
  }
  
  /**
   * Try to answer WITHOUT calling LLM
   * Returns response if possible, null if needs LLM
   */
  async tryInstantResponse(userId: string, query: string): Promise<string | null> {
    console.time('instantResponseService.tryInstantResponse');
    const lowerQuery = query.toLowerCase().trim();
    
    // TIER 1: EXACT PATTERN MATCHING (< 1ms)
    for (const { pattern, handler } of this.patterns) {
      const match = query.match(pattern);
      if (match) {
        console.log('[InstantResponse] Pattern matched, generating instant response');
        const response = await handler(match, userId);
        if (response) {
          return response;
        }
      }
    }
    
    // TIER 2: IN-MEMORY EXACT CACHE (~0.1ms)
    const inMemoryExactResponse = this.getExactFromInMemoryCache(query);
    if (inMemoryExactResponse) {
      console.log('[InstantResponse] In-memory exact cache HIT, returning immediately');
      console.timeEnd('instantResponseService.tryInstantResponse');
      return inMemoryExactResponse;
    }

    // TIER 3: REDIS EXACT CACHE (~1ms)
    const redisExactResponse = await this.findExact(userId, query);
    if (redisExactResponse) {
      console.log('[InstantResponse] Redis exact cache HIT, returning immediately');
      console.timeEnd('instantResponseService.tryInstantResponse');
      return redisExactResponse;
    }

    // TIER 4: LSH-BASED SEMANTIC CACHE (~20ms)
    const semanticCachedResponse = await this.checkSemanticCache(userId, query);
    if (semanticCachedResponse) {
      console.log('[InstantResponse] Semantic cache HIT');
      console.timeEnd('instantResponseService.tryInstantResponse');
      return semanticCachedResponse;
    }
    
    // TIER 5: DIRECT FACT LOOKUP (100ms)
    if (/^what (is|are|was|were)/i.test(query)) {
      const directAnswer = await this.tryDirectFactLookup(userId, query);
      if (directAnswer) {
        console.log('[InstantResponse] Direct fact lookup success');
        return directAnswer;
      }
    }
    
    // NO INSTANT RESPONSE AVAILABLE - NEED LLM
    console.log('[InstantResponse] No instant response available, needs LLM');
    console.timeEnd('instantResponseService.tryInstantResponse');
    return null;
  }
  
  private getExactFromInMemoryCache(query: string): string | null {
    const cached = this.inMemoryCache.get(query);
    if (cached && cached.expires > Date.now()) {
      return cached.response;
    }
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
      // Generate embedding for query
      console.time('llmService.createEmbedding (semantic cache)');
      const queryEmbedding = await llmService.createEmbedding(query);
      console.timeEnd('llmService.createEmbedding (semantic cache)');
      
      // Query HNSW index for approximate nearest neighbors
      const numNeighbors = 5; // Number of neighbors to retrieve from HNSW
      const hnswResults = this.hnswIndex.searchKnn(queryEmbedding, numNeighbors);
      
      if (hnswResults.neighbors.length === 0) {
        console.timeEnd('instantResponseService.checkSemanticCache');
        return null;
      }
      
      let bestMatch: string | null = null;
      let bestSimilarity = 0.0;
      
      for (let i = 0; i < hnswResults.neighbors.length; i++) {
        const numericId = hnswResults.neighbors[i];
        const cacheId = this.reverseIdMap.get(numericId); // Get original string ID

        if (!cacheId) continue; // Should not happen if mapping is consistent

        const cacheKey = `query_cache:${cacheId}`;
        const cachedData = await redis.get(cacheKey);
        
        if (cachedData) {
          const data = JSON.parse(cachedData);
          // Re-calculate cosine similarity for precise ranking
          const similarity = this.cosineSimilarity(queryEmbedding, data.embedding);
          
          // 85% similarity threshold
          if (similarity >= 0.85 && similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = data.response;
          }
        }
      }
      
      if (bestMatch) {
        console.log(`[InstantResponse] Cache hit with ${(bestSimilarity * 100).toFixed(1)}% similarity`);
      }
      console.timeEnd('instantResponseService.checkSemanticCache');
      return bestMatch;
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
      
      const cacheId = `${userId}:${query}`; // Unique string ID for this cache entry

      // Get or create numeric ID for HNSW
      let numericId = this.idMap.get(cacheId);
      if (numericId === undefined) {
        numericId = this.nextNumericId++;
        this.idMap.set(cacheId, numericId);
        this.reverseIdMap.set(numericId, cacheId);
        this.hnswIndex.resizeIndex(this.hnswIndex.getCurrentCount() + 1); // Resize if needed
      }

      // Add to HNSW index
      this.hnswIndex.addPoint(queryEmbedding, numericId);
      
      const cacheData = JSON.stringify({
        query,
        embedding: queryEmbedding, // Store embedding for re-ranking
        response,
        timestamp: Date.now()
      });
      
      const cacheKey = `query_cache:${cacheId}`;
      await redis.setex(cacheKey, 7200, cacheData); // 2 hours

      // Update in-memory cache
      this.inMemoryCache.set(query, { response, expires: Date.now() + 3600000 }); // 1 hour expiry

      console.timeEnd('instantResponseService.cacheResponse');
    } catch (error) {
      console.error('[InstantResponse] Error caching response:', error);
      console.timeEnd('instantResponseService.cacheResponse');
    }
  }
}

export const instantResponseService = new InstantResponseService();