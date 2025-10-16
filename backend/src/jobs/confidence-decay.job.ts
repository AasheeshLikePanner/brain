import prisma from '../db';

/**
 * Gradually reduce confidence of memories that aren't accessed
 * This implements "forgetting" - unused memories fade
 */
export async function applyConfidenceDecay(): Promise<void> {
  console.log('[Confidence Decay] Starting confidence decay job...');

  try {
    const users = await prisma.user.findMany();

    for (const user of users) {
      // Get all memories for this user
      const memories = await prisma.memory.findMany({
        where: {
          userId: user.id,
          deleted: false,
          confidenceScore: { gt: 0.1 } // Don't process already-faded memories
        },
        select: {
          id: true,
          lastAccessedAt: true,
          confidenceScore: true,
          metadata: true
        }
      });

      const now = new Date();
      const updates: Array<{ id: string; newConfidence: number }> = [];

      for (const memory of memories) {
        const daysSinceAccess = 
          (now.getTime() - memory.lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);

        // Apply exponential decay
        const decayRate = 0.01; // Slower decay than recency (we want gradual forgetting)
        const decayFactor = Math.exp(-decayRate * daysSinceAccess);
        
        // Calculate new confidence
        let newConfidence = memory.confidenceScore * decayFactor;

        // Important memories decay slower
        const importance = (memory.metadata as any)?.importance || 0.5;
        if (importance > 0.7) {
          newConfidence = Math.max(newConfidence, 0.3); // Floor for important memories
        }

        // Only update if confidence changed significantly
        if (Math.abs(newConfidence - memory.confidenceScore) > 0.05) {
          updates.push({ id: memory.id, newConfidence });
        }
      }

      // Batch update
      if (updates.length > 0) {
        for (const update of updates) {
          await prisma.memory.update({
            where: { id: update.id },
            data: { confidenceScore: update.newConfidence }
          });
        }
        console.log(`[Confidence Decay] Updated ${updates.length} memories for user ${user.id}`);
      }

      // Archive extremely low-confidence memories
      const toArchive = await prisma.memory.findMany({
        where: {
          userId: user.id,
          confidenceScore: { lt: 0.15 },
          deleted: false
        }
      });

      if (toArchive.length > 0) {
        await prisma.memory.updateMany({
          where: {
            id: { in: toArchive.map(m => m.id) }
          },
          data: {
            deleted: true,
            metadata: {
              // Preserve existing metadata and add archive reason
              archivedReason: 'low_confidence',
              archivedAt: now.toISOString()
            }
          }
        });
        console.log(`[Confidence Decay] Archived ${toArchive.length} low-confidence memories`);
      }
    }

    console.log('[Confidence Decay] Confidence decay job completed');
  } catch (error) {
    console.error('[Confidence Decay] Error:', error);
  }
}
