/**
 * Server-side transcript persistence for the voice relay.
 *
 * The relay already parses every frame in both directions, so it can build the
 * conversation transcript independently of the browser. Previously the
 * transcript lived only in React state — closing the tab (or a crash) lost it.
 * Now the relay feeds frames here; we accumulate turns and flush them to the
 * vault incrementally (debounced) and on close, so a session is durable even if
 * the user never clicks "Save & Ingest".
 *
 * Live transcripts land in logs/interviews/.live/<timestamp>-<brief>.md as
 * plain markdown. The existing "Save & Ingest" flow (POST
 * /api/interview/transcript) remains the canonical path that converts to HTML
 * and indexes; this is the crash-safety net, not a replacement.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { vaultPath } from "./vault";

interface Turn {
  role: "user" | "assistant";
  /** xAI item id, when known — dedupes re-fired transcripts. */
  itemId?: string;
  text: string;
}

const FLUSH_DEBOUNCE_MS = 1500;

export class InterviewTranscriptStore {
  private turns: Turn[] = [];
  private assistantBuf = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private filePath: string;
  private dir: string;
  private startedAt = new Date();
  private closed = false;
  private writing = false;
  private dirtySinceWrite = false;

  constructor(private briefSlug: string) {
    this.dir = vaultPath("logs", "interviews", ".live");
    const stamp = this.startedAt
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "-")
      .slice(0, 19);
    const safe = briefSlug.replace(/[^a-z0-9-]/gi, "-") || "interview";
    this.filePath = path.join(this.dir, `${stamp}-${safe}.md`);
  }

  /** Feed a raw frame (string) coming from EITHER direction. */
  ingestFrame(raw: string, source: "browser" | "upstream"): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event["type"] as string | undefined;
    if (!type) return;

    // Assistant transcript streams in deltas from upstream.
    if (source === "upstream") {
      if (
        type === "response.audio_transcript.delta" ||
        type === "response.output_audio_transcript.delta" ||
        type === "response.text.delta" ||
        type === "response.output_text.delta"
      ) {
        const delta = event["delta"];
        if (typeof delta === "string") this.assistantBuf += delta;
        return;
      }
      if (
        type === "response.audio_transcript.done" ||
        type === "response.output_audio_transcript.done" ||
        type === "response.text.done" ||
        type === "response.output_text.done"
      ) {
        const done = event["transcript"] ?? event["text"];
        const text = (typeof done === "string" ? done : this.assistantBuf).trim();
        this.assistantBuf = "";
        if (text) {
          this.turns.push({ role: "assistant", text });
          this.scheduleFlush();
        }
        return;
      }
      // User audio transcription completes upstream too.
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = (event["transcript"] as string | undefined)?.trim();
        if (!text) return;
        const itemId = event["item_id"] as string | undefined;
        const existing = itemId
          ? this.turns.find((t) => t.role === "user" && t.itemId === itemId)
          : undefined;
        if (existing) {
          existing.text = text;
        } else {
          // Skip a verbatim repeat of the last user turn when no id present.
          const lastUser = [...this.turns].reverse().find((t) => t.role === "user");
          if (!itemId && lastUser && lastUser.text === text) return;
          this.turns.push({ role: "user", itemId, text });
        }
        this.scheduleFlush();
      }
    }
  }

  private scheduleFlush(): void {
    this.dirtySinceWrite = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private render(): string {
    const head = `# Voice interview (live capture) — ${this.briefSlug}\n\nStarted: ${this.startedAt.toISOString()}\nUpdated: ${new Date().toISOString()}\n\n> Auto-saved by the relay. Use "Save & Ingest" in the app for the canonical, indexed copy.\n\n---\n\n`;
    const body = this.turns
      .map((t) => `**${t.role === "assistant" ? "Interviewer" : "You"}:** ${t.text}`)
      .join("\n\n");
    return head + body + "\n";
  }

  /** Write current transcript to disk. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.turns.length === 0) return;
    if (this.writing) {
      this.dirtySinceWrite = true;
      return;
    }
    this.writing = true;
    this.dirtySinceWrite = false;
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      // Atomic-ish: write a temp file then rename, so a crash mid-write never
      // leaves a truncated transcript.
      const tmp = `${this.filePath}.tmp`;
      await fsp.writeFile(tmp, this.render(), "utf-8");
      await fsp.rename(tmp, this.filePath);
    } catch (e) {
      console.error("[interview-transcript] flush failed:", e);
    } finally {
      this.writing = false;
      if (this.dirtySinceWrite) this.scheduleFlush();
    }
  }

  /** Final flush on session end. Cancels any pending debounce. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Best-effort synchronous flush as a last resort if the process is exiting.
    try {
      await this.flush();
    } catch {
      try {
        if (this.turns.length > 0) {
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(this.filePath, this.render(), "utf-8");
        }
      } catch {
        /* give up */
      }
    }
  }

  get path(): string {
    return this.filePath;
  }

  get turnCount(): number {
    return this.turns.length;
  }
}
