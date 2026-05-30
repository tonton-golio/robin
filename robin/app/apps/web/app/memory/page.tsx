import React from 'react';
import type { Metadata } from 'next';
import { MemoryExplorer } from '@/components/MemoryExplorer';

export const metadata: Metadata = {
  title: 'Memory — Robin',
};

export default function MemoryPage(): React.ReactElement {
  return <MemoryExplorer />;
}
