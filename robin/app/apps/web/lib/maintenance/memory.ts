import path from 'path';
import type { MaintenanceItem, Severity } from './types';
import { isRecord, readJsonlFile, stringValue, timestampValue } from './shared';

export interface MemoryHealthSection {
  title: string;
  source: string;
  available: boolean;
  totalEvents: number;
  malformedEvents: number;
  currentMemories: number;
  statuses: Record<string, number>;
  tentative: number;
  rejected: number;
  superseded: number;
  samples: MemoryIssue[];
}

export interface MemoryIssue {
  id?: string;
  status: string;
  subject?: string;
  summary?: string;
  updatedAt?: string;
  severity: Severity;
}

export async function getMemoryHealthSection(limit: number): Promise<MemoryHealthSection> {
  const source = path.join('brain', 'memory', 'events.jsonl');
  const result = await readJsonlFile(source);
  const memories = new Map<string, Record<string, unknown>>();

  for (const { value } of result.records) {
    const memory = value['memory'];
    if (!isRecord(memory)) continue;
    const id = stringValue(memory['id']);
    if (!id) continue;

    const current = memories.get(id);
    const nextUpdated = timestampValue(memory['updated_at']) ?? timestampValue(memory['created_at']);
    const currentUpdated = current
      ? timestampValue(current['updated_at']) ?? timestampValue(current['created_at'])
      : undefined;
    if (current && currentUpdated && nextUpdated && currentUpdated > nextUpdated) continue;
    memories.set(id, memory);
  }

  const statuses: Record<string, number> = {};
  const samples: MemoryIssue[] = [];
  for (const memory of memories.values()) {
    const status = stringValue(memory['status']) ?? 'unknown';
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (status === 'tentative' || status === 'rejected' || status === 'superseded') {
      samples.push({
        id: stringValue(memory['id']),
        status,
        subject: stringValue(memory['subject']),
        summary: stringValue(memory['summary']),
        updatedAt: timestampValue(memory['updated_at']),
        severity: status === 'tentative' ? 'info' : 'warning',
      });
    }
  }

  return {
    title: 'Memory health',
    source,
    available: result.totalLines > 0 || result.malformed > 0,
    totalEvents: result.totalLines,
    malformedEvents: result.malformed,
    currentMemories: memories.size,
    statuses,
    tentative: statuses['tentative'] ?? 0,
    rejected: statuses['rejected'] ?? 0,
    superseded: statuses['superseded'] ?? 0,
    samples: samples
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, limit),
  };
}

export function memoryItems(section: MemoryHealthSection, limit: number): MaintenanceItem[] {
  const items: MaintenanceItem[] = [];
  if (section.malformedEvents > 0) {
    items.push({
      id: 'memory:malformed-events',
      title: 'Malformed memory events',
      detail: `${section.malformedEvents} lines could not be parsed from ${section.source}.`,
      path: section.source,
      severity: 'critical',
    });
  }

  for (const sample of section.samples) {
    items.push({
      id: `memory:${sample.id ?? sample.status}:${sample.subject ?? sample.summary ?? ''}`,
      title: sample.subject ?? sample.summary ?? sample.status,
      detail: sample.summary,
      path: section.source,
      meta: [sample.status, sample.updatedAt].filter((value): value is string => Boolean(value)),
      severity: sample.severity,
    });
  }

  return items.slice(0, limit);
}
