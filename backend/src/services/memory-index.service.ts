import prisma from '../db';
import { llmService } from './llm.service';
import { Memory } from '@prisma/client';

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  rerankScore?: number;
}

class MemoryIndexService {
  // This service will handle the hybrid search (FTS + Vector) and potentially reranking

  async buildIndex(userId: string): Promise<void> {
    // In this architecture, the indexes are managed by PostgreSQL directly via migrations.
    // This method can be used for any future in-application indexing or verification if needed.
    console.log(`[MemoryIndexService] Ensuring indexes are built for user ${userId}. (Managed by migrations)`);
    // For now, this is a placeholder as actual index creation is via Prisma migrations.
  }

  async vectorSearch(userId: string, queryEmbedding: number[], limit: number = 5): Promise<SearchResult[]> {
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // Perform vector similarity search using pgvector
    const rawResults: { id: string; content: string; similarity: number; metadata: any }[] = await prisma.$queryRaw`
      SELECT 
        m.id,
        m.content,
        (1 - (e.embedding <=> ${vectorString}::vector)) as similarity,
        m.metadata
      FROM memories m
      JOIN embeddings e ON m.id = e."memoryId"
      WHERE 
        m."userId" = ${userId}
        AND m.deleted = false
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return rawResults.map(r => ({
      id: r.id,
      content: r.content,
      similarity: r.similarity,
    }));
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

  async searchMemories(userId: string, query: string, limit: number = 5): Promise<{ contextString: string; sources: { id: string; content: string }[] }> {
    console.log(`[MemoryIndexService] Performing hybrid search for query: "${query}"`);

    const queryEmbedding = await llmService.createEmbedding(query);

    const vectorResults = await this.vectorSearch(userId, queryEmbedding, limit);
    const ftsResults = await this.fullTextSearch(userId, query, limit);

    // Combine and deduplicate results
    const combinedResultsMap = new Map<string, SearchResult>();

    vectorResults.forEach(res => combinedResultsMap.set(res.id, res));
    ftsResults.forEach(res => {
      if (combinedResultsMap.has(res.id)) {
        // If already present from vector search, take the higher score or combine
        const existing = combinedResultsMap.get(res.id)!;
        combinedResultsMap.set(res.id, { ...existing, similarity: Math.max(existing.similarity, res.similarity) });
      } else {
        combinedResultsMap.set(res.id, res);
      }
    });

    let finalResults = Array.from(combinedResultsMap.values());

    // Sort by a combined score (e.g., average of normalized scores, or just similarity for now)
    finalResults.sort((a, b) => b.similarity - a.similarity);

    // Take top `limit` results after combining and sorting
    const topResults = finalResults.slice(0, limit);

    const contextString = topResults
      .map(mem => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');
    
    const sources = topResults.map(mem => ({ id: mem.id, content: mem.content }));

    return { contextString, sources };
  }
}

export const memoryIndexService = new MemoryIndexService();
