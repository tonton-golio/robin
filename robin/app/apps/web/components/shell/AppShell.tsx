'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sunrise,
  CalendarDays,
  FolderTree,
  Network,
  FileText,
  Sparkles,
  Info,
  PanelLeft,
  Search,
  CheckSquare,
  Database,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { ResyncButton } from './ResyncButton';
import { Annotator } from '@/components/annotate/Annotator';
import { WidgetProvider } from '@/components/widgets/WidgetProvider';
import { WidgetTriggers, WidgetPanels } from '@/components/widgets/WidgetDock';
import { appBreadcrumbs, isDailyRoute, isOutputsRoute, isVaultRoute } from '@/lib/routes';

interface RailItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  match?: (path: string) => boolean;
}

const ITEMS: RailItem[] = [
  { href: '/', label: 'Today', icon: Sunrise, match: (p) => p === '/' },
  { href: '/daily', label: 'Daily', icon: CalendarDays, match: isDailyRoute },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/vault', label: 'Vault', icon: FolderTree, match: isVaultRoute },
  { href: '/graph', label: 'Graph', icon: Network },
  { href: '/outputs', label: 'Outputs', icon: FileText, match: isOutputsRoute },
  { href: '/chat', label: 'Chat', icon: Sparkles },
];

// Secondary destinations — knowledge tools + housekeeping, below a divider.
const SECONDARY: RailItem[] = [
  { href: '/memory', label: 'Memory', icon: Database },
  { href: '/comments', label: 'Comments', icon: MessageSquare },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/about', label: 'About', icon: Info },
];

function RailLink({ item, path }: { item: RailItem; path: string }) {
  const Icon = item.icon;
  const active = item.match ? item.match(path) : path.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className="robin-rail-item"
      aria-current={active ? 'page' : undefined}
      title={item.label}
    >
      <Icon size={18} strokeWidth={1.5} />
      <span className="robin-rail-item-label">{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const breadcrumb = appBreadcrumbs(path);

  return (
    <WidgetProvider>
    <div className="robin-shell" data-rail={open ? 'open' : 'closed'}>
      <aside className="robin-rail" aria-label="Primary">
        <Link href="/" className="robin-rail-brand" aria-label="Robin home">
          R<span className="robin-rail-brand-name">obin</span>
        </Link>
        {ITEMS.map((item) => (
          <RailLink key={item.href} item={item} path={path} />
        ))}
        <div className="robin-rail-divider" aria-hidden />
        {SECONDARY.map((item) => (
          <RailLink key={item.href} item={item} path={path} />
        ))}
        <div className="robin-rail-spacer" />
        <div className="robin-rail-foot">
          <button
            type="button"
            className="robin-rail-item"
            onClick={() => setOpen((v) => !v)}
            title="Toggle rail (⌘\\)"
          >
            <PanelLeft size={18} strokeWidth={1.5} />
            <span className="robin-rail-item-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="robin-content">
        <header className="robin-topbar">
          <div className="robin-crumbs">
            <Link href="/">robin</Link>
            {breadcrumb.map((seg, i) => {
              const isLast = i === breadcrumb.length - 1;
              return (
                <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <span className="robin-crumbs-sep">/</span>
                  {isLast ? (
                    <span className="robin-crumbs-now">{seg.label}</span>
                  ) : seg.href ? (
                    <Link href={seg.href}>{seg.label}</Link>
                  ) : (
                    <span className="robin-crumbs-folder">{seg.label}</span>
                  )}
                </span>
              );
            })}
          </div>
          <div className="robin-topbar-actions">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="robin-iconbtn robin-iconbtn-pill"
              title="Command palette (⌘K)"
            >
              <Search size={14} strokeWidth={1.5} />
              <kbd>⌘K</kbd>
            </button>
            <span className="robin-topbar-divider" aria-hidden />
            <WidgetTriggers />
            <ResyncButton />
          </div>
        </header>
        <main className="robin-main">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Annotator pathname={path} />
      <WidgetPanels />
    </div>
    </WidgetProvider>
  );
}
