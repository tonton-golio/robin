"use client";

/**
 * useInterviewSession — the voice-interview tool, hoisted out of the page so a
 * live session survives route navigation. Owns brief selection, relay config,
 * the VoiceClient lifecycle, and save-to-brain. Mounted once in WidgetProvider.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useVoiceClient } from "@/components/interview/VoiceClient";
import type { TranscriptEntry } from "@/lib/voice-client";
import { QUICK_INTERVIEW_SLUG } from "@/lib/interview-constants";

export interface BriefEntry {
  slug: string;
  title: string;
}

const QUICK_OPTION: BriefEntry = {
  slug: QUICK_INTERVIEW_SLUG,
  title: "Quick interview (full brain)",
};

interface WsConfig {
  wsUrl: string;
  model: string;
  voice: string;
  ready: boolean;
  error: { code: string; message: string } | null;
}

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; filename: string; pageUrl: string }
  | { kind: "err"; message: string };

export type RecordingStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; audioPath: string; durationSec: number }
  | { kind: "err"; message: string };

function formatTranscript(entries: TranscriptEntry[], title: string, audioPath?: string): string {
  const stamp = new Date().toISOString();
  const audioLine = audioPath ? `Answer audio: ${audioPath}\n\n` : "";
  const head = `# ${title}\n\nExported: ${stamp}\n\n${audioLine}---\n\n`;
  const body = entries
    .map((e) => {
      const who = e.role === "assistant" ? "Interviewer" : "You";
      return `**${who}:** ${e.text}`;
    })
    .join("\n\n");
  return head + body + "\n";
}

export interface InterviewSession {
  briefs: BriefEntry[];
  briefsError: string | null;
  selectedBrief: string;
  setSelectedBrief: (slug: string) => void;
  selectedBriefTitle: string;
  wsConfig: WsConfig | null;
  relayReady: boolean;

  state: ReturnType<typeof useVoiceClient>["state"];
  statusLabel: string;
  error: string | null;
  errorKind: ReturnType<typeof useVoiceClient>["errorKind"];
  detail: string | null;
  transcript: TranscriptEntry[];
  analyser: AnalyserNode | null;
  inputAnalyser: AnalyserNode | null;

  isLive: boolean;
  isBusy: boolean;
  isActive: boolean;
  isReconnecting: boolean;
  canStart: boolean;
  canSave: boolean;

  /** Coarse phase for the UI: what is happening right now. */
  phase: "idle" | "connecting" | "reconnecting" | "speaking" | "listening" | "ended" | "error";

  saveStatus: SaveStatus;
  recordingStatus: RecordingStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  save: () => Promise<void>;
}

export function useInterviewSession(): InterviewSession {
  const [briefs, setBriefs] = useState<BriefEntry[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<string>("");
  const [wsConfig, setWsConfig] = useState<WsConfig | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({ kind: "idle" });
  const [briefsError, setBriefsError] = useState<string | null>(null);

  const { state, error, errorKind, detail, transcript, analyser, inputAnalyser, start, stop } =
    useVoiceClient();

  useEffect(() => {
    fetch("/api/interview/briefs")
      .then((r) => r.json())
      .then((data: { briefs?: BriefEntry[] }) => {
        const list = data.briefs ?? [];
        setBriefs([QUICK_OPTION, ...list]);
        const requested = new URLSearchParams(window.location.search).get("interview");
        const requestedBrief = requested ? list.find((brief) => brief.slug === requested) : null;
        setSelectedBrief(requestedBrief?.slug ?? QUICK_OPTION.slug);
      })
      .catch((e: Error) => setBriefsError(`Could not load briefs: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!selectedBrief) return;
    fetch(`/api/interview/voice?brief=${encodeURIComponent(selectedBrief)}`)
      .then((r) => r.json())
      .then((data: WsConfig) => setWsConfig(data))
      .catch(() => setWsConfig(null));
  }, [selectedBrief]);

  const isLive = state === "live";
  const isReconnecting = state === "reconnecting";
  const isBusy = state === "connecting" || isReconnecting;
  const isActive = isLive || isBusy;
  const relayReady = !!wsConfig && wsConfig.ready;
  const canStart =
    !isActive && !!selectedBrief && relayReady && recordingStatus.kind !== "saving";
  const canSave =
    !isActive &&
    transcript.length > 0 &&
    saveStatus.kind !== "saving" &&
    recordingStatus.kind !== "saving";

  const selectedBriefTitle = useMemo(() => {
    if (selectedBrief === QUICK_INTERVIEW_SLUG) return "Quick interview (full brain)";
    return briefs.find((b) => b.slug === selectedBrief)?.title ?? selectedBrief ?? "Interview";
  }, [briefs, selectedBrief]);

  const statusLabel = useMemo(() => {
    if (recordingStatus.kind === "saving") return "Saving audio…";
    switch (state) {
      case "idle": return "Ready";
      case "connecting": return "Connecting…";
      case "live": return "Listening";
      case "reconnecting": return "Reconnecting…";
      case "ended": return "Ended";
      case "error": return "Error";
    }
  }, [state, recordingStatus.kind]);

  // Coarse phase for the UI. While live we distinguish "speaking" (Robin has a
  // partial assistant turn streaming) from "listening" (waiting on the user).
  const phase = useMemo<InterviewSession["phase"]>(() => {
    if (state === "error") return "error";
    if (state === "ended") return "ended";
    if (state === "reconnecting") return "reconnecting";
    if (state === "connecting") return "connecting";
    if (state === "live") {
      const last = transcript[transcript.length - 1];
      return last?.role === "assistant" && last.partial ? "speaking" : "listening";
    }
    return "idle";
  }, [state, transcript]);

  const handleStart = useCallback(async () => {
    if (!wsConfig || !selectedBrief) return;
    setSaveStatus({ kind: "idle" });
    setRecordingStatus({ kind: "idle" });
    // Pass a provider rather than a static URL: each connection attempt
    // (including reconnects) re-fetches a fresh signed session token, since the
    // token minted at first start may have expired by the time a reconnect fires.
    const briefForSession = selectedBrief;
    await start(async () => {
      const res = await fetch(
        `/api/interview/voice?brief=${encodeURIComponent(briefForSession)}`,
      );
      if (!res.ok) throw new Error(`Failed to mint session token (HTTP ${res.status})`);
      const data = (await res.json()) as WsConfig;
      if (!data.wsUrl) throw new Error("Relay did not return a session URL");
      return data.wsUrl;
    });
  }, [wsConfig, selectedBrief, start]);

  const handleStop = useCallback(async () => {
    setRecordingStatus({ kind: "saving" });
    try {
      const recording = await stop();
      if (!recording) {
        setRecordingStatus({
          kind: "err",
          message: "No microphone audio was captured; the transcript is still auto-saved.",
        });
        return;
      }

      const body = new FormData();
      body.append("audio", recording.blob, "answers.webm");
      body.append("durationSec", String(recording.durationSec));
      body.append("slug", selectedBrief);
      const response = await fetch("/api/interview/audio", { method: "POST", body });
      const data = (await response.json()) as { audioPath?: string; error?: string };
      if (!response.ok || !data.audioPath) {
        throw new Error(data.error ?? `Audio upload failed (HTTP ${response.status})`);
      }
      setRecordingStatus({
        kind: "ok",
        audioPath: data.audioPath,
        durationSec: recording.durationSec,
      });
    } catch (error) {
      setRecordingStatus({
        kind: "err",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [stop, selectedBrief]);

  const save = useCallback(async () => {
    setSaveStatus({ kind: "saving" });
    try {
      const audioPath = recordingStatus.kind === "ok" ? recordingStatus.audioPath : undefined;
      const md = formatTranscript(transcript, selectedBriefTitle, audioPath);
      const res = await fetch("/api/interview/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: md, slug: selectedBrief }),
      });
      const data = (await res.json()) as {
        filename?: string;
        ingest?: { status?: string; pageUrl?: string };
        error?: string;
      };
      if (!res.ok || data.error) {
        setSaveStatus({ kind: "err", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setSaveStatus({
        kind: "ok",
        filename: data.filename ?? "transcript.md",
        pageUrl: data.ingest?.pageUrl ?? "",
      });
    } catch (e) {
      setSaveStatus({ kind: "err", message: e instanceof Error ? e.message : String(e) });
    }
  }, [transcript, selectedBriefTitle, selectedBrief, recordingStatus]);

  return {
    briefs,
    briefsError,
    selectedBrief,
    setSelectedBrief,
    selectedBriefTitle,
    wsConfig,
    relayReady,
    state,
    statusLabel,
    error,
    errorKind,
    detail,
    transcript,
    analyser,
    inputAnalyser,
    isLive,
    isBusy,
    isActive,
    isReconnecting,
    canStart,
    canSave,
    phase,
    saveStatus,
    recordingStatus,
    start: handleStart,
    stop: handleStop,
    save,
  };
}
