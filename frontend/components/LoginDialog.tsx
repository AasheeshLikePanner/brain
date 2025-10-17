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
import Image from "next/image";
import { useAuth } from "@/lib/authContext"; // Re-import useAuth

export function LoginDialog() {
  const { isAuthenticated, login, logout, isLoading } = useAuth();

  if (isLoading) {
    return null; // Or a loading spinner
  }

  if (isAuthenticated) {
    return (
      <Button
        className="btn-cta cursor-pointer rounded-full border-none text-white hover:opacity-90"
        onClick={logout}
      >
        Logout
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="btn-cta cursor-pointer rounded-full border-none text-white hover:opacity-90">
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
            className="w-full h-12 rounded-lg justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer"
            onClick={login} // Call login function on click
          >
            <Image src="/login/google.svg" alt="Google" width={14} height={14} className="mr-2" />
            Sign in with Google
          </Button>
          <Button className="w-full h-12 rounded-lg justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
            <Image src="/login/github.svg" alt="GitHub" width={14} height={14} className="mr-2" />
            Sign in with GitHub
          </Button>
          <Button className="w-full h-12 rounded-lg justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
            <Image src="/login/microsoft.svg" alt="Microsoft" width={14} height={14} className="mr-2" />
            Sign in with Microsoft
          </Button>
          <Button className="w-full h-12 rounded-lg justify-start items-center shadow-sm bg-input text-gray-300 hover:bg-card hover:text-white cursor-pointer">
            <Image src="/login/x.svg" alt="X" width={14} height={14} className="mr-2" />
            Sign in with X
          </Button>
        </div>
        </DialogContent>
    </Dialog>
  );
}
