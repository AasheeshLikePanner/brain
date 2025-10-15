import { ChatInput } from '@/components/ChatInput';

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground justify-center">
      <div className="px-4 pb-10 flex flex-col items-center">
        <ChatInput />
      </div>
    </div>
  );
}