"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mic, ArrowUpIcon, MicOff } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { createChat } from "@/lib/api";

// Helper to format time from seconds to MM:SS
const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

export default function Home() {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
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

    try {
      // 1. Create the new chat session and get its ID
      const newChat = await createChat(message);

      // 2. Redirect to the new chat's page
      router.push(`/chat/${newChat.id}`);
    } catch (error) {
      console.error("Error creating chat:", error);
      // You could show an error message to the user here
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground justify-center">
      <div className="px-4 pb-10 flex flex-col items-center">
        <form
          onSubmit={handleSubmit}
          className={`w-full max-w-2xl rounded-2xl border-2 border-border bg-muted relative overflow-hidden transition-[min-height] duration-500 ease-in-out ${
            isRecording ? "min-h-[220px]" : "min-h-[120px]"
          }`}
        >
          <div
            className={`absolute inset-0 z-0 bg-[linear-gradient(to_bottom_right,_#8B5CF6,_#3B82F6,_#10B981,_#F59E0B)] blur-2xl animate-[fluid-gradient_15s_ease-in-out_infinite] [background-size:400%_400%] transition-opacity duration-1000 ease-in-out ${
              isRecording ? "opacity-75" : "opacity-0"
            }`}
          />

          <div className="relative z-10 flex flex-col h-full">
            <div className="w-full p-4 flex-1 relative">
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
              <div>
                <TextareaAutosize
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
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
                >
                  <ArrowUpIcon className="h-4 w-4" />
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
