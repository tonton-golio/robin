/**
 * Reader for the edit-event stream that @robin/vault-io writes.
 *
 * Mirrors lib/annotation-store.ts: events live as append-only JSONL under
 * inbox/robin/edits/<YYYY-MM>.jsonl, one event per page write (see
 * robin/app/docs/edit-log-ingest.md). This module is the read side the /edits
 * list + the back-step action consume.
 */

import fs from "fs/promises";
import path from "path";
import { locateVault } from "@/lib/vault";
import type { EditEvent } from "@robin/vault-io";

const EDITS_DIR = path.join("inbox", "robin", "edits");

export type EditRecord = EditEvent & { logPath: string };

export function editLogDir(): string {
  return EDITS_DIR;
}

/** Read every edit event across all month buckets (file order, oldest file first). */
export async function readEditEvents(): Promise<EditRecord[]> {
  const vault = locateVault();
  const dir = path.join(vault, EDITS_DIR);
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => ({
      relPath: path.join(EDITS_DIR, entry.name),
      absPath: path.join(dir, entry.name),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const events: EditRecord[] = [];
  for (const file of files) {
    const content = await fs.readFile(file.absPath, "utf-8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push({ ...(JSON.parse(line) as EditEvent), logPath: file.relPath });
      } catch {
        // Leave malformed rows in place; the raw JSONL is still inspectable.
      }
    }
  }
  return events;
}

export interface ListEditsOptions {
  /** Filter to a single page's edits. */
  pagePath?: string;
  /** Cap the number returned (after newest-first sort). */
  limit?: number;
}

/** Edit events newest-first, optionally scoped to one page. */
export async function listEdits(options: ListEditsOptions = {}): Promise<EditRecord[]> {
  let events = await readEditEvents();
  if (options.pagePath) events = events.filter((e) => e.page_path === options.pagePath);
  events.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  if (options.limit && options.limit > 0) events = events.slice(0, options.limit);
  return events;
}

/** Find a single edit event by its immutable, unique mutation id. */
export async function findEdit(id: string): Promise<EditRecord | null> {
  const events = await readEditEvents();
  // Prefer the newest defensively if a legacy/corrupt stream contains a
  // duplicate. Writers and recovery now suppress duplicate mutation ids.
  const matches = events
    .filter((e) => e.id === id)
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return matches[0] ?? null;
}

export interface EditGroup {
  pagePath: string;
  items: EditRecord[];
}

/** Group edits by page, each group newest-first, groups by most-recent activity. */
export function groupEditsByPage(events: EditRecord[]): EditGroup[] {
  const groups = new Map<string, EditRecord[]>();
  for (const e of events) {
    const key = e.page_path || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return Array.from(groups.entries())
    .map(([pagePath, items]) => ({
      pagePath,
      items: items.sort((a, b) => (b.ts || "").localeCompare(a.ts || "")),
    }))
    .sort((a, b) => (b.items[0]?.ts || "").localeCompare(a.items[0]?.ts || ""));
}
