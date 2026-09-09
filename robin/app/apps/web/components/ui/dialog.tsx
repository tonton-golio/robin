'use client';

import * as React from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DialogRoot = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogPortal = RadixDialog.Portal;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;
export const DialogClose = RadixDialog.Close;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof RadixDialog.Overlay>) {
  return <RadixDialog.Overlay className={cn('workspace-dialog-overlay', className)} {...props} />;
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Content className={cn('workspace-dialog-content', className)} {...props}>
      {children}
    </RadixDialog.Content>
  );
}

export function DialogHeader({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('workspace-dialog-header', className)} {...props}>
      {children}
    </div>
  );
}

export function DialogBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div className={cn('workspace-dialog-body', className)} {...props} />;
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div className={cn('workspace-dialog-footer', className)} {...props} />;
}

export function DialogCloseButton({ label = 'Close' }: { label?: string }) {
  return (
    <RadixDialog.Close type="button" className="workspace-icon-button" aria-label={label}>
      <X size={17} strokeWidth={1.7} aria-hidden="true" />
    </RadixDialog.Close>
  );
}
