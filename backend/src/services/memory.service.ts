import prisma from '../db';
import { llmService } from './llm.service';
import { v4 as uuidv4 } from 'uuid';
import { pipeline, env } from '@xenova/transformers';
import { Prisma } from '@prisma/client';

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
      this.reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base', { quantized: true });
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
          metadata: {
            importance: 0.5
          }
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

  async reinforce(memoryId: string) {
    console.log(`[MemoryService] Reinforcing memory: ${memoryId}`);
    const memory = await prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) {
      throw new Error('Memory not found');
    }

    const currentMetadata = (memory.metadata || {}) as Prisma.JsonObject;
    const currentImportance = (currentMetadata.importance as number) || 0.5;

    // Increase importance by 0.1, capping at 1.0
    const newImportance = Math.min(currentImportance + 0.1, 1.0);

    const updatedMemory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        metadata: {
          ...currentMetadata,
          importance: newImportance,
        },
      },
    });

    console.log(`[MemoryService] New importance for ${memoryId}: ${newImportance}`);
    return updatedMemory;
  }

  async softDelete(memoryId: string) {
    console.log(`[MemoryService] Soft deleting memory: ${memoryId}`);
    const memory = await prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) {
      throw new Error('Memory not found');
    }

    const updatedMemory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        deleted: true,
      },
    });

    console.log(`[MemoryService] Successfully deleted memory ${memoryId}`);
    return updatedMemory;
  }

  async getContext(userId: string, query: string, limit: number = 5): Promise<{ contextString: string; sources: { id: string; content: string }[] }> {
    console.log(`[MemoryService] Getting context for query: "${query}"`);

    const broadQueryKeywords = ['summarize', 'summary', 'week', 'day', 'month', 'last week', 'last day', 'last month', 'yesterday', 'what happened'];
    const isBroadQuery = broadQueryKeywords.some(keyword => query.toLowerCase().includes(keyword));

    let finalContextString = "";
    let finalSources: { id: string; content: string }[] = [];

    if (isBroadQuery) {
      console.log('[MemoryService] Detected broad query, attempting to retrieve summaries.');
      const relevantSummaries = await prisma.summary.findMany({
        where: {
          userId: userId,
          level: 1, // Daily summaries
          createdAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - 7)), // Last 7 days
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 3, // Get top 3 recent summaries
      });

      if (relevantSummaries.length > 0) {
        const summaryContext = relevantSummaries.map(s => `[id: ${s.id}] Summary (Level ${s.level}): ${s.content}`).join('\n---\n');
        finalContextString += `High-Level Summaries:\n${summaryContext}\n\n`;
        finalSources = finalSources.concat(relevantSummaries.map(s => ({ id: s.id, content: s.content })));
      }
    }

    // Always perform detailed memory retrieval, but potentially combine with summaries
    // 1. Create an embedding for the user's query
    const queryEmbedding = await llmService.createEmbedding(query);
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // 2. Find the most relevant memories using a weighted score of similarity and importance
    const rawRelevantMemories: { id: string; content: string; similarity: number; rerankScore?: number }[] = await prisma.$queryRaw`
      SELECT 
        m.id, 
        m.content, 
        (1 - (e.embedding <=> ${vectorString}::vector)) as similarity,
        (1 - (e.embedding <=> ${vectorString}::vector)) + COALESCE((m.metadata->>'importance')::numeric, 0.5) * 0.5 AS final_score
      FROM memories m
      JOIN embeddings e ON m.id = e."memoryId"
      WHERE 
        m."userId" = ${userId}
        AND m.deleted = false
      ORDER BY final_score DESC
      LIMIT 15
    `;
    console.log(`[MemoryService] Found ${rawRelevantMemories.length} raw relevant memories.`);

    if (rawRelevantMemories.length === 0 && finalSources.length === 0) {
      return { contextString: "No relevant memories found.", sources: [] };
    }

    // 3. Add a Similarity Threshold Filter
    const SIMILARITY_THRESHOLD = 0.78;
    let filteredMemories = rawRelevantMemories.filter(r => r.similarity >= SIMILARITY_THRESHOLD);
    console.log(`[MemoryService] ${filteredMemories.length} memories passed the similarity threshold.`);

    if (filteredMemories.length === 0 && rawRelevantMemories.length > 0) {
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

    // 6. Format the context string with IDs and return the sources
    const memoryContextString = topMemories
      .map(mem => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');
    
    finalContextString += `Detailed Memories:\n${memoryContextString}`;
    finalSources = finalSources.concat(topMemories.map(mem => ({ id: mem.id, content: mem.content })));

    return { contextString: finalContextString, sources: finalSources };
  }

  async retrieve(userId: string, query: string): Promise<string> {
    try {
      const { contextString } = await this.getContext(userId, query);

      if (contextString === "No relevant memories found.") {
        return "I don't have any memories related to that.";
      }

      const prompt = `Based on the following memories, please answer the user's question.\n\nMemories:\n${contextString}\n\nUser's Question: ${query}`;

      const finalResponse = await llmService.generateCompletion(prompt);

      return finalResponse;

    } catch (error) {
      console.error('Error during memory retrieval:', error);
      throw error;
    }
  }
}

export const memoryService = new MemoryService();
