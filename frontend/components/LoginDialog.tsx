"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import Image from "next/image";
import { useAuth } from "@/lib/authContext"; // Re-import useAuth

export function LoginDialog() {
  const { isAuthenticated, login, logout, isLoading, user } = useAuth();

  if (isLoading) {
    return null;
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-2 bg-background text-foreground">
      {isAuthenticated && (
        <div className="flex items-center">
          <Button className="rounded-full p-2 flex items-center justify-center bg-button-light ring-1 ring-border text-foreground hover-warm-gradient hover:scale-105 transition-transform duration-200 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </Button>
        </div>
      )}

      {!isAuthenticated ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button className="bg-button-light ring-1 ring-border text-foreground hover-warm-gradient hover:scale-105 transition-transform duration-200 cursor-pointer rounded-full">
              Sign In
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[380px]">
            <DialogHeader>
              <DialogTitle>Sign in to continue</DialogTitle>
              <DialogDescription>
                Save conversations and sync across devices
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Button
                className="w-full h-12 rounded-xl justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer"
                onClick={login} // Call login function on click
              >
                <Image src="/login/google.svg" alt="Google" width={14} height={14} className="mr-2" />
                Sign in with Google
              </Button>
              <Button className="w-full h-12 rounded-xl justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
                <Image src="/login/github.svg" alt="GitHub" width={14} height={14} className="mr-2" />
                Sign in with GitHub
              </Button>
              <Button className="w-full h-12 rounded-xl justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
                <Image src="/login/microsoft.svg" alt="Microsoft" width={14} height={14} className="mr-2" />
                Sign in with Microsoft
              </Button>
              <Button className="w-full h-12 rounded-xl justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
                <Image src="/login/x.svg" alt="X" width={14} height={14} className="mr-2" />
                Sign in with X
              </Button>            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <div className="flex items-center space-x-4">
          <Button className="rounded-full p-2 bg-button-light ring-1 ring-border text-foreground hover-warm-gradient hover:scale-105 transition-transform duration-200 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Button>
          {user?.avatarUrl && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Image
                  src={user.avatarUrl}
                  alt="User Avatar"
                  width={36}
                  height={36}
                  className="rounded-full cursor-pointer"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={logout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </header>
  );
}
