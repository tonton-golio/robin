import type { EditEvent } from "@robin/vault-io";
import { readEditEvents } from "@/lib/edit-store";
import { normalizeVaultFilePath, statVaultFile } from "@/lib/vault-file";

const MAX_MOVE_HOPS = 16;
type MoveRecord = Pick<EditEvent, "event" | "page_path" | "previous_path"> &
  Partial<Pick<EditEvent, "ts">>;

function canonicalHtmlPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.endsWith(".html")) return null;
  const normalized = normalizeVaultFilePath(value);
  return normalized === value ? normalized : null;
}

/**
 * Follow valid move events to the first destination that is still servable.
 * The requested file itself always wins, and corrupt/cyclic chains resolve to null.
 */
export async function resolveMovedHtmlPathFromEvents(
  requestedPath: string,
  events: MoveRecord[],
  isServable: (relPath: string) => Promise<boolean>,
  maxHops = MAX_MOVE_HOPS,
): Promise<string | null> {
  const requested = canonicalHtmlPath(requestedPath);
  if (!requested || maxHops < 1) return null;
  if (await isServable(requested)) return null;

  const moves = new Map<string, { path: string; ts: string; index: number }>();
  for (const [index, event] of events.entries()) {
    if (event.event !== "edit.moved") continue;
    const previous = canonicalHtmlPath(event.previous_path);
    const current = canonicalHtmlPath(event.page_path);
    if (!previous || !current || previous === current) continue;
    const candidate = { path: current, ts: event.ts ?? "", index };
    const prior = moves.get(previous);
    if (!prior || candidate.ts > prior.ts || (candidate.ts === prior.ts && index > prior.index)) {
      moves.set(previous, candidate);
    }
  }

  const visited = new Set([requested]);
  let cursor = requested;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = moves.get(cursor)?.path;
    if (!next || visited.has(next)) return null;
    visited.add(next);
    if (await isServable(next)) return next;
    cursor = next;
  }
  return null;
}

/** Resolve a missing canonical HTML path through the durable edit ledger. */
export async function resolveMovedHtmlPath(requestedPath: string): Promise<string | null> {
  if (!canonicalHtmlPath(requestedPath)) return null;
  const events = await readEditEvents();
  return resolveMovedHtmlPathFromEvents(requestedPath, events, async (relPath) => {
    try {
      return (await statVaultFile(relPath)).isFile;
    } catch {
      return false;
    }
  });
}
