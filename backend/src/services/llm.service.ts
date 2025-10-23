import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 5 });

class LLMService {
  private ollamaUrl: string;
  private groqUrl: string;
  private groqApiKey: string;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    if (!this.groqApiKey) {
      console.warn('[LLMService] WARNING: GROQ_API_KEY is not set. User-facing chat will fail.');
    }
  }

  // EMBEDDING (Ollama) - Stays the same
  async createEmbedding(text: string): Promise<number[]> {
    return queue.add(async () => {
      console.time('llmService.createEmbedding');
      try {
        console.log(`[LLMService] Creating embedding for text: "${text.substring(0, 50)}..."`);
        const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'nomic-embed-text',
            prompt: text,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log('[LLMService] Successfully created embedding.');
        console.timeEnd('llmService.createEmbedding');
        return data.embedding;
      } catch (error) {
        console.error('Error creating embedding:', error);
        console.timeEnd('llmService.createEmbedding');
        throw error;
      }
    });
  }
  
  // NON-STREAMING COMPLETION (Ollama) - Reverted to local model
  async generateCompletion(prompt: string): Promise<string> {
    return queue.add(async () => {
      console.time('llmService.generateCompletion');
      try {
        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen2.5:1.5b', // Using qwen model as requested
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
