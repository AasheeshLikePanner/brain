import prisma from '../db';
import { llmService } from './llm.service';
import { v4 as uuidv4 } from 'uuid';

class MemoryService {

  /**
   * Ingests a new piece of content, creates a memory, generates its embedding,
   * and stores both in the database.
   * @param userId The ID of the user who owns the memory.
   * @param content The text content to ingest.
   */
  async ingest(userId: string, content: string) {
    try {
      // Step 1: Create and store the memory record
      const newMemory = await prisma.memory.create({
        data: {
          userId,
          content,
          type: 'note', // Defaulting to 'note' for now
        },
      });

      // Step 2: Generate an embedding for the content
      const embeddingVector = await llmService.createEmbedding(content);

      if (!embeddingVector) {
        throw new Error('Failed to generate embedding for the memory.');
      }

      // Step 3: Store the embedding using a raw SQL query
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

  async retrieve(userId: string, query: string): Promise<string> {
    try {
      // 1. Create an embedding for the user's query
      const queryEmbedding = await llmService.createEmbedding(query);
      const vectorString = `[${queryEmbedding.join(',')}]`;

      // 2. Find the most relevant memories using vector similarity search
      const relevantMemories: { content: string }[] = await prisma.$queryRaw`
        SELECT m.content
        FROM memories m
        JOIN embeddings e ON m.id = e."memoryId"
        WHERE m."userId" = ${userId}
        ORDER BY e.embedding <-> ${vectorString}::vector
        LIMIT 5
      `;

      if (relevantMemories.length === 0) {
        return "I don't have any memories related to that.";
      }

      // 3. Construct the prompt for the LLM
      const context = relevantMemories.map(m => m.content).join('\n---\n');
      const prompt = `Based on the following memories, please answer the user's question.

Memories:
${context}

User's Question: ${query}`;

      // 4. Generate the final response
      const finalResponse = await llmService.generateCompletion(prompt);

      return finalResponse;

    } catch (error) {
      console.error('Error during memory retrieval:', error);
      throw error;
    }
  }
}

export const memoryService = new MemoryService();
