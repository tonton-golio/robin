'use client';

import { Headphones, Mic } from 'lucide-react';
import {
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';

function openCapture(kind: 'meeting' | 'interview') {
  window.dispatchEvent(new CustomEvent('robin:open-widget', { detail: kind }));
}

export function CaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const choose = (kind: 'meeting' | 'interview') => {
    onOpenChange(false);
    window.setTimeout(() => openCapture(kind), 0);
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent id="workspace-capture-dialog" className="workspace-capture-dialog">
          <DialogHeader>
            <div>
              <DialogTitle>Capture</DialogTitle>
              <DialogDescription>Choose what Robin should record.</DialogDescription>
            </div>
            <DialogCloseButton label="Close capture" />
          </DialogHeader>
          <DialogBody className="workspace-capture-choices">
            <button type="button" className="workspace-capture-choice" onClick={() => choose('meeting')}>
              <Headphones size={21} strokeWidth={1.6} aria-hidden="true" />
              <span>
                <strong>Meeting</strong>
                <small>Record, transcribe, and compile</small>
              </span>
            </button>
            <button type="button" className="workspace-capture-choice" onClick={() => choose('interview')}>
              <Mic size={21} strokeWidth={1.6} aria-hidden="true" />
              <span>
                <strong>Interview</strong>
                <small>Use a brief and scorecard</small>
              </span>
            </button>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
