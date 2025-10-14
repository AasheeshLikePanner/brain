import React from 'react';

export const DateHighlight = ({ children }: { children: React.ReactNode }) => {
  return <strong className="date-highlight">{children}</strong>;
};