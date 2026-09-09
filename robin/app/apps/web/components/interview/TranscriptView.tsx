"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/voice-client";

// Static literal class tables (Tailwind v4 only emits complete literal strings,
// so these must never be built by interpolation).
const ACTOR_CLASS = {
  robin: "text-[var(--blue)]",
  you: "text-[var(--muted)]",
} as const;

const BUBBLE_CLASS = {
  robin: "rounded-tl-sm bg-[var(--card-2)]",
  you: "rounded-tr-sm border border-[color-mix(in_srgb,var(--blue)_25%,transparent)] bg-[var(--accent-wash)]",
} as const;

interface Props {
  entries: TranscriptEntry[];
  /** True once a session is connecting/live — changes the empty-state copy. */
  isLive?: boolean;
}

export default function TranscriptView({ entries, isLive = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom by default; unstick only when the user scrolls up to
  // read back, and re-stick once they return near the bottom. This keeps the
  // latest turn (and streaming assistant text) visible without yanking the
  // view away while someone is reading earlier history.
  const stickRef = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  // The transcript array gets a fresh reference on every delta (new turn or a
  // streamed token), so this runs on each update. rAF waits for the new content
  // to lay out before we measure scrollHeight.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center px-6">
        <div
          className={`mb-5 flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] border border-[color-mix(in_srgb,var(--blue)_30%,transparent)] bg-[var(--accent-wash)] ${
            isLive ? "animate-pulse" : ""
          }`}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--blue)]"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <path d="M12 17v4" />
          </svg>
        </div>
        {isLive ? (
          <>
            <p className="text-sm font-medium text-[var(--ink)]">Listening…</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--muted)]">
              The interviewer is warming up. It will introduce itself and ask the first
              question — just start talking when you&apos;re ready.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-[var(--ink)]">Ready when you are</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--muted)]">
              Pick a brief, hit{" "}
              <span className="font-medium text-[var(--blue)]">Start</span>, and allow
              microphone access. The conversation appears here as you speak.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
      <ul className="space-y-5">
        {entries.map((entry) => {
          const isAi = entry.role === "assistant";
          return (
            <li
              key={entry.id}
              className={`flex flex-col gap-1 ${isAi ? "items-start" : "items-end"}`}
            >
              <span
                className={`px-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
                  isAi ? ACTOR_CLASS.robin : ACTOR_CLASS.you
                }`}
              >
                {isAi ? "Robin" : "You"}
              </span>
              <div
                className={`max-w-[85%] rounded-[var(--radius-lg)] px-3.5 py-2 text-sm leading-relaxed text-[var(--ink)] ${
                  isAi ? BUBBLE_CLASS.robin : BUBBLE_CLASS.you
                }`}
              >
                {entry.text}
                {entry.partial && (
                  <span className="ml-1 inline-block animate-pulse text-[var(--blue)]">▌</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
