import prisma from '../db';
import { llmService } from '../services/llm.service';

export const generateDailySummaries = async () => {
  console.log('[SummarizationJob] Running job to generate daily summaries...');

  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  try {
    // Find all users with memories in the last 24 hours that haven't been summarized
    const usersWithRecentMemories = await prisma.memory.findMany({
      where: {
        createdAt: {
          gte: twentyFourHoursAgo,
        },
        isSummarized: false,
        deleted: false,
      },
      distinct: ['userId'],
      select: {
        userId: true,
      },
    });

    for (const user of usersWithRecentMemories) {
      const userId = user.userId;

      // Get all memories for this user in the last 24 hours that are not summarized
      const memoriesToSummarize = await prisma.memory.findMany({
        where: {
          userId: userId,
          createdAt: {
            gte: twentyFourHoursAgo,
          },
          isSummarized: false,
          deleted: false,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      if (memoriesToSummarize.length === 0) {
        console.log(`[SummarizationJob] No new memories to summarize for user ${userId}.`);
        continue;
      }

      const combinedContent = memoriesToSummarize.map(mem => mem.content).join('\n\n---\n\n');
      const sourceMemoryIds = memoriesToSummarize.map(mem => mem.id);

      console.log(`[SummarizationJob] Generating summary for user ${userId} from ${memoriesToSummarize.length} memories.`);

      const prompt = `Please summarize the following collection of memories into a concise, coherent daily summary. Focus on key events, decisions, and insights. The summary should be in the first person, as if the user is recalling their day.

Memories:
${combinedContent}

Daily Summary:`;

      const summaryContent = await llmService.generateCompletion(prompt);

      if (summaryContent) {
        await prisma.summary.create({
          data: {
            userId: userId,
            content: summaryContent,
            sourceMemoryIds: sourceMemoryIds,
            level: 1, // Daily summary
            modelName: 'qwen3:1.7B', // Or whatever model is used for summarization
          },
        });
        console.log(`[SummarizationJob] Successfully created daily summary for user ${userId}.`);

        // Mark memories as summarized
        await prisma.memory.updateMany({
          where: {
            id: {
              in: sourceMemoryIds,
            },
          },
          data: {
            isSummarized: true,
          },
        });
        console.log(`[SummarizationJob] Marked ${sourceMemoryIds.length} memories as summarized for user ${userId}.`);

      } else {
        console.warn(`[SummarizationJob] LLM returned empty summary for user ${userId}.`);
      }
    }
  } catch (error) {
    console.error('[SummarizationJob] Error during daily summarization:', error);
  }
};
