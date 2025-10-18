'use client'
import { useState, useCallback } from 'react';
import { ChatInput } from '@/components/ChatInput';
import { LoginDialog } from '@/components/LoginDialog';
import { ProactiveAlerts } from '@/components/ProactiveAlerts';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

export default function Home() {
  const [replyContext, setReplyContext] = useState<string | null>(null);

  const clearReplyContext = useCallback(() => {
    setReplyContext(null);
  }, []);

  return (
    <div className="relative flex flex-col h-screen text-foreground justify-center">
      <div className="absolute top-4 right-4">
        <LoginDialog />
      </div>
      <div className="px-4 pb-10 flex flex-col items-center">
        <ProactiveAlerts onReplySelected={setReplyContext} />

        {replyContext && (
          <div className="w-full max-w-2xl p-3 bg-card rounded-t-2xl shadow-md text-left flex items-center justify-between">
            <p className="flex-grow mr-2 text-sm text-muted-foreground truncate whitespace-nowrap">
              Replying to: <span className="font-medium text-foreground">{replyContext}</span>
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={clearReplyContext}
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Remove reply context</span>
            </Button>
          </div>
        )}

        <ChatInput isReplying={!!replyContext} />
      </div>
    </div>
  );
}