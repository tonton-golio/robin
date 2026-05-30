import fs from 'fs/promises';
import path from 'path';
import { locateVault } from '@/lib/vault';
import type { Severity } from './types';

export interface JsonlRecord {
  value: Record<string, unknown>;
  relPath: string;
}

export interface JsonlReadResult {
  records: JsonlRecord[];
  totalLines: number;
  malformed: number;
}

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export const DEFAULT_LIMIT = 50;
export const STALE_OPEN_TASK_DAYS = 30;
export const OUTPUT_ARCHIVE_DAYS = 30;
export const LARGE_OUTPUT_BYTES = 5 * 1024 * 1024;
export const DONE_TASK_STATES = new Set(['done', 'completed', 'archived', 'cancelled', 'canceled']);

export async function readJsonlDir(relDir: string): Promise<JsonlReadResult> {
  const vault = locateVault();
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(path.join(vault, relDir), { withFileTypes: true });
  } catch {
    return { records: [], totalLines: 0, malformed: 0 };
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(relDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const parts = await Promise.all(files.map((file) => readJsonlFile(file)));
  return parts.reduce<JsonlReadResult>((acc, part) => ({
    records: acc.records.concat(part.records),
    totalLines: acc.totalLines + part.totalLines,
    malformed: acc.malformed + part.malformed,
  }), { records: [], totalLines: 0, malformed: 0 });
}

export async function readJsonlFile(relPath: string): Promise<JsonlReadResult> {
  const text = await readText(path.join(locateVault(), relPath));
  if (!text) return { records: [], totalLines: 0, malformed: 0 };

  const records: JsonlRecord[] = [];
  let totalLines = 0;
  let malformed = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    totalLines += 1;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) {
        records.push({ value: parsed, relPath });
      } else {
        malformed += 1;
      }
    } catch {
      malformed += 1;
    }
  }

  return { records, totalLines, malformed };
}

export async function walk(root: string, relDir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      found.push(...await walk(root, relPath));
    } else if (entry.isFile()) {
      found.push(relPath);
    }
  }
  return found.map((file) => file.split(path.sep).join('/'));
}

export function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_LIMIT), 200));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function timestampValue(value: unknown): string | undefined {
  const text = stringValue(value);
  // Drop unparseable timestamps so callers' `?? fallback` chains work and bad
  // values don't pollute sort/compare. (The check was previously a no-op:
  // `? text : text`.)
  return text && isValidDate(text) ? text : undefined;
}

export function isValidDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function isBeforeDay(value: string, now: Date): boolean {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  // Compare on the UTC calendar day, matching how due dates are written
  // (robin:due is always YYYY-MM-DDT00:00:00Z). Using local setHours would
  // reinterpret that UTC-midnight instant as the PREVIOUS local day in any
  // negative-offset timezone, flagging a task due *today* as overdue a day early.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed < today;
}

export function ageDays(value: string, now: Date): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

export function severityRank(severity: Severity): number {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

export function titleFromPath(relPath: string): string {
  return path.basename(relPath, path.extname(relPath)).replace(/[-_]+/g, ' ');
}

export async function readText(absPath: string): Promise<string> {
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return '';
  }
}

export function metaContent(html: string, name: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (attrValue(tag, 'name') === name) {
      return attrValue(tag, 'content');
    }
  }
  return undefined;
}

export function attrValue(tag: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return tag.match(re)?.[2];
}
