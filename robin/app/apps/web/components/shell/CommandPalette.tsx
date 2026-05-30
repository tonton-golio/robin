'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Dialog, VisuallyHidden } from 'radix-ui';
import {
  Sunrise,
  FolderTree,
  Network,
  FileText,
  Sparkles,
  Info,
  RefreshCw,
  Mic,
  Headphones,
  Wrench,
  FilePlus,
  ListTodo,
  MessageSquare,
  CornerDownLeft,
  type LucideIcon,
} from 'lucide-react';
import { vaultPageHref } from '@/lib/routes';

interface SearchHit {
  title: string;
  path: string;
  href?: string;
  type?: string;
  summary?: string;
}

interface CommandAction {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Extra terms to match against when filtering in command mode. */
  keywords: string[];
}

const COMMANDS: CommandAction[] = [
  { id: 'today', label: 'Go to Today', description: 'Daily dashboard', href: '/', icon: Sunrise, keywords: ['home', 'dashboard', 'start'] },
  { id: 'new', label: 'New page', description: 'Create a knowledge page', href: '/new', icon: FilePlus, keywords: ['create', 'add', 'write', 'page'] },
  { id: 'tasks', label: 'Open Tasks', description: 'Task board', href: '/tasks', icon: ListTodo, keywords: ['todo', 'task', 'board'] },
  { id: 'vault', label: 'Open Vault', description: 'Browse the brain', href: '/vault', icon: FolderTree, keywords: ['files', 'brain', 'tree', 'browse'] },
  { id: 'graph', label: 'Open Graph', description: 'Knowledge graph view', href: '/graph', icon: Network, keywords: ['links', 'map', 'connections'] },
  { id: 'outputs', label: 'Browse Outputs', description: 'Generated reports', href: '/outputs', icon: FileText, keywords: ['reports', 'out', 'generated'] },
  { id: 'chat', label: 'Open Chat', description: 'Chat with Robin', href: '/chat', icon: MessageSquare, keywords: ['talk', 'ask', 'assistant'] },
  { id: 'meeting', label: 'Record meeting', description: 'Live transcription', href: '#widget:meeting', icon: Headphones, keywords: ['record', 'transcribe', 'audio'] },
  { id: 'interview', label: 'Start interview', description: 'Voice interview', href: '#widget:interview', icon: Mic, keywords: ['voice', 'ask', 'questions'] },
  { id: 'maintenance', label: 'Maintenance', description: 'Vault health & lint', href: '/maintenance', icon: Wrench, keywords: ['lint', 'health', 'clean', 'fix'] },
  { id: 'about', label: 'About Robin', description: 'How Robin works', href: '/about', icon: Info, keywords: ['help', 'info', 'docs'] },
  { id: 'resync', label: 'Resync vault', description: 'Rebuild the search index', href: '#resync', icon: RefreshCw, keywords: ['reindex', 'refresh', 'rebuild', 'index'] },
];

/** Subset shown on the empty/idle state. */
const QUICK_ACTIONS = COMMANDS.filter((c) =>
  ['today', 'vault', 'graph', 'new', 'chat', 'resync'].includes(c.id),
);

function fuzzyMatch(term: string, command: CommandAction): boolean {
  if (!term) return true;
  const haystack = (command.label + ' ' + command.id + ' ' + command.keywords.join(' ')).toLowerCase();
  // every whitespace-separated token must appear somewhere
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  const isCommandMode = query.startsWith('/');
  const commandTerm = isCommandMode ? query.slice(1).trim() : '';
  const matchedCommands = useMemo(
    () => (isCommandMode ? COMMANDS.filter((c) => fuzzyMatch(commandTerm, c)) : []),
    [isCommandMode, commandTerm],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    // No server search in command mode, on empty, or for short queries.
    if (isCommandMode || !query || query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&k=8`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setHits([]);
        } else {
          const data = await res.json();
          setHits(Array.isArray(data.hits) ? data.hits.slice(0, 8) : []);
        }
      } catch {
        // ignored
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query, isCommandMode]);

  function go(action: Pick<CommandAction, 'id' | 'href'>) {
    onOpenChange(false);
    if (action.id === 'resync') {
      window.dispatchEvent(new CustomEvent('robin:resync'));
      return;
    }
    if (action.href.startsWith('#widget:')) {
      window.dispatchEvent(
        new CustomEvent('robin:open-widget', { detail: action.href.slice('#widget:'.length) }),
      );
      return;
    }
    router.push(action.href);
  }

  function openPage(hit: SearchHit) {
    onOpenChange(false);
    const href = hit.href ?? vaultPageHref(hit.path);
    router.push(href);
  }

  const showQuickActions = !query;

  return (
    // Command.Dialog is built on Radix Dialog: it provides role=dialog,
    // aria-modal, a focus trap, scroll lock, Escape-to-close, and focus
    // restoration to the trigger. Reuse the existing palette styling by
    // passing the overlay/panel class names through.
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Robin command palette"
      shouldFilter={false}
      overlayClassName="robin-cmdk-overlay"
      contentClassName={`robin-cmdk${isCommandMode ? ' robin-cmdk--command' : ''}`}
      data-mode={isCommandMode ? 'command' : 'search'}
    >
          {/* Command.Dialog renders a Radix Dialog, which requires an accessible
              Title (and warns about a missing Description) for screen readers.
              The palette is visually self-evident, so hide both off-screen.
              cmdk and we share a single hoisted @radix-ui/react-dialog, so this
              Dialog.Title/Description resolves the same Dialog context. */}
          <VisuallyHidden.Root>
            <Dialog.Title>Robin command palette</Dialog.Title>
            <Dialog.Description>
              Search pages or type / to run a command.
            </Dialog.Description>
          </VisuallyHidden.Root>
          <div className="robin-cmdk-inputrow">
            {isCommandMode && (
              <span className="robin-cmdk-mode-badge" aria-hidden>
                <CornerDownLeft size={11} strokeWidth={2} />
                Command
              </span>
            )}
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={
                isCommandMode ? 'Run a command…' : 'Search pages, or type / for commands…'
              }
              autoFocus
            />
          </div>
          <Command.List className="robin-cmdk-list">
            {/* Command mode: leading "/" filters the action list */}
            {isCommandMode && matchedCommands.length > 0 && (
              // Omit cmdk's `heading` prop: it renders a second, unstyled
              // heading element on top of our styled label below. The styled
              // div is the visible group label.
              <Command.Group>
                <div className="robin-cmdk-group">Commands</div>
                {matchedCommands.map((cmd) => {
                  const Icon = cmd.icon;
                  return (
                    <Command.Item
                      key={cmd.id}
                      onSelect={() => go(cmd)}
                      value={cmd.id + ' ' + cmd.label + ' ' + cmd.keywords.join(' ')}
                      className="robin-cmdk-item"
                    >
                      <Icon size={16} strokeWidth={1.5} />
                      <span className="robin-cmdk-item-label">{cmd.label}</span>
                      <span className="robin-cmdk-item-desc">{cmd.description}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
            {isCommandMode && matchedCommands.length === 0 && (
              <div className="robin-cmdk-empty">
                No command matches <code>/{commandTerm}</code>.
              </div>
            )}

            {/* Idle: quick actions + the slash hint */}
            {showQuickActions && (
              <Command.Group>
                <div className="robin-cmdk-group">Quick actions</div>
                {QUICK_ACTIONS.map((cmd) => {
                  const Icon = cmd.icon;
                  return (
                    <Command.Item
                      key={cmd.id}
                      onSelect={() => go(cmd)}
                      value={cmd.id + ' ' + cmd.label}
                      className="robin-cmdk-item"
                    >
                      <Icon size={16} strokeWidth={1.5} />
                      <span className="robin-cmdk-item-label">{cmd.label}</span>
                    </Command.Item>
                  );
                })}
                <div className="robin-cmdk-tip">
                  <Sparkles size={13} strokeWidth={1.5} />
                  Type <kbd>/</kbd> to run a command
                </div>
              </Command.Group>
            )}

            {/* Search mode */}
            {!isCommandMode && query && hits.length > 0 && (
              <Command.Group>
                <div className="robin-cmdk-group">Pages</div>
                {hits.map((hit) => (
                  <Command.Item
                    key={hit.path}
                    value={hit.title + ' ' + hit.path}
                    onSelect={() => openPage(hit)}
                    className="robin-cmdk-item"
                  >
                    <FileText size={16} strokeWidth={1.5} />
                    <span className="robin-cmdk-item-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hit.title}
                    </span>
                    <span className="robin-cmdk-item-meta">{hit.type ?? ''}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {!isCommandMode && query && hits.length === 0 && !loading && (
              <div className="robin-cmdk-empty">No results.</div>
            )}
            {!isCommandMode && query && loading && (
              <div className="robin-cmdk-empty">Searching…</div>
            )}
          </Command.List>
          <div className="robin-cmdk-hint">
            <span>↑ ↓ navigate · ↵ {isCommandMode ? 'run' : 'open'} · esc close</span>
            <span>{isCommandMode ? '/ command' : '⌘K'}</span>
          </div>
    </Command.Dialog>
  );
}
