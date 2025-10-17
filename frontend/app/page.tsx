import { ChatInput } from '@/components/ChatInput';
import { LoginDialog } from '@/components/LoginDialog'; // Use LoginDialog again

export default function Home() {
  return (
    <div className="relative flex flex-col h-screen text-foreground justify-center">
      <div className="absolute top-4 right-4">
        <LoginDialog /> {/* Use the LoginDialog */}
      </div>
      <div className="px-4 pb-10 flex flex-col items-center">
        <ChatInput />
      </div>
    </div>
  );
}