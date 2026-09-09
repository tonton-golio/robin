import 'server-only';

import { listMemories } from '@robin/memory';
import { listAnnotations } from '@/lib/annotation-store';
import { listOpenInterventions } from '@/lib/interventions';
import { locateVault } from '@/lib/vault';
import { assembleReviewSnapshot } from './assemble';
import type { ReviewSnapshot } from './model';

export function loadReviewSnapshot(): Promise<ReviewSnapshot> {
  const vault = Promise.resolve().then(() => locateVault());

  return assembleReviewSnapshot({
    loadInterventions: async () => listOpenInterventions(await vault),
    loadMemories: async () => listMemories(await vault, { status: ['tentative'] }),
    loadAnnotations: () => listAnnotations({ includeClosed: false }),
  });
}
