import { redirect } from 'next/navigation';

/** Legacy /edits → the unified Activity ledger (default lens). */
export default function EditsRedirect(): never {
  redirect('/activity');
}
