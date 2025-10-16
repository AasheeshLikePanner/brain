import prisma from '../db';

export class MemoryAssociationService {
  /**
   * Pre-compute and store top associated memories for each memory
   * Run this periodically as a background job
   */
  async computeMemoryAssociations(userId: string): Promise<void> {
    console.log(`[Association] Computing memory associations for user ${userId}`);

    const memories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        confidenceScore: { gt: 0.3 }
      },
      select: { id: true, metadata: true }
    });

    if (memories.length < 2) {
      console.log('[Association] Not enough memories to compute associations');
      return;
    }

    for (const memory of memories) {
      const embeddingResult: { embedding: number[] }[] = await prisma.$queryRaw`
        SELECT embedding FROM "embeddings" WHERE "memoryId" = ${memory.id} LIMIT 1
      `;

      if (embeddingResult.length === 0) continue;

      const vectorString = `[${embeddingResult[0].embedding.join(',')}]`;

      const similar: any[] = await prisma.$queryRaw`
        SELECT 
          m.id,
          (1 - (e.embedding <=> ${vectorString}::vector)) as similarity
        FROM memories m
        JOIN embeddings e ON m.id = e."memoryId"
        WHERE 
          m."userId" = ${userId}
          AND m.id != ${memory.id}
          AND m.deleted = false
        ORDER BY similarity DESC
        LIMIT 5
      `;

      // Store associations in metadata
      const associatedIds = similar
        .filter(s => s.similarity > 0.7) // Only strong associations
        .map(s => s.id);

      if (associatedIds.length > 0) {
        const oldMetadata = (memory.metadata as object) || {};
        await prisma.memory.update({
          where: { id: memory.id },
          data: {
            metadata: {
              ...oldMetadata,
              associatedMemories: associatedIds
            }
          }
        });
      }
    }

    console.log(`[Association] Completed associations for ${memories.length} memories`);
  }

  /**
   * When retrieving a memory, also get its associated memories
   */
  async getMemoryWithAssociations(memoryId: string): Promise<{
    primary: any;
    associated: any[];
  }> {
    const primary = await prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!primary) {
      return { primary: null, associated: [] };
    }

    const associatedIds = (primary.metadata as any)?.associatedMemories || [];
    
    if (associatedIds.length === 0) {
      return { primary, associated: [] };
    }

    const associated = await prisma.memory.findMany({
      where: {
        id: { in: associatedIds },
        deleted: false
      }
    });

    return { primary, associated };
  }
}
