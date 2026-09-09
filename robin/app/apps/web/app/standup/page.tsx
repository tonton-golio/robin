import { redirect } from 'next/navigation';

/** Legacy path — board lives at /tasks. */
export default function StandupRedirectPage() {
  redirect('/tasks');
}
