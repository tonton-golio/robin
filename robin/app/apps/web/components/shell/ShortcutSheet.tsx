'use client';

import { usePathname } from 'next/navigation';
import { COMMAND_DESTINATIONS } from '@/lib/workspaces';
import {
  isActivityRoute,
  isHealthRoute,
  isMemoryRoute,
  isSearchRoute,
  isTasksRoute,
} from '@/lib/routes';
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

interface Shortcut {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  label: string;
  rows: Shortcut[];
}

// Jump chords are derived from the route contract so the sheet never drifts.
const NAV_ROWS: Shortcut[] = COMMAND_DESTINATIONS.map((item) => ({
  keys: ['g', item.chord],
  label: `Go to ${item.label}`,
}));

const BASE_GROUPS: ShortcutGroup[] = [
  { label: 'Navigate', rows: NAV_ROWS },
  {
    label: 'Global',
    rows: [
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['⌘', 'N'], label: 'New page' },
      { keys: ['?'], label: 'This shortcut sheet' },
      { keys: ['Esc'], label: 'Close overlay / dialog' },
    ],
  },
];

function shortcutContext(pathname: string): ShortcutGroup {
  if (isTasksRoute(pathname)) {
    return {
      label: 'Tasks',
      rows: [
        { keys: ['J', 'K'], label: 'Move between tasks' },
        { keys: ['↵'], label: 'Open selected task' },
        { keys: ['V'], label: 'Switch tree / board' },
        { keys: ['[', ']'], label: 'Move status backward / forward' },
        { keys: ['1…4'], label: 'Set task status' },
        { keys: ['/'], label: 'Filter tasks' },
      ],
    };
  }
  if (isActivityRoute(pathname)) {
    return {
      label: 'Activity',
      rows: [
        { keys: ['1', '2', '3'], label: 'Switch activity lens' },
        { keys: ['J', 'K'], label: 'Move between rows' },
        { keys: ['↵', 'O'], label: 'Open selected item' },
        { keys: ['X'], label: 'Toggle edit diff' },
        { keys: ['U'], label: 'Undo selected edit' },
        { keys: ['R', 'A'], label: 'Resolve / flag comment' },
      ],
    };
  }
  if (isMemoryRoute(pathname)) {
    return {
      label: 'Memory',
      rows: [
        { keys: ['J', 'K'], label: 'Move between memories' },
        { keys: ['↵', 'O'], label: 'Expand selected memory' },
        { keys: ['C'], label: 'Confirm selected memory' },
        { keys: ['X', 'E', 'S'], label: 'Reject / archive / supersede' },
        { keys: ['L'], label: 'Open lineage' },
        { keys: ['1…5', '0'], label: 'Filter status / show all' },
      ],
    };
  }
  if (isHealthRoute(pathname)) {
    return {
      label: 'System health',
      rows: [
        { keys: ['1…7'], label: 'Jump to scanner' },
        { keys: ['E', '⇧E'], label: 'Expand / collapse scanners' },
        { keys: ['J', 'K'], label: 'Move through triage' },
        { keys: ['R'], label: 'Reindex / rescan' },
        { keys: ['↵', 'O'], label: 'Open selected item' },
        { keys: ['/'], label: 'Focus status strip' },
      ],
    };
  }
  if (isSearchRoute(pathname)) {
    return {
      label: 'Search results',
      rows: [
        { keys: ['J', 'K'], label: 'Move between results' },
        { keys: ['↵'], label: 'Open result' },
        { keys: ['⌘', '↵'], label: 'Open result in new tab' },
        { keys: ['O', 'Y'], label: 'Reveal in files / copy path' },
        { keys: ['1…4'], label: 'Filter corpus' },
        { keys: ['/', 'F', 'X'], label: 'Query / filters / clear' },
      ],
    };
  }
  if (
    pathname.startsWith('/brain/') ||
    pathname.startsWith('/logs/') ||
    pathname.startsWith('/out/') ||
    pathname.startsWith('/file/') ||
    pathname.startsWith('/p/')
  ) {
    return {
      label: 'Reader',
      rows: [
        { keys: ['E'], label: 'Edit page' },
        { keys: ['C'], label: 'Add comment' },
        { keys: ['⌘', 'S'], label: 'Save changes' },
      ],
    };
  }
  return {
    label: 'Current view',
    rows: [
      { keys: ['J'], label: 'Next card' },
      { keys: ['K'], label: 'Previous card' },
      { keys: ['↵'], label: 'Open selected card' },
      { keys: ['E'], label: 'Edit selected card' },
    ],
  };
}

/**
 * `?`-toggled keyboard map. Radix owns focus trapping, Escape dismissal, focus
 * return, and the modal accessibility contract.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const pathname = usePathname() ?? '/';
  const groups = [shortcutContext(pathname), ...BASE_GROUPS];

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="robin-shortcut-sheet-overlay" />
        <DialogContent className="robin-shortcut-sheet">
          <DialogHeader>
            <div>
              <DialogTitle className="robin-shortcut-sheet-title">
                Keyboard shortcuts
              </DialogTitle>
              <DialogDescription>
                Move through Robin without leaving the keyboard.
              </DialogDescription>
            </div>
            <DialogCloseButton label="Close keyboard shortcuts" />
          </DialogHeader>
          <DialogBody>
            {groups.map((group) => (
              <section className="robin-shortcut-group" key={group.label}>
                <div className="robin-shortcut-group-label">{group.label}</div>
                {group.rows.map((row) => (
                  <div className="robin-shortcut-row" key={row.label}>
                    <span>{row.label}</span>
                    <span className="robin-shortcut-keys">
                      {row.keys.map((key) => (
                        <kbd key={`${row.label}-${key}`}>{key}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
