import type { Metadata } from 'next';
import '@/styles/page-inbox.css';
import { InboxView } from '@/components/inbox/InboxView';
import { loadInbox } from '@/lib/inbox/load';

export const metadata: Metadata = {
  title: 'Inbox — Robin',
  description:
    'Raw meeting and interview captures, safe recovery sources, and filed history.',
};

// Inbox mirrors live files and ingest receipts. A newly saved capture must be
// visible immediately, and a successful ingest must leave the action queue
// immediately, so this route cannot be statically cached.
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const data = await loadInbox();
  return <InboxView data={data} />;
}
