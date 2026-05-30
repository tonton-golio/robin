import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type MemoryStatus = 'tentative' | 'active' | 'superseded' | 'rejected' | 'archived';
export type MemoryConfidence = 'low' | 'medium' | 'high';
export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'procedural';
export type MemoryType =
  | 'preference'
  | 'correction'
  | 'decision'
  | 'pattern'
  | 'procedure'
  | 'project'
  | 'person'
  | 'repo'
  | 'task'
  | 'other';

export interface MemorySource {
  kind: 'annotation' | 'conversation' | 'meeting' | 'manual' | 'tool' | 'repo' | 'other';
  ref: string;
  quote?: string;
  captured_at?: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  tier: MemoryTier;
  status: MemoryStatus;
  confidence: MemoryConfidence;
  scope: string;
  subject: string;
  summary: string;
  body?: string;
  tags: string[];
  links: string[];
  sources: MemorySource[];
  source_count: number;
  seen_count: number;
  supersedes: string[];
  superseded_by?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  fingerprint: string;
}

export interface MemorySavedEvent {
  event: 'memory.saved';
  memory: MemoryRecord;
}

export interface MemorySeenEvent {
  event: 'memory.seen';
  id: string;
  seen_at: string;
  source?: MemorySource;
}

export interface MemoryResolvedEvent {
  event: 'memory.resolved';
  id: string;
  status: MemoryStatus;
  resolved_at: string;
  resolution: string;
  superseded_by?: string;
}

export type MemoryEvent = MemorySavedEvent | MemorySeenEvent | MemoryResolvedEvent;

export interface SaveMemoryInput {
  type: MemoryType;
  tier?: MemoryTier;
  scope?: string;
  subject: string;
  summary: string;
  body?: string;
  tags?: string[];
  links?: string[];
  source: MemorySource;
  status?: MemoryStatus;
  confidence?: MemoryConfidence;
  supersedes?: string[];
  merge?: boolean;
}

export interface SearchMemoryInput {
  query?: string;
  k?: number;
  status?: MemoryStatus[];
  type?: MemoryType[];
  tier?: MemoryTier[];
  scope?: string;
  tags?: string[];
}

export interface MemoryHit {
  memory: MemoryRecord;
  score: number;
  matched: string[];
}

export interface ResolveMemoryInput {
  id: string;
  status: MemoryStatus;
  resolution: string;
  superseded_by?: string;
}

export interface MemoryProjection {
  memories: MemoryRecord[];
  events: MemoryEvent[];
  malformed: Array<{ line: number; error: string }>;
}

export const MEMORY_EVENTS_PATH = path.join('brain', 'memory', 'events.jsonl');

const VALID_STATUSES: MemoryStatus[] = ['tentative', 'active', 'superseded', 'rejected', 'archived'];
const VALID_TIERS: MemoryTier[] = ['working', 'episodic', 'semantic', 'procedural'];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string): string {
  return normalizeSpace(value).toLowerCase();
}

function uniqueSorted(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map(normalizeSpace).filter(Boolean))).sort();
}

function fingerprint(input: Pick<SaveMemoryInput, 'type' | 'scope' | 'subject' | 'summary'>): string {
  const basis = [
    input.type,
    input.scope ?? 'global',
    normalizeKey(input.subject),
    normalizeKey(input.summary),
  ].join('\n');
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
}

function memoryId(): string {
  return `mem_${crypto.randomUUID()}`;
}

function defaultTier(type: MemoryType): MemoryTier {
  if (type === 'procedure' || type === 'pattern') return 'procedural';
  if (type === 'decision' || type === 'correction' || type === 'preference') return 'semantic';
  return 'semantic';
}

function normalizeMemoryRecord(memory: MemoryRecord): MemoryRecord {
  const tier = VALID_TIERS.includes(memory.tier) ? memory.tier : defaultTier(memory.type);
  return { ...memory, tier };
}

function eventPath(vaultPath: string): string {
  return path.join(vaultPath, MEMORY_EVENTS_PATH);
}

async function appendEvent(vaultPath: string, event: MemoryEvent): Promise<void> {
  const target = eventPath(vaultPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(event)}\n`, 'utf8');
}

function parseEvent(value: unknown): MemoryEvent | null {
  if (!value || typeof value !== 'object' || !('event' in value)) {
    return null;
  }

  const event = value as { event: unknown };
  if (event.event === 'memory.saved' || event.event === 'memory.seen' || event.event === 'memory.resolved') {
    return value as MemoryEvent;
  }

  return null;
}

export async function loadMemoryProjection(vaultPath: string): Promise<MemoryProjection> {
  const target = eventPath(vaultPath);
  const raw = await fs.readFile(target, 'utf8').catch(() => '');
  const events: MemoryEvent[] = [];
  const malformed: Array<{ line: number; error: string }> = [];

  raw.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = parseEvent(JSON.parse(line));
      if (parsed) {
        events.push(parsed);
      } else {
        malformed.push({ line: index + 1, error: 'unknown memory event' });
      }
    } catch (err) {
      malformed.push({ line: index + 1, error: err instanceof Error ? err.message : 'parse error' });
    }
  });

  const records = new Map<string, MemoryRecord>();

  for (const event of events) {
    if (event.event === 'memory.saved') {
      records.set(event.memory.id, normalizeMemoryRecord({ ...event.memory }));
      for (const supersededId of event.memory.supersedes) {
        const existing = records.get(supersededId);
        if (existing) {
          existing.status = 'superseded';
          existing.superseded_by = event.memory.id;
          existing.updated_at = event.memory.created_at;
        }
      }
    } else if (event.event === 'memory.seen') {
      const existing = records.get(event.id);
      if (existing) {
        existing.seen_count += 1;
        existing.source_count = event.source ? existing.source_count + 1 : existing.source_count;
        existing.last_seen_at = event.seen_at;
        existing.updated_at = event.seen_at;
        if (event.source) {
          existing.sources = [...existing.sources, event.source];
        }
      }
    } else if (event.event === 'memory.resolved') {
      const existing = records.get(event.id);
      if (existing) {
        existing.status = event.status;
        existing.resolution = event.resolution;
        existing.updated_at = event.resolved_at;
        if (event.superseded_by) {
          existing.superseded_by = event.superseded_by;
        }
      }
    }
  }

  return {
    memories: Array.from(records.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    events,
    malformed,
  };
}

export async function saveMemory(vaultPath: string, input: SaveMemoryInput): Promise<MemoryRecord> {
  const createdAt = nowIso();
  const scope = normalizeSpace(input.scope ?? 'global') || 'global';
  const summary = normalizeSpace(input.summary);
  const subject = normalizeSpace(input.subject);
  const fp = fingerprint({ ...input, scope });
  const projection = await loadMemoryProjection(vaultPath);

  if (input.merge !== false) {
    const existing = projection.memories.find(
      (memory) =>
        memory.fingerprint === fp &&
        (memory.status === 'active' || memory.status === 'tentative'),
    );
    if (existing) {
      await appendEvent(vaultPath, {
        event: 'memory.seen',
        id: existing.id,
        seen_at: createdAt,
        source: input.source,
      });
      return {
        ...existing,
        seen_count: existing.seen_count + 1,
        source_count: existing.source_count + 1,
        sources: [...existing.sources, input.source],
        updated_at: createdAt,
        last_seen_at: createdAt,
      };
    }
  }

  const memory: MemoryRecord = {
    id: memoryId(),
    type: input.type,
    tier: input.tier ?? defaultTier(input.type),
    status: input.status ?? 'tentative',
    confidence: input.confidence ?? 'medium',
    scope,
    subject,
    summary,
    body: input.body ? normalizeSpace(input.body) : undefined,
    tags: uniqueSorted(input.tags),
    links: uniqueSorted(input.links),
    sources: [input.source],
    source_count: 1,
    seen_count: 1,
    supersedes: uniqueSorted(input.supersedes),
    created_at: createdAt,
    updated_at: createdAt,
    last_seen_at: createdAt,
    fingerprint: fp,
  };

  await appendEvent(vaultPath, { event: 'memory.saved', memory });
  return memory;
}

export async function resolveMemory(vaultPath: string, input: ResolveMemoryInput): Promise<MemoryRecord> {
  if (!VALID_STATUSES.includes(input.status)) {
    throw new Error(`Invalid memory status: ${input.status}`);
  }

  const projection = await loadMemoryProjection(vaultPath);
  const memory = projection.memories.find((record) => record.id === input.id);
  if (!memory) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  const resolvedAt = nowIso();
  await appendEvent(vaultPath, {
    event: 'memory.resolved',
    id: input.id,
    status: input.status,
    resolved_at: resolvedAt,
    resolution: input.resolution,
    superseded_by: input.superseded_by,
  });

  return {
    ...memory,
    status: input.status,
    resolution: input.resolution,
    superseded_by: input.superseded_by ?? memory.superseded_by,
    updated_at: resolvedAt,
  };
}

export async function listMemories(vaultPath: string, input: Omit<SearchMemoryInput, 'query' | 'k'> = {}): Promise<MemoryRecord[]> {
  const projection = await loadMemoryProjection(vaultPath);
  return applyFilters(projection.memories, input);
}

export async function searchMemories(vaultPath: string, input: SearchMemoryInput): Promise<MemoryHit[]> {
  const projection = await loadMemoryProjection(vaultPath);
  const filtered = applyFilters(projection.memories, input);
  const query = normalizeKey(input.query ?? '');
  const k = input.k ?? 20;

  if (!query) {
    return filtered.slice(0, k).map((memory) => ({ memory, score: 1, matched: [] }));
  }

  const queryTerms = tokenize(query);
  const hits = filtered
    .map((memory) => scoreMemory(memory, query, queryTerms))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at));

  return hits.slice(0, k);
}

function applyFilters(
  memories: MemoryRecord[],
  input: Omit<SearchMemoryInput, 'query' | 'k'>,
): MemoryRecord[] {
  return memories.filter((memory) => {
    if (input.status?.length && !input.status.includes(memory.status)) return false;
    if (input.type?.length && !input.type.includes(memory.type)) return false;
    if (input.tier?.length && !input.tier.includes(memory.tier)) return false;
    if (input.scope && memory.scope !== input.scope) return false;
    if (input.tags?.length && !input.tags.every((tag) => memory.tags.includes(tag))) return false;
    return true;
  });
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []));
}

function scoreMemory(memory: MemoryRecord, query: string, queryTerms: string[]): MemoryHit {
  const fields: Array<[string, string, number]> = [
    ['subject', memory.subject, 8],
    ['summary', memory.summary, 6],
    ['body', memory.body ?? '', 3],
    ['scope', memory.scope, 4],
    ['type', memory.type, 2],
    ['tier', memory.tier, 2],
    ['tags', memory.tags.join(' '), 5],
    ['links', memory.links.join(' '), 3],
  ];

  let score = 0;
  const matched = new Set<string>();

  for (const [field, rawValue, weight] of fields) {
    const value = normalizeKey(rawValue);
    if (!value) continue;
    if (value.includes(query)) {
      score += weight * 2;
      matched.add(field);
    }
    const fieldTokens = new Set(tokenize(value));
    for (const term of queryTerms) {
      if (fieldTokens.has(term)) {
        score += weight;
        matched.add(field);
      } else if (value.includes(term)) {
        score += weight * 0.35;
        matched.add(field);
      }
    }
  }

  if (memory.status === 'active') score *= 1.15;
  if (memory.confidence === 'high') score *= 1.1;
  if (memory.status === 'rejected' || memory.status === 'archived') score *= 0.25;

  return { memory, score: Number(score.toFixed(3)), matched: Array.from(matched).sort() };
}
