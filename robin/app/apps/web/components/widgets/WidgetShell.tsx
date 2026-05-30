"use client";

/**
 * WidgetShell — the floating chrome around a tool widget.
 *
 * Three presentation states, driven by WidgetProvider:
 *   - collapsed: panel hidden (the trigger lives in the top bar); body stays
 *     MOUNTED so any live session keeps running.
 *   - small: compact viewer anchored under the top bar.
 *   - big:   full viewer.
 *
 * Open/close is a motion spring; the small↔big morph is a CSS size transition.
 */

import { motion } from "motion/react";
import { Minus, Maximize2, Minimize2 } from "lucide-react";
import { useWidgets, type WidgetId } from "./WidgetProvider";

interface Props {
  id: WidgetId;
  title: string;
  /** Small lucide icon component for the header. */
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Accent color (CSS color) for the live dot + title glyph. */
  accent: string;
  live: boolean;
  statusLabel: string;
  children: React.ReactNode;
}

const WIDTHS: Record<"small" | "big", number> = { small: 384, big: 760 };

export function WidgetShell({ id, title, icon: Icon, accent, live, statusLabel, children }: Props) {
  const { openId, size, collapse, cycleSize, setSize } = useWidgets();
  const isOpen = openId === id;
  const width = WIDTHS[size];

  return (
    <motion.div
      className="robin-widget"
      role="dialog"
      aria-label={`${title} widget`}
      aria-hidden={!isOpen}
      initial={false}
      animate={
        isOpen
          ? { opacity: 1, scale: 1, y: 0, pointerEvents: "auto" }
          : { opacity: 0, scale: 0.97, y: -10, pointerEvents: "none" }
      }
      transition={
        isOpen
          ? { type: "spring", stiffness: 460, damping: 34, mass: 0.6 }
          : { duration: 0.12, ease: "easeIn" }
      }
      style={{
        width,
        maxWidth: "calc(100vw - 32px)",
        // A defined height (not just max) so the transcript's flex-1 region has
        // room to fill — otherwise the panel shrinks to its controls and the
        // conversation gets a cramped sliver.
        height: size === "big" ? "calc(100vh - 84px)" : "min(78vh, 600px)",
      }}
      data-size={size}
      data-open={isOpen}
    >
      <header className="robin-widget-head">
        <span className="robin-widget-dot" style={{ background: accent }} data-live={live} />
        <Icon size={14} strokeWidth={1.6} />
        <span className="robin-widget-title">{title}</span>
        <span className="robin-widget-status" data-live={live}>
          {statusLabel}
        </span>
        <div className="robin-widget-head-actions">
          <button
            type="button"
            className="robin-widget-btn"
            title={size === "small" ? "Expand" : "Shrink"}
            onClick={() => (size === "small" ? setSize("big") : setSize("small"))}
          >
            {size === "small" ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <button
            type="button"
            className="robin-widget-btn"
            title="Collapse to icon"
            onClick={collapse}
          >
            <Minus size={15} />
          </button>
        </div>
      </header>
      <div className="robin-widget-body" onDoubleClick={cycleSize}>
        {children}
      </div>
    </motion.div>
  );
}
