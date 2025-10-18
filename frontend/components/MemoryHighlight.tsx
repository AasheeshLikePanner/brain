import React, { useState } from 'react';

interface MemoryHighlightProps {
  content: string;
  sourceId: string;
}

export const MemoryHighlight = ({ content, sourceId }: MemoryHighlightProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClick = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className="memory-highlight p-4 rounded-[5px] border border-yellow-700 bg-yellow-900 shadow-lg block text-yellow-100 cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs font-semibold leading-none flex-shrink-0">Memory Context</p>
        <svg
          className={`w-4 h-4 transition-transform duration-300 flex-shrink-0 pt-[1px] ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          ></path>
        </svg>
      </div>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[9999px]' : 'max-h-0'}`}
      >
        {content}
      </div>
    </div>
  );
};