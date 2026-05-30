'use client';

import { Headphones, Mic } from 'lucide-react';
import type { WidgetId } from './WidgetProvider';

function openWidget(id: WidgetId) {
  window.dispatchEvent(new CustomEvent('robin:open-widget', { detail: id }));
}

/** Today-page quick-launch buttons that open the top-bar tool widgets. */
export function ToolLaunchButtons() {
  return (
    <>
      <button type="button" onClick={() => openWidget('meeting')}>
        <Headphones size={16} strokeWidth={1.5} /> Record meeting
      </button>
      <button type="button" onClick={() => openWidget('interview')}>
        <Mic size={16} strokeWidth={1.5} /> Start interview
      </button>
    </>
  );
}
