import { v4 as uuidv4 } from 'uuid';
import prisma from '../db';
import { llmService } from './llm.service';
import { MemoryType } from '../models/memory';
import { ContradictionDetectionService } from './contradiction-detection.service';
import { memoryService } from './memory.service';
import { smartCacheService } from './smart-cache.service';

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  importance: number;
  source?: string;
  chatId?: string;
  temporal?: Date;
  entities?: string[];
}

class MemoryExtractorService {
  private contradictionService: ContradictionDetectionService;

  constructor() {
    this.contradictionService = new ContradictionDetectionService();
  }

  async extractAndStore(userId: string, userMessage: string, assistantMessage: string, chatId: string): Promise<void> {
    console.time('memoryExtractorService.extractAndStore');
    console.log('[MemoryExtractorService] Starting extraction and storage process...');
    const combinedContent = `User: ${userMessage}\nAssistant: ${assistantMessage}`;

    console.log('[MemoryExtractorService] Performing quick duplicate check...');
    const isDuplicate = await this.quickDuplicateCheck(userId, combinedContent);
    if (isDuplicate) {
      console.log('[MemoryExtractorService] Duplicate content detected, skipping extraction.');
      return;
    }
    console.log('[MemoryExtractorService] Quick duplicate check completed.');

    console.log('[MemoryExtractorService] Parsing memories with LLM...');
    const extractedMemories: ExtractedMemory[] = await this.parseMemories(combinedContent);
    console.log(`[MemoryExtractorService] LLM parsing completed. Extracted ${extractedMemories.length} memories.`);

    if (extractedMemories.length === 0) {
      console.log('[MemoryExtractorService] No memories extracted, skipping storage.');
      return;
    }

    console.log('[MemoryExtractorService] Starting to store extracted memories and embeddings...');
    for (const memoryData of extractedMemories) {
      console.log(`[MemoryExtractorService] Ingesting memory: ${memoryData.content.substring(0, 50)}...`);
      const memory = await memoryService.ingest(
        userId,
        memoryData.content,
        memoryData.type,
        memoryData.importance,
        memoryData.source,
        memoryData.temporal?.toISOString()
      );
      console.log(`[MemoryExtractorService] Memory ${memory.id} ingested. Checking for contradictions...`);

      const contradictionCheck = await this.contradictionService.detectContradictions(
        userId,
        memoryData.content,
        memory.id
      );
      console.log(`[MemoryExtractorService] Contradiction check completed for memory ${memory.id}. Has contradictions: ${contradictionCheck.hasContradictions}`);

      if (contradictionCheck.hasContradictions) {
        console.log(`[Contradiction Detected] Memory ${memory.id} contradicts existing memories`);
        
        for (const contradiction of contradictionCheck.contradictions) {
          console.log(`[MemoryExtractorService] Resolving contradiction for memory ${memory.id} with existing memory ${contradiction.existingMemoryId}`);
          const isProgression = this.isTemporalProgression(
            contradiction.existingContent,
            memoryData.content
          );

          if (isProgression) {
            await this.contradictionService.resolveContradiction(
              memory.id,
              contradiction.existingMemoryId,
              'temporal_update'
            );
          } else {
            await this.contradictionService.resolveContradiction(
              memory.id,
              contradiction.existingMemoryId,
              'contradiction_noted'
            );
          }
          console.log(`[MemoryExtractorService] Contradiction resolved for memory ${memory.id}.`);
        }
      }
    }
    console.log(`[MemoryExtractorService] Finished storing all ${extractedMemories.length} memories.`);

    console.log('[MemoryExtractorService] Invalidating cache for mentioned entities...');
    const extractedEntities = new Set<string>();
    
    for (const memoryData of extractedMemories) {
      if (memoryData.entities) {
        memoryData.entities.forEach(e => extractedEntities.add(e));
      }
    }
    
    for (const entityName of extractedEntities) {
      await smartCacheService.invalidateEntity(entityName);
      console.log(`[MemoryExtractorService] Invalidated cache for entity: ${entityName}`);
    }
    console.log('[MemoryExtractorService] Cache invalidation completed.');
    console.timeEnd('memoryExtractorService.extractAndStore');
  }

  private isTemporalProgression(oldContent: string, newContent: string): boolean {
    // Simple heuristic: check for role/status changes
    const progressionKeywords = ['was', 'used to', 'previously', 'now', 'became', 'promoted'];
    return progressionKeywords.some(keyword => 
      newContent.toLowerCase().includes(keyword) ||
      oldContent.toLowerCase().includes(keyword)
    );
  }

  private async quickDuplicateCheck(userId: string, content: string): Promise<boolean> {
    console.time('memoryExtractorService.quickDuplicateCheck');
    console.log('[MemoryExtractorService] Performing quick duplicate check...');
    const recentMemories = await prisma.memory.findMany({
      where: {
        userId: userId,
        content: content, // Exact match for now
        createdAt: {
          gte: new Date(Date.now() - 1000 * 60 * 5), // Check for duplicates in the last 5 minutes
        },
      },
      take: 1,
    });
    const isDuplicate = recentMemories.length > 0;
    console.timeEnd('memoryExtractorService.quickDuplicateCheck');
    return isDuplicate;
  }

    private async parseMemories(content: string): Promise<ExtractedMemory[]> {
      console.time('memoryExtractorService.parseMemories');
      console.log('[MemoryExtractorService] Parsing memories with LLM...');
      const prompt = `From the following conversation, extract distinct memories. Each memory should be a JSON object with the following fields:
  - type: (string, choose from: ${Object.values(MemoryType).join(', ')})
  - content: (string, the actual memory)
  - importance: (number, 0.0 to 1.0, how important is this memory?)
  - source: (string, e.g., 'chat', 'document', 'observation')
  - temporal: (string, ISO date string if a specific date/time is mentioned, otherwise omit)
  - entities: (array of strings, ALL named entities, especially people, mentioned in the memory)
  
  Additionally, if family relationships are mentioned (e.g., mother, father, brother, sister), extract them as separate memories with type 'relationship' and content describing the relationship (e.g., 'User is mother of Sarah').
  
  Return a JSON array of these memory objects. If no distinct memories are found, return an empty array.
  
  Conversation:\n  ${content}\n\n  Memories (JSON array):`;
  
      try {
        const llmResponse = await llmService.generateCompletion(prompt);
        console.log('[MemoryExtractorService] LLM Raw Response:', llmResponse);
        if (llmResponse) {
          const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
          let cleanedResponse = llmResponse;
          if (jsonMatch && jsonMatch[1]) {
            cleanedResponse = jsonMatch[1];
          } else {
            const directJsonMatch = llmResponse.match(/\s*\[[\s\S]*\]\s*/);
            if (directJsonMatch && directJsonMatch[0]) {
              cleanedResponse = directJsonMatch[0];
            }
          }
          const parsedMemories: ExtractedMemory[] = JSON.parse(cleanedResponse);
          const filteredMemories = parsedMemories.filter(mem => {
            const lowerContent = mem.content.toLowerCase();
            return !lowerContent.includes("i don't remember") &&
                   !lowerContent.includes("i do not remember") &&
                   !lowerContent.includes("i don't have enough context");
          });
          const result = filteredMemories.map(mem => ({
            ...mem,
            temporal: mem.temporal ? new Date(mem.temporal) : undefined,
          }));
          console.timeEnd('memoryExtractorService.parseMemories');
          return result;
        }
      } catch (e) {
        console.error('[MemoryExtractorService] Failed to parse LLM response for memories:', e);
      }
      console.timeEnd('memoryExtractorService.parseMemories');
      return [];
    }}

export const memoryExtractorService = new MemoryExtractorService();