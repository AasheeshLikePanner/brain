import axios from 'axios';
// import { useBetterAuth } from '@better-auth/core'; // Placeholder for better-auth hook

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080/api';

// Configure Axios to include token automatically
axios.interceptors.request.use(config => {
  // Placeholder for getting token from better-auth
  // const { token } = useBetterAuth(); // This won't work directly in a non-React context
  const token = localStorage.getItem('jwt_token'); // Fallback to localStorage for now

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, error => {
  return Promise.reject(error);
});

axios.interceptors.response.use(response => response, error => {
  if (error.response && error.response.status === 401) {
    // Placeholder for better-auth logout
    // const { logout } = useBetterAuth();
    // logout();
    localStorage.removeItem('jwt_token'); // Fallback to localStorage for now
    localStorage.removeItem('user_data'); // Fallback to localStorage for now
    window.location.href = '/'; // Redirect to home or login page
  }
  return Promise.reject(error);
});

export async function createChat(message: string): Promise<{ id: string }> {
  try {
    const response = await axios.post(`${API_BASE_URL}/chat`, {
      message,
    });
    return response.data;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw new Error('Failed to create chat');
  }
}

const GRAPH_API_URL = `${API_BASE_URL}/graph`;

export async function getGraphEntities(type?: string): Promise<any[]> {
  const params = type ? `?type=${type}` : '';
  const response = await axios.get(`${GRAPH_API_URL}/entities${params}`);
  if (response.status !== 200) throw new Error('Failed to fetch entities');
  return response.data;
}

export async function getGraphRelationships(entityName: string, relationshipType?: string): Promise<any[]> {
  const params = relationshipType ? `?relationshipType=${relationshipType}` : '';
  const response = await axios.get(`${GRAPH_API_URL}/relationships/${entityName}${params}`);
  if (response.status !== 200) throw new Error('Failed to fetch relationships');
  return response.data;
}