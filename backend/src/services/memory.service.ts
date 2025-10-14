import prisma from '../db';
import { llmService } from './llm.service';
import { v4 as uuidv4 } from 'uuid';
import { pipeline, env } from '@xenova/transformers';

// Set the cache directory for transformers.js
env.cacheDir = './.transformers-cache';

class MemoryService {
  private reranker: any; // To store the loaded reranker pipeline

  constructor() {
    this.initReranker();
  }

  private async initReranker() {
    try {
      // Load the reranker model only once
      this.reranker = await pipeline('text-classification', 'BAAI/bge-reranker-base', { quantized: false });
      console.log('BGE Reranker model loaded successfully.');
    } catch (error) {
      console.error('Failed to load BGE Reranker model:', error);
    }
  }

  async ingest(userId: string, content: string) {
    try {
      const newMemory = await prisma.memory.create({
        data: {
          userId,
          content,
          type: 'note',
        },
      });

      const embeddingVector = await llmService.createEmbedding(content);

      if (!embeddingVector) {
        throw new Error('Failed to generate embedding for the memory.');
      }

      const embeddingId = uuidv4();
      const vectorString = `[${embeddingVector.join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO "embeddings" ("id", "memoryId", "modelName", "embedding")
        VALUES (${embeddingId}::uuid, ${newMemory.id}::uuid, 'nomic-embed-text', ${vectorString}::vector)
      `;

      console.log(`Successfully ingested and embedded memory ${newMemory.id}`);
      return newMemory;

    } catch (error) {
      console.error('Error during memory ingestion:', error);
      throw error;
    }
  }

  async getContext(userId: string, query: string, limit: number = 5): Promise<string> {
    console.log(`[MemoryService] Getting context for query: "${query}"`);
    // 1. Create an embedding for the user's query
    const queryEmbedding = await llmService.createEmbedding(query);
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // 2. Find the most relevant memories using vector similarity search
    const rawRelevantMemories: { id: string; content: string; similarity: number; rerankScore?: number }[] = await prisma.$queryRaw`
      SELECT m.id, m.content, (1 - (e.embedding <=> ${vectorString}::vector)) AS similarity
      FROM memories m
      JOIN embeddings e ON m.id = e."memoryId"
      WHERE m."userId" = ${userId}
      ORDER BY e.embedding <=> ${vectorString}::vector
      LIMIT 10
    `;
    console.log(`[MemoryService] Found ${rawRelevantMemories.length} raw relevant memories.`);

    if (rawRelevantMemories.length === 0) {
      return "No relevant memories found.";
    }

    // 3. Add a Similarity Threshold Filter
    const SIMILARITY_THRESHOLD = 0.78;
    let filteredMemories = rawRelevantMemories.filter(r => r.similarity >= SIMILARITY_THRESHOLD);
    console.log(`[MemoryService] ${filteredMemories.length} memories passed the similarity threshold.`);

    if (filteredMemories.length === 0) {
      console.warn('[MemoryService] No memories met the similarity threshold. Falling back to top 2.');
      filteredMemories = rawRelevantMemories.slice(0, 2);
    }

    // 4. Reranking
    let finalResults = filteredMemories;
    if (this.reranker) {
      const reranked = await Promise.all(filteredMemories.map(async (mem) => {
        const res = await this.reranker([query, mem.content]);
        const score = Array.isArray(res) ? res[0].score : res.score;
        return { ...mem, rerankScore: score };
      }));
      finalResults = reranked.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
      console.log('[MemoryService] Reranked memories:', finalResults.map(r => ({ content: r.content.substring(0, 50) + '...', rerankScore: r.rerankScore })));
    } else {
      console.warn('[MemoryService] Reranker not initialized. Skipping reranking step.');
    }

    // 5. Take top `limit` after filtering and reranking
    const topMemories = finalResults.slice(0, limit);

    // 6. Combine raw content of top memories for context
    const context = topMemories.map(mem => mem.content).join('\n---\n');
    return context;
  }

  async retrieve(userId: string, query: string): Promise<string> {
    try {
      const context = await this.getContext(userId, query);

      if (context === "No relevant memories found.") {
        return "I don't have any memories related to that.";
      }

      const prompt = `Based on the following memories, please answer the user's question.

Memories:
${context}

User's Question: ${query}`;

      const finalResponse = await llmService.generateCompletion(prompt);

      return finalResponse;

    } catch (error) {
      console.error('Error during memory retrieval:', error);
      throw error;
    }
  }
}

export const memoryService = new MemoryService();