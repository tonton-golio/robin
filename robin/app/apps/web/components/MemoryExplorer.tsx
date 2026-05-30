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
  updated_at: string;
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
                  <Pill tone="cyan">{memory.status}</Pill>
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
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-[var(--text-2)]">
                <span>seen {memory.seen_count} · sources {memory.source_count} · updated {memory.updated_at.slice(0, 10)}</span>
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
