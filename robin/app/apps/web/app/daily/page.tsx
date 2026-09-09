import { redirect } from 'next/navigation';

/** Legacy /daily (session archive) → the Activity ledger's Sessions lens. */
export default function DailyRedirect(): never {
  redirect('/activity?lens=sessions');
}
