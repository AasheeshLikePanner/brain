import React from 'react';

export const MemoryHighlight = ({ children }: { children: React.ReactNode }) => {
  return <span className="memory-highlight">{children}</span>;
};