/**
 * deepgram-live.ts
 *
 * Browser-side controller for live streaming transcription via Deepgram.
 *
 * Flow:
 *   1. fetch a short-lived token from /api/meeting/deepgram-token
 *   2. open a WebSocket to Deepgram's streaming endpoint (token subprotocol)
 *   3. feed audio chunks (webm/opus from MediaRecorder) as binary frames
 *   4. parse results: interim hypotheses (replaced live) + final segments
 *      (committed, grouped by diarized speaker)
 *
 * The committed transcript uses Robin's meeting convention:
 *   **Speaker 0:** ...
 *   **Speaker 1:** ...
 * so it flows straight into TranscriptEditor / save-transcript / ingest.
 */

const DG_WS_BASE = 'wss://api.deepgram.com/v1/listen';

/**
 * Build the streaming query string. nova-3 is Deepgram's most accurate
 * streaming model; diarize groups words by speaker, smart_format adds
 * punctuation/casing/numerals.
 *
 * `keyterms` (Nova-3 keyterm prompting) bias recognition toward domain proper
 * nouns — teammate names, product names — that the model would otherwise spell
 * phonetically. They're passed one `keyterm=` param each.
 */
function buildParams(keyterms: string[]): URLSearchParams {
  const params = new URLSearchParams({
    model: 'nova-3',
    // Meetings are mostly English; an explicit language beats auto-detection
    // for accuracy and is required for keyterm prompting.
    language: 'en',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
    filler_words: 'false',
    // Hold a final segment open briefly so sentences commit as whole thoughts
    // (cleaner speaker lines) rather than fragmenting on every short pause.
    endpointing: '300',
    utterance_end_ms: '1000',
    // No `encoding` param: Deepgram auto-detects the webm/opus container that
    // MediaRecorder emits, so we can forward its chunks verbatim.
  });
  for (const term of keyterms) {
    if (term.trim()) params.append('keyterm', term.trim());
  }
  return params;
}

interface DGWord {
  word: string;
  punctuated_word?: string;
  speaker?: number;
}

interface DGMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      words?: DGWord[];
    }>;
  };
}

export interface CommittedLine {
  speaker: number | null;
  text: string;
}

export interface DeepgramLiveCallbacks {
  /** Fired on every interim hypothesis — the not-yet-final tail. */
  onInterim?: (text: string) => void;
  /** Fired whenever the committed transcript grows. Receives full line list. */
  onCommit?: (lines: CommittedLine[]) => void;
  /** Connection opened and ready to receive audio. */
  onOpen?: () => void;
  /** Fatal error (token, socket, or grant failure that we won't retry). */
  onError?: (message: string) => void;
  /** Socket closed. */
  onClose?: () => void;
  /**
   * Connection dropped unexpectedly and we're attempting to reconnect.
   * `attempt` is 1-based; `delayMs` is the wait before this attempt. Use it to
   * surface a "reconnecting…" state. Followed by onOpen (recovered) or, after
   * the attempt budget is exhausted, onError (gave up).
   */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  /** Fired once after a reconnect succeeds (live transcript resumes). */
  onReconnected?: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;

export class DeepgramLive {
  private ws: WebSocket | null = null;
  private cb: DeepgramLiveCallbacks;
  private lines: CommittedLine[] = [];
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;
  // Reconnect bookkeeping.
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // True between the first OPEN and an explicit close(); enables auto-reconnect
  // on an unexpected drop (vs. a token failure during the initial connect).
  private wasEverOpen = false;

  constructor(cb: DeepgramLiveCallbacks) {
    this.cb = cb;
  }

  /** Fetch a fresh short-lived token + the streaming query string. */
  private async fetchSocketConfig(): Promise<{ token: string; params: URLSearchParams }> {
    const tokenRes = await fetch('/api/meeting/deepgram-token');
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      hint?: string;
      detail?: string;
      keyterms?: string[];
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = [tokenData.error, tokenData.hint, tokenData.detail]
        .filter(Boolean)
        .join(' — ');
      throw new Error(msg || `Token request failed (${tokenRes.status})`);
    }

    return { token: tokenData.access_token, params: buildParams(tokenData.keyterms ?? []) };
  }

  /**
   * Open a socket with the given token/params. Resolves once OPEN.
   * Wires onclose → scheduleReconnect so an unexpected drop self-heals.
   */
  private openSocket(token: string, params: URLSearchParams): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${DG_WS_BASE}?${params.toString()}`;
      // Deepgram authenticates the browser socket via the `token` subprotocol.
      const ws = new WebSocket(url, ['token', token]);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        this.wasEverOpen = true;
        this.reconnectAttempts = 0; // a clean open resets the backoff budget
        // Deepgram closes idle sockets; a periodic KeepAlive holds it open
        // during silence (e.g. between speakers).
        this.keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 8000);
        this.cb.onOpen?.();
        settled = true;
        resolve();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; let onclose decide whether to
        // reconnect. Only reject the initial connect promise (before OPEN).
        if (!settled) {
          settled = true;
          reject(new Error('Deepgram WebSocket error (check key/network)'));
        }
      };

      ws.onclose = () => {
        if (this.keepAlive) {
          clearInterval(this.keepAlive);
          this.keepAlive = null;
        }
        if (this.closedByUs) return;
        // Unexpected drop mid-session → attempt to reconnect and resume.
        if (this.wasEverOpen) {
          this.scheduleReconnect();
        } else {
          // Never opened; the connect() promise's reject already fired.
          this.cb.onClose?.();
        }
      };

      ws.onmessage = (ev) => this.handleMessage(ev.data);
    });
  }

  /** Fetch a token and open the socket. Resolves once the socket is open. */
  async connect(): Promise<void> {
    try {
      const { token, params } = await this.fetchSocketConfig();
      await this.openSocket(token, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.cb.onError?.(msg);
      throw err;
    }
  }

  /**
   * Schedule a reconnect with exponential backoff + jitter. After the attempt
   * budget is exhausted we surface a fatal error and stop. The committed
   * transcript (`this.lines`) is preserved across reconnects, so the live
   * caption stream resumes where it left off.
   */
  private scheduleReconnect(): void {
    if (this.closedByUs) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.cb.onError?.(
        `Lost connection to Deepgram and could not reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. ` +
          'Your transcript so far is preserved — stop & save to keep it.',
      );
      return;
    }

    const expo = BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    const capped = Math.min(expo, MAX_RECONNECT_DELAY_MS);
    const delayMs = Math.round(capped / 2 + Math.random() * (capped / 2)); // 50–100% jitter
    this.cb.onReconnecting?.(this.reconnectAttempts, delayMs);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (this.closedByUs) return;
      try {
        const { token, params } = await this.fetchSocketConfig();
        if (this.closedByUs) return;
        await this.openSocket(token, params);
        this.cb.onReconnected?.();
      } catch {
        // Token fetch / open failed → back off and try again.
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  /** Forward an audio chunk to Deepgram. No-op if the socket isn't open. */
  send(chunk: Blob | ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
    // During a reconnect window the socket isn't OPEN; chunks are dropped from
    // the live stream (a few seconds of captions), but the full audio blob is
    // still buffered by the recorder, so nothing is lost from the saved file.
  }

  /** True while we've lost the socket and are retrying. */
  get isReconnecting(): boolean {
    return !this.closedByUs && this.wasEverOpen && this.ws?.readyState !== WebSocket.OPEN;
  }

  /** Flush and close the stream gracefully. */
  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      // CloseStream tells Deepgram to finalize any buffered audio before close.
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
    this.ws = null;
  }

  /** The committed transcript as Robin-format markdown. */
  get transcript(): string {
    return this.lines
      .map((l) =>
        l.speaker != null ? `**Speaker ${l.speaker}:** ${l.text}` : l.text,
      )
      .join('\n');
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: DGMessage;
    try {
      msg = JSON.parse(raw) as DGMessage;
    } catch {
      return;
    }
    if (msg.type && msg.type !== 'Results') return;

    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) return;

    if (msg.is_final) {
      this.commit(alt?.words ?? [], text);
      this.cb.onInterim?.('');
      this.cb.onCommit?.([...this.lines]);
    } else {
      this.cb.onInterim?.(text);
    }
  }

  /** Append a finalized segment, grouping words into speaker runs. */
  private commit(words: DGWord[], fallbackText: string): void {
    const runs = groupBySpeaker(words);
    if (runs.length === 0) {
      // No word-level speaker data — append as an unattributed line.
      this.appendRun(null, fallbackText);
      return;
    }
    for (const run of runs) {
      this.appendRun(run.speaker, run.text);
    }
  }

  /** Append text to the last line if same speaker, else start a new line. */
  private appendRun(speaker: number | null, text: string): void {
    const last = this.lines[this.lines.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`.trim();
    } else {
      this.lines.push({ speaker, text });
    }
  }
}

interface SpeakerRun {
  speaker: number | null;
  text: string;
}

/** Collapse a word list into consecutive same-speaker runs. */
function groupBySpeaker(words: DGWord[]): SpeakerRun[] {
  const runs: SpeakerRun[] = [];
  for (const w of words) {
    const token = w.punctuated_word ?? w.word;
    if (!token) continue;
    const speaker = typeof w.speaker === 'number' ? w.speaker : null;
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${token}`;
    } else {
      runs.push({ speaker, text: token });
    }
  }
  return runs.map((r) => ({ ...r, text: r.text.trim() }));
}
