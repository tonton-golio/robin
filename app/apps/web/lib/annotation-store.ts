import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  annotationEventId,
  annotationEventTimestamp,
  annotationStatus,
  collapseAnnotationEvents,
  isClosedAnnotationStatus,
  type AnnotationEvent,
  type AnnotationRecord,
} from '@/lib/annotations';
import { locateVault } from '@/lib/vault';
import { OWNER_NAME } from '@/lib/config';

const ANNOTATION_DIR = path.join('inbox', 'robin', 'annotations');

export interface AnnotationListOptions {
  pagePath?: string;
  includeClosed?: boolean;
}

export interface AnnotationStatusUpdate {
  id: string;
  status: string;
  pagePath?: string;
  renderPath?: string;
  resolutionMd?: string;
  author?: string;
}

export function annotationLogDir(): string {
  return ANNOTATION_DIR;
}

export async function hashAnnotationPage(vault: string, renderPath: string): Promise<string> {
  try {
    const data = await fs.readFile(path.join(vault, renderPath));
    return `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
  } catch {
    return 'sha256:missing';
  }
}

export async function appendAnnotationEvent(event: AnnotationEvent, now = new Date()): Promise<string> {
  const vault = locateVault();
  const timestamp = event.updated_at ?? event.created_at ?? event.resolved_at ?? now.toISOString();
  const month = timestamp.slice(0, 7);
  const relPath = path.join(ANNOTATION_DIR, `${month}.jsonl`);
  const absPath = path.join(vault, relPath);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.appendFile(absPath, `${JSON.stringify(event)}\n`, 'utf-8');

  return relPath;
}

function eventNameForStatus(status: string): string {
  if (status === 'needs-attention') return 'annotation.needs-attention';
  if (status === 'open') return 'annotation.reopened';
  return `annotation.${status}`;
}

export async function appendAnnotationStatusEvent(update: AnnotationStatusUpdate): Promise<string> {
  const updatedAt = new Date().toISOString();
  const event: AnnotationEvent = {
    id: update.id,
    event: eventNameForStatus(update.status),
    status: update.status,
    created_at: updatedAt,
    updated_at: updatedAt,
    author: update.author ?? (OWNER_NAME || 'user'),
    page_path: update.pagePath,
    render_path: update.renderPath,
    resolution_md: update.resolutionMd,
  };

  if (update.status !== 'open') {
    event.resolved_at = updatedAt;
  }

  return appendAnnotationEvent(event, new Date(updatedAt));
}

export async function readAnnotationEvents(): Promise<Array<AnnotationEvent & { logPath: string }>> {
  const vault = locateVault();
  const dir = path.join(vault, ANNOTATION_DIR);
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => ({ relPath: path.join(ANNOTATION_DIR, entry.name), absPath: path.join(dir, entry.name) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const events: Array<AnnotationEvent & { logPath: string }> = [];
  for (const file of files) {
    const content = await fs.readFile(file.absPath, 'utf-8').catch(() => '');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push({ ...(JSON.parse(line) as AnnotationEvent), logPath: file.relPath });
      } catch {
        // Leave malformed rows in place; callers can still inspect the source JSONL.
      }
    }
  }

  return events;
}

function toRecord(event: AnnotationEvent & { status: string }): AnnotationRecord | null {
  const id = annotationEventId(event);
  if (!id) return null;
  return {
    ...event,
    id,
    status: annotationStatus(event),
  };
}

function matchesPage(record: AnnotationRecord, pagePath: string): boolean {
  return record.page_path === pagePath || record.render_path === pagePath;
}

/**
 * Re-hash the current rendered page for every annotation that captured a
 * `page_hash` at creation, and set `pageChanged` when the live hash no longer
 * matches. This is what makes the stored `page_hash` useful for stale-anchor
 * detection — the UI can warn that the page changed since the comment.
 * Hashes are computed once per render_path and memoized for the batch.
 */
async function flagStaleAnchors(
  vault: string,
  records: AnnotationRecord[],
): Promise<AnnotationRecord[]> {
  const liveHashes = new Map<string, Promise<string>>();
  const hashFor = (renderPath: string): Promise<string> => {
    let pending = liveHashes.get(renderPath);
    if (!pending) {
      pending = hashAnnotationPage(vault, renderPath);
      liveHashes.set(renderPath, pending);
    }
    return pending;
  };

  return Promise.all(
    records.map(async (record) => {
      const renderPath = record.render_path ?? record.page_path;
      // No stored hash or no render target to compare against → unknown, leave undefined.
      if (!record.page_hash || !renderPath) return record;
      const current = await hashFor(renderPath);
      return { ...record, pageChanged: current !== record.page_hash };
    }),
  );
}

export async function listAnnotations(options: AnnotationListOptions = {}): Promise<AnnotationRecord[]> {
  const vault = locateVault();
  const events = await readAnnotationEvents();
  const collapsed = collapseAnnotationEvents(events)
    .map(toRecord)
    .filter((event): event is AnnotationRecord => event !== null);

  const filtered = collapsed
    .filter((event) => (options.includeClosed ? true : !isClosedAnnotationStatus(event.status)))
    .filter((event) => (options.pagePath ? matchesPage(event, options.pagePath) : true))
    .sort((a, b) => annotationEventTimestamp(b).localeCompare(annotationEventTimestamp(a)));

  return flagStaleAnchors(vault, filtered);
}

