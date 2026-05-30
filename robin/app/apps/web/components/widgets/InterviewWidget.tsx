"use client";

import { Mic } from "lucide-react";
import { useWidgets } from "./WidgetProvider";
import { WidgetShell } from "./WidgetShell";
import VoiceBars from "@/components/interview/VoiceBars";
import BriefPicker from "@/components/interview/BriefPicker";
import TranscriptView from "@/components/interview/TranscriptView";

const ACCENT = "rgb(167 139 250)"; // violet (--decision-violet)

export function InterviewWidget() {
  const { size, interview: s } = useWidgets();
  const big = size === "big";

  // Compact dual meter — only meaningful while a session is live.
  const meters = (h: number) => (
    <div className="flex flex-col gap-1 rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[9px] font-medium uppercase tracking-wider text-violet-300/70">
          Robin
        </span>
        <div className="flex-1">
          <VoiceBars analyser={s.isLive ? s.analyser : null} color="rgb(167 139 250)" height={h} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[9px] font-medium uppercase tracking-wider text-emerald-300/70">
          You
        </span>
        <div className="flex-1">
          <VoiceBars analyser={s.isLive ? s.inputAnalyser : null} color="rgb(52 211 153)" height={h} />
        </div>
      </div>
    </div>
  );

  const startStop = !s.isActive ? (
    <button
      onClick={s.start}
      disabled={!s.canStart}
      className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-all hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      Start interview
    </button>
  ) : (
    <button
      onClick={s.stop}
      className="flex items-center justify-center gap-2 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-600"
    >
      <span className="h-2 w-2 rounded-sm bg-red-400" aria-hidden />
      {s.isBusy ? "Cancel" : "End interview"}
    </button>
  );

  const relayWarning = s.wsConfig && !s.relayReady && (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
      {s.wsConfig.error?.message ??
        "Voice relay is not configured. Set XAI_API_KEY and restart the dev server."}
    </div>
  );

  // Live phase indicator: a labelled dot that reads connecting → listening →
  // speaking → reconnecting at a glance.
  const PHASE_UI: Record<string, { label: string; color: string; pulse: boolean }> = {
    connecting: { label: "Connecting…", color: "rgb(250 204 21)", pulse: true },
    reconnecting: { label: "Reconnecting…", color: "rgb(251 146 60)", pulse: true },
    listening: { label: "Listening — your turn", color: "rgb(52 211 153)", pulse: true },
    speaking: { label: "Robin is speaking", color: "rgb(167 139 250)", pulse: true },
  };
  const phaseInfo = PHASE_UI[s.phase];
  const phasePill = s.isActive && phaseInfo && (
    <div className="flex items-center gap-2 rounded-md border border-white/5 bg-black/20 px-3 py-1.5">
      <span
        className={`h-2 w-2 rounded-full ${phaseInfo.pulse ? "animate-pulse" : ""}`}
        style={{ background: phaseInfo.color, boxShadow: `0 0 8px ${phaseInfo.color}` }}
        aria-hidden
      />
      <span className="text-[11px] font-medium text-slate-200">{phaseInfo.label}</span>
    </div>
  );

  // Reconnecting / error banners. Mic-permission denial gets a distinct,
  // actionable message rather than a raw DOMException string.
  const reconnectBanner = s.isReconnecting && (
    <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-[11px] leading-relaxed text-orange-200">
      {s.detail ?? "Connection dropped — reconnecting…"} The session resumes automatically.
    </div>
  );

  const errorBanner = s.state === "error" && (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
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
      <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-2)]">
        Brief
      </label>
      {s.briefsError ? (
        <p className="text-xs text-red-400">{s.briefsError}</p>
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
        className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
      >
        {s.saveStatus.kind === "saving" ? "Saving…" : "Save & Ingest"}
      </button>
      {s.saveStatus.kind === "ok" && (
        <span className="truncate text-[11px] text-slate-400">
          Saved · {s.saveStatus.pageUrl ? (
            <a href={s.saveStatus.pageUrl} className="text-violet-300 hover:underline">open page</a>
          ) : (
            s.saveStatus.filename
          )}
        </span>
      )}
      {s.saveStatus.kind === "err" && (
        <span className="truncate text-[11px] text-red-400">Save failed</span>
      )}
    </div>
  );

  const transcript = (
    <div className="flex min-h-0 flex-1 flex-col">
      <span className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-2)]">
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
            {startStop}
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
          {startStop}
          {phasePill}
          {reconnectBanner}
          {errorBanner}
          {s.isActive && meters(20)}
          <div className="min-h-0 flex-1 border-t border-white/5 pt-2.5">{transcript}</div>
          {saveRow}
        </div>
      )}
    </WidgetShell>
  );
}
