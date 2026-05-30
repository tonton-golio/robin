'use client';

import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import {
  PageHeader,
  Button,
  Input,
  Card,
  Pill,
  EmptyState,
  ErrorBanner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';

interface MemoryRecord {
  id: string;
  type: string;
  tier: string;
  status: string;
  confidence: string;
  scope: string;
  subject: string;
  summary: string;
  body?: string;
  tags: string[];
  links: string[];
  source_count: number;
  seen_count: number;
  supersedes: string[];
  superseded_by?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface MemoryHit {
  memory: MemoryRecord;
  score: number;
  matched: string[];
}

type MemoryResponse =
  | { mode: 'search'; hits: MemoryHit[] }
  | { mode: 'list'; memories: MemoryRecord[] };

const STATUS_OPTIONS = ['active', 'tentative', 'superseded', 'rejected', 'archived'];

// Mirror of the Pill component's accepted tones (kept local since Pill does
// not export the type). Matches the per-page statusTone pattern used elsewhere.
type Tone = 'neutral' | 'amber' | 'cyan' | 'violet' | 'rust' | 'green';

// Color is the fastest scanning channel — give each lifecycle state its own
// tone so a superseded/rejected fact never looks like a still-trusted one.
function statusTone(status: string): Tone {
  if (status === 'active') return 'green';
  if (status === 'tentative') return 'amber';
  if (status === 'superseded') return 'violet';
  if (status === 'rejected') return 'rust';
  if (status === 'archived') return 'neutral';
  return 'cyan';
}

function asMemories(response: MemoryResponse | null | undefined): MemoryHit[] {
  if (!response) return [];
  if (response.mode === 'search') return response.hits;
  return response.memories.map((memory) => ({ memory, score: 1, matched: [] }));
}

export function MemoryExplorer(): React.ReactElement {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [status, setStatus] = useState('active,tentative');

  const params = new URLSearchParams({ status, k: '40' });
  if (submittedQuery.trim()) params.set('q', submittedQuery.trim());
  const { data: response, error: swrError, isLoading: loading } = useSWR<MemoryResponse>(
    `/api/memory?${params}`,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const error = swrError ? (swrError as Error).message : null;

  const hits = useMemo(() => asMemories(response), [response]);

  // Applies the typed query; status changes refetch automatically via the SWR key.
  const load = () => setSubmittedQuery(query);

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14">
      <PageHeader
        eyebrow="Memory"
        title="Promoted, durable recall."
        sub="Promoted Robin memories from the repo knowledgebase. Source capture stays in inbox and durable facts stay linked to source pages."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load();
          }}
          placeholder="Search memories…"
          className="min-w-[240px] flex-1"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active,tentative">Open</SelectItem>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
            <SelectItem value={STATUS_OPTIONS.join(',')}>All</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" onClick={() => void load()}>
          Search
        </Button>
      </div>

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {loading ? (
        <EmptyState title="Loading memory…" />
      ) : (
        <div className="grid gap-3">
          {hits.length === 0 ? <EmptyState title="No promoted memories match this view." /> : null}
          {hits.map(({ memory, score, matched }) => (
            <Card key={memory.id} className="gap-2 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="amber">{memory.type}</Pill>
                  {memory.tier ? <Pill tone="neutral">{memory.tier}</Pill> : null}
                  <Pill tone={statusTone(memory.status)}>{memory.status}</Pill>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-2)]">
                    {memory.confidence}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-2)]">
                    {memory.scope}
                  </span>
                </span>
                <span className="break-all font-mono text-[10px] text-[var(--text-2)]">{memory.id}</span>
              </div>
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">{memory.subject}</h2>
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">{memory.summary}</p>
              {memory.body ? (
                <p className="text-[13px] leading-relaxed text-muted-foreground/70">{memory.body}</p>
              ) : null}
              {/* Lifecycle lineage: the most decision-relevant metadata. Show what
                  superseded this fact, what it superseded, and the resolution note,
                  so a stale fact can be traced to its replacement / rejection reason. */}
              {memory.superseded_by || memory.supersedes?.length || memory.resolution ? (
                <div className="grid gap-1 rounded-md border border-border/60 bg-secondary/40 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  {memory.superseded_by ? (
                    <span>
                      Superseded by{' '}
                      <span className="break-all font-mono text-[10.5px] text-[var(--decision-violet)]">
                        {memory.superseded_by}
                      </span>
                    </span>
                  ) : null}
                  {memory.supersedes?.length ? (
                    <span>
                      Supersedes{' '}
                      <span className="break-all font-mono text-[10.5px] text-[var(--text-2)]">
                        {memory.supersedes.join(', ')}
                      </span>
                    </span>
                  ) : null}
                  {memory.resolution ? <span>{memory.resolution}</span> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-[var(--text-2)]">
                <span>seen {memory.seen_count} · sources {memory.source_count} · created {memory.created_at.slice(0, 10)} · updated {memory.updated_at.slice(0, 10)}</span>
                {score !== 1 ? <span>score {score}</span> : null}
                {matched.length ? <span>matched {matched.join(', ')}</span> : null}
                {memory.tags.length ? (
                  <span>{memory.tags.map((tag) => `#${tag}`).join(' ')}</span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
