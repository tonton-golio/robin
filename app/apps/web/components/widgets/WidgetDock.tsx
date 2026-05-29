"use client";

/**
 * WidgetDock — the top-bar entry points and the floating panels.
 *
 * <WidgetTriggers/> renders inside the top bar's action row; each is an icon
 * button that toggles its panel and shows a live pulse while a session runs.
 * <WidgetPanels/> renders the always-mounted panels (so sessions persist even
 * when collapsed or while the user navigates the brain).
 */

import { Mic, Radio } from "lucide-react";
import { useWidgets, type WidgetId } from "./WidgetProvider";
import { InterviewWidget } from "./InterviewWidget";
import { MeetingWidget } from "./MeetingWidget";

function Trigger({
  id,
  label,
  icon: Icon,
}: {
  id: WidgetId;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  const { openId, toggle, isLive } = useWidgets();
  const active = openId === id;
  const live = isLive(id);
  return (
    <button
      type="button"
      className="robin-iconbtn robin-widget-trigger"
      data-active={active}
      data-live={live}
      aria-pressed={active}
      title={live ? `${label} — live` : label}
      onClick={() => toggle(id)}
    >
      <Icon size={15} strokeWidth={1.6} />
      {live && <span className="robin-widget-trigger-dot" aria-hidden />}
    </button>
  );
}

export function WidgetTriggers() {
  return (
    <>
      <Trigger id="interview" label="Interview" icon={Mic} />
      <Trigger id="meeting" label="Meeting" icon={Radio} />
    </>
  );
}

export function WidgetPanels() {
  return (
    <div className="robin-widget-layer">
      <InterviewWidget />
      <MeetingWidget />
    </div>
  );
}
