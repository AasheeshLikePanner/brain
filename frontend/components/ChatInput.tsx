'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Mic, ArrowUpIcon, MicOff } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import { createChat } from '@/lib/api';
import { toast } from 'sonner';

// Helper to format time from seconds to MM:SS
const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

export function ChatInput() {
  const [message, setMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsLoading(true);
    try {
      const newChat = await createChat(message);
      toast.success('Chat created successfully!');
      router.push(`/chat/${newChat.id}`);
    } catch (error) {
      console.error('Error creating chat:', error);
      toast.error('Error creating chat. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`w-full max-w-2xl rounded-2xl border-2 border-border bg-card shadow-xl shadow-black/5 relative overflow-hidden transition-[min-height] duration-500 ease-in-out ${
        isRecording ? 'min-h-[220px]' : 'min-h-[120px]'
      }`}>
      <div
        className={`absolute inset-0 z-0 bg-[linear-gradient(to_bottom_right,_#A78BFA,_#3B82F6,_#10B981,_#F59E0B)] blur-2xl animate-[fluid-gradient_15s_ease-in-out_infinite] [background-size:400%_400%] transition-opacity duration-1000 ease-in-out ${
          isRecording ? 'opacity-75' : 'opacity-0'
        }`}/>

      <div className="relative z-10 flex flex-col h-full">
        {/* Main content area - this takes up all space except the bottom controls */}
        <div className="w-full p-4 flex-1 relative">
          {/* Timer - centered in the entire content area */}
          <div
            className={`absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-300 ${
              isRecording ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-25"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="font-mono text-lg text-foreground/75 font-semibold [text-shadow:0_0_8px_rgba(255,255,255,0.5)]">
              {formatTime(seconds)}
            </span>
          </div>

          {/* Textarea - shown when not recording */}
          <div className={`transition-opacity duration-300 ${isRecording ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <TextareaAutosize
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask anything..."
              className="w-full resize-none bg-transparent focus:outline-none text-base"
              minRows={1}
              maxRows={10}
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Bottom controls - fixed height */}
        <div className="flex items-center gap-2 p-2.5">
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={`rounded-full h-8 w-8 cursor-pointer shadow-sm ${
                isRecording
                  ? 'bg-gradient-to-br from-red-500/20 to-red-700/20 text-red-500'
                  : 'bg-gradient-to-br from-white/10 to-white/5 text-white'
              }`}
              onClick={() => setIsRecording(!isRecording)}
              disabled={isLoading}
            >
              {isRecording ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              <span className="sr-only">
                {isRecording ? 'Stop Recording' : 'Use Microphone'}
              </span>
            </Button>
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="rounded-full h-8 w-8 bg-gradient-to-br from-white/10 to-white/5 text-white shadow-sm cursor-pointer"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <ArrowUpIcon className="h-4 w-4" />
              )}
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}