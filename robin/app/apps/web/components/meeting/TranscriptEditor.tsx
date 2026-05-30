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

export interface EditorActionItem {
  text: string;
  owner: string | null;
}

interface TranscriptEditorProps {
  transcript: string;
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
  actionItems: EditorActionItem[];
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

  const actions = input.actionItems.filter(a => a.text.trim());
  if (actions.length) {
    const lines = actions.map(a => `- [ ] ${a.text.trim()}${a.owner?.trim() ? ` — ${a.owner.trim()}` : ''}`);
    sections.push(`## Action items\n\n${lines.join('\n')}`);
  }

  // Only label the transcript when there's a preamble above it; a bare transcript
  // is left unheaded so the ingest route's legacy "Transcript" wrapper applies.
  if (sections.length) {
    sections.push(`## Transcript\n\n${input.transcript.trim()}`);
    return sections.join('\n\n');
  }
  return input.transcript.trim();
}

const LABEL = 'text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-2)]';
const FIELD =
  'w-full rounded-md border border-[var(--border-0)] bg-[var(--bg-1)] px-3 py-2 text-sm text-[var(--text-0)] outline-none transition-colors focus:border-[var(--robin-amber)]';

export function TranscriptEditor({
  transcript: initialTranscript,
  segments,
  audioPath,
  durationSec,
  initialSlug = '',
  initialAttendees = '',
  initialTitle = '',
  initialSummary = '',
  initialKeyPoints = [],
  initialActionItems = [],
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
      const composedBody = composeBody({ summary, keyPoints, actionItems, transcript: finalTranscript });
      const res = await fetch('/api/meeting/save-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: composedBody,
          title: title.trim() || undefined,
          summary: summary.trim() || undefined,
          slug: slug.trim() || undefined,
          attendees: attendees.trim() || undefined,
          audioPath,
          durationSec,
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [actionItems, attendees, audioPath, durationSec, finalTranscript, keyPoints, onSaved, slug, summary, title]);

  const handleIngest = useCallback(async () => {
    if (!ingestUrl) return;
    setIngesting(true);
    setIngestMsg(null);
    try {
      const res = await fetch(ingestUrl, { method: 'POST' });
      const data = (await res.json()) as { message?: string; outputPath?: string; pageUrl?: string; error?: string };
      if (!res.ok) {
        setIngestMsg({ text: data?.error || data?.message || `Ingest failed (${res.status})` });
        return;
      }
      const href = data?.pageUrl
        || (data?.outputPath ? vaultPageHref(data.outputPath) : undefined);
      setIngestMsg({ text: href ? `Ingested → open meeting page` : data?.message || 'Ingest complete', href });
    } catch (err) {
      setIngestMsg({ text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIngesting(false);
    }
  }, [ingestUrl]);

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

      {/* Key points + action items */}
      <div className="grid gap-5 md:grid-cols-2">
        <ListEditor
          label="Key points"
          items={keyPoints}
          onChange={setKeyPoints}
          placeholder="Add a key point"
        />
        <ActionItemEditor items={actionItems} onChange={setActionItems} />
      </div>

      {/* Speaker rename controls */}
      {speakers.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Speakers</span>
          <div className="flex flex-wrap gap-2.5">
            {speakers.map(speaker => (
              <label
                key={speaker}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border-0)] bg-[var(--bg-1)] px-2 py-1 text-sm"
              >
                <span className="font-mono text-xs text-[var(--text-2)]">{speaker}</span>
                <span className="text-[var(--text-2)]">→</span>
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
      <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--border-0)] pt-5">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : savedPath ? 'Re-save' : 'Save transcript'}
        </Button>

        <Button
          variant="outline"
          onClick={handleIngest}
          disabled={!ingestUrl || ingesting}
          className="border-[var(--status-stable)] bg-[color-mix(in_srgb,var(--status-stable)_18%,transparent)] text-[var(--status-stable)] hover:bg-[color-mix(in_srgb,var(--status-stable)_28%,transparent)] hover:text-[var(--status-stable)]"
        >
          {ingesting ? 'Ingesting…' : 'Ingest to brain'}
        </Button>

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

        {savedPath && <span className="font-mono text-xs text-[var(--status-stable)]">Saved → {savedPath}</span>}
        {saveError && <span className="text-xs text-[var(--warning-rust)]">{saveError}</span>}
      </div>

      {ingestMsg && (
        <p className="text-xs text-[var(--status-stable)]">
          {ingestMsg.href ? (
            <a
              href={ingestMsg.href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:opacity-80"
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
            <span className="text-[var(--signal-cyan)]">•</span>
            <Input
              type="text"
              value={item}
              onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
              className="h-8 flex-1"
            />
            <button
              onClick={() => remove(i)}
              className="text-[var(--text-2)] transition-colors hover:text-[var(--warning-rust)]"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="self-start text-xs text-[var(--text-1)] transition-colors hover:text-[var(--robin-amber)]">
        ＋ Add
      </button>
    </div>
  );
}

// ── Editable list of action items (text + owner) ───────────────────────────
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
  const add = () => onChange([...items, { text: '', owner: null }]);

  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Action items</span>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[var(--robin-amber)]">☐</span>
            <Input
              type="text"
              value={item.text}
              onChange={e => update(i, { text: e.target.value })}
              placeholder="Follow-up"
              className="h-8 flex-1"
            />
            <Input
              type="text"
              value={item.owner ?? ''}
              onChange={e => update(i, { owner: e.target.value || null })}
              placeholder="Owner"
              className="h-8 w-24"
            />
            <button
              onClick={() => remove(i)}
              className="text-[var(--text-2)] transition-colors hover:text-[var(--warning-rust)]"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="self-start text-xs text-[var(--text-1)] transition-colors hover:text-[var(--robin-amber)]">
        ＋ Add
      </button>
    </div>
  );
}
