'use client';

import { useSearchParams, useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Button } from "@/components/ui/button";
import { Mic, ArrowUpIcon, MicOff, StarIcon, CopyIcon, Trash2Icon } from "lucide-react";
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

export default function ChatPage() {
  const searchParams = useSearchParams();
  const { chatId } = useParams() as { chatId: string };
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState(''); // Renamed from input to message
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // NEW: State to store the user's location
  const [location, setLocation] = useState<Location | null>(null);

  // NEW: Function to handle reinforcing memories
  const handleReinforce = async (content: string) => {
    console.log('Reinforcing memories for content...');

    // Use a regex to find all Source tags and extract their
    // IDs
    const sourceIdRegex = /<Source id="([^"]+)" \/>/g;
    const ids = [...content.matchAll(sourceIdRegex)].map(
      match => match[1]);

    if (ids.length === 0) {
      console.log('No source IDs found in this message.');
      return;
    }

    console.log(`Found ${ids.length} source IDs to 
      reinforce:`, ids);

    // Call the reinforce API for each ID
    for (const id of ids) {
      try {
        await fetch(`http://localhost:8080/api/memories/${id}/reinforce`, {
          method: 'POST',
        });
      } catch (error) {
        console.error(`Failed to reinforce memory ${id}`,
          error);
      }
    }
    // Optional: Add some visual feedback to the user
    alert(`Reinforced ${ids.length} memories!`);
  };

  // NEW: Function to handle soft-deleting (forgetting) memories
  const handleForget = async (content: string) => {
    console.log('Forgetting memories for content...');

    // Use the same regex to find all Source tags and extract their IDs
    const sourceIdRegex = /<Source id="([^"]+)" \/>/g;
    const ids = [...content.matchAll(sourceIdRegex)].map(
      match => match[1]);

    if (ids.length === 0) {
      console.log('No source IDs found in this message to forget.');
      return;
    }

    console.log(`Found ${ids.length} source IDs to forget:`, ids);

    // Call the DELETE API for each ID
    for (const id of ids) {
      try {
        await fetch(`http://localhost:8080/api/memories/${id}`, { // Note the DELETE method
          method: 'DELETE',
        });
      } catch (error) {
        console.error(`Failed to forget memory ${id}`,
          error);
      }
    }
    // Optional: Add some visual feedback to the user
    alert(`Forgot ${ids.length} memories! They will no longer be used.`);
  };

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

  const handleSendMessage = async (messageContent: string) => {
    if (!messageContent.trim()) return;

    console.log("Sending message:", messageContent);
    setIsLoading(true);

    try {
      // 1. Optimistic UI update
      const userMessage: Message = { role: 'user', content: messageContent };
      setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }]);
      setMessage(''); // Clear message input

      // 2. Fetch the streaming response
      const token = localStorage.getItem('jwt_token');
      const response = await fetch(
        `http://localhost:8080/api/chat/${chatId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          message: messageContent,
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

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (part) {
            try {
              const json = JSON.parse(part);
              if (json.response) {
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
        buffer = parts[parts.length - 1];
      }
    } finally {
      setIsLoading(false); // Reset loading state
    }
  };

  // MODIFIED: useEffect to fetch history and now also get 
  // location
  useEffect(() => {
    // Fetch initial chat history
    const fetchHistory = async () => {
      try {

        const token = localStorage.getItem('jwt_token');
        const response = await axios.get(`http://localhost:8080/api/chat/${chatId}`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
          },
        });
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

                className={`p-2 rounded-lg ${m.role === 'user' ? 'bg-[#222222] text-white max-w-[70%]' : 'w-full text-left'}`}

              >

                {m.role === 'assistant' ? (

                  <div className="flex flex-col">

                    <MdxRenderer source={m.content} />

                    {m.content && (

                      <div className="flex justify-start mt-2 space-x-2">

                        <Button

                          variant="ghost"

                          className="rounded-full h-8 w-8 bg-white/10 cursor-pointer"

                          onClick={() => handleReinforce(m.content)} title="Mark as important">

                          <StarIcon className="h-4 w-4" />

                          <span className="sr-only">Mark as important</span>

                        </Button>
                        {/* NEW: Add the Forget button */}
                        <Button
                          variant="ghost"
                          className="rounded-full h-8 w-8 bg-white/10 cursor-pointer"
                          onClick={() => handleForget(m.content)} title="Forget this memory">
                          <Trash2Icon className="h-4 w-4" />
                          <span className="sr-only">Forget this memory</span>
                        </Button>

                        <Button

                          variant="ghost"

                          className="rounded-full h-8 w-8 bg-white/10 cursor-pointer"

                          onClick={() => navigator.clipboard.writeText(m.content)} title="Copy message">

                          <CopyIcon className="h-4 w-4" />

                          <span className="sr-only">Copy message</span>

                        </Button>

                      </div>

                    )}

                  </div>

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

          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(message);
          }}

          className={`w-1/2 rounded-2xl border-2 border-border bg-muted relative overflow-hidden transition-[min-height] duration-500 ease-in-out ${isRecording ? "min-h-[150px]" : "min-h-[80px]"

            }`}

        >

          <div

            className={`absolute inset-0 z-0 bg-[linear-gradient(to_bottom_right,_#8B5CF6,_#3B82F6,_#10B981,_#F59E0B)] blur-2xl animate-[fluid-gradient_15s_ease-in-out_infinite] [background-size:400%_400%] transition-opacity duration-1000 ease-in-out ${isRecording ? "opacity-75" : "opacity-0"

              }`}

          />



          <div className="relative z-10 flex flex-col h-full">

            <div className="w-full p-2 flex-1 relative">

              {/* Timer, always rendered, opacity controlled */}

              <div

                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-full gap-2 transition-opacity duration-300 ${isRecording ? "opacity-100" : "opacity-0 pointer-events-none"

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

                className={`transition-opacity duration-300 ${!isRecording ? "opacity-100" : "opacity-0"

                  }`}

              >

                <TextareaAutosize

                  value={message}

                  onChange={(e) => setMessage(e.target.value)}

                  onKeyDown={(e) => {

                    if (e.key === 'Enter' && !e.shiftKey) {

                      e.preventDefault();

                      handleSendMessage(message);

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

                  className={`rounded-full h-8 w-8 cursor-pointer ${isRecording ? "bg-red-500/10 text-red-500" : "bg-white/10"

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