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

const GRAPH_API_URL = 'http://localhost:8080/api/graph';

export async function getGraphEntities(type?: string): Promise<any[]> {
  const params = type ? `?type=${type}` : '';
  const response = await fetch(`${GRAPH_API_URL}/entities${params}`);
  if (!response.ok) throw new Error('Failed to fetch entities');
  return response.json();
}

export async function getGraphRelationships(entityName: string, relationshipType?: string): Promise<any[]> {
  const params = relationshipType ? `?relationshipType=${relationshipType}` : '';
  const response = await fetch(`${GRAPH_API_URL}/relationships/${entityName}${params}`);
  if (!response.ok) throw new Error('Failed to fetch relationships');
  return response.json();
}