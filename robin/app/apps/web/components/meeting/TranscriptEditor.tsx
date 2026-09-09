'use client';

/**
 * TranscriptEditor.tsx
 *
 * The review step of the meeting flow. Shows the (optionally AI-processed)
 * meeting and lets the user edit before saving:
 *   - title + summary (from the Process step or typed by hand)
 *   - key points + action items (editable lists)
 *   - speaker label → real name mapping
 *   - the transcript body
 *
 * On save it composes a markdown body — a "## Summary / ## Key points /
 * ## Action items / ## Transcript" preamble in front of the transcript — which
 * /api/ingest/meeting renders into proper brain-page blocks. title + summary are
 * also written to frontmatter so the brain page and index get a real title/summary.
 *
 * Transcript speaker convention (matching ingest-meeting + live Deepgram):
 *   **Speaker A:** lorem ipsum
 *   **Speaker B:** dolor sit amet
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { Segment } from '@/lib/whisper';
import { vaultPageHref } from '@/lib/routes';
import { Button, Input, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';
import type {
  MeetingCommitmentSignal,
  MeetingConflictSignal,
  MeetingDecisionSignal,
  MeetingEvidenceState,
} from '@/lib/meeting-signals';

export type EditorActionItem = MeetingCommitmentSignal;
export type EditorDecision = MeetingDecisionSignal;
export type EditorConflict = MeetingConflictSignal;

interface TranscriptEditorProps {
  transcript: string;
  meetingId: string;
  segments?: Segment[];
  audioPath?: string;
  durationSec?: number;
  /** Prefill from a matched calendar event. */
  initialSlug?: string;
  initialAttendees?: string;
  /** Prefill from the AI Process step. */
  initialTitle?: string;
  initialSummary?: string;
  initialKeyPoints?: string[];
  initialActionItems?: EditorActionItem[];
  initialDecisions?: EditorDecision[];
  initialConflicts?: EditorConflict[];
  /** Map of detected speaker label → inferred name (auto speaker naming). */
  speakerNames?: Record<string, string>;
  onSaved?: (result: { path: string; slug: string; ingestUrl: string }) => void;
}

// Extract unique speaker labels from a transcript string or segment list
function extractSpeakers(transcript: string, segments?: Segment[]): string[] {
  const found = new Set<string>();

  segments?.forEach(s => {
    if (s.speaker) found.add(s.speaker);
  });

  // From "**Name:**" (colon inside — live Deepgram / ingest output convention)
  // and "**Name**:" (colon outside — some Whisper exports). Capture either.
  const labelRe = /\*\*\s*([^*\n]+?)\s*:?\s*\*\*\s*:?/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(transcript)) !== null) {
    const label = m[1]?.replace(/:$/, '').trim();
    if (label) found.add(label);
  }

  const bareRe = /^(SPEAKER_\d+|[A-Z]):/gm;
  while ((m = bareRe.exec(transcript)) !== null) {
    if (m[1]) found.add(m[1]);
  }

  return Array.from(found).sort();
}

function applyRenames(transcript: string, renames: Record<string, string>): string {
  let out = transcript;
  for (const [from, to] of Object.entries(renames)) {
    if (!to.trim() || to === from) continue;
    const f = escapeRegExp(from);
    out = out.replace(new RegExp(`\\*\\*\\s*${f}\\s*:\\s*\\*\\*`, 'g'), `**${to}:**`);
    out = out.replace(new RegExp(`\\*\\*\\s*${f}\\s*\\*\\*\\s*:`, 'g'), `**${to}:**`);
    out = out.replace(new RegExp(`^${f}:`, 'gm'), `**${to}:**`);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segmentsToTranscript(segments: Segment[], renames: Record<string, string>): string {
  const lines: string[] = [];
  for (const seg of segments) {
    const rawSpeaker = seg.speaker;
    const displayName = rawSpeaker ? (renames[rawSpeaker]?.trim() || rawSpeaker) : null;
    const line = displayName ? `**${displayName}:** ${seg.text.trim()}` : seg.text.trim();
    lines.push(line);
  }
  return lines.join('\n');
}

// Compose the markdown body saved to inbox/meetings: an optional AI preamble
// (Summary / Key points / Action items) followed by the transcript. The ingest
// route turns "## " headings, "- " bullets and "- [ ]" tasks into real blocks.
function composeBody(input: {
  summary: string;
  keyPoints: string[];
  decisions: EditorDecision[];
  actionItems: EditorActionItem[];
  conflicts: EditorConflict[];
  transcript: string;
}): string {
  const sections: string[] = [];

  if (input.summary.trim()) {
    sections.push(`## Summary\n\n${input.summary.trim()}`);
  }

  const points = input.keyPoints.map(p => p.trim()).filter(Boolean);
  if (points.length) {
    sections.push(`## Key points\n\n${points.map(p => `- ${p}`).join('\n')}`);
  }

  const decisions = input.decisions.filter(decision => decision.text.trim());
  if (decisions.length) {
    sections.push(`## Decisions\n\n${decisions.map(decision => `- ${decision.text.trim()}`).join('\n')}`);
  }

  const actions = input.actionItems.filter(a => a.text.trim());
  if (actions.length) {
    const lines = actions.map(a => {
      const owner = a.owner?.trim() ? ` — ${a.owner.trim()}` : '';
      const due = a.due ? ` — due ${a.due}` : '';
      return `- [ ] ${a.text.trim()}${owner}${due}`;
    });
    sections.push(`## Action items\n\n${lines.join('\n')}`);
  }

  const conflicts = input.conflicts.filter(conflict => conflict.question.trim());
  if (conflicts.length) {
    sections.push(`## Open questions\n\n${conflicts.map(conflict => `- ${conflict.question.trim()}`).join('\n')}`);
  }

  // Only label the transcript when there's a preamble above it; a bare transcript
  // is left unheaded so the ingest route's legacy "Transcript" wrapper applies.
  if (sections.length) {
    sections.push(`## Transcript\n\n${input.transcript.trim()}`);
    return sections.join('\n\n');
  }
  return input.transcript.trim();
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]';
const FIELD =
  'w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--blue)]';

export function TranscriptEditor({
  transcript: initialTranscript,
  meetingId,
  segments,
  audioPath,
  durationSec,
  initialSlug = '',
  initialAttendees = '',
  initialTitle = '',
  initialSummary = '',
  initialKeyPoints = [],
  initialActionItems = [],
  initialDecisions = [],
  initialConflicts = [],
  speakerNames,
  onSaved,
}: TranscriptEditorProps) {
  const speakers = useMemo(
    () => extractSpeakers(initialTranscript, segments),
    [initialTranscript, segments],
  );

  const [renames, setRenames] = useState<Record<string, string>>(() =>
    Object.fromEntries(speakers.map(s => [s, speakerNames?.[s]?.trim() || s])),
  );

  const [body, setBody] = useState(() => {
    if (segments && segments.length > 0) return segmentsToTranscript(segments, {});
    return initialTranscript;
  });

  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [keyPoints, setKeyPoints] = useState<string[]>(initialKeyPoints);
  const [actionItems, setActionItems] = useState<EditorActionItem[]>(initialActionItems);
  const [decisions, setDecisions] = useState<EditorDecision[]>(initialDecisions);
  const [conflicts, setConflicts] = useState<EditorConflict[]>(initialConflicts);

  // Seed attendees from inferred speaker names when available.
  const [slug, setSlug] = useState(initialSlug);
  const [attendees, setAttendees] = useState(() => {
    if (initialAttendees) return initialAttendees;
    const inferred = speakers.map(s => speakerNames?.[s]?.trim()).filter(Boolean);
    return inferred.join(', ');
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<{ text: string; href?: string } | null>(null);

  const runIngest = useCallback(async (url: string) => {
    setIngesting(true);
    setIngestMsg(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      const data = (await res.json()) as {
        message?: string;
        outputPath?: string;
        pageUrl?: string;
        error?: string;
        compiled?: { decisions?: unknown[]; commitments?: unknown[]; interventions?: unknown[] };
      };
      if (!res.ok) {
        setIngestMsg({ text: data?.error || data?.message || `Compile failed (${res.status})` });
        return;
      }
      const href = data.pageUrl || (data.outputPath ? vaultPageHref(data.outputPath) : undefined);
      const counts = data.compiled
        ? `${data.compiled.decisions?.length ?? 0} decisions, ${data.compiled.commitments?.length ?? 0} commitments, ${data.compiled.interventions?.length ?? 0} need you`
        : 'meeting compiled';
      setIngestMsg({ text: `Captured · ${counts}`, href });
    } catch (err) {
      setIngestMsg({ text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIngesting(false);
    }
  }, []);

  const handleRenameChange = useCallback((speaker: string, newName: string) => {
    setRenames(prev => ({ ...prev, [speaker]: newName }));
  }, []);

  const finalTranscript = useMemo(() => {
    if (segments && segments.length > 0) return segmentsToTranscript(segments, renames);
    return applyRenames(body, renames);
  }, [body, renames, segments]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const composedBody = composeBody({
        summary,
        keyPoints,
        decisions,
        actionItems,
        conflicts,
        transcript: finalTranscript,
      });
      const res = await fetch('/api/meeting/save-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: composedBody,
          meetingId,
          title: title.trim() || undefined,
          summary: summary.trim() || undefined,
          slug: slug.trim() || undefined,
          attendees: attendees.trim() || undefined,
          audioPath,
          durationSec,
          signals: { decisions, commitments: actionItems, conflicts },
        }),
      });

      const data = (await res.json()) as { path?: string; slug?: string; ingestUrl?: string; error?: string };
      if (!res.ok) {
        setSaveError(data.error ?? `Server error ${res.status}`);
        return;
      }
      setSavedPath(data.path ?? null);
      setIngestUrl(data.ingestUrl ?? null);
      onSaved?.({ path: data.path ?? '', slug: data.slug ?? '', ingestUrl: data.ingestUrl ?? '' });
      if (data.ingestUrl) await runIngest(data.ingestUrl);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [actionItems, attendees, audioPath, conflicts, decisions, durationSec, finalTranscript, keyPoints, meetingId, onSaved, runIngest, slug, summary, title]);

  const handleIngest = useCallback(async () => {
    if (!ingestUrl) return;
    await runIngest(ingestUrl);
  }, [ingestUrl, runIngest]);

  return (
    <div className="flex flex-col gap-6">
      {/* Title + summary */}
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Title</span>
          <Input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Meeting title"
            className="text-base"
            style={{ fontFamily: 'var(--font-serif)' }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Summary</span>
          <textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            rows={3}
            placeholder="A short TL;DR of the meeting."
            className={`${FIELD} resize-y leading-relaxed`}
          />
        </label>
      </div>

      {/* Reviewable synthesis */}
      <div className="grid gap-5">
        <ListEditor
          label="Key points"
          items={keyPoints}
          onChange={setKeyPoints}
          placeholder="Add a key point"
        />
        <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--blue)_35%,var(--line))] bg-[color-mix(in_srgb,var(--blue)_5%,var(--card))] p-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className={LABEL}>Robin&apos;s read</span>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                These are the durable records Robin will carry forward. Reported means someone said it explicitly; inferred stays tentative.
              </p>
            </div>
            <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--blue-deep)]">review before capture</span>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <DecisionEditor items={decisions} onChange={setDecisions} />
            <ActionItemEditor items={actionItems} onChange={setActionItems} />
            <ConflictEditor items={conflicts} onChange={setConflicts} />
          </div>
        </div>
      </div>

      {/* Speaker rename controls */}
      {speakers.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Speakers</span>
          <div className="flex flex-wrap gap-2.5">
            {speakers.map(speaker => (
              <label
                key={speaker}
                className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-sm"
              >
                <span className="font-mono text-xs text-[var(--muted)]">{speaker}</span>
                <span className="text-[var(--muted)]">→</span>
                <input
                  type="text"
                  value={renames[speaker] ?? speaker}
                  onChange={e => handleRenameChange(speaker, e.target.value)}
                  className="w-28 rounded bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Name"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Transcript</span>
        <textarea
          value={segments && segments.length > 0 ? finalTranscript : body}
          onChange={e => setBody(e.target.value)}
          rows={16}
          className={`${FIELD} resize-y font-mono leading-relaxed`}
          placeholder="Transcript will appear here…"
          readOnly={!!(segments && segments.length > 0)}
        />
      </label>

      {/* Metadata */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Slug (optional)</span>
          <Input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="e.g. standup-weekly"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Attendees</span>
          <Input
            type="text"
            value={attendees}
            onChange={e => setAttendees(e.target.value)}
            placeholder="Alex, Sam"
          />
        </label>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--hairline)] pt-5">
        <Button onClick={handleSave} disabled={saving || ingesting || !!savedPath}>
          {saving ? 'Saving…' : ingesting ? 'Compiling…' : savedPath ? 'Captured' : 'Save & compile'}
        </Button>

        {savedPath && ingestMsg && !ingestMsg.href && (
          <Button
            variant="outline"
            onClick={handleIngest}
            disabled={!ingestUrl || ingesting}
            className="border-[var(--good)] text-[var(--good)]"
          >
            {ingesting ? 'Compiling…' : 'Retry compile'}
          </Button>
        )}

        <Button
          variant="outline"
          onClick={async () => {
            if (!finalTranscript) return;
            await navigator.clipboard.writeText(finalTranscript);
          }}
        >
          Copy
        </Button>

        <a
          href={`data:text/markdown;charset=utf-8,${encodeURIComponent(finalTranscript)}`}
          download={`${slug || 'meeting'}.md`}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          Download
        </a>

        {savedPath && <span className="font-mono text-xs text-[var(--good)]">Saved → {savedPath}</span>}
        {saveError && <span className="text-xs text-[var(--red)]">{saveError}</span>}
      </div>

      {ingestMsg && (
        <p className="text-xs text-[var(--good)]">
          {ingestMsg.href ? (
            <a
              href={ingestMsg.href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-[var(--blue-deep)]"
            >
              {ingestMsg.text}
            </a>
          ) : (
            ingestMsg.text
          )}
        </p>
      )}
    </div>
  );
}

// ── Editable list of plain strings ─────────────────────────────────────────
function ListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const update = (i: number, value: string) => onChange(items.map((it, idx) => (idx === i ? value : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, '']);

  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>{label}</span>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[var(--blue)]">•</span>
            <Input
              type="text"
              value={item}
              onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
              className="h-8 flex-1"
            />
            <button
              onClick={() => remove(i)}
              className="text-[var(--muted)] transition-colors hover:text-[var(--red)]"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="self-start text-xs text-[var(--muted)] transition-colors hover:text-[var(--blue)]">
        ＋ Add
      </button>
    </div>
  );
}

function freshSignalId(kind: 'decision' | 'commitment' | 'conflict'): string {
  return `${kind}-${globalThis.crypto.randomUUID().toLowerCase()}`;
}

function EvidenceSelect({
  value,
  onChange,
}: {
  value: MeetingEvidenceState;
  onChange: (value: MeetingEvidenceState) => void;
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value as MeetingEvidenceState)}
      className="h-7 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--card)] px-2 font-mono text-[11px] tracking-[0.06em] text-[var(--muted)] outline-none focus:border-[var(--blue)]"
      aria-label="Evidence state"
    >
      <option value="reported">Reported</option>
      <option value="inferred">Inferred</option>
    </select>
  );
}

function DecisionEditor({
  items,
  onChange,
}: {
  items: EditorDecision[];
  onChange: (items: EditorDecision[]) => void;
}) {
  const update = (i: number, patch: Partial<EditorDecision>) =>
    onChange(items.map((item, index) => index === i ? { ...item, ...patch } : item));
  const remove = (i: number) => onChange(items.filter((_, index) => index !== i));
  const add = () => onChange([...items, {
    id: freshSignalId('decision'),
    text: '',
    evidenceState: 'reported',
  }]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>Decisions</span>
      {items.map((item, i) => (
        <div key={item.id} className="grid gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card-2)] p-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-2 text-[var(--blue)]">◆</span>
            <Input
              type="text"
              value={item.text}
              onChange={event => update(i, { text: event.target.value })}
              placeholder="Decision"
              className="h-8 min-w-0 flex-1"
            />
            <button onClick={() => remove(i)} className="mt-1 text-[var(--muted)] hover:text-[var(--red)]" aria-label="Remove decision">✕</button>
          </div>
          <EvidenceSelect value={item.evidenceState} onChange={value => update(i, { evidenceState: value })} />
        </div>
      ))}
      <button onClick={add} className="self-start text-xs text-[var(--muted)] transition-colors hover:text-[var(--blue)]">＋ Add decision</button>
    </div>
  );
}

// ── Editable commitments (promises, not generic tasks) ────────────────────
function ActionItemEditor({
  items,
  onChange,
}: {
  items: EditorActionItem[];
  onChange: (items: EditorActionItem[]) => void;
}) {
  const update = (i: number, patch: Partial<EditorActionItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, {
    id: freshSignalId('commitment'),
    text: '',
    owner: null,
    due: null,
    evidenceState: 'reported',
  }]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>Commitments</span>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={item.id} className="grid gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card-2)] p-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-[var(--blue)]">☐</span>
              <Input
                type="text"
                value={item.text}
                onChange={e => update(i, { text: e.target.value })}
                placeholder="Promised outcome"
                className="h-8 min-w-0 flex-1"
              />
              <button onClick={() => remove(i)} className="mt-1 text-[var(--muted)] hover:text-[var(--red)]" aria-label="Remove commitment">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="text"
                value={item.owner ?? ''}
                onChange={e => update(i, { owner: e.target.value || null })}
                placeholder="Owner"
                className="h-8 min-w-0"
              />
              <Input
                type="date"
                value={item.due ?? ''}
                onChange={e => update(i, { due: e.target.value || null })}
                className="h-8 min-w-0"
                aria-label="Commitment checkpoint"
              />
            </div>
            <EvidenceSelect value={item.evidenceState} onChange={value => update(i, { evidenceState: value })} />
          </div>
        ))}
      </div>
      <button onClick={add} className="self-start text-xs text-[var(--muted)] transition-colors hover:text-[var(--blue)]">
        ＋ Add commitment
      </button>
    </div>
  );
}

function ConflictEditor({
  items,
  onChange,
}: {
  items: EditorConflict[];
  onChange: (items: EditorConflict[]) => void;
}) {
  const update = (i: number, patch: Partial<EditorConflict>) =>
    onChange(items.map((item, index) => index === i ? { ...item, ...patch } : item));
  const remove = (i: number) => onChange(items.filter((_, index) => index !== i));
  const add = () => onChange([...items, {
    id: freshSignalId('conflict'),
    subject: '',
    existingValue: '',
    proposedValue: '',
    question: '',
  }]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>Needs judgment</span>
      {items.map((item, i) => (
        <div key={item.id} className="grid gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--red)_35%,var(--line))] bg-[var(--card-2)] p-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-2 text-[var(--red)]">!</span>
            <Input value={item.subject} onChange={event => update(i, { subject: event.target.value })} placeholder="Subject" className="h-8 min-w-0 flex-1" />
            <button onClick={() => remove(i)} className="mt-1 text-[var(--muted)] hover:text-[var(--red)]" aria-label="Remove judgment item">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={item.existingValue} onChange={event => update(i, { existingValue: event.target.value })} placeholder="Current" className="h-8 min-w-0" />
            <Input value={item.proposedValue} onChange={event => update(i, { proposedValue: event.target.value })} placeholder="Meeting says" className="h-8 min-w-0" />
          </div>
          <Input value={item.question} onChange={event => update(i, { question: event.target.value })} placeholder="What should Robin ask you?" className="h-8 min-w-0" />
        </div>
      ))}
      <button onClick={add} className="self-start text-xs text-[var(--muted)] transition-colors hover:text-[var(--blue)]">＋ Add judgment</button>
    </div>
  );
}
