"use client";

/**
 * React wrapper around the VoiceClient lifecycle.
 * Manages start/stop, exposes state + transcript + analyser to parent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VoiceClient,
  type VoiceState,
  type VoiceErrorKind,
  type TranscriptEntry,
  type WsUrlProvider,
} from "@/lib/voice-client";

export interface VoiceClientState {
  state: VoiceState;
  error: string | null;
  errorKind: VoiceErrorKind | null;
  /** Human status detail for transient states like "reconnecting". */
  detail: string | null;
  transcript: TranscriptEntry[];
  analyser: AnalyserNode | null;       // AI playback (what the interviewer is saying)
  inputAnalyser: AnalyserNode | null;  // User mic input level (what you are saying)
  /** Accepts a static URL or a provider that mints a fresh URL/token per attempt. */
  start: (wsUrl: string | WsUrlProvider) => Promise<void>;
  stop: () => Promise<void>;
}

export function useVoiceClient(): VoiceClientState {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<VoiceErrorKind | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const clientRef = useRef<VoiceClient | null>(null);

  const start = useCallback(async (wsUrl: string | WsUrlProvider) => {
    setError(null);
    setErrorKind(null);
    setDetail(null);
    setTranscript([]);
    setAnalyser(null);
    setInputAnalyser(null);
    const client = new VoiceClient(wsUrl, {
      onState: (s, d, kind) => {
        setState(s);
        if (s === "error") {
          setError(d ?? "Something went wrong");
          setErrorKind(kind ?? "unknown");
        } else {
          setDetail(s === "reconnecting" ? (d ?? "Reconnecting…") : null);
        }
      },
      onTranscript: (t) => setTranscript(t),
      onAnalyser: (a) => setAnalyser(a),
      onInputAnalyser: (a) => setInputAnalyser(a),
    });
    clientRef.current = client;
    await client.start();
  }, []);

  const stop = useCallback(async () => {
    await clientRef.current?.stop();
    clientRef.current = null;
  }, []);

  // Safety net: if this hook ever unmounts mid-session (HMR, error boundary,
  // a future layout change), tear down the mic / WebSocket / audio so they
  // don't keep running.
  useEffect(() => {
    return () => {
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  return { state, error, errorKind, detail, transcript, analyser, inputAnalyser, start, stop };
}
