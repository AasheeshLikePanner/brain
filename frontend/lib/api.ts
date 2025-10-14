import axios from 'axios';

// This would be in /lib/api.ts
export async function createChat(message: string): Promise<{ id: string }> {
  try {
    const response = await axios.post('http://localhost:8080/api/chat', {
      message,
    });
    return response.data;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw new Error('Failed to create chat');
  }
}
