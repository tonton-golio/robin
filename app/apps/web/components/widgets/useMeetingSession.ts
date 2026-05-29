"use client";

/**
 * useMeetingSession — meeting recorder orchestration, hoisted out of the page so
 * a live recording survives route navigation. The media plumbing lives inside
 * the <LiveRecorder> component (kept mounted in the dock); this hook holds the
 * surrounding flow state: recording status, the finished result, and the
 * process → review stage machine.
 */

import { useCallback, useState } from "react";
import type { LiveRecordingResult, LiveStatus } from "@/components/meeting/LiveRecorder";
import type { EditorActionItem } from "@/components/meeting/TranscriptEditor";

export type PageStatus = "idle" | "recording" | "review";
export type ReviewStage = "choose" | "processing" | "editing";

export interface ProcessResult {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: EditorActionItem[];
  speakers: Record<string, string>;
  cleanedTranscript: string;
  model?: string;
}

export interface MeetingSession {
  status: LiveStatus;
  pageStatus: PageStatus;
  result: LiveRecordingResult | null;
  recordingStartedAt: Date | null;
  suggestion: { slug: string; attendees: string[] } | null;
  setSuggestion: (s: { slug: string; attendees: string[] } | null) => void;

  reviewStage: ReviewStage;
  processed: ProcessResult | null;
  processError: string | null;

  isRecording: boolean;
  isActive: boolean;
  statusLabel: string;

  onStatusChange: (s: LiveStatus) => void;
  onComplete: (r: LiveRecordingResult) => void;
  runProcess: () => Promise<void>;
  skipProcess: () => void;
  reset: () => void;
}

export function useMeetingSession(): MeetingSession {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [pageStatus, setPageStatus] = useState<PageStatus>("idle");
  const [result, setResult] = useState<LiveRecordingResult | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<Date | null>(null);
  const [suggestion, setSuggestion] = useState<{ slug: string; attendees: string[] } | null>(null);

  const [reviewStage, setReviewStage] = useState<ReviewStage>("choose");
  const [processed, setProcessed] = useState<ProcessResult | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const onComplete = useCallback((r: LiveRecordingResult) => {
    setResult(r);
    setPageStatus("review");
    setReviewStage("choose");
    setProcessed(null);
    setProcessError(null);
  }, []);

  const onStatusChange = useCallback((s: LiveStatus) => {
    setStatus(s);
    if (s === "recording") setRecordingStartedAt(new Date());
  }, []);

  const runProcess = useCallback(async () => {
    if (!result) return;
    setReviewStage("processing");
    setProcessError(null);
    try {
      const res = await fetch("/api/meeting/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: result.transcript,
          durationSec: result.durationSec,
          attendees: suggestion?.attendees ?? [],
        }),
      });
      const data = (await res.json()) as ProcessResult & { error?: string };
      if (!res.ok) {
        setProcessError(data.error ?? `Processing failed (${res.status})`);
        setReviewStage("choose");
        return;
      }
      setProcessed(data);
      setReviewStage("editing");
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
      setReviewStage("choose");
    }
  }, [result, suggestion]);

  const skipProcess = useCallback(() => {
    setProcessed(null);
    setReviewStage("editing");
  }, []);

  const reset = useCallback(() => {
    setResult((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
    setPageStatus("idle");
    setRecordingStartedAt(null);
    setSuggestion(null);
    setReviewStage("choose");
    setProcessed(null);
    setProcessError(null);
  }, []);

  const isRecording = status === "recording";
  const isActive =
    status === "recording" ||
    status === "connecting" ||
    status === "reconnecting" ||
    status === "finalizing";

  const statusLabel = (() => {
    if (pageStatus === "review") return reviewStage === "processing" ? "Processing…" : "Review";
    switch (status) {
      case "idle": return "Ready";
      case "connecting": return "Connecting…";
      case "recording": return "Recording";
      case "reconnecting": return "Reconnecting…";
      case "finalizing": return "Saving…";
      case "error": return "Error";
    }
  })();

  return {
    status,
    pageStatus,
    result,
    recordingStartedAt,
    suggestion,
    setSuggestion,
    reviewStage,
    processed,
    processError,
    isRecording,
    isActive,
    statusLabel,
    onStatusChange,
    onComplete,
    runProcess,
    skipProcess,
    reset,
  };
}
