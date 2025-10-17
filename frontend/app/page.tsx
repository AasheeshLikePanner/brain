import { ChatInput } from '@/components/ChatInput';
import { LoginDialog } from '@/components/LoginDialog';

export default function Home() {
  return (
    <div className="relative flex flex-col h-screen bg-background text-foreground justify-center">
      <div className="absolute top-4 right-4">
        <LoginDialog />
      </div>
      <div className="px-4 pb-10 flex flex-col items-center">
        <ChatInput />
      </div>
    </div>
  );
}