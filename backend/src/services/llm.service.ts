import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1 }); // Limit concurrent LLM calls to Ollama

class LLMService {
  private ollamaUrl: string;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  }

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
            model: 'qwen2.5:1.5B',
            prompt,
            stream: false, // We want the full response at once
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

  async generateCompletionStream(prompt: string): Promise<ReadableStream<Uint8Array>> {
    return queue.add(async () => {
      console.time('llmService.generateCompletionStream');
      console.log('[LLMService] Generating completion stream from Ollama.');
      console.log(`[LLMService] Prompt: \n---\n${prompt}\n---`);
      try {
        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen2.5:1.5b',
            prompt,
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama API request failed with status ${response.status}`);
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