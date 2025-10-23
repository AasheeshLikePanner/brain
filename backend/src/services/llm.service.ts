import PQueue from 'p-queue';
import redis from 'queues/redis';

const queue = new PQueue({ concurrency: 5 });

class LLMService {
  private ollamaUrl: string;
  private groqUrl: string;
  private groqApiKey: string;
  private embeddingModel: string = 'nomic-embed-text'; // Default embedding model
  private completionModel: string = 'qwen2.5:1.5b'; // Default completion model

  private pendingEmbeddings = new Map<string, Promise<number[]>>();
  private pendingCompletions = new Map<string, Promise<string>>();

  private embeddingQueue: Array<{ text: string; resolve: (embedding: number[]) => void; reject: (error: Error) => void; }> = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    if (!this.groqApiKey) {
      console.warn('[LLMService] WARNING: GROQ_API_KEY is not set. User-facing chat will fail.');
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    const cached = await this.getEmbeddingFromCache(text);
    if (cached) {
      return cached;
    }

    const existing = this.pendingEmbeddings.get(text);
    if (existing) {
      console.log('[LLMService] Deduplicating embedding request');
      return existing;
    }

    const promise = new Promise<number[]>((resolve, reject) => {
      this.embeddingQueue.push({ text, resolve, reject });
      
      if (this.embeddingQueue.length >= 10) {
        this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), 10);
      }
    });

    this.pendingEmbeddings.set(text, promise);
    promise.finally(() => this.pendingEmbeddings.delete(text));
    return promise;
  }

  private async processBatch() {
    if (this.embeddingQueue.length === 0) return;
    
    const batch = this.embeddingQueue.splice(0, 32); // Ollama supports batch
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: batch.map(b => b.text)
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API batch embedding request failed with status ${response.status}`);
      }

      const data = await response.json();
      
      batch.forEach((item, index) => {
        const embedding = data.embeddings[index];
        this.cacheEmbedding(item.text, embedding);
        item.resolve(embedding);
      });
    } catch (error) {
      batch.forEach(item => item.reject(error as Error));
    }
  }

  private async getEmbeddingFromCache(text: string): Promise<number[] | null> {
    const cached = await redis.get(`embedding:${this.hashText(text)}`);
    return cached ? JSON.parse(cached) : null;
  }
  
  private async cacheEmbedding(text: string, embedding: number[]) {
    await redis.setex(
      `embedding:${this.hashText(text)}`,
      86400, // 24 hours
      JSON.stringify(embedding)
    );
  }
  
  private hashText(text: string): string {
    // Simple hash for cache key, can be more robust if needed
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString();
  }
  
  // NON-STREAMING COMPLETION (Ollama) - Reverted to local model
  async generateCompletion(prompt: string): Promise<string> {
    const existing = this.pendingCompletions.get(prompt);
    if (existing) {
      console.log('[LLMService] Deduplicating completion request');
      return existing;
    }

    const promise = queue.add(async () => {
      console.time('llmService.generateCompletion');
      try {
        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.completionModel, // Using qwen model as requested
            prompt,
            stream: false,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.timeEnd('llmService.generateCompletion');
        return data.response;
      } catch (error) {
        console.error('Error generating completion:', error);
        console.timeEnd('llmService.generateCompletion');
        throw error;
      }
    });

    this.pendingCompletions.set(prompt, promise);
    promise.finally(() => this.pendingCompletions.delete(prompt));
    return promise;
  }

  // STREAMING COMPLETION (Groq) - Stays on fast API
  async generateCompletionStream(systemPrompt: string, userPrompt: string): Promise<ReadableStream<Uint8Array>> {
    return queue.add(async () => {
      console.time('llmService.generateCompletionStream');
      console.log('[LLMService] Generating completion stream from Groq.');
      try {
        const response = await fetch(this.groqUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.groqApiKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Groq API request failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        return response.body;
      } catch (error) {
        console.error('Error generating completion stream:', error);
        console.timeEnd('llmService.generateCompletionStream');
        throw error;
      }
    });
  }
}

export const llmService = new LLMService();
