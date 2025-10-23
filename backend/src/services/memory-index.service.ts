import prisma from '../db';
import { llmService } from './llm.service';
import { Memory } from '@prisma/client';

interface SearchResult {
  id: string;
  content: string;
  score: number;
  vector_similarity: number;
  fts_rank: number;
  recency_score: number;
  access_score: number;
  importance: number;
  confidence: number;
  contextual_boost: number;
}

class MemoryIndexService {
  async buildIndex(userId: string): Promise<void> {
    console.log(`[MemoryIndexService] Ensuring indexes are built for user ${userId}. (Managed by migrations)`);
  }

  async searchMemories(
    userId: string,
    query: string,
    limit: number = 5,
    contextEntities?: string[]
  ): Promise<SearchResult[]> {
    console.time('memoryIndexService.searchMemories');
    
    // Generate query embedding
    console.time('llmService.createEmbedding (searchMemories)');
    const queryEmbedding = await llmService.createEmbedding(query);
    console.timeEnd('llmService.createEmbedding (searchMemories)');

    // Single database call - all scoring happens in PostgreSQL
    const results = await prisma.$queryRaw<SearchResult[]>`
      SELECT 
        id,
        content,
        score,
        vector_similarity,
        fts_rank,
        recency_score,
        access_score,
        importance,
        confidence,
        contextual_boost
      FROM hybrid_memory_search(
        ${userId},
        ${query},
        ${`[${queryEmbedding.join(',')}]`}::vector,
        ${limit}::INTEGER,
        ${contextEntities || []}::text[]
      )
    `;
    
    // IMPORTANT: Track that these memories were accessed
    const memoryIds = results.map(r => r.id);
    if (memoryIds.length > 0) {
      console.time('memoryIndexService.trackMemoryAccess');
      await this.trackMemoryAccess(memoryIds);
      console.timeEnd('memoryIndexService.trackMemoryAccess');
    }

    console.timeEnd('memoryIndexService.searchMemories');
    return results;
  }

  /**
   * Track that memories were accessed (for access frequency scoring)
   */
  private async trackMemoryAccess(memoryIds: string[]): Promise<void> {
    try {
      await prisma.$executeRaw`
      UPDATE memories
      SET 
        "accessCount" = "accessCount" + 1,
        "lastAccessedAt" = NOW()
      WHERE id = ANY(CAST(${memoryIds} AS text[]))
    `;
    } catch (error) {
      console.error('Error tracking memory access:', error);
    }
  }
}

export const memoryIndexService = new MemoryIndexService();
