"use client";

import { Radio } from "lucide-react";
import { useWidgets } from "./WidgetProvider";
import { WidgetShell } from "./WidgetShell";
import { LiveRecorder } from "@/components/meeting/LiveRecorder";
import { TranscriptEditor } from "@/components/meeting/TranscriptEditor";
import { CalendarMatcher } from "@/components/meeting/CalendarMatcher";

const ACCENT = "var(--blue)";

export function MeetingWidget() {
  const { size, setSize, meeting: s } = useWidgets();
  const big = size === "big";
  const reviewing = s.pageStatus === "review" && s.result;

  return (
    <WidgetShell
      id="meeting"
      title="Meeting"
      icon={Radio}
      accent={ACCENT}
      live={s.isActive}
      statusLabel={s.statusLabel}
    >
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* ── Record ── */}
        {!reviewing && (
          <>
            <LiveRecorder onComplete={s.onComplete} onStatusChange={s.onStatusChange} />
            <div className="border-t border-[var(--hairline)] pt-3">
              <CalendarMatcher
                recordingStartedAt={s.recordingStartedAt}
                onSuggestion={s.setSuggestion}
              />
            </div>
          </>
        )}

        {/* ── Review ── */}
        {reviewing && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                Recording captured · {Math.round(s.result!.durationSec)}s
              </span>
              <button
                onClick={s.reset}
                className="rounded-[var(--radius)] border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--card-2)] hover:text-[var(--ink)]"
              >
                ＋ New
              </button>
            </div>

            {s.result!.objectUrl && (
              <audio src={s.result!.objectUrl} controls className="h-9 w-full" />
            )}

            {s.reviewStage !== "editing" && (
              <div className="rounded-[var(--radius-lg)] bg-[var(--card)] p-4 shadow-[var(--offset-sm)]">
                <p className="text-sm font-medium text-[var(--ink)]">
                  <span className="mr-1.5 text-[var(--blue)]">✦</span>Process with AI
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  Title, summary, decisions, commitments, conflicts, speaker names, and a cleaned
                  transcript. Everything stays editable before Robin carries it forward.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={s.runProcess}
                    disabled={s.reviewStage === "processing"}
                    className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--blue)] px-3.5 py-1.5 text-sm font-medium text-[var(--on-blue)] shadow-[var(--offset-sm)] transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {s.reviewStage === "processing" && (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    {s.reviewStage === "processing" ? "Analyzing…" : "Process with AI"}
                  </button>
                  <button
                    onClick={s.skipProcess}
                    disabled={s.reviewStage === "processing"}
                    className="rounded-[var(--radius)] border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--card-2)] hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    Skip — edit raw
                  </button>
                </div>
                {s.processError && (
                  <p className="mt-3 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--red)_40%,transparent)] bg-[var(--red-wash)] px-3 py-2 text-xs text-[var(--red)]">
                    {s.processError}
                  </p>
                )}
              </div>
            )}

            {s.reviewStage === "editing" && (
              <div className="min-h-0 flex-1">
                {s.processed?.warning && (
                  <p className="mb-3 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-2 text-xs text-[var(--warn)]">
                    {s.processed.warning}
                  </p>
                )}
                {!big && (
                  <button
                    onClick={() => setSize("big")}
                    className="mb-3 w-full rounded-[var(--radius)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)] shadow-[var(--offset-sm)] transition-colors hover:text-[var(--ink)]"
                  >
                    Editing is roomier in the big view — expand ↗
                  </button>
                )}
                <TranscriptEditor
                  transcript={s.processed?.cleanedTranscript ?? s.result!.transcript}
                  meetingId={s.result!.meetingId}
                  audioPath={s.result!.audioPath ?? undefined}
                  durationSec={s.result!.durationSec}
                  initialSlug={s.suggestion?.slug ?? ""}
                  initialAttendees={s.suggestion?.attendees.join(", ") ?? ""}
                  initialTitle={s.processed?.title ?? ""}
                  initialSummary={s.processed?.summary ?? ""}
                  initialKeyPoints={s.processed?.keyPoints ?? []}
                  initialDecisions={s.processed?.decisions ?? []}
                  initialActionItems={s.processed?.actionItems ?? []}
                  initialConflicts={s.processed?.conflicts ?? []}
                  speakerNames={s.processed?.speakers}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
