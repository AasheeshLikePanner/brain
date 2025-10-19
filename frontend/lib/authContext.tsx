'use client'
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@prisma/client'; // Assuming Prisma client types are available or define a similar User type
import axios from 'axios';

interface AuthContextType {
  user: Partial<User> | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080/api';
const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_BACKEND_URL_ORIGIN || 'http://localhost:8080';

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<Partial<User> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('jwt_token');
    const storedUser = localStorage.getItem('user_data');
    console.log(storedToken);
    
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          console.log('401 Unauthorized - Logging out...');
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

    const login = () => {
      const authWindow = window.open(`${API_BASE_URL}/auth/google`, '_blank', 'width=500,height=600');
  
      if (!authWindow) {
        console.error('Failed to open authentication window. Popup blocked?');
        return;
      }
  
      const messageListener = (event: MessageEvent) => {
        if (event.origin !== BACKEND_ORIGIN) {
          return;
        }
  
        const { token: receivedToken, user: receivedUser, message } = event.data;
  
        if (receivedToken && receivedUser) {
          localStorage.setItem('jwt_token', receivedToken);
          localStorage.setItem('user_data', JSON.stringify(receivedUser));
                  setToken(receivedToken);
                  setUser(receivedUser);
                  try {
                    authWindow?.close();
                  } catch (e) {
                    console.warn('Could not close auth window due to COOP policy:', e);
                  }
                  window.removeEventListener('message', messageListener);
                } else if (message === 'Authentication failed') {
                  try {
                    authWindow?.close();
                  } catch (e) {
                    console.warn('Could not close auth window due to COOP policy:', e);
                  }
                  window.removeEventListener('message', messageListener);        }
      };
  
      window.addEventListener('message', messageListener);
    };
const logout = () => {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('user_data');
  setToken(null);
  setUser(null);
  axios.get(`${API_BASE_URL}/auth/logout`).catch(console.error);
};

const isAuthenticated = !!user && !!token;

return (
  <AuthContext.Provider value={{
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
  }}>
    {children}
  </AuthContext.Provider>
);
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
