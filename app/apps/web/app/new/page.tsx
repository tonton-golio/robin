import React from 'react';
import type { Metadata } from 'next';
import { NewPageClient } from './NewPageClient';

export const metadata: Metadata = {
  title: 'New page — Robin',
};

export default function NewPage() {
  return <NewPageClient />;
}
