import { v4 as uuidv4 } from 'uuid';
import prisma from '../db';
import { llmService } from './llm.service';
import { memoryService } from './memory.service';
import { graphService } from './graph.service'; // NEW
import { memoryIndexService } from './memory-index.service';
import { Chat } from '@prisma/client';
import { memoryQueue } from '../queues/memory.queue';
import { ReasoningService } from './reasoning.service';
import { queryAnalyzerService, QueryAnalysis } from './query-analyzer.service';
import { smartCacheService } from './smart-cache.service';
import { metricsService } from '././metrics.service';
import { instantResponseService } from './instant-response.service'; // NEW

class ChatService {
  private reasoningService: ReasoningService;

  constructor() {
    this.reasoningService = new ReasoningService();
  }

  async createChatSession(userId: string, title: string): Promise<Chat> {
    const chat = await prisma.chat.create({
      data: {
        userId,
        title: title.substring(0, 50),
      }
    });
    return chat;
  }

  async streamChatResponse(
    chatId: string,
    userId: string,
    message: string
  ): Promise<ReadableStream<Uint8Array>> {
    const startTime = Date.now();
    console.log('[ChatService] Starting streamChatResponse');
    const streamId = uuidv4(); // Unique ID for this stream

    // Save user message immediately
    const userMsg = await prisma.chatMessage.create({
      data: { chatId, role: 'user', content: message }
    });
    
    // Create assistant message placeholder
    const assistantMsg = await prisma.chatMessage.create({
      data: { 
        chatId, 
        role: 'assistant', 
        content: '', // Empty initially
        metadata: { 
          streamId, 
          status: 'streaming',
          startedAt: new Date().toISOString()
        }
      }
    });

    // Step 1: Save user message and analyze query in parallel
    const saveMessagePromise = Promise.resolve(userMsg); // User message already saved
    const queryAnalysis = queryAnalyzerService.analyzeQuery(message);

    const queryAnalysisResult = queryAnalysis;
    console.log('[ChatService] Query analysis:', queryAnalysisResult);

    // Step 2: Decide on the response strategy based on query analysis
    if (queryAnalysisResult.isFactual && queryAnalysisResult.confidence > 0.8) {
      console.log('[ChatService] Attempting instant response for factual query.');
      const instantResponse = await instantResponseService.tryInstantResponse(
        userId,
        message
      );

      if (instantResponse) {
        console.log('[ChatService] Instant response found:', instantResponse);
        await saveMessagePromise; // Ensure user message is saved
        await prisma.chatMessage.create({
          data: { chatId, role: 'assistant', content: instantResponse },
        });
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(instantResponse));
            controller.close();
          },
        });
      }
    }

    // Step 3: Fetch relevant data in parallel (if not handled by instant response)
    const [_, history, relevantMemories] = await Promise.all([
      saveMessagePromise,
      this.getChatHistory(chatId, userId, 5),
      memoryIndexService.searchMemories(
        userId,
        message,
        queryAnalysisResult.isComplex ? 15 : 7, // Fetch more memories for complex queries
        queryAnalysisResult.entities
      ),
    ]);

    // Step 3: Get memory details
    const memoryDetails = await prisma.memory.findMany({
      where: { id: { in: relevantMemories.map((m: any) => m.id) } },
      select: {
        id: true,
        content: true,
        type: true,
        metadata: true,
        recordedAt: true,
        confidenceScore: true
      }
    });

    // Step 4: Perform advanced reasoning only for complex queries
    let implications: any[] = [];
    let graphInsights: { reasoning: string } = { reasoning: '' };

    if (queryAnalysis.isComplex) {
      console.log('[ChatService] Performing advanced reasoning for complex query.');
      const [implicationsResult, graphInsightsResult] = await Promise.all([
        this.reasoningService.detectImplications(userId, memoryDetails, message),
        queryAnalysis.needsGraph
          ? this.reasoningService.graphReasoning(userId, message)
          : Promise.resolve({ reasoning: '' }),
      ]);
      implications = implicationsResult;
      graphInsights = graphInsightsResult;
    } else {
      console.log('[ChatService] Skipping advanced reasoning for simple query.');
    }

    // Step 5: Build context for the LLM
    const contextString = memoryDetails
      .map((mem: any) => `[id: ${mem.id}] ${mem.content}`)
      .join('\n---\n');

    let reasoningContext = '';
    if (implications.length > 0) {
      reasoningContext += '\n\n**Insights from your memories:**\n';
      implications.forEach(imp => {
        reasoningContext += `- ${imp.content}\n`;
      });
    }
    if (graphInsights.reasoning) {
      reasoningContext += `\n\n**Connections from your knowledge graph:**\n${graphInsights.reasoning}`;
    }

    // Step 6: Generate the prompt
    const currentDate = new Date().toUTCString();
    const historyText = history.map((m: any) => `${m.role}: ${m.content}`).join('\n');

    const systemPrompt = `You are a helpful assistant with access to the user's personal knowledge base and reasoning capabilities.
      Your analysis of the user's query is: ${JSON.stringify(queryAnalysis)}
      ${reasoningContext ? `You have analyzed the context and identified some insights:${reasoningContext}` : ''}
      When responding:
      1. Use the provided insights to give more helpful, proactive answers
      2. If implications suggest actions, offer them naturally
      3. If there are connections the user might not have considered, mention them
      4. Always cite sources using <Source id="..." />

      Your answers must be formatted in MDX.
      When you mention a date, wrap it in <DateHighlight>component</DateHighlight>.
      When you reference a memory, wrap key insights in <MemoryHighlight>component</MemoryHighlight>.
      When you use information from memories, cite with <Source id="memory-id" />.

      Current context:
      - Current Date/Time: ${currentDate}
      - User Location: [Location not provided]`;

    const userPrompt = `Here is the relevant context, including memories from our past conversations, that you should use to answer the question:
    Relevant Memories:
    ${contextString}
    Chat History:
    ${historyText}
    User's Question: ${message}`;

    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    // Step 7: Stream the response from the LLM
    const llmStream = await llmService.generateCompletionStream(systemPrompt, userPrompt);
    
    let fullResponseText = '';
    let lastSavedLength = 0;
    let saveTimer: NodeJS.Timeout | null = null;

    // Helper: Progressive saving
    const saveProgress = async (force = false) => {
      if (!force && fullResponseText.length - lastSavedLength < 100) {
        return; // Don't save too frequently
      }
      
      try {
        await prisma.chatMessage.update({
          where: { id: assistantMsg.id },
          data: { 
            content: fullResponseText,
            metadata: {
              streamId, 
              status: 'streaming',
              lastUpdatedAt: new Date().toISOString()
            }
          }
        });
        lastSavedLength = fullResponseText.length;
        console.log(`[Stream ${streamId}] Progress saved: ${lastSavedLength} chars`);
      } catch (error) {
        console.error(`[Stream ${streamId}] Failed to save progress:`, error);
        // Don't throw - continue streaming
      }
    };

    const transformStream = new TransformStream({
      start(controller) {
        // Set up periodic saving
        saveTimer = setInterval(() => saveProgress(), 5000); // Save every 5s
      },
      
      transform(chunk, controller) {
        try {
          const jsonString = new TextDecoder().decode(chunk);
          const dataLines = jsonString
            .split('\n')
            .filter(line => line.startsWith('data: '));

          for (const line of dataLines) {
            const jsonStr = line.substring(6); // Remove 'data: '
            if (jsonStr.trim() === '[DONE]') {
              continue;
            }
            
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices[0]?.delta?.content;
              if (delta) {
                fullResponseText += delta;
              }
            } catch (e) {
              console.warn(`[Stream ${streamId}] Could not parse chunk:`, jsonStr);
            }
          }
          
          controller.enqueue(chunk);
        } catch (error) {
          console.error(`[Stream ${streamId}] Transform error:`, error);
          controller.error(error);
        }
      },
      
      async flush(controller) {
        // Clear periodic saving
        if (saveTimer) {
          clearInterval(saveTimer);
        }
        
        console.log(`[Stream ${streamId}] Stream completed. Finalizing...`);
        
        try {
          // Final save with complete status
          await prisma.chatMessage.update({
            where: { id: assistantMsg.id },
            data: { 
              content: fullResponseText,
              metadata: {
                streamId,
                status: 'completed',
                completedAt: new Date().toISOString(),
                duration: Date.now() - startTime
              }
            }
          });
          
          console.log(`[Stream ${streamId}] Response saved successfully`);
          
          // Queue memory extraction (fire and forget with error handling)
          memoryQueue.add('extract', {
            userId,
            chatId,
            userMessage: message,
            assistantMessage: fullResponseText,
            streamId
          }).catch(error => {
            console.error(`[Stream ${streamId}] Failed to queue memory extraction:`, error);
            // Could add to dead letter queue here
          });
          
        } catch (error) {
          console.error(`[Stream ${streamId}] Failed to finalize:`, error);
          
          // Mark as failed but keep content
          await prisma.chatMessage.update({
            where: { id: assistantMsg.id },
            data: {
              content: fullResponseText,
              metadata: {
                streamId,
                status: 'failed',
                error: (error as Error).message,
                failedAt: new Date().toISOString()
              }
            }
          }).catch(e => {
            console.error(`[Stream ${streamId}] Critical: Could not save failed state:`, e);
          });
        }
      }
    });
    
    try {
      const finalStream = llmStream.pipeThrough(transformStream);

      // Return the final stream
      return finalStream;
    } catch (error) {
      console.error(`[Stream ${streamId}] Stream error:`, error);
      
      // Try to save what we have
      if (fullResponseText) {
        prisma.chatMessage.update({
          where: { id: assistantMsg.id },
          data: {
            content: fullResponseText + '\n\n[Stream interrupted]',
            metadata: {
              streamId,
              status: 'interrupted',
              error: (error as Error).message
            }
          }
        }).catch(e => console.error('Failed to save interrupted stream:', e));
      }
      
      throw error;
    }
  }

  public async getChatHistory(chatId: string, userId: string, limit: number = 3) {
    console.time('chatService.getChatHistory');
    const history = await prisma.chatMessage.findMany({
      where: { chatId, chat: { userId } },
      select: { role: true, content: true },
      orderBy: { createdAt: 'desc' },
      take:limit
    });
    console.timeEnd('chatService.getChatHistory');
    return history.reverse(); // Chronological order
  }

}

export const chatService = new ChatService();
