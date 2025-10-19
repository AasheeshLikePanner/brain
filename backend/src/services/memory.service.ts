import prisma from '../db';
import { llmService } from './llm.service';
import { v4 as uuidv4 } from 'uuid';
import { pipeline, env } from '@xenova/transformers';
import { Prisma } from '@prisma/client';
import { MemoryAssociationService } from './memory-association.service';
import { memoryIndexService } from './memory-index.service';

// Set the cache directory for transformers.js
env.cacheDir = './.transformers-cache';

class MemoryService {
  private reranker: any; // To store the loaded reranker pipeline
  private associationService: MemoryAssociationService;

  constructor() {
    this.initReranker();
    this.associationService = new MemoryAssociationService();
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

  async ingest(
    userId: string,
    content: string,
    type: string = 'note',
    importance: number = 0.5,
    source: string = 'unknown',
    recordedAt: string | null = null // Changed from temporal to recordedAt
  ) {
    try {
      console.log('[MemoryService] Starting memory ingestion process...');
      console.log('[MemoryService] Creating new memory record in database...');
      const newMemory = await prisma.memory.create({
        data: {
          userId,
          content,
          type,
          recordedAt: recordedAt ? new Date(recordedAt) : null, // Use recordedAt field
          metadata: {
            importance,
            source,
          },
        },
      });
      console.log(`[MemoryService] Memory ${newMemory.id} created. Generating embedding...`);

      const embeddingVector = await llmService.createEmbedding(content);
      console.log('[MemoryService] Embedding generated.');

      if (!embeddingVector) {
        throw new Error('Failed to generate embedding for the memory.');
      }

      const embeddingId = uuidv4();
      const vectorString = `[${embeddingVector.join(',')}]`;
      console.log('[MemoryService] Inserting embedding into database...');
      await prisma.$executeRaw`
        INSERT INTO "embeddings" ("id", "memoryId", "modelName", "embedding")
        VALUES (${embeddingId}::uuid, ${newMemory.id}::uuid, 'nomic-embed-text', ${vectorString}::vector)
      `;
      console.log('[MemoryService] Embedding inserted. Memory ingestion complete.');

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

  async getContext(
    userId: string,
    query: string,
    limit: number = 3
  ): Promise<{ contextString: string; sources: { id: string; content: string }[] }> {
    // ... existing broad query detection ...

    // Get top memories with smart scoring
    let memories = await memoryIndexService.searchMemories(
      userId,
      query,
      limit * 2  // Get more initially
    );

    // For each top memory, get associated memories (constellation effect)
    const memoryConstellation: any[] = [];
    const seenIds = new Set<string>();

    for (const memory of memories.slice(0, limit)) {
      if (seenIds.has(memory.id)) continue;
      
      const withAssociations = await this.associationService.getMemoryWithAssociations(memory.id);
      
      memoryConstellation.push(withAssociations.primary);
      seenIds.add(memory.id);

      // Add top 2 associated memories
      for (const assoc of withAssociations.associated.slice(0, 2)) {
        if (!seenIds.has(assoc.id)) {
          memoryConstellation.push(assoc);
          seenIds.add(assoc.id);
        }
      }
    }

    // ... existing reranking logic ...

    // Format context with associations clearly marked
    const contextString = memoryConstellation
      .slice(0, limit + 2) // Allow a few extra from associations
      .map((m, i) => {
        const isAssociated = !memories.find(mem => mem.id === m.id);
        const prefix = isAssociated ? '(Related)' : '';
        return `${prefix}[${i + 1}] ${m.content}`;
      })
      .join('\n');
    
    const sources = memoryConstellation.slice(0, limit + 2).map(m => ({ id: m.id, content: m.content }));

    return { contextString, sources };
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
