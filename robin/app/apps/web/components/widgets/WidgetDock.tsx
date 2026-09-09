"use client";

/**
 * WidgetDock — the floating capture panels.
 *
 * Living Workspace opens them through the Capture dialog or command palette.
 * The panels stay mounted so sessions persist while collapsed or navigating.
 */

import { InterviewWidget } from "./InterviewWidget";
import { MeetingWidget } from "./MeetingWidget";

export function WidgetPanels() {
  return (
    <div className="robin-widget-layer">
      <InterviewWidget />
      <MeetingWidget />
    </div>
  );
}
