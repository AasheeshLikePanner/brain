import prisma from '../db';
import { llmService } from '../services/llm.service';
import { Prisma } from '@prisma/client';

interface Triplet {
  subject: string;
  predicate: string;
  object: string;
  sourceId: string; // New field to link back to original content
  sourceType: 'memory' | 'chatMessage'; // New field
}

export const extractTriplets = async () => {
  console.log('[TripletExtractionJob] Running job to extract knowledge triplets...');

  try {
    // Find all users with unprocessed memories or chat messages
    const usersWithUnprocessedContent = await prisma.$queryRaw`
      SELECT DISTINCT "userId" FROM (
        SELECT "userId" FROM "memories" WHERE "isTripletExtracted" = false AND "deleted" = false
        UNION ALL
        SELECT c."userId" FROM "chat_messages" cm JOIN "chats" c ON cm."chatId" = c.id WHERE cm."isTripletExtracted" = false
      ) AS unprocessed_content;
    `;

    for (const user of usersWithUnprocessedContent as { userId: string }[]) {
      const userId = user.userId;

      // Fetch unprocessed memories
      const unprocessedMemories = await prisma.memory.findMany({
        where: {
          userId: userId,
          isTripletExtracted: false,
          deleted: false,
        },
        select: { id: true, content: true, metadata: true }, // Select metadata to update it
      });

      // Fetch unprocessed chat messages
      const unprocessedChatMessages = await prisma.chatMessage.findMany({
        where: {
          chat: { userId: userId }, // Filter by chat's userId
          isTripletExtracted: false,
        },
        select: { id: true, content: true },
      });

      const allUnprocessedContent = [
        ...unprocessedMemories.map(m => ({ id: m.id, type: 'memory', content: m.content, metadata: m.metadata })),
        ...unprocessedChatMessages.map(cm => ({ id: cm.id, type: 'chatMessage', content: cm.content })),
      ];

      if (allUnprocessedContent.length === 0) {
        console.log(`[TripletExtractionJob] No new content to process for user ${userId}.`);
        continue;
      }

      // Process each content item individually to get sourceId for triplets
      for (const contentItem of allUnprocessedContent) {
        const prompt = `From the following text, extract knowledge triplets in the format of a JSON array of objects: [{ "subject": "", "predicate": "", "object": "" }].
For each triplet, also include the "sourceId" and "sourceType" from the provided context. The sourceId is "${contentItem.id}" and sourceType is "${contentItem.type}".
Focus on factual information, relationships between entities, and key actions. Ensure subjects and objects are specific entities.

Text:
${contentItem.content}

Triplets (JSON array):`;

        const llmResponse = await llmService.generateCompletion(prompt);
        console.log(`[TripletExtractionJob] LLM Raw Response for ${contentItem.id}:`, llmResponse); // ADDED LOG

        if (llmResponse) {
          try {
            const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
            let cleanedResponse = llmResponse;
            if (jsonMatch && jsonMatch[1]) {
              cleanedResponse = jsonMatch[1];
            } else {
              // Fallback if no markdown block, try to find a JSON array directly
              const directJsonMatch = llmResponse.match(/\s*\[[\s\S]*\]\s*/);
              if (directJsonMatch && directJsonMatch[0]) {
                cleanedResponse = directJsonMatch[0];
              }
            }
            console.log(`[TripletExtractionJob] Cleaned LLM Response for ${contentItem.id}:`, cleanedResponse); // ADDED LOG
            const triplets: Triplet[] = JSON.parse(cleanedResponse);
            console.log(`[TripletExtractionJob] Parsed Triplet Array for ${contentItem.id}:`, triplets); // ADDED LOG
            if (Array.isArray(triplets) && triplets.every(t => t.subject)) {
              // Inject sourceId and sourceType into each triplet
              const processedTriplets = triplets.map(t => ({
                ...t,
                sourceId: contentItem.id,
                sourceType: contentItem.type,
              }));
              console.log(`[TripletExtractionJob] Extracted ${processedTriplets.length} triplets for content item ${contentItem.id}.`);

              // Collect all unique entities from the triplets
              const detectedEntities = Array.from(new Set([
                ...processedTriplets.map(t => t.subject),
                ...processedTriplets.map(t => t.object)
              ])).filter(Boolean); // Filter out empty strings or nulls
              console.log(`[TripletExtractionJob] Detected Entities for ${contentItem.id}:`, detectedEntities); // ADDED LOG

              for (const triplet of processedTriplets) {
                // Ensure subject is a valid string
                let subjectName = String(triplet.subject || '').trim();
                if (!subjectName) {
                  console.warn(`[TripletExtractionJob] Skipping triplet due to invalid subject: ${JSON.stringify(triplet)}`);
                  continue;
                }

                // Ensure object is a valid string, or null if not present
                let objectName: string | null = null;
                if (triplet.object && (typeof triplet.object === 'string' || Array.isArray(triplet.object))) {
                  objectName = String(triplet.object).trim();
                  if (objectName === '') objectName = null;
                }

                // Upsert subject entity
                const subjectEntity = await prisma.entity.upsert({
                  where: { userId_name: { userId: userId, name: subjectName } },
                  update: {},
                  create: { userId: userId, name: subjectName, type: 'unknown' },
                });

                let objectEntity = null;
                if (objectName) {
                  // Upsert object entity if it exists
                  objectEntity = await prisma.entity.upsert({
                    where: { userId_name: { userId: userId, name: objectName } },
                    update: {},
                    create: { userId: userId, name: objectName, type: 'unknown' },
                  });
                }

                // Create entity link
                await prisma.entityLink.create({
                  data: {
                    entityId: subjectEntity.id,
                    objectId: objectEntity?.id, // Use optional chaining for objectId
                    memoryId: triplet.sourceType === 'memory' ? triplet.sourceId : null,
                    chatMessageId: triplet.sourceType === 'chatMessage' ? triplet.sourceId : null,
                    role: triplet.predicate,
                  },
                });
              }

              // Mark processed content as isTripletExtracted = true and update metadata.entities
              if (contentItem.type === 'memory') {
                const existingMemory = await prisma.memory.findUnique({
                  where: { id: contentItem.id },
                  select: { metadata: true }
                });
                await prisma.memory.update({
                  where: { id: contentItem.id },
                  data: {
                    isTripletExtracted: true,
                    metadata: {
                      ...(existingMemory?.metadata as Prisma.JsonObject || {}),
                      detected_entities: detectedEntities
                    }
                  },
                });
              } else if (contentItem.type === 'chatMessage') {
                // ChatMessage model does not have a metadata field, so we cannot update metadata.entities
                await prisma.chatMessage.update({
                  where: { id: contentItem.id },
                  data: { isTripletExtracted: true },
                });
              }

            } else {
              console.warn(`[TripletExtractionJob] LLM response was not a valid triplet array for content item ${contentItem.id}:`, llmResponse);
            }
          } catch (e) {
            console.error(`[TripletExtractionJob] Failed to parse LLM response for content item ${contentItem.id}:`, llmResponse, e);
          }
        } else {
          console.warn(`[TripletExtractionJob] LLM returned empty response for triplet extraction for content item ${contentItem.id}.`);
        }
      }
    }
  } catch (error) {
    console.error('[TripletExtractionJob] Error during triplet extraction:', error);
  }
};