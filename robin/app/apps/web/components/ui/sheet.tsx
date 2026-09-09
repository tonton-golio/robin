'use client';

import * as React from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '@/lib/utils';
import { DialogOverlay } from './dialog';

export const SheetRoot = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetPortal = RadixDialog.Portal;
export const SheetTitle = RadixDialog.Title;
export const SheetDescription = RadixDialog.Description;
export const SheetClose = RadixDialog.Close;

export function SheetContent({
  side = 'right',
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDialog.Content> & { side?: 'left' | 'right' }) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        className={cn('workspace-sheet', `workspace-sheet--${side}`, className)}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
