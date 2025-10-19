import prisma from '../db';
import { llmService } from '../services/llm.service';
import { Prisma } from '@prisma/client';

interface Triplet {
  subject: string;
  predicate: string;
  object: string;
  sourceId: string;
  sourceType: 'memory' | 'chatMessage';
}

// Function for the scheduled job (processes all users)
export const extractTriplets = async () => {
  console.log('[TripletExtractionJob] Running scheduled job to extract knowledge triplets for all users...');

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
      await processUserContentForTriplets(user.userId);
    }
  } catch (error) {
    console.error('[TripletExtractionJob] Error during scheduled triplet extraction:', error);
  }
};

// Function for manual extraction (processes a specific user)
export const extractTripletsForUser = async (userId: string) => {
  console.log(`[TripletExtractionJob] Manually triggering triplet extraction for user ${userId}...`);
  try {
    await processUserContentForTriplets(userId);
  } catch (error) {
    console.error(`[TripletExtractionJob] Error during manual triplet extraction for user ${userId}:`, error);
  }
};


// Helper function to process content for a given user
async function processUserContentForTriplets(userId: string) {
  // Fetch unprocessed memories for the specific user
  const unprocessedMemories = await prisma.memory.findMany({
    where: {
      userId: userId,
      isTripletExtracted: false,
      deleted: false,
    },
    select: { id: true, content: true, metadata: true },
  });

  // Fetch unprocessed chat messages for the specific user
  const unprocessedChatMessages = await prisma.chatMessage.findMany({
    where: {
      chat: { userId: userId },
      isTripletExtracted: false,
    },
    select: { id: true, content: true },
  });

  const allUnprocessedContent = [
    ...unprocessedMemories.map(m => ({ id: m.id, type: 'memory', content: m.content, metadata: m.metadata })),
    ...unprocessedChatMessages.map(cm => ({ id: cm.id, type: 'chatMessage', content: cm.content }))
  ];

  if (allUnprocessedContent.length === 0) {
    console.log(`[TripletExtractionJob] No new content to process for user ${userId}.`);
    return;
  }

  // Process each content item individually to get sourceId for triplets
  for (const contentItem of allUnprocessedContent) {
    const prompt = `From the following text, extract knowledge triplets in the format of a JSON array of objects: [{ "subject": "", "predicate": "", "object": "" }].\nFor each triplet, also include the "sourceId" and "sourceType" from the provided context. The sourceId is "${contentItem.id}" and sourceType is "${contentItem.type}".\nFocus on factual information, relationships between entities, and key actions. Ensure subjects and objects are specific entities.\n\nText:\n${contentItem.content}\n\nTriplets (JSON array):`;

    const llmResponse = await llmService.generateCompletion(prompt);
    console.log(`[TripletExtractionJob] LLM Raw Response for ${contentItem.id}:`, llmResponse);

    if (llmResponse) {
      try {
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
        console.log(`[TripletExtractionJob] Cleaned LLM Response for ${contentItem.id}:`, cleanedResponse);
        const triplets: Triplet[] = JSON.parse(cleanedResponse);
        console.log(`[TripletExtractionJob] Parsed Triplet Array for ${contentItem.id}:`, triplets);
        if (Array.isArray(triplets) && triplets.every(t => t.subject)) {
          const processedTriplets = triplets.map(t => ({
            ...t,
            sourceId: contentItem.id,
            sourceType: contentItem.type,
          }));
          console.log(`[TripletExtractionJob] Extracted ${processedTriplets.length} triplets for content item ${contentItem.id}.`);

          const detectedEntities = Array.from(new Set([
            ...processedTriplets.map(t => t.subject),
            ...processedTriplets.map(t => t.object)
          ])).filter(Boolean);
          console.log(`[TripletExtractionJob] Detected Entities for ${contentItem.id}:`, detectedEntities);

          for (const triplet of processedTriplets) {
            let subjectName = String(triplet.subject || '').trim();
            if (!subjectName) {
              console.warn(`[TripletExtractionJob] Skipping triplet due to invalid subject: ${JSON.stringify(triplet)}`);
              continue;
            }

            let objectName: string | null = null;
            if (triplet.object && (typeof triplet.object === 'string' || Array.isArray(triplet.object))) {
              objectName = String(triplet.object).trim();
              if (objectName === '') objectName = null;
            }

            const subjectEntity = await prisma.entity.upsert({
              where: { userId_name: { userId: userId, name: subjectName } },
              update: {}, // No specific update logic needed for now
              create: { userId: userId, name: subjectName, type: 'unknown' },
            });

            let objectEntity = null;
            if (objectName) {
              objectEntity = await prisma.entity.upsert({
                where: { userId_name: { userId: userId, name: objectName } },
                update: {}, // No specific update logic needed for now
                create: { userId: userId, name: objectName, type: 'unknown' },
              });
            }

            await prisma.entityLink.create({
              data: {
                entityId: subjectEntity.id,
                objectId: objectEntity?.id,
                memoryId: triplet.sourceType === 'memory' ? triplet.sourceId : null,
                chatMessageId: triplet.sourceType === 'chatMessage' ? triplet.sourceId : null,
                role: triplet.predicate,
              },
            });
          }

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
