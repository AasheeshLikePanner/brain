import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080/api';

export async function getProactiveAlerts(): Promise<any[]> {
  try {
    const token = localStorage.getItem('jwt_token');
    const response = await axios.get(`${API_BASE_URL}/chat/proactive`,  {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching proactive alerts:', error);
    throw new Error('Failed to fetch proactive alerts');
  }
}
