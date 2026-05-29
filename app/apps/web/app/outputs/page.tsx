import Link from 'next/link';
import React from 'react';
import {
  FileText,
  Presentation,
  ScrollText,
  Calendar,
  Mic,
  StickyNote,
  Headphones,
  FileImage,
} from 'lucide-react';
import { listOutputs, type OutputItem } from '@/lib/catalog';
import { OutputPreview } from './OutputPreview';

export const dynamic = 'force-dynamic';

const KIND_META: Record<string, { Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string }> = {
  presentations: { Icon: Presentation, label: 'Presentations' },
  reports: { Icon: ScrollText, label: 'Reports' },
  meetings: { Icon: Calendar, label: 'Meetings' },
  interviews: { Icon: Mic, label: 'Interviews' },
  handovers: { Icon: ScrollText, label: 'Handovers' },
  remsleep: { Icon: StickyNote, label: 'Remsleep' },
  images: { Icon: FileImage, label: 'Images' },
  notes: { Icon: StickyNote, label: 'Notes' },
  log: { Icon: ScrollText, label: 'Logs' },
};

function metaFor(kind: string): { Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string } {
  return KIND_META[kind] ?? { Icon: FileText, label: kind };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface SectionData {
  kind: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  items: OutputItem[];
}

export default async function OutputsPage() {
  const outputs = await listOutputs();
  const grouped = new Map<string, OutputItem[]>();
  for (const item of outputs) {
    const existing = grouped.get(item.kind) ?? [];
    existing.push(item);
    grouped.set(item.kind, existing);
  }
  const sections: SectionData[] = Array.from(grouped.entries())
    .map(([kind, items]): SectionData => {
      const meta = metaFor(kind);
      return { kind, label: meta.label, Icon: meta.Icon, items };
    })
    .sort((a, b) => {
      const order = ['presentations', 'reports', 'meetings', 'interviews', 'handovers', 'remsleep', 'notes', 'images', 'log'];
      const ai = order.indexOf(a.kind);
      const bi = order.indexOf(b.kind);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

  return (
    <div className="outputs-page">
      <header className="outputs-head">
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--robin-amber)', textTransform: 'uppercase', marginBottom: 6 }}>
            Outputs
          </p>
          <h1 className="outputs-title">Generated work, ready to open.</h1>
        </div>
      </header>

      {outputs.length === 0 ? (
        <section style={{ padding: 48, border: '1px solid var(--border-0)', borderRadius: 12, textAlign: 'center', color: 'var(--text-2)' }}>
          <FileText size={32} strokeWidth={1.5} style={{ marginBottom: 12, color: 'var(--text-2)' }} />
          <p style={{ color: 'var(--text-0)', fontSize: 16, marginBottom: 6 }}>No outputs yet.</p>
          <p style={{ fontSize: 14 }}>Generated artifacts will appear here when Robin writes to <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--robin-amber)' }}>out/</code>.</p>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 40 }}>
          {sections.map(({ kind, label, Icon, items }) => (
            <section key={kind}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border-0)' }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={14} strokeWidth={1.5} />
                  {label}
                </h2>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{items.length}</span>
              </div>
              <div className="outputs-grid">
                {items.map((item) => {
                  return (
                    <Link key={item.path} href={item.href} className="output-tile">
                      <OutputPreview path={item.path} />
                      <div className="output-tile-body">
                        <div className="output-tile-title">{item.title}</div>
                        <div className="output-tile-meta">
                          <span>{formatDate(item.mtime)}</span>
                          <span>·</span>
                          <span>{formatBytes(item.size)}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
