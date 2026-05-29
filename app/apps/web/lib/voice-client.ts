// Browser client for the voice interview.
//
// Responsibilities:
//   - Open WebSocket to the backend relay (which proxies xAI Voice Agent).
//   - Capture mic at 24kHz, convert to PCM16 in an AudioWorklet, and stream
//     base64-encoded chunks via `input_audio_buffer.append` events.
//   - Decode incoming PCM16 audio deltas and play them gaplessly by
//     scheduling AudioBufferSourceNodes back-to-back through an AnalyserNode
//     (so the UI can visualise interviewer voice level).
//   - Cancel local playback the instant the user starts speaking — the
//     server already sends `response.cancel` upstream, but in-flight audio
//     deltas would otherwise keep playing for ~1s after barge-in.
//   - Surface transcript text and connection state to the UI.

export type VoiceState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "ended";

/** Distinct error kinds so the UI can give targeted guidance. */
export type VoiceErrorKind = "mic-permission" | "connect" | "server" | "unknown";

export type TranscriptEntry = {
  id: string;
  /** xAI conversation item id, when known — used to dedupe re-fired transcripts. */
  itemId?: string;
  role: "user" | "assistant";
  text: string;
  partial: boolean;
  startedAt: number;
};

export type VoiceClientEvents = {
  onState: (state: VoiceState, detail?: string, errorKind?: VoiceErrorKind) => void;
  onTranscript: (entries: TranscriptEntry[]) => void;
  onAnalyser?: (analyser: AnalyserNode | null) => void;
  onInputAnalyser?: (analyser: AnalyserNode | null) => void;
};

/**
 * Resolves the WebSocket URL to connect to. Called once per connection attempt
 * (including reconnects) so each attempt can carry a fresh short-lived session
 * token — the token minted at first start may have expired by the time a
 * reconnect fires.
 */
export type WsUrlProvider = () => Promise<string> | string;

const SAMPLE_RATE = 24000;

// Reconnect backoff: a transient network blip shouldn't dead-end the session.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 8000;

function int16BytesToFloat32(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    bin += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** getUserMedia rejects with NotAllowedError / SecurityError on denial. */
function isPermissionError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "NotAllowedError" || err.name === "SecurityError";
  }
  const name = (err as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "SecurityError";
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private playbackTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private transcript: TranscriptEntry[] = [];
  private currentAssistant: TranscriptEntry | null = null;
  private nextId = 1;
  private stopped = false;
  private live = false;
  // True once a fatal error has been surfaced; suppresses the WS `close`
  // handler and stop()'s teardown from overwriting the error state with
  // "ended" (the race that previously masked failures).
  private errored = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly urlProvider: WsUrlProvider;

  constructor(
    wsUrlOrProvider: string | WsUrlProvider,
    private events: VoiceClientEvents,
  ) {
    this.urlProvider =
      typeof wsUrlOrProvider === "function" ? wsUrlOrProvider : () => wsUrlOrProvider;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.errored = false;
    this.reconnectAttempts = 0;
    this.events.onState("connecting");

    // Acquire the mic FIRST and ONCE. Permission denial is the most common
    // failure and deserves a distinct, non-fatal-looking message. Doing it
    // before the socket also means a reconnect reuses the existing mic graph.
    try {
      await this.startMic();
    } catch (err) {
      const kind = isPermissionError(err) ? "mic-permission" : "unknown";
      this.fail(kind, err instanceof Error ? err.message : String(err));
      return;
    }

    await this.connect();
  }

  /** Open (or re-open) the relay socket. Mic is assumed already running. */
  private async connect(): Promise<void> {
    if (this.stopped || this.errored) return;

    let url: string;
    try {
      url = await this.urlProvider();
    } catch (err) {
      this.scheduleReconnect("connect", err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.stopped || this.errored) return;

    try {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
      });

      ws.addEventListener("message", (e) => this.handleServerEvent(e.data));
      ws.addEventListener("close", () => this.handleSocketClosed(ws));

      await opened;
      if (this.stopped || this.errored) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this.reconnectAttempts = 0;
      this.live = true;
      this.events.onState("live");
    } catch (err) {
      // The handshake failed. Detach this socket first so the `close` event it
      // will also fire doesn't double-trigger reconnect via handleSocketClosed
      // (which checks ws === this.ws). Then schedule a single backoff retry.
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
      }
      this.scheduleReconnect("connect", err instanceof Error ? err.message : String(err));
    }
  }

  /** WebSocket closed. Decide: deliberate stop, fatal, or reconnect. */
  private handleSocketClosed(ws: WebSocket): void {
    // Ignore closes from a stale socket we've already replaced.
    if (ws !== this.ws) return;
    this.ws = null;
    if (this.stopped || this.errored) return;
    this.live = false;
    this.scheduleReconnect("connect", "connection dropped");
  }

  private scheduleReconnect(kind: VoiceErrorKind, detail: string): void {
    if (this.stopped || this.errored) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.fail(kind, `${detail} — reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
    );
    this.events.onState(
      "reconnecting",
      `Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`,
    );
    this.cancelPlayback();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  /** Surface a fatal error and tear down without re-emitting "ended" over it. */
  private fail(kind: VoiceErrorKind, message: string): void {
    if (this.errored) return;
    this.errored = true;
    this.events.onState("error", message, kind);
    void this.teardown();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const wasErrored = this.errored;
    await this.teardown();
    // Only announce a clean end when we didn't already surface an error — this
    // is the race fix: previously stop() always emitted "ended", clobbering a
    // just-fired "error" from the start() failure path.
    if (!wasErrored) this.events.onState("ended");
  }

  /** Release all audio + socket resources. Does not emit a terminal state. */
  private async teardown(): Promise<void> {
    this.live = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.cancelPlayback();
      this.worklet?.disconnect();
      this.worklet = null;
      this.mediaStream?.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
      this.events.onAnalyser?.(null);
      this.events.onInputAnalyser?.(null);
      this.analyser = null;
      if (this.ctx) {
        await this.ctx.close().catch(() => {});
        this.ctx = null;
      }
      const ws = this.ws;
      this.ws = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* best-effort teardown */
    }
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  private async startMic(): Promise<void> {
    // Hold the context/stream in locals through every await. `this.ctx` can be
    // nulled by a concurrent stop() (React re-render, double-clicked Start)
    // while we're suspended on addModule()/getUserMedia(); reading it back
    // afterwards would throw "Cannot read properties of null". If a stop landed
    // mid-setup we detect it via `this.stopped` and tear down what we built.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.ctx = ctx;
    if (ctx.sampleRate !== SAMPLE_RATE) {
      console.warn(
        `AudioContext sampleRate=${ctx.sampleRate}, expected ${SAMPLE_RATE}.`,
      );
    }
    await ctx.audioWorklet.addModule("/pcm-worklet.js");

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.mediaStream = mediaStream;

    // A stop() may have fired while we awaited the mic permission / worklet.
    if (this.stopped || this.ctx !== ctx) {
      mediaStream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      return;
    }

    const source = ctx.createMediaStreamSource(mediaStream);
    this.worklet = new AudioWorkletNode(ctx, "pcm-recorder", {
      processorOptions: { framesPerChunk: 2400 },
    });
    this.worklet.port.onmessage = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // Stream the mic continuously — including while the interviewer is
      // speaking — so the user can barge in and interrupt. The browser's
      // echoCancellation keeps the AI's own voice from leaking back into the
      // mic; when the user does start talking, server-VAD fires speech_started,
      // which cancels local playback here and the upstream response in the relay.
      const audio = bytesToBase64(e.data as ArrayBuffer);
      this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    };
    source.connect(this.worklet);
    // An AudioWorkletNode is only pulled by the render graph if its OUTPUT has
    // a path to the destination. With only `source.connect(worklet)` the node
    // is a dangling sink, so Chrome never calls process() and no mic frames are
    // ever posted to the main thread (xAI then sees zero audio → no
    // speech_started). Route the worklet through a muted gain so it stays in
    // the active graph without leaking the raw mic to the speakers.
    const micPump = ctx.createGain();
    micPump.gain.value = 0;
    this.worklet.connect(micPump);
    micPump.connect(ctx.destination);

    // Input level meter (user mic) — separate from playback analyser.
    // This lets the UI show real-time feedback that the microphone is actually capturing sound.
    const inputAnalyser = ctx.createAnalyser();
    inputAnalyser.fftSize = 256;
    inputAnalyser.smoothingTimeConstant = 0.7;
    source.connect(inputAnalyser); // tap the mic source before the worklet
    this.events.onInputAnalyser?.(inputAnalyser);

    // Build the playback graph: each AudioBufferSourceNode → analyser → destination.
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.7;
    this.analyser.connect(ctx.destination);
    this.events.onAnalyser?.(this.analyser);

    if (ctx.state === "suspended") await ctx.resume();
  }

  private handleServerEvent(data: string | ArrayBuffer): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    const type = event.type as string;

    switch (type) {
      case "input_audio_buffer.speech_started": {
        // Barge-in. Drop everything queued for playback so the interviewer
        // shuts up immediately.
        this.cancelPlayback();
        if (this.currentAssistant) {
          this.currentAssistant.partial = false;
          this.currentAssistant = null;
        }
        this.emitTranscript();
        break;
      }
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const delta = event.delta as string | undefined;
        if (delta) this.schedulePlayback(delta);
        break;
      }
      case "response.text.delta":
      case "response.output_text.delta":
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const delta = event.delta as string | undefined;
        if (delta) this.appendAssistantText(delta);
        break;
      }
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
      case "response.text.done":
      case "response.output_text.done": {
        if (this.currentAssistant) {
          this.currentAssistant.partial = false;
          this.currentAssistant = null;
          this.emitTranscript();
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (event.transcript as string | undefined)?.trim();
        if (!text) break;
        const itemId = event.item_id as string | undefined;
        // A single committed audio item can have its transcription delivered
        // more than once. Key user turns by item_id and update in place rather
        // than appending a duplicate line. As a fallback when no id is present,
        // skip a verbatim repeat of the most recent user turn.
        const existing = itemId
          ? this.transcript.find((t) => t.role === "user" && t.itemId === itemId)
          : undefined;
        if (existing) {
          existing.text = text;
        } else {
          const lastUser = [...this.transcript].reverse().find((t) => t.role === "user");
          if (!itemId && lastUser && lastUser.text === text) break;
          this.transcript.push({
            id: String(this.nextId++),
            itemId,
            role: "user",
            text,
            partial: false,
            startedAt: Date.now(),
          });
        }
        this.emitTranscript();
        break;
      }
      case "error": {
        const err = event.error as { message?: string } | undefined;
        const message = err?.message ?? "unknown error";
        // Once the session is live, xAI `error` events are typically transient
        // and non-fatal (e.g. a stray response.cancel with nothing to cancel).
        // Surfacing them as a fatal error would wrongly end the interview, so
        // just log them and keep the session running. Fatal connection failures
        // are handled by start()'s catch and the WS `close` handler instead.
        if (this.live) {
          console.warn("[voice] non-fatal server error:", message);
        } else {
          this.fail("server", message);
        }
        break;
      }
      default:
        if (typeof window !== "undefined" && (window as { __voiceDebug?: boolean }).__voiceDebug) {
          console.debug("[voice]", type, event);
        }
    }
  }

  private appendAssistantText(delta: string): void {
    if (!this.currentAssistant) {
      this.currentAssistant = {
        id: String(this.nextId++),
        role: "assistant",
        text: "",
        partial: true,
        startedAt: Date.now(),
      };
      this.transcript.push(this.currentAssistant);
    }
    this.currentAssistant.text += delta;
    this.emitTranscript();
  }

  private emitTranscript(): void {
    this.events.onTranscript([...this.transcript]);
  }

  private cancelPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.stop(0);
      } catch {
        /* already stopped */
      }
    }
    this.activeSources.clear();
    if (this.ctx) this.playbackTime = this.ctx.currentTime;
  }

  private schedulePlayback(b64: string): void {
    if (!this.ctx || !this.analyser) return;
    const float = int16BytesToFloat32(base64ToBytes(b64));
    if (float.length === 0) return;

    const buffer = this.ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    source.start(startAt);
    this.playbackTime = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
  }
}
