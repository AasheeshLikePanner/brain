import React from 'react';

export const MemoryHighlight = ({ children }: { children: React.ReactNode }) => {
  return <span className="memory-highlight p-4 rounded-3xl border border-border bg-card shadow-lg block">{children}</span>;
};