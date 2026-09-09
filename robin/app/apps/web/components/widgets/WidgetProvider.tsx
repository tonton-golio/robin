"use client";

/**
 * WidgetProvider — single source of truth for the capture widgets.
 *
 * Mounted once inside LivingWorkspaceShell, so the interview and meeting
 * sessions it owns stay alive while the user navigates the archive. Each
 * widget has three presentation states:
 *   collapsed (icon only) · small (compact viewer) · big (full viewer)
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useInterviewSession, type InterviewSession } from "./useInterviewSession";
import { useMeetingSession, type MeetingSession } from "./useMeetingSession";

export type WidgetId = "interview" | "meeting";
export type WidgetSize = "small" | "big";

interface WidgetContextValue {
  openId: WidgetId | null;
  size: WidgetSize;
  collapse: () => void;
  setSize: (s: WidgetSize) => void;
  cycleSize: () => void;
  interview: InterviewSession;
  meeting: MeetingSession;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

export function WidgetProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<WidgetId | null>(null);
  const [size, setSize] = useState<WidgetSize>("small");

  const interview = useInterviewSession();
  const meeting = useMeetingSession();

  const collapse = useCallback(() => setOpenId(null), []);

  // Let any part of the app open a widget by dispatching a window event
  // (mirrors the `robin:resync` pattern) — used by the Today quick-launch and
  // the command palette now that the standalone tool routes are gone.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<WidgetId>).detail;
      if (id === "interview" || id === "meeting") setOpenId(id);
    }
    window.addEventListener("robin:open-widget", onOpen as EventListener);
    return () => window.removeEventListener("robin:open-widget", onOpen as EventListener);
  }, []);

  // A shareable local deep-link can open the interview at full size and let
  // useInterviewSession select the requested brief, e.g. `?interview=<slug>`.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("interview")) return;
    setOpenId("interview");
    setSize("big");
  }, []);
  const cycleSize = useCallback(() => setSize((s) => (s === "small" ? "big" : "small")), []);

  const value = useMemo<WidgetContextValue>(
    () => ({ openId, size, collapse, setSize, cycleSize, interview, meeting }),
    [openId, size, collapse, cycleSize, interview, meeting],
  );

  return <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>;
}

export function useWidgets(): WidgetContextValue {
  const ctx = useContext(WidgetContext);
  if (!ctx) throw new Error("useWidgets must be used within WidgetProvider");
  return ctx;
}
