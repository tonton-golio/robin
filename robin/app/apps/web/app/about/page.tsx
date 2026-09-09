import { permanentRedirect } from 'next/navigation';

// /about is retired — the "what Robin is" self-portrait is now the SYSTEM®
// footer of /health (BUILD-BRIEF §11 / health.md §8), corrected to drop the
// removed chat + force-directed graph. Permanent redirect keeps old links alive.
export default function AboutRedirect(): never {
  permanentRedirect('/health');
}
