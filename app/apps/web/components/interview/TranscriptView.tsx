"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/voice-client";

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
          className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 ${
            isLive ? "animate-pulse" : ""
          }`}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgb(165 180 252)"
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
            <p className="text-sm font-medium text-slate-200">Listening…</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              The interviewer is warming up. It will introduce itself and ask the first
              question — just start talking when you&apos;re ready.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-200">Ready when you are</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              Pick a brief, hit{" "}
              <span className="font-medium text-violet-300">Start</span>, and allow
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
                className="px-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: isAi ? "rgb(165,180,252)" : "rgb(110,231,183)" }}
              >
                {isAi ? "Robin" : "You"}
              </span>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  isAi
                    ? "rounded-tl-sm bg-white/5 text-slate-100"
                    : "rounded-tr-sm text-emerald-50"
                }`}
                style={
                  isAi
                    ? undefined
                    : {
                        background: "rgba(16,185,129,0.16)",
                        border: "1px solid rgba(16,185,129,0.25)",
                      }
                }
              >
                {entry.text}
                {entry.partial && (
                  <span className="ml-1 inline-block animate-pulse text-violet-400">▌</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
