import prisma from '../db';
import { llmService } from './llm.service';

export class ContradictionDetectionService {

  /**
   * Check if a new memory contradicts existing memories
   */
  async detectContradictions(
    userId: string,
    newMemoryContent: string,
    newMemoryId?: string
  ): Promise<{
    hasContradictions: boolean;
    contradictions: Array<{
      existingMemoryId: string;
      existingContent: string;
      reason: string;
    }>;
  }> {
    console.time('contradictionDetectionService.detectContradictions');
    // Get recent memories (last 90 days) that might contradict
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const recentMemories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        createdAt: { gte: ninetyDaysAgo },
        ...(newMemoryId && { id: { not: newMemoryId } })
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        type: true
      },
      take: 50 // Limit to prevent too many LLM calls
    });

    if (recentMemories.length === 0) {
      console.timeEnd('contradictionDetectionService.detectContradictions');
      return { hasContradictions: false, contradictions: [] };
    }

    // Use LLM to detect contradictions
    const systemPrompt = `Analyze if the following NEW memory contradicts any EXISTING memories.

Task: Identify if the NEW memory contradicts any EXISTING memories. A contradiction means they make conflicting claims about the same subject.

Examples of contradictions:
- "I prefer coffee" vs "I prefer tea" (about same preference)
- "Sarah is an intern" vs "Sarah is a senior engineer" (about same person's role, though could be temporal progression)
- "Meeting is on Monday" vs "Meeting is on Tuesday" (about same event)

Examples of NOT contradictions:
- "I had coffee today" vs "I prefer tea" (one is specific instance, other is general preference)
- Different facts about different subjects
- Complementary information

Respond in JSON format:
{
  "contradictions": [
    {
      "existingMemoryIndex": <number>,
      "reason": "<brief explanation>",
      "severity": "<high|medium|low>",
      "isTemporalProgression": <boolean>
    }
  ]
}

If no contradictions, return: {"contradictions": []}`;

    const userPrompt = `NEW MEMORY:\n${newMemoryContent}\n\nEXISTING MEMORIES:\n${recentMemories.map((m, i) => `[${i}] ${m.content}`).join('\n')}`;

    try {
      const prompt = `${systemPrompt}\n\n${userPrompt}`;
      console.time('llmService.generateCompletion (contradiction detection)');
      const response = await llmService.generateCompletion(prompt);
      console.timeEnd('llmService.generateCompletion (contradiction detection)');
      debugger;
      const parsed = JSON.parse(this.extractJSON(response));

      if (!parsed.contradictions) {
        console.timeEnd('contradictionDetectionService.detectContradictions');
        return { hasContradictions: false, contradictions: [] };
      }

      const contradictions = parsed.contradictions
        .filter((c: any) => 
          c.existingMemoryIndex !== undefined && 
          c.existingMemoryIndex >= 0 && 
          c.existingMemoryIndex < recentMemories.length
        )
        .map((c: any) => ({
        existingMemoryId: recentMemories[c.existingMemoryIndex].id,
        existingContent: recentMemories[c.existingMemoryIndex].content,
        reason: c.reason,
        severity: c.severity,
        isTemporalProgression: c.isTemporalProgression
      }));

      console.timeEnd('contradictionDetectionService.detectContradictions');
      return {
        hasContradictions: contradictions.length > 0,
        contradictions
      };
    } catch (error) {
      console.error('Error detecting contradictions:', error);
      console.timeEnd('contradictionDetectionService.detectContradictions');
      return { hasContradictions: false, contradictions: [] };
    }
  }

  /**
   * Resolve a contradiction by updating memory metadata
   */
  async resolveContradiction(
    newMemoryId: string,
    existingMemoryId: string,
    resolution: 'temporal_update' | 'contradiction_noted' | 'merge'
  ): Promise<void> {
    console.time('contradictionDetectionService.resolveContradiction');
    if (resolution === 'temporal_update') {
      // Mark old memory as superseded
      const oldMemory = await prisma.memory.findUnique({ where: { id: existingMemoryId }, select: { metadata: true } });
      await prisma.memory.update({
        where: { id: existingMemoryId },
        data: {
          metadata: {
            ...(oldMemory?.metadata as object || {}),
            supersededBy: newMemoryId,
            supersededAt: new Date().toISOString()
          },
          confidenceScore: 0.3 // Reduce confidence but don't delete
        }
      });

      // Mark new memory as superseding
      const newMemory = await prisma.memory.findUnique({ where: { id: newMemoryId }, select: { metadata: true } });
      await prisma.memory.update({
        where: { id: newMemoryId },
        data: {
          metadata: {
            ...(newMemory?.metadata as object || {}),
            supersedes: existingMemoryId
          }
        }
      });
    } else if (resolution === 'contradiction_noted') {
      // Add metadata to both memories noting the contradiction
      const existingMemory = await prisma.memory.findUnique({
        where: { id: existingMemoryId },
        select: { metadata: true }
      });

      const newMemory = await prisma.memory.findUnique({
        where: { id: newMemoryId },
        select: { metadata: true }
      });

      await prisma.memory.update({
        where: { id: existingMemoryId },
        data: {
          metadata: {
            ...(existingMemory?.metadata as object || {}),
            contradictedBy: newMemoryId
          }
        }
      });

      await prisma.memory.update({
        where: { id: newMemoryId },
        data: {
          metadata: {
            ...(newMemory?.metadata as object || {}),
            contradicts: existingMemoryId
          }
        }
      });
    }
    console.timeEnd('contradictionDetectionService.resolveContradiction');
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : '{\"contradictions\": []}';
  }
}