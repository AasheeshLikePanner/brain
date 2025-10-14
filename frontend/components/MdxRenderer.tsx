'use client';

import { useState, useEffect } from 'react';
import { MDXRemote, MDXRemoteProps, MDXRemoteSerializeResult } from 'next-mdx-remote';
import { serialize } from 'next-mdx-remote/serialize';
import { DateHighlight } from './DateHighlight';
import { MemoryHighlight } from './MemoryHighlight';

// Define the custom components that the MDX can use
const components = {
  DateHighlight,
  MemoryHighlight,
  p: (props: any) => <p {...props} className="mb-4" />,
  h1: (props: any) => <h1 {...props} className="text-3xl font-bold mb-4" />,
  h2: (props: any) => <h2 {...props} className="text-2xl font-bold mb-3" />,
  h3: (props: any) => <h3 {...props} className="text-xl font-bold mb-2" />,
  ul: (props: any) => <ul {...props} className="list-disc pl-5 mb-4" />,
  ol: (props: any) => <ol {...props} className="list-decimal pl-5 mb-4" />,
  li: (props: any) => <li {...props} className="mb-1" />,
  a: (props: any) => <a {...props} className="text-blue-400 hover:underline" />,
  pre: (props: any) => <pre {...props} className="bg-gray-900 p-3 rounded-md overflow-x-auto mb-4" />,
  code: (props: any) => <code {...props} className="bg-gray-700 px-1 rounded-sm text-sm" />,
  Code: (props: any) => <code {...props} className="bg-gray-700 px-1 rounded-sm text-sm" />,
};

interface MdxRendererProps {
  source: string;
}

export const MdxRenderer = ({ source }: MdxRendererProps) => {
  const [serializedSource, setSerializedSource] = useState<MDXRemoteSerializeResult | null>(null);

  useEffect(() => {
    if (source) {
      const serializeMdx = async () => {
        const result = await serialize(source, { scope: {}, mdxOptions: {} });
        setSerializedSource(result);
      };
      serializeMdx();
    } else {
      setSerializedSource(null);
    }
  }, [source]);

  if (!serializedSource) {
    return null;
  }

  return <MDXRemote {...serializedSource} components={components} />;
};