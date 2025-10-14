'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Button } from "@/components/ui/button";
import { Mic, ArrowUpIcon, MicOff } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { MdxRenderer } from '@/components/MdxRenderer'; // Adjust path if needed

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// NEW: Define a type for the location state
interface Location {
  latitude: number;
  longitude: number;
}

// Helper to format time from seconds to MM:SS
const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

export default function ChatPage({ params }: { params: { chatId: string } }) {
  const { chatId } = params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState(''); // Renamed from input to message
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // NEW: State to store the user's location
  const [location, setLocation] = useState<Location | null>(null);

  // Timer useEffect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      setSeconds(0); // Reset timer on new recording
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      clearInterval(interval);
    };
  }, [isRecording]);

  // MODIFIED: useEffect to fetch history and now also get 
  // location
  useEffect(() => {
    // Fetch initial chat history
    const fetchHistory = async () => {
      try {
        const response = await axios.get(
          `http://localhost:8080/api/chat/${chatId}`);
        setMessages(response.data);
      } catch (error) {
        console.error('Error fetching chat history:', error);
      }
    };
    fetchHistory();

    // NEW: Get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          console.log('Location obtained:', position.coords);
        },
        (error) => {
          console.error("Error getting location: ", error);
          // Handle cases where the user denies permission
        }
      );
    }
  }, [chatId]); // This effect runs once when the chat page
  // loads

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault(); // Prevent default form submission
    if (!message.trim()) return; // Use message state

    console.log("Sending message:", message);
    setIsLoading(true); // Set loading to true

    try {
      // 1. Optimistic UI update
      const userMessage: Message = { role: 'user', content: message };
      setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }]);
      setMessage(''); // Clear message input

      // 2. Fetch the streaming response
      // MODIFIED: The fetch request now includes the 
      // location
      const response = await fetch(
        `http://localhost:8080/api/chat/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message,
            location: location // Send the location object
          }),
        });

      if (!response.body) {
        console.error("Response body is null");
        return;
      }
      console.log("Received response body.");

      // 3. Decode and process the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream finished.");
          break;
        }

        console.log("Raw stream chunk (value):", value);
        buffer += decoder.decode(value, { stream: true });
        console.log("Decoded buffer after append:", buffer);

        // The backend stream sends JSON objects separated by 
        // newlines
        const parts = buffer.split('\n');
        console.log("Buffer split into parts:", parts);

        // Process all complete JSON parts
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (part) {
            console.log("Processing part:", part);
            try {
              const json = JSON.parse(part);
              console.log("Parsed JSON:", json);
              if (json.response) {
                console.log("Appending response chunk:", json.response);
                // Append the new chunk to the last message 
                // (the assistant's)
                setMessages(prev => {
                  const lastMessage = prev[prev.length - 1];
                  const updatedContent = lastMessage.content + json.response;
                  const updatedLastMessage = { ...lastMessage, content: updatedContent };
                  return [...prev.slice(0, -1), updatedLastMessage];
                });
              }
            } catch (e) {
              console.error("Error parsing stream part:", part, e);
            }
          }
        }

        // Keep the last, possibly incomplete, part in the 
        // buffer
        buffer = parts[parts.length - 1];
        console.log("Remaining buffer:", buffer);
      }
    } finally {
      setIsLoading(false); // Reset loading state
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Main content area for messages */}
      <div className="flex-1 overflow-y-auto relative flex flex-col items-center py-2 pb-[120px]">
        <div className="w-1/2 flex flex-col space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`p-2 rounded-lg ${m.role === 'user' ? 'bg-[#141414] text-white max-w-[70%]' : 'w-full text-left'}`}
              >
                {m.role === 'assistant' ? (
                  <MdxRenderer source={m.content} />
                ) : (
                  <span>{m.content}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky input area */}
      <div className="fixed bottom-0 left-0 right-0 bg-background p-4 flex justify-center">
        <form
          onSubmit={handleSendMessage}
          className={`w-1/2 rounded-2xl border-2 border-border bg-muted relative overflow-hidden transition-[min-height] duration-500 ease-in-out ${
            isRecording ? "min-h-[150px]" : "min-h-[80px]"
          }`}
        >
          <div
            className={`absolute inset-0 z-0 bg-[linear-gradient(to_bottom_right,_#8B5CF6,_#3B82F6,_#10B981,_#F59E0B)] blur-2xl animate-[fluid-gradient_15s_ease-in-out_infinite] [background-size:400%_400%] transition-opacity duration-1000 ease-in-out ${
              isRecording ? "opacity-75" : "opacity-0"
            }`}
          />

          <div className="relative z-10 flex flex-col h-full">
            <div className="w-full p-2 flex-1 relative">
              {/* Timer, always rendered, opacity controlled */}
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-full gap-2 transition-opacity duration-300 ${
                  isRecording ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="font-mono text-lg text-foreground/75 font-semibold [text-shadow:0_0_8px_rgba(255,255,255,0.5)]">
                  {formatTime(seconds)}
                </span>
              </div>

              {/* Textarea, always rendered, opacity controlled */}
              <div
                className={`transition-opacity duration-300 ${
                  !isRecording ? "opacity-100" : "opacity-0"
                }`}
              >
                <TextareaAutosize
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  placeholder="Ask anything..."
                  className="w-full resize-none bg-transparent focus:outline-none text-base"
                  minRows={1}
                  maxRows={10}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 mt-auto">
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={`rounded-full h-8 w-8 cursor-pointer ${
                    isRecording ? "bg-red-500/10 text-red-500" : "bg-white/10"
                  }`}
                  onClick={() => setIsRecording(!isRecording)}
                >
                  {isRecording ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  <span className="sr-only">
                    {isRecording ? "Stop Recording" : "Use Microphone"}
                  </span>
                </Button>
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  className="rounded-full h-8 w-8 bg-white/10 cursor-pointer"
                  disabled={isLoading} // Disable when loading
                >
                  {isLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent border-white"></div> // Spinner
                  ) : (
                    <ArrowUpIcon className="h-4 w-4" />
                  )}
                  <span className="sr-only">Send</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}