import type { Metadata } from "next";
import type React from "react";
import { listOutputs } from "@/lib/catalog";
import { groupEditsByPage, listEdits } from "@/lib/edit-store";
import { deriveLedger, type EditInfo } from "./derive";
import { OutputsBrowser } from "./OutputsBrowser";

// Reads the out/ tree + edit stream + annotation log off the filesystem on every
// request, so the ledger never serves a stale build-time snapshot. The per-file
// HTML parse behind deriveLedger() is memoised on path:mtimeMs (see derive.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Outputs — Robin",
};

export default async function OutputsPage(): Promise<React.ReactElement> {
  const [outputs, edits] = await Promise.all([listOutputs(), listEdits()]);

  // One pass over the edit stream → provenance per page. Only in-app / MCP /
  // agent writes flow through writeWithHistory, so script-generated artifacts
  // have no entry at all: provenance stays absent rather than faked. The
  // recorded actor is carried through VERBATIM — the old origin==='web' →
  // 'human' guess printed a human's name for a piece of software ('deck-editor').
  const editInfo = new Map<string, EditInfo>();
  for (const group of groupEditsByPage(edits)) {
    const saves = group.items.filter((e) => e.event === "edit.saved").length;
    if (saves === 0) continue;
    const latest = group.items[0];
    // edit-store only string-compares `ts`, so a malformed value reaches here
    // intact. NaN would render as the literal "Invalid Date" and poison the
    // activity sort key, so an unparseable timestamp is simply absent.
    const parsed = latest?.ts ? Date.parse(latest.ts) : 0;
    editInfo.set(group.pagePath, {
      saves,
      lastMs: Number.isFinite(parsed) ? parsed : 0,
      actor: latest?.actor?.trim() || latest?.origin || "unrecorded",
    });
  }

  const data = await deriveLedger(outputs, editInfo);

  return <OutputsBrowser data={data} />;
}
