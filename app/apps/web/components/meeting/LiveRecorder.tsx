'use client';

/**
 * LiveRecorder.tsx
 *
 * Minimalist live meeting recorder. One control, live captions, done.
 *
 * - getUserMedia(audio) → MediaRecorder (webm/opus, 250ms chunks)
 * - Each chunk is forwarded to Deepgram over a WebSocket AND buffered locally
 *   so we keep a playable audio file for the saved meeting.
 * - Deepgram returns interim (live, gray) + final (committed, with speaker
 *   labels) results. The committed text IS the final transcript.
 * - On stop: uploads the audio blob, hands the assembled transcript +
 *   audioPath back to the parent.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bestMimeType, blobToObjectURL, formatDuration, getBlobDurationSec } from '@/lib/audio-utils';
import { DeepgramLive, type CommittedLine } from '@/lib/deepgram-live';
import { Button } from '@/components/ui';

export interface LiveRecordingResult {
  transcript: string;
  durationSec: number;
  audioPath: string | null;
  objectUrl: string;
}

interface LiveRecorderProps {
  onComplete: (result: LiveRecordingResult) => void;
  onStatusChange?: (status: LiveStatus) => void;
}

export type LiveStatus = 'idle' | 'connecting' | 'recording' | 'reconnecting' | 'finalizing' | 'error';

const LEVEL_BARS = 28;
const LEVEL_SMOOTHING = 0.8;

// Crash-safety: how often to checkpoint the committed transcript to disk +
// localStorage while recording. 5s is frequent enough to lose almost nothing,
// rare enough to be negligible I/O.
const CHECKPOINT_INTERVAL_MS = 5000;
const LS_CHECKPOINT_PREFIX = 'robin:meeting:partial:';

// Bounded in-memory audio buffer. MediaRecorder chunks accumulate in memory
// until "Stop & save" assembles the blob; an unbounded buffer would grow until
// the tab OOMs on a very long meeting. opus@128kbps ≈ ~1 MB/min, so 400 MB is
// ~6.5 hours of audio — generous, but a hard ceiling that protects the tab.
// Past the cap we drop the *oldest* chunks (keep the recent tail) and flag it.
const MAX_AUDIO_BUFFER_BYTES = 400 * 1024 * 1024;

export function LiveRecorder({ onComplete, onStatusChange }: LiveRecorderProps) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lines, setLines] = useState<CommittedLine[]>([]);
  const [interim, setInterim] = useState('');
  const [levels, setLevels] = useState<number[]>(Array(LEVEL_BARS).fill(0));
  const [captureSystem, setCaptureSystem] = useState(true);
  const [sysNote, setSysNote] = useState<string | null>(null);
  const [bufferTrimmed, setBufferTrimmed] = useState(false);

  const dgRef = useRef<DeepgramLive | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bufferBytesRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef(0);
  const smoothRef = useRef(0);
  const captionsRef = useRef<HTMLDivElement | null>(null);
  // Crash-safety checkpoint plumbing.
  const sessionIdRef = useRef<string | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest committed transcript text, kept in a ref so the checkpoint interval
  // can read it without being re-created on every commit.
  const transcriptRef = useRef('');

  const setStatusSafe = useCallback(
    (s: LiveStatus) => {
      setStatus(s);
      onStatusChange?.(s);
    },
    [onStatusChange],
  );

  // ── Crash-safety checkpointing ──────────────────────────────────────────
  // Persist the committed transcript both to localStorage (instant, in-tab)
  // and to a server-side .partial.txt (durable across a tab crash). Either
  // alone is a fallback for the other: localStorage survives a server restart,
  // the server file survives a tab crash.
  const writeLocalCheckpoint = useCallback((sessionId: string, text: string) => {
    try {
      localStorage.setItem(
        `${LS_CHECKPOINT_PREFIX}${sessionId}`,
        JSON.stringify({ updated: Date.now(), elapsedSec: (Date.now() - startRef.current) / 1000, transcript: text }),
      );
    } catch {
      /* storage full / disabled — non-fatal, the server checkpoint still runs */
    }
  }, []);

  const flushCheckpoint = useCallback(
    (sessionId: string, text: string) => {
      writeLocalCheckpoint(sessionId, text);
      // Fire-and-forget; a failed checkpoint must never disrupt recording.
      void fetch('/api/meeting/partial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcript: text,
          durationSec: (Date.now() - startRef.current) / 1000,
        }),
        keepalive: true, // let it complete even if the tab is closing
      }).catch(() => {});
    },
    [writeLocalCheckpoint],
  );

  const clearCheckpoint = useCallback((sessionId: string) => {
    try {
      localStorage.removeItem(`${LS_CHECKPOINT_PREFIX}${sessionId}`);
    } catch {
      /* non-fatal */
    }
    void fetch(`/api/meeting/partial?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => {});
  }, []);

  // Auto-scroll captions to the latest line.
  useEffect(() => {
    captionsRef.current?.scrollTo({ top: captionsRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, interim]);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
    checkpointTimerRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevels(Array(LEVEL_BARS).fill(0));
  }, []);

  useEffect(() => () => {
    dgRef.current?.close();
    cleanup();
  }, [cleanup]);

  // Last-ditch checkpoint if the tab is closed/refreshed mid-recording. The
  // 5s interval covers crashes; this covers the user closing the tab. We don't
  // try to clean up media here — the browser tears the page down anyway.
  useEffect(() => {
    const onBeforeUnload = () => {
      const sid = sessionIdRef.current;
      if (sid && status === 'recording') flushCheckpoint(sid, transcriptRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status, flushCheckpoint]);

  const startMeter = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += (data[i] ?? 0) ** 2;
      const rms = Math.sqrt(sum / data.length) / 255;
      smoothRef.current = smoothRef.current * LEVEL_SMOOTHING + rms * (1 - LEVEL_SMOOTHING);
      const lvl = smoothRef.current;
      setLevels(Array.from({ length: LEVEL_BARS }, (_, i) => {
        // Center-weighted bars react around the middle for a waveform feel.
        const dist = Math.abs(i - LEVEL_BARS / 2) / (LEVEL_BARS / 2);
        return Math.max(0, lvl * (1.2 - dist));
      }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setLines([]);
    setInterim('');
    setSysNote(null);
    setStatusSafe('connecting');

    // 1. System / tab audio (the other participants). Requested FIRST so the
    //    click's user-activation is still fresh for the screen-share picker.
    //    On macOS Chrome this captures the audio of a shared *Chrome tab*
    //    (e.g. Google Meet / Zoom web). The browser cannot reach the audio of
    //    the Zoom/Teams *desktop apps* on macOS — join the call in a browser
    //    tab and share that tab, or run the meeting on speaker (see the UI copy
    //    below). There is no shipping native fallback today.
    let displayStream: MediaStream | null = null;
    if (captureSystem) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        // We only want the audio; drop the video track immediately.
        display.getVideoTracks().forEach((t) => t.stop());
        if (display.getAudioTracks().length > 0) {
          displayStream = display;
          displayStreamRef.current = display;
          setSysNote('Capturing mic + shared audio.');
        } else {
          setSysNote('No audio was shared — recording mic only. Re-share and tick “Share tab audio”.');
        }
      } catch {
        // User cancelled the picker or it’s unsupported → mic-only.
        setSysNote('Shared-audio capture skipped — recording mic only.');
      }
    }

    // 2. Mic
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      displayStream?.getTracks().forEach((t) => t.stop());
      setError(`Microphone access denied: ${err instanceof Error ? err.message : String(err)}`);
      setStatusSafe('error');
      return;
    }
    streamRef.current = stream;

    // 3. Mix mic + shared audio into a single stream, and tap it for the meter.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const mixDest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;

    const micSrc = ctx.createMediaStreamSource(stream);
    micSrc.connect(mixDest);
    micSrc.connect(analyser);
    if (displayStream) {
      const sysSrc = ctx.createMediaStreamSource(displayStream);
      sysSrc.connect(mixDest);
      sysSrc.connect(analyser);
    }
    // NB: never connect to ctx.destination — that would echo the call to speakers.
    const recordStream = mixDest.stream;
    startMeter(analyser);

    // Stable session id for crash-safety checkpoints (filesystem-safe).
    const sessionId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    sessionIdRef.current = sessionId;
    transcriptRef.current = '';

    // 3. Deepgram socket
    const dg = new DeepgramLive({
      onInterim: setInterim,
      onCommit: (committed) => {
        setLines([...committed]);
        // Keep the latest committed transcript in a ref so the periodic
        // checkpoint (and beforeunload) can read it without re-subscribing.
        transcriptRef.current = dgRef.current?.transcript ?? '';
      },
      onError: (msg) => {
        setError(msg);
        setStatusSafe('error');
      },
      // Mid-session drop → show a reconnecting state but keep the session alive.
      onReconnecting: (attempt, delayMs) => {
        setStatusSafe('reconnecting');
        setSysNote(`Connection dropped — reconnecting (attempt ${attempt}, ${Math.round(delayMs / 100) / 10}s)…`);
      },
      onReconnected: () => {
        setStatusSafe('recording');
        setSysNote('Reconnected — live transcript resumed.');
      },
    });
    dgRef.current = dg;
    try {
      await dg.connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatusSafe('error');
      cleanup();
      return;
    }

    // If the user stops the browser's screen-share via its own banner, drop
    // the note so they know shared audio is no longer being captured.
    displayStream?.getAudioTracks()[0]?.addEventListener('ended', () => {
      setSysNote('Shared audio stopped — now recording mic only.');
    });

    // 4. Recorder → Deepgram + local buffer (records the mixed stream).
    //    128 kbps opus is transparent for speech and gives Deepgram cleaner
    //    audio than the browser's conservative default bitrate.
    const mimeType = bestMimeType();
    const recorder = new MediaRecorder(recordStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128000,
    });
    recorderRef.current = recorder;
    chunksRef.current = [];
    bufferBytesRef.current = 0;
    setBufferTrimmed(false);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        bufferBytesRef.current += e.data.size;
        // Bound the in-memory buffer: on a marathon meeting, evict the oldest
        // chunks once we exceed the cap so the tab can't OOM. The live Deepgram
        // transcript is unaffected; only the *saved audio file* loses its head.
        while (
          bufferBytesRef.current > MAX_AUDIO_BUFFER_BYTES &&
          chunksRef.current.length > 1
        ) {
          const dropped = chunksRef.current.shift();
          if (dropped) bufferBytesRef.current -= dropped.size;
          setBufferTrimmed(true);
        }
        dg.send(e.data);
      }
    };
    recorder.start(250); // 250ms chunks → snappy live captions

    startRef.current = Date.now();
    setElapsedSec(0);
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);

    // Periodic crash-safety checkpoint of the committed transcript.
    checkpointTimerRef.current = setInterval(() => {
      if (transcriptRef.current.trim()) flushCheckpoint(sessionId, transcriptRef.current);
    }, CHECKPOINT_INTERVAL_MS);

    setStatusSafe('recording');
  }, [captureSystem, cleanup, setStatusSafe, startMeter, flushCheckpoint]);

  const handleStop = useCallback(async () => {
    setStatusSafe('finalizing');
    const recorder = recorderRef.current;
    const dg = dgRef.current;
    // Snapshot elapsed time now (before the await chain runs the clock on).
    const elapsedAtStop = (Date.now() - startRef.current) / 1000;
    // Stop checkpointing immediately — we're about to do the durable save.
    if (checkpointTimerRef.current) {
      clearInterval(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }

    // Wait for the recorder to flush its final chunk before closing.
    await new Promise<void>((resolve) => {
      if (!recorder || recorder.state === 'inactive') return resolve();
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Give Deepgram a beat to return the trailing final result.
    await new Promise((r) => setTimeout(r, 600));
    const transcript = dg?.transcript ?? '';
    dg?.close();

    const mimeType = bestMimeType() || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    // Prefer the recorder's tracked elapsed time (already exact); only fall
    // back to a decode for small blobs (see getBlobDurationSec) — this avoids
    // a multi-second, multi-MB double decode on long meetings.
    const durationSec = (await getBlobDurationSec(blob, elapsedAtStop)) ?? elapsedAtStop;
    const objectUrl = blobToObjectURL(blob);

    cleanup();

    // Upload audio (non-fatal if it fails — transcript still saves).
    let audioPath: string | null = null;
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'recording.webm');
      fd.append('durationSec', String(durationSec));
      const res = await fetch('/api/meeting/upload', { method: 'POST', body: fd });
      if (res.ok) {
        const data = (await res.json()) as { audioPath?: string };
        audioPath = data.audioPath ?? null;
      }
    } catch {
      /* non-fatal */
    }

    // The recording is now safely in the recorder result + uploaded audio, so
    // the crash-safety checkpoint is no longer needed — clear it.
    const sid = sessionIdRef.current;
    if (sid) clearCheckpoint(sid);
    sessionIdRef.current = null;

    setStatusSafe('idle');
    onComplete({ transcript, durationSec, audioPath, objectUrl });
  }, [cleanup, onComplete, setStatusSafe, clearCheckpoint]);

  const isRecording = status === 'recording';
  const isReconnecting = status === 'reconnecting';
  const isBusy = status === 'connecting' || status === 'finalizing';
  const hasCaptions = lines.length > 0 || interim.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Control bar ── */}
      <div className="flex items-center gap-4">
        {!isRecording && !isReconnecting && !isBusy && (
          <Button
            variant="destructive"
            onClick={handleStart}
            className="group rounded-full pl-4 pr-5 py-2.5 hover:shadow-[0_0_24px_-4px_var(--warning-rust)]"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
            Start recording
          </Button>
        )}

        {(isRecording || isReconnecting) && (
          <Button
            variant="secondary"
            onClick={handleStop}
            className="rounded-full pl-4 pr-5 py-2.5"
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-foreground" />
            Stop &amp; save
          </Button>
        )}

        {isBusy && (
          <div className="flex items-center gap-2.5 rounded-full bg-secondary pl-4 pr-5 py-2.5 text-muted-foreground text-sm">
            <svg className="h-4 w-4 animate-spin text-[var(--robin-amber)]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {status === 'connecting' ? 'Connecting to Deepgram…' : 'Finalizing & saving…'}
          </div>
        )}

        {/* Reconnecting pill — recording continues, live stream is paused */}
        {isReconnecting && (
          <div className="flex items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,var(--warning-rust)_14%,transparent)] pl-3.5 pr-4 py-2 text-[var(--warning-rust)] text-sm">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Reconnecting…
          </div>
        )}

        {/* Live waveform */}
        <div className="flex h-8 flex-1 items-center justify-center gap-[3px] overflow-hidden">
          {levels.map((lvl, i) => (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-[height] duration-100 ${isRecording ? 'bg-[var(--status-stable)]' : isReconnecting ? 'bg-[var(--warning-rust)]' : 'bg-border'}`}
              style={{ height: `${Math.max(8, lvl * 100)}%` }}
            />
          ))}
        </div>

        {/* Timer + REC dot */}
        {(isRecording || isReconnecting || isBusy) && (
          <span className="flex items-center gap-2 font-mono text-sm tabular-nums text-muted-foreground">
            {isRecording && <span className="h-2 w-2 rounded-full bg-[var(--warning-rust)] animate-pulse" />}
            {formatDuration(elapsedSec)}
          </span>
        )}
      </div>

      {/* ── Capture options (idle only) ── */}
      {!isRecording && !isReconnecting && !isBusy && (
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={captureSystem}
              onChange={(e) => setCaptureSystem(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--status-stable)]"
            />
            <span>
              Also capture the other side — only the audio of a{' '}
              <strong className="font-medium text-foreground">shared browser tab or window</strong>.
              You’ll be prompted to pick one and must tick{' '}
              <strong className="font-medium text-foreground">“Share tab audio”</strong> in that dialog.
            </span>
          </label>
          {captureSystem && (
            <p className="pl-[22px] text-[11px] leading-relaxed text-muted-foreground/70">
              This cannot hear the Zoom or Teams <em>desktop apps</em> — the browser has no access to
              native app/system audio on macOS. To capture the other side, join the call in a browser
              tab (Zoom/Meet/Teams web) and share that tab, or run the meeting on speaker. Wear
              headphones to keep the far side out of your mic (avoids double-capture + echo).
            </p>
          )}
        </div>
      )}

      {/* ── System-audio / reconnect status note ── */}
      {sysNote && (
        <p className="-mt-1 text-xs text-muted-foreground">{sysNote}</p>
      )}

      {/* ── Buffer-trim warning (very long meeting) ── */}
      {bufferTrimmed && (
        <p className="-mt-1 text-xs text-[var(--warning-rust)]">
          This recording is very long — the earliest audio was dropped from the saved file to protect
          the browser. The transcript so far is unaffected. Consider stopping &amp; saving in segments.
        </p>
      )}

      {/* ── Live captions ── */}
      <div
        ref={captionsRef}
        className="min-h-[180px] max-h-[44vh] overflow-y-auto rounded-xl border border-border bg-background/60 px-5 py-4"
      >
        {!hasCaptions && (
          <p className="flex h-full min-h-[148px] items-center justify-center text-center text-sm text-muted-foreground">
            {isReconnecting
              ? 'Reconnecting to Deepgram… your transcript is preserved and live captions resume shortly.'
              : isRecording
                ? 'Listening… start speaking and the transcript appears here live.'
                : 'Press Start recording. Live captions with speaker labels stream in real time.'}
          </p>
        )}

        <div className="space-y-2.5 text-[15px] leading-relaxed">
          {lines.map((line, i) => (
            <p key={i} className="text-foreground">
              {line.speaker != null && (
                <span className={`mr-2 font-semibold ${speakerColor(line.speaker)}`}>
                  Speaker {line.speaker}:
                </span>
              )}
              {line.text}
            </p>
          ))}
          {interim && <p className="text-muted-foreground italic">{interim}</p>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--warning-rust)]/30 bg-[var(--warning-rust)]/10 px-4 py-2.5 text-sm text-[var(--warning-rust)]">
          {error}
        </div>
      )}
    </div>
  );
}

const SPEAKER_COLORS = [
  'text-sky-400',
  'text-emerald-400',
  'text-amber-400',
  'text-fuchsia-400',
  'text-rose-400',
  'text-violet-400',
];

function speakerColor(speaker: number): string {
  return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length]!;
}
