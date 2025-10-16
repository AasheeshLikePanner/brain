import prisma from '../db';
import { llmService } from './llm.service';
import { Memory } from '@prisma/client';

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  rerankScore?: number;
  breakdown?: any;
}

interface ScoredMemory {
  id: string;
  content: string;
  score: number;
  breakdown?: {
    vectorSimilarity: number;
    recency: number;
    accessFrequency: number;
    importance: number;
    confidence: number;
  };
}

class MemoryIndexService {
  // This service will handle the hybrid search (FTS + Vector) and potentially reranking

  async buildIndex(userId: string): Promise<void> {
    // In this architecture, the indexes are managed by PostgreSQL directly via migrations.
    // This method can be used for any future in-application indexing or verification if needed.
    console.log(`[MemoryIndexService] Ensuring indexes are built for user ${userId}. (Managed by migrations)`);
    // For now, this is a placeholder as actual index creation is via Prisma migrations.
  }

  /**
 * Calculate a composite score for a memory based on multiple factors
 */
  private calculateMemoryScore(
    memory: {
      id: string;
      content: string;
      createdAt: Date;
      accessCount: number;
      lastAccessedAt: Date;
      metadata: any;
      confidenceScore: number;
    },
    vectorSimilarity: number,
    maxAccessCount: number,
    contextEntities?: string[]
  ): { score: number; breakdown: any } {

    const now = new Date();

    // 1. RECENCY WEIGHT (exponential decay)
    const daysOld = (now.getTime() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyDecayRate = 0.05; // Tunable parameter
    const recencyWeight = Math.exp(-recencyDecayRate * daysOld);

    // 2. ACCESS FREQUENCY WEIGHT
    const accessBase = maxAccessCount > 0
      ? Math.log(1 + memory.accessCount) / Math.log(1 + maxAccessCount)
      : 0;

    const daysSinceLastAccess = (now.getTime() - memory.lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);
    const accessRecency = Math.exp(-recencyDecayRate * daysSinceLastAccess);
    const accessFrequencyWeight = accessBase * accessRecency;

    // 3. IMPORTANCE WEIGHT (from metadata)
    const importance = memory.metadata?.importance || 0.5;

    // 4. CONFIDENCE WEIGHT (for forgetting mechanism)
    const confidence = memory.confidenceScore;

    // 5. CONTEXTUAL BOOST (if entities are provided)
    let contextualBoost = 0;
    if (contextEntities && contextEntities.length > 0) {
      const memoryEntities = memory.metadata?.detected_entities || [];
      const overlap = contextEntities.filter(e =>
        memoryEntities.some((me: string) =>
          me.toLowerCase().includes(e.toLowerCase())
        )
      ).length;
      contextualBoost = overlap / Math.max(contextEntities.length, 1);
    }

    // COMPOSITE SCORE with configurable weights
    const weights = {
      vector: 0.35,
      recency: 0.20,
      accessFreq: 0.15,
      importance: 0.15,
      confidence: 0.10,
      contextual: 0.05
    };

    const finalScore =
      (vectorSimilarity * weights.vector) +
      (recencyWeight * weights.recency) +
      (accessFrequencyWeight * weights.accessFreq) +
      (importance * weights.importance) +
      (confidence * weights.confidence) +
      (contextualBoost * weights.contextual);

    return {
      score: finalScore,
      breakdown: {
        vectorSimilarity,
        recency: recencyWeight,
        accessFrequency: accessFrequencyWeight,
        importance,
        confidence,
        contextualBoost
      }
    };
  }

  async vectorSearch(
    userId: string,
    queryEmbedding: number[],
    limit: number = 10,
    contextEntities?: string[]
  ): Promise<ScoredMemory[]> {
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // Get MORE results than needed because we'll re-score
    const fetchLimit = limit * 3;

    // Fetch memories with all necessary fields for scoring
    const rawResults: any[] = await prisma.$queryRaw`
    SELECT 
      m.id,
      m.content,
      m."createdAt",
      m."accessCount",
      m."lastAccessedAt",
      m.metadata,
      m."confidenceScore",
      (1 - (e.embedding <=> ${vectorString}::vector)) as similarity
    FROM memories m
    JOIN embeddings e ON m.id = e."memoryId"
    WHERE 
      m."userId" = ${userId}
      AND m.deleted = false
      AND m."confidenceScore" > 0.2
    ORDER BY similarity DESC
    LIMIT ${fetchLimit}
  `;

    // Get max access count for normalization
    const maxAccessCount = Math.max(...rawResults.map(r => r.accessCount), 1);

    // Score each memory using our composite scoring
    const scoredResults = rawResults.map(r => {
      const { score, breakdown } = this.calculateMemoryScore(
        {
          id: r.id,
          content: r.content,
          createdAt: r.createdAt,
          accessCount: r.accessCount,
          lastAccessedAt: r.lastAccessedAt,
          metadata: r.metadata,
          confidenceScore: r.confidenceScore
        },
        r.similarity,
        maxAccessCount,
        contextEntities
      );

      return {
        id: r.id,
        content: r.content,
        score,
        breakdown
      };
    });

    // Sort by final score and take top results
    scoredResults.sort((a, b) => b.score - a.score);

    return scoredResults.slice(0, limit);
  }

  async fullTextSearch(userId: string, query: string, limit: number = 5): Promise<SearchResult[]> {
    // Perform full-text search using PostgreSQL FTS
    const rawResults: { id: string; content: string; rank: number; metadata: any }[] = await prisma.$queryRaw`
      SELECT
        id,
        content,
        ts_rank_cd(to_tsvector('english', content), websearch_to_tsquery('english', ${query})) as rank,
        metadata
      FROM memories
      WHERE
        "userId" = ${userId}
        AND deleted = false
        AND to_tsvector('english', content) @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return rawResults.map(r => ({
      id: r.id,
      content: r.content,
      similarity: r.rank, // Using rank as similarity for FTS results
    }));
  }

  async searchMemories(
    userId: string,
    query: string,
    limit: number = 5,
    contextEntities?: string[]
  ): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await llmService.createEmbedding(query);

    // Perform vector search with smart scoring
    const vectorResults = await this.vectorSearch(
      userId,
      queryEmbedding,
      limit,
      contextEntities
    );

    // Perform full-text search
    const ftsResults = await this.fullTextSearch(userId, query, limit);

    // Combine and deduplicate
    const combined = new Map<string, any>();

    vectorResults.forEach(r => {
      combined.set(r.id, {
        id: r.id,
        content: r.content,
        similarity: r.score,
        breakdown: r.breakdown
      });
    });

    ftsResults.forEach(r => {
      if (combined.has(r.id)) {
        // Boost score if found in both
        const existing = combined.get(r.id);
        existing.similarity = existing.similarity * 0.7 + r.similarity * 0.3;
      } else {
        combined.set(r.id, r);
      }
    });

    const results = Array.from(combined.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // IMPORTANT: Track that these memories were accessed
    const memoryIds = results.map(r => r.id);
    if (memoryIds.length > 0) {
      await this.trackMemoryAccess(memoryIds);
    }

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
