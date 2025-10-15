'use client';

import { useState, useEffect } from 'react';

export function SplashScreen() {
  // const [progress, setProgress] = useState(0);
  // const [visible, setVisible] = useState(true);

  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     setProgress((prev) => {
  //       if (prev >= 100) {
  //         clearInterval(interval);
  //         setTimeout(() => setVisible(false), 500);
  //         return 100;
  //       }
  //       return prev + 1;
  //     });
  //   }, 30);

  //   return () => clearInterval(interval);
  // }, []);

  // if (!visible) return null;

  return null;

  // return (
  //   <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-white">
  //     <div className="text-6xl mb-4"></div>
  //     <div className="w-48 h-1 bg-gray-700 rounded-full overflow-hidden">
  //       <div
  //         className="h-full bg-white transition-all duration-150"
  //         style={{ width: `${progress}%` }}
  //       ></div>
  //     </div>
  //     <p className="mt-4 text-sm text-gray-400">Loading...</p>
  //   </div>
  // );
}
