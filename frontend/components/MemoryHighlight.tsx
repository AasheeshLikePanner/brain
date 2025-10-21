import React from 'react';

interface MemoryHighlightProps {
  children: React.ReactNode;
}

export const MemoryHighlight = ({ children }: MemoryHighlightProps) => {
  return (
    <span className="bg-pink-900/30 text-pink-200 p-1 rounded">
      {children}
    </span>
  );
};
