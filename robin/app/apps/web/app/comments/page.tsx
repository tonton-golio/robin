import { redirect } from 'next/navigation';

/** Legacy /comments → the Activity ledger's Comments lens. */
export default function CommentsRedirect(): never {
  redirect('/activity?lens=comments');
}
