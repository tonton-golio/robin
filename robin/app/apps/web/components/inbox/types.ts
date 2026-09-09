import type {
  CaptureSession,
  RecoveryItem,
} from '@/lib/inbox/model';

export type InboxSelection =
  | { type: 'capture'; item: CaptureSession }
  | { type: 'recovery'; item: RecoveryItem };

export function captureSelectionKey(item: CaptureSession): string {
  return `capture:${item.id}`;
}

export function recoverySelectionKey(item: RecoveryItem): string {
  return `recovery:${item.id}`;
}
