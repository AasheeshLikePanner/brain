class LLMService {
  private ollamaUrl: string;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      console.log(`[LLMService] Simulating embedding creation for text: "${text.substring(0, 50)}..."`);
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network delay
      const dummyEmbedding = Array(768).fill(0.123); // Return a dummy embedding
      console.log('[LLMService] Successfully simulated embedding creation.');
      return dummyEmbedding;
    } catch (error) {
      console.error('Error simulating embedding creation:', error);
      throw error;
    }
  }
  
  async generateCompletion(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          prompt,
          stream: false, // We want the full response at once
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Error generating completion:', error);
      throw error;
    }
  }

  async generateCompletionStream(prompt: string): Promise<ReadableStream<Uint8Array>> {
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
      throw error;
    }
  }
}

export const llmService = new LLMService();