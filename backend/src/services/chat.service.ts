import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { graphService } from './graph.service'; // NEW
import { Chat, ChatMessage } from '@prisma/client';

class ChatService {

  async createChat(userId: string, initialMessage: string): Promise<Chat> {
    const chat = await prisma.chat.create({
      data: {
        userId,
        title: initialMessage.substring(0, 50),
        messages: {
          create: {
            role: 'user',
            content: initialMessage,
          }
        }
      },
      include: {
        messages: true,
      }
    });
    return chat;
  }

  async getChatHistory(chatId: string, userId: string): Promise<ChatMessage[]> {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    return chat?.messages || [];
  }

  async streamChatResponse(chatId: string, userId: string, message: string): Promise<ReadableStream<Uint8Array>> {
    console.log('[ChatService] Starting streamChatResponse.');
    // 1. Save user message
    await prisma.chatMessage.create({
      data: {
        chatId,
        role: 'user',
        content: message,
      },
    });
    console.log('[ChatService] Saved user message.');

    // 2. Get chat history and relevant memories
    const history = await this.getChatHistory(chatId, userId);
    console.log(`[ChatService] Retrieved ${history.length} messages from chat history.`);
    
    const { contextString, sources } = await memoryService.getContext(userId, message, 3); // Get top 3 memories
    console.log(`[ChatService] Retrieved memory context:\n---\n${contextString}\n---`);

    // NEW: Graph Query Integration
    let graphContext = "";
    const graphQueryKeywords = ['who is', 'what is the relationship between', 'connections of', 'tell me about the connections of'];
    const isGraphQuery = graphQueryKeywords.some(keyword => message.toLowerCase().includes(keyword));

    if (isGraphQuery) {
      console.log('[ChatService] Detected potential graph query.');
      // Basic entity extraction for demonstration. A more robust solution would use an LLM.
      const entityNameMatch = message.match(/(who is|what is the relationship between|connections of|tell me about the connections of)\s+(.*?)(?:\?|$)/i);
      if (entityNameMatch && entityNameMatch[2]) {
        const entityName = entityNameMatch[2].trim();
        // NEW: Find the entity by name to get its ID
        const entity = await prisma.entity.findFirst({
          where: { userId: userId, name: entityName },
        });

        if (entity) {
          console.log(`[ChatService] Found entity ID for ${entityName}: ${entity.id}`);
          const relationships = await graphService.getRelationships(userId, entity.id); // Pass entity.id
          
          if (relationships.length > 0) {
            graphContext = `
Knowledge Graph Relationships for "${entityName}":\n` +
              relationships.map(link => {
                const subject = link.subjectEntity?.name || 'Unknown';
                const object = link.objectEntity?.name || 'Unknown';
                const source = link.memory?.content || link.chatMessage?.content || 'Unknown Source';
                return `- ${subject} ${link.role} ${object} (Source: ${source.substring(0, 50)}...)`;
              }).join('\n') + '\n';
            console.log('[ChatService] Injected graph context.');
          } else {
            console.log('[ChatService] No direct graph relationships found for this entity.');
          }
        } else {
          console.log(`[ChatService] Entity "${entityName}" not found in graph.`);
        }
    }
    }

    // 3. Construct the prompt
    const historyText = history.map(m => `${m.role}: ${m.content}`).join('\n');
    const currentDate = new Date().toUTCString();

    const systemPrompt = `You are a helpful assistant whose primary goal is to answer questions based *only* on the provided context. If the answer is not in the context, state that you don't know.
Your answers must be formatted in MDX.
When you mention a date, wrap it in a <DateHighlight>component</DateHighlight>. Example: <DateHighlight>2025-10-15</DateHighlight>.
When you reference a specific memory from the context provided, wrap the key insight in a <MemoryHighlight>component</MemoryHighlight>. Example: <MemoryHighlight>the user prefers coffee in the morning</MemoryHighlight>.
When you use a memory from the "Relevant Memories" context to construct your answer, you MUST cite it at the end of the sentence by using a <Source /> component with the corresponding ID. Example: The user enjoys coffee in the morning.<Source id="memory-uuid-123" />
Keep your answers concise and clear.

Here is the current context for the user:
- Current Date/Time: ${currentDate}
- User Location: [Location not provided]

Use this context to provide more relevant and personalized answers.`;

    const userPrompt = `Here is the relevant context you should use to answer the question:
${graphContext}
Relevant Memories:
${contextString}

Chat History:
${historyText}

User's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    console.log(`[ChatService] Constructed prompt for LLM.`);

    // 4. Get the stream from the LLM service
    const llmStream = await llmService.generateCompletionStream(prompt);
    console.log('[ChatService] Received stream from LLM service.');

    // 5. Use a TransformStream to save the full response while streaming
    let fullResponse = '';
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        // Extract content from the Ollama stream format
        try {
          const json = JSON.parse(text);
          if (json.response) {
            fullResponse += json.response;
          }
        } catch (e) {
          // In case of malformed JSON, just append the raw text
          fullResponse += text;
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        // When the stream is done, save the assistant's message
        await prisma.chatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: fullResponse,
          },
        });
        console.log(`[ChatService] Saved assistant response for chat ${chatId}.\n---\n${fullResponse}\n---`);
      }
    });

    return llmStream.pipeThrough(transformStream);
  }
}

export const chatService = new ChatService();