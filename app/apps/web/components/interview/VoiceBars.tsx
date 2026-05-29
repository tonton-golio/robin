"use client";

import { useEffect, useRef } from "react";

// Renders a row of bars driven by an AnalyserNode's frequency data.
//
// Animation strategy: we mutate `transform: scaleY(...)` directly inside a
// rAF loop. No React state, no CSS height transitions — the rAF cadence is
// already 60fps and CSS transitions on top would just produce jitter.
//
// Bars grow from the vertical center (origin-center) so the meter reads as a
// symmetric waveform rather than a bottom-anchored equaliser.

const BAR_COUNT = 28;
const SMOOTH_UP = 0.55; // how fast a bar grows toward a louder sample
const SMOOTH_DOWN = 0.18; // how fast it falls back when audio quiets

interface Props {
  analyser: AnalyserNode | null;
  /** Tailwind/CSS color for active bars. Defaults to violet. */
  color?: string;
  /** Pixel height of the meter. Defaults to 64. */
  height?: number;
}

export default function VoiceBars({ analyser, color = "rgb(167 139 250)", height = 64 }: Props) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const targets = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const rafRef = useRef<number | null>(null);

  // Idle baseline shape — a gentle centered hump so the meter never looks dead.
  const baseline = (i: number) => 0.06 + Math.sin((i / BAR_COUNT) * Math.PI) * 0.05;

  useEffect(() => {
    if (!analyser) {
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = refs.current[i];
        if (el) el.style.transform = `scaleY(${baseline(i)})`;
        targets.current[i] = 0;
      }
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT / 1.5));

    const tick = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BAR_COUNT; i++) {
        const sample = (data[i * step] ?? 0) / 255;
        const prev = targets.current[i] ?? 0;
        // Asymmetric smoothing — feels more natural than a single LP.
        const next =
          sample > prev
            ? prev + (sample - prev) * SMOOTH_UP
            : prev + (sample - prev) * SMOOTH_DOWN;
        targets.current[i] = next;

        const el = refs.current[i];
        if (!el) continue;
        el.style.transform = `scaleY(${Math.max(baseline(i), next)})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser]);

  const active = !!analyser;

  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height }} aria-hidden>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="w-1 rounded-full origin-center"
          style={{
            height: "100%",
            background: active ? color : "rgb(51 65 85)",
            boxShadow: active ? `0 0 6px ${color}` : "none",
            transform: `scaleY(${baseline(i)})`,
            transition: "background 0.3s, box-shadow 0.3s",
          }}
        />
      ))}
    </div>
  );
}
