"use client";

import { Mic } from "lucide-react";
import { useWidgets } from "./WidgetProvider";
import { WidgetShell } from "./WidgetShell";
import VoiceBars from "@/components/interview/VoiceBars";
import BriefPicker from "@/components/interview/BriefPicker";
import TranscriptView from "@/components/interview/TranscriptView";

const ACCENT = "var(--blue)"; // the Quiet Slate accent

function compactDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function InterviewWidget() {
  const { size, interview: s } = useWidgets();
  const big = size === "big";

  // Compact dual meter — only meaningful while a session is live.
  const meters = (h: number) => (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] bg-[var(--card-2)] px-2.5 py-2 shadow-[var(--offset-sm)]">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--blue)]">
          Robin
        </span>
        <div className="flex-1">
          <VoiceBars analyser={s.isLive ? s.analyser : null} color="var(--blue)" height={h} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          You
        </span>
        <div className="flex-1">
          <VoiceBars analyser={s.isLive ? s.inputAnalyser : null} color="var(--good)" height={h} />
        </div>
      </div>
    </div>
  );

  const startStop = !s.isActive ? (
    <button
      onClick={s.start}
      disabled={!s.canStart}
      className="rounded-[var(--radius)] bg-[var(--blue)] px-4 py-2 text-sm font-semibold text-[var(--on-blue)] shadow-[var(--offset-sm)] transition-all hover:bg-[var(--blue-deep)] hover:shadow-[var(--offset)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {s.recordingStatus.kind === "saving" ? "Saving audio…" : "Start interview"}
    </button>
  ) : (
    <button
      onClick={s.stop}
      className="flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-[var(--offset-sm)] transition-colors hover:bg-[var(--card-2)]"
    >
      <span className="h-2 w-2 rounded-full bg-[var(--red)]" aria-hidden />
      {s.isBusy ? "Cancel" : "End interview"}
    </button>
  );

  const relayWarning = s.wsConfig && !s.relayReady && (
    <div className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--warn)]">
      {s.wsConfig.error?.message ??
        "Voice relay is not configured. Set XAI_API_KEY and restart the dev server."}
    </div>
  );

  const captureNotice = !s.isActive && s.recordingStatus.kind === "idle" && (
    <div className="rounded-[var(--radius)] border border-[var(--hairline)] bg-[var(--card-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
      The selected brief and live voice are sent to xAI, whose default API retention is up
      to 30 days. Your microphone answers and the two-sided transcript are saved locally;
      the xAI key stays on the server.
    </div>
  );

  const recordingNotice = (
    <div aria-live="polite">
      {s.isActive && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--red-wash)] px-3 py-2 text-[11px] font-medium text-[var(--red)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--red)]" aria-hidden />
          REC · your microphone answers only
        </div>
      )}
      {!s.isActive && s.recordingStatus.kind === "saving" && (
        <div className="rounded-[var(--radius)] bg-[var(--card-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
          Saving the answer recording locally…
        </div>
      )}
      {s.recordingStatus.kind === "ok" && (
        <div
          className="truncate rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--good)_12%,transparent)] px-3 py-2 text-[11px] text-[var(--good)]"
          title={s.recordingStatus.audioPath}
        >
          Answer audio saved locally · {compactDuration(s.recordingStatus.durationSec)}
        </div>
      )}
      {s.recordingStatus.kind === "err" && (
        <div className="rounded-[var(--radius)] bg-[var(--red-wash)] px-3 py-2 text-[11px] leading-relaxed text-[var(--red)]">
          Audio save failed: {s.recordingStatus.message}
        </div>
      )}
    </div>
  );

  // Live phase indicator: a labelled dot that reads connecting → listening →
  // speaking → reconnecting at a glance.
  const PHASE_UI: Record<string, { label: string; color: string; pulse: boolean }> = {
    connecting: { label: "Connecting…", color: "var(--warn)", pulse: true },
    reconnecting: { label: "Reconnecting…", color: "var(--warn)", pulse: true },
    listening: { label: "Listening — your turn", color: "var(--good)", pulse: true },
    speaking: { label: "Robin is speaking", color: "var(--blue)", pulse: true },
  };
  const phaseInfo = PHASE_UI[s.phase];
  const phasePill = s.isActive && phaseInfo && (
    <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--card-2)] px-3 py-1.5 shadow-[var(--offset-sm)]">
      <span
        className={`h-2 w-2 rounded-full ${phaseInfo.pulse ? "animate-pulse" : ""}`}
        style={{ background: phaseInfo.color, boxShadow: `0 0 8px ${phaseInfo.color}` }}
        aria-hidden
      />
      <span className="text-[11px] font-medium text-[var(--ink)]">{phaseInfo.label}</span>
    </div>
  );

  // Reconnecting / error banners. Mic-permission denial gets a distinct,
  // actionable message rather than a raw DOMException string.
  const reconnectBanner = s.isReconnecting && (
    <div className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--warn)]">
      {s.detail ?? "Connection dropped — reconnecting…"} The session resumes automatically.
    </div>
  );

  const errorBanner = s.state === "error" && (
    <div className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--red)_40%,transparent)] bg-[var(--red-wash)] px-3 py-2 text-[11px] leading-relaxed text-[var(--red)]">
      {s.errorKind === "mic-permission" ? (
        <>
          <span className="font-semibold">Microphone access blocked.</span> Allow the mic
          for this site (check the address-bar camera/mic icon), then press Start again.
        </>
      ) : (
        <>
          <span className="font-semibold">Interview ended unexpectedly.</span>{" "}
          {s.error ?? "Unknown error."} Press Start to try again.
        </>
      )}
    </div>
  );

  const briefField = (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
        Brief
      </label>
      {s.briefsError ? (
        <p className="text-xs text-[var(--red)]">{s.briefsError}</p>
      ) : (
        <BriefPicker
          briefs={s.briefs}
          selected={s.selectedBrief}
          onChange={s.setSelectedBrief}
          disabled={s.isActive}
        />
      )}
    </div>
  );

  const saveRow = s.canSave && (
    <div className="flex items-center gap-2">
      <button
        onClick={s.save}
        disabled={s.saveStatus.kind === "saving"}
        className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--blue)_40%,transparent)] bg-[var(--accent-wash)] px-3 py-1.5 text-xs font-medium text-[var(--blue-deep)] transition-colors hover:bg-[color-mix(in_srgb,var(--blue)_18%,transparent)] disabled:opacity-40"
      >
        {s.saveStatus.kind === "saving" ? "Saving…" : "Save & Ingest"}
      </button>
      {s.saveStatus.kind === "ok" && (
        <span className="truncate text-[11px] text-[var(--muted)]">
          Saved · {s.saveStatus.pageUrl ? (
            <a href={s.saveStatus.pageUrl} className="text-[var(--link)] hover:underline">open page</a>
          ) : (
            s.saveStatus.filename
          )}
        </span>
      )}
      {s.saveStatus.kind === "err" && (
        <span className="truncate text-[11px] text-[var(--red)]">Save failed</span>
      )}
    </div>
  );

  // h-full (not just flex-1) so the transcript fills a bounded height in BOTH
  // layouts: in the big layout its parent is a flex row (stretch gives height),
  // but in the small layout its parent is a plain block where flex-1 is inert —
  // without an explicit height the inner overflow-y-auto never bounds, so the
  // conversation just grows and gets clipped instead of scrolling to the latest.
  const transcript = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
        Transcript
      </span>
      <div className="min-h-0 flex-1">
        <TranscriptView entries={s.transcript} isLive={s.isActive} />
      </div>
    </div>
  );

  return (
    <WidgetShell
      id="interview"
      title="Interview"
      icon={Mic}
      accent={ACCENT}
      live={s.isActive}
      statusLabel={s.statusLabel}
    >
      {big ? (
        <div className="flex h-full min-h-0 gap-5">
          {transcript}
          <div className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
            {briefField}
            {relayWarning}
            {captureNotice}
            {startStop}
            {recordingNotice}
            {phasePill}
            {reconnectBanner}
            {errorBanner}
            {meters(34)}
            {saveRow}
          </div>
        </div>
      ) : (
        // Small: transcript-first. Controls stay tight at the top; meters only
        // appear while live so they never crowd out the conversation.
        <div className="flex h-full min-h-0 flex-col gap-2.5">
          {!s.isActive && briefField}
          {relayWarning}
          {captureNotice}
          {startStop}
          {recordingNotice}
          {phasePill}
          {reconnectBanner}
          {errorBanner}
          {s.isActive && meters(20)}
          <div className="min-h-0 flex-1 border-t border-[var(--hairline)] pt-2.5">{transcript}</div>
          {saveRow}
        </div>
      )}
    </WidgetShell>
  );
}
