import prisma from '../db';
import { llmService } from './llm.service';
import { Memory } from '@prisma/client';

class MemoryDeduplicationService {
  async findAndMergeDuplicates(): Promise<void> {
    console.log('[MemoryDeduplicationService] Starting duplicate detection and merging...');

    // Fetch all users to process their memories
    const users = await prisma.user.findMany();

    for (const user of users) {
      console.log(`[MemoryDeduplicationService] Processing memories for user: ${user.id}`);
      // Fetch all active memories for the current user
      const userMemories = await prisma.memory.findMany({
        where: {
          userId: user.id,
          deleted: false, // Only consider active memories
        },
        orderBy: { createdAt: 'asc' }, // Process older memories first
      });

      if (userMemories.length < 2) {
        console.log(`[MemoryDeduplicationService] User ${user.id} has less than 2 memories, skipping deduplication.`);
        continue;
      }

      // Simple N^2 comparison for demonstration. In production, use vector similarity or hashing.
      for (let i = 0; i < userMemories.length; i++) {
        for (let j = i + 1; j < userMemories.length; j++) {
          const mem1 = userMemories[i];
          const mem2 = userMemories[j];

          // Placeholder for actual duplicate detection logic
          if (await this.isDuplicate(mem1, mem2)) {
            console.log(`[MemoryDeduplicationService] Found potential duplicate: ${mem1.id} and ${mem2.id}`);
            await this.mergeMemoriesSimple(mem1, mem2);
          }
        }
      }
    }
    console.log('[MemoryDeduplicationService] Duplicate detection and merging completed.');
  }

  private async isDuplicate(mem1: Memory, mem2: Memory): Promise<boolean> {
    // Implement actual duplicate detection logic using embedding similarity.
    // Fetch embeddings for both memories
    const embedding1Record = await prisma.embedding.findFirst({
      where: { memoryId: mem1.id },
    });
    const embedding2Record = await prisma.embedding.findFirst({
      where: { memoryId: mem2.id },
    });

    if (!embedding1Record || !embedding2Record) {
      console.warn(`[MemoryDeduplicationService] Could not find embeddings for one or both memories (${mem1.id}, ${mem2.id}). Falling back to content equality.`);
      return mem1.content === mem2.content;
    }

    interface RawEmbeddingResult { embedding: string; }

    const embedding1Result: RawEmbeddingResult[] = await prisma.$queryRaw`
      SELECT embedding::text as embedding FROM embeddings WHERE "memoryId" = ${mem1.id} LIMIT 1
    `;
    const embedding2Result: RawEmbeddingResult[] = await prisma.$queryRaw`
      SELECT embedding::text as embedding FROM embeddings WHERE "memoryId" = ${mem2.id} LIMIT 1
    `;

    if (embedding1Result.length === 0 || embedding2Result.length === 0) {
      console.warn(`[MemoryDeduplicationService] Could not find embeddings for one or both memories (${mem1.id}, ${mem2.id}). Falling back to content equality.`);
      return mem1.content === mem2.content;
    }

    const vector1 = JSON.parse(embedding1Result[0].embedding);
    const vector2 = JSON.parse(embedding2Result[0].embedding);

    // Calculate cosine similarity


    if (vector1.length === 0 || vector2.length === 0) {
      console.warn(`[MemoryDeduplicationService] Empty embedding vectors for one or both memories (${mem1.id}, ${mem2.id}). Falling back to content equality.`);
      return mem1.content === mem2.content;
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      magnitude1 += vector1[i] * vector1[i];
      magnitude2 += vector2[i] * vector2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return false; // Cannot calculate similarity if magnitude is zero
    }

    const similarity = dotProduct / (magnitude1 * magnitude2);
    console.log(`[MemoryDeduplicationService] Similarity between ${mem1.id} and ${mem2.id}: ${similarity}`);

    const SIMILARITY_THRESHOLD = 0.95; // Adjust as needed
    return similarity >= SIMILARITY_THRESHOLD;
  }

  private async mergeMemoriesSimple(mem1: Memory, mem2: Memory): Promise<void> {
    console.log(`[MemoryDeduplicationService] Merging memories ${mem1.id} and ${mem2.id}...`);
    // Placeholder: Implement actual merging logic.
    // This could involve:
    // 1. Choosing one memory as the primary and soft-deleting the other.
    // 2. Combining metadata, content, etc.
    // 3. Re-embedding the merged memory.

    // For now, soft-delete the second memory and update the first with a log
    await prisma.memory.update({
      where: { id: mem2.id },
      data: { deleted: true, metadata: { ...mem2.metadata as object, mergedInto: mem1.id } },
    });

    await prisma.memory.update({
      where: { id: mem1.id },
      data: { metadata: { ...mem1.metadata as object, mergeCount: ((mem1.metadata as any).mergeCount || 0) + 1 } },
    });

    console.log(`[MemoryDeduplicationService] Merged ${mem2.id} into ${mem1.id}. ${mem2.id} soft-deleted.`);
  }
}

export const memoryDeduplicationService = new MemoryDeduplicationService();
