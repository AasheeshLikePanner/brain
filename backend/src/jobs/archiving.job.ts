import prisma from '../db';

export const archiveOldMemories = async () => {
  console.log('[ArchivingJob] Running job to archive old and unimportant memories...');

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const importanceThreshold = 0.4;

  try {
    // Prisma does not support direct numeric comparison on JSON fields across all DBs.
    // A raw query is the most reliable way to perform this update.
    const count = await prisma.$executeRaw`
      UPDATE "memories"
      SET "deleted" = true
      WHERE
        "createdAt" < ${sixMonthsAgo}
        AND ("metadata"->>'importance')::numeric < ${importanceThreshold}
        AND "deleted" = false
    `;

    if (count > 0) {
      console.log(`[ArchivingJob] Successfully archived ${count} memories.`);
    } else {
      console.log('[ArchivingJob] No memories met the criteria for archiving.');
    }
  } catch (error) {
    console.error('[ArchivingJob] Error during memory archiving:', error);
  }
};