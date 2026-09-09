import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Inbox — Robin',
  description: 'Meeting and interview captures waiting for attention.',
};

/** Legacy entry point retained for bookmarks and command history. */
export default function CapturePage() {
  redirect('/inbox');
}
