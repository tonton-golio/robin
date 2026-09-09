'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import type {
  HItemVM,
  HSectionVM,
  HStatus,
  HealthViewModel,
} from './health-types';
import { archiveOutput, rescanAll } from './actions';

const TRIAGE_CAP = 12;
const SECTION_ITEM_CAP = 6;

function dotClass(status: HStatus): string {
  return status === 'critical' ? 'is-crit' : status === 'warn' ? 'is-warn' : 'is-ok';
}
function pillClass(status: HStatus): string {
  return status === 'critical' ? 'is-crit' : status === 'warn' ? 'is-warn' : 'is-ok';
}
function pillLabel(status: HStatus): string {
  return status === 'critical' ? 'Critical' : status === 'warn' ? 'Attention' : 'Healthy';
}
function sectionNum(num: number): string {
  return String(num).padStart(2, '0');
}
function metaLine(item: HItemVM): string {
  return [item.path, ...item.meta].filter(Boolean).join(' · ');
}

export function HealthDashboard({ vm }: { vm: HealthViewModel }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const scannerIds = useMemo(() => vm.sections.map((s) => s.id), [vm.sections]);

  // ── ephemeral UI state ────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openLists, setOpenLists] = useState<Set<string>>(new Set());
  const [triageAll, setTriageAll] = useState(false);
  const [selIndex, setSelIndex] = useState(-1);
  const [focusList, setFocusList] = useState<string>('triage');
  const [toast, setToast] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const firstTileRef = useRef<HTMLAnchorElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ── collapse helpers ───────────────────────────────────────────────────────
  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(
    () => setCollapsed(new Set(scannerIds)),
    [scannerIds],
  );
  const jumpTo = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      requestAnimationFrame(() => {
        document
          .getElementById(id)
          ?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    },
    [reduceMotion],
  );

  const visibleTriage = triageAll ? vm.triage : vm.triage.slice(0, TRIAGE_CAP);

  const openItem = useCallback(
    (item: HItemVM) => {
      if (item.action === 'annotation') {
        setFocusList('cadence');
        jumpTo('cadence');
        showToast('→ cadence · resolve annotation');
        return;
      }
      if (!item.openHref) return;
      if (item.external) window.open(item.openHref, '_blank', 'noreferrer');
      else router.push(item.openHref);
    },
    [jumpTo, router, showToast],
  );

  // ── mutations ──────────────────────────────────────────────────────────────
  const doRescan = useCallback(() => {
    startTransition(async () => {
      const res = await rescanAll();
      showToast(
        res.ok
          ? `snapshot rebuilt · ${vm.scannerCount} scanners · deltas recomputed`
          : `rescan failed: ${res.error ?? 'unknown'}`,
      );
      router.refresh();
    });
  }, [router, showToast, vm.scannerCount]);

  const doReindex = useCallback(() => {
    showToast('reindex → POST /api/resync · shared in-flight scan');
    fetch('/api/resync', { method: 'POST' })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        showToast(d.ok ? 'index rebuilt · lag cleared · logged' : `reindex failed: ${d.error ?? 'unknown'}`);
        router.refresh();
      })
      .catch(() => showToast('reindex failed'));
  }, [router, showToast]);

  const doArchive = useCallback(
    (relPath: string) => {
      startTransition(async () => {
        const res = await archiveOutput(relPath);
        showToast(res.ok ? 'archived → out/archive/ · logged' : `archive failed: ${res.error ?? 'unknown'}`);
        router.refresh();
      });
    },
    [router, showToast],
  );

  const patchAnnotation = useCallback(
    (id: string, status: 'resolved' | 'rejected', pagePath?: string, note?: string) => {
      fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, page_path: pagePath, resolution_md: note }),
      })
        .then((r) => r.json())
        .then((d: { ok?: boolean; error?: string }) => {
          showToast(
            d.ok
              ? status === 'resolved'
                ? 'resolved · resolution_md logged (agent-visible)'
                : 'dismissed · robin will not act on it'
              : `annotation update failed: ${d.error ?? 'unknown'}`,
          );
          router.refresh();
        })
        .catch(() => showToast('annotation update failed'));
    },
    [router, showToast],
  );

  const moveSel = useCallback(
    (delta: number) => {
      setSelIndex((i) => {
        const len = visibleTriage.length;
        if (len === 0) return -1;
        const start = i < 0 ? (delta > 0 ? -1 : 0) : i;
        return Math.max(0, Math.min(len - 1, start + delta));
      });
    },
    [visibleTriage.length],
  );

  // ── page-local keyboard map ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const inInput =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      // Let the shell own ⌘K / ⌘N / g-chords.
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'g') return;
      if (inInput) return;

      if (e.key >= '1' && e.key <= '7') {
        const id = scannerIds[Number(e.key) - 1];
        if (id) {
          setFocusList(id);
          jumpTo(id);
          e.preventDefault();
        }
        return;
      }
      switch (e.key) {
        case 'e':
          expandAll();
          showToast('expanded all scanners');
          break;
        case 'E':
          collapseAll();
          showToast('collapsed all scanners');
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          moveSel(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          moveSel(-1);
          break;
        case 'r':
          e.preventDefault();
          if (focusList === 'index-health') doReindex();
          else doRescan();
          break;
        case 'o':
        case 'Enter': {
          const it = visibleTriage[selIndex];
          if (it) {
            e.preventDefault();
            openItem(it);
          }
          break;
        }
        case '/':
          e.preventDefault();
          firstTileRef.current?.focus();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    scannerIds,
    jumpTo,
    expandAll,
    collapseAll,
    moveSel,
    doReindex,
    doRescan,
    focusList,
    openItem,
    selIndex,
    visibleTriage,
    showToast,
  ]);

  const triageCount: ReactNode =
    vm.triage.length > TRIAGE_CAP && !triageAll ? (
      <>
        showing {TRIAGE_CAP} of {vm.triageTotal} ·{' '}
        <button type="button" className="h-showall" onClick={() => setTriageAll(true)}>
          show all
        </button>
      </>
    ) : (
      <>
        {vm.triageTotal === 0
          ? '0 flagged'
          : `showing ${visibleTriage.length} of ${vm.triageTotal}`}
      </>
    );

  return (
    <div className="health-page">
      <span className="h-bar">Health</span>

      {/* OVERALL VERDICT — the page's one blue moment */}
      <div className="health-overall">
        <span className="h-corner">®</span>
        <div>
          <h1 className="h-verdict">{vm.verdictWord}</h1>
          <div className="h-sub">{vm.countsLine}</div>
          {vm.worst ? <div className="h-worst">{vm.worst}</div> : null}
        </div>
        <div className="h-rightcol">
          <span className="h-stamp">
            {vm.generatedLabel} · cached {vm.cachedLabel} · {vm.scannerCount} scanners
          </span>
          <button type="button" className="h-btnw" onClick={doRescan} disabled={pending}>
            {pending ? 'Rescanning…' : 'Rescan all'}
          </button>
        </div>
      </div>

      {/* STATUS STRIP */}
      <nav className="health-strip" aria-label="Scanner status strip">
        {vm.strip.map((tile, i) => (
          <a
            key={tile.id}
            ref={i === 0 ? firstTileRef : undefined}
            className="health-tile"
            href={`#${tile.id}`}
            onClick={(e) => {
              e.preventDefault();
              setFocusList(tile.id);
              jumpTo(tile.id);
            }}
          >
            <div className="h-thead">
              <span className={`h-dot ${dotClass(tile.status)}`} aria-hidden />
              <span className="health-sr-only">{pillLabel(tile.status)}: </span>
              <span className="h-tname">{tile.title}</span>
            </div>
            <span className={`h-metric ${tile.status === 'critical' ? 'is-crit' : ''}`}>
              {tile.metric}
              {tile.delta ? <span className="h-delta">{tile.delta}</span> : null}
            </span>
          </a>
        ))}
      </nav>

      {/* TRIAGE */}
      <section className="health-triage" aria-label="Triage — what to fix">
        <div className="h-triage-head">
          <span className="h-triage-lbl">Triage — what to fix</span>
          <span className="h-triage-n">{triageCount}</span>
        </div>
        {vm.triage.length === 0 ? (
          <div className="h-noflag">
            nothing flagged — {vm.scannerCount} scanners clean · this is a real zero
          </div>
        ) : (
          <div>
            {visibleTriage.map((item, idx) => (
              <TriageRow
                key={`${item.scannerId}:${item.id}`}
                item={item}
                selected={idx === selIndex}
                onSelect={() => setSelIndex(idx)}
                onJump={(id) => {
                  setFocusList(id);
                  jumpTo(id);
                  showToast(`→ ${id} section`);
                }}
                onArchive={doArchive}
                onOpen={openItem}
              />
            ))}
          </div>
        )}
      </section>

      {/* SCANNER SECTIONS */}
      {vm.sections.map((section) => (
        <ScannerSection
          key={section.id}
          section={section}
          collapsed={collapsed.has(section.id)}
          listOpen={openLists.has(section.id)}
          onToggle={() => toggleSection(section.id)}
          onToggleList={() =>
            setOpenLists((prev) => {
              const next = new Set(prev);
              if (next.has(section.id)) next.delete(section.id);
              else next.add(section.id);
              return next;
            })
          }
          onRescan={section.id === 'index-health' ? doReindex : doRescan}
          onReindex={doReindex}
          onArchive={doArchive}
          onResolve={(id, page, note) => patchAnnotation(id, 'resolved', page, note)}
          onDismiss={(id, page) => patchAnnotation(id, 'rejected', page)}
        />
      ))}

      {/* SYSTEM® FOOTER — what Robin is */}
      <SystemFooter vm={vm} />

      {toast ? (
        <div className="health-toast-holder" aria-live="polite" style={{ position: 'fixed', bottom: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}>
          <span
            className="h-mono"
            style={{
              background: 'var(--ink)',
              color: 'var(--on-ink)',
              fontSize: 11,
              padding: '8px 14px',
              display: 'inline-block',
              maxWidth: '80vw',
            }}
          >
            {toast}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── triage row ─────────────────────────────────────────────────────────────

function TriageRow({
  item,
  selected,
  onSelect,
  onJump,
  onArchive,
  onOpen,
}: {
  item: HItemVM;
  selected: boolean;
  onSelect: () => void;
  onJump: (id: string) => void;
  onArchive: (path: string) => void;
  onOpen: (item: HItemVM) => void;
}): ReactNode {
  return (
    <div
      className="health-trow"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
    >
      <span className={`h-dot ${dotClass(item.severity === 'critical' ? 'critical' : 'warn')}`} aria-hidden />
      <span className="health-sr-only">
        {pillLabel(item.severity === 'critical' ? 'critical' : 'warn')}:{' '}
      </span>
      <button
        type="button"
        className="h-scan"
        onClick={(e) => {
          e.stopPropagation();
          onJump(item.scannerId);
        }}
      >
        [{item.scannerId}]
      </button>
      <div className="h-body">
        <div className="h-ti">{item.title}</div>
        {item.detail ? <div className="h-td">{item.detail}</div> : null}
        <div className="h-tm">{metaLine(item)}</div>
      </div>
      <TriageAction item={item} onArchive={onArchive} onOpen={onOpen} onJump={onJump} />
    </div>
  );
}

function TriageAction({
  item,
  onArchive,
  onOpen,
  onJump,
}: {
  item: HItemVM;
  onArchive: (path: string) => void;
  onOpen: (item: HItemVM) => void;
  onJump: (id: string) => void;
}): ReactNode {
  if (item.action === 'archive' && item.archivePath) {
    return (
      <button
        type="button"
        className="h-act"
        onClick={(e) => {
          e.stopPropagation();
          onArchive(item.archivePath!);
        }}
      >
        Archive<span className="h-k">a</span>
      </button>
    );
  }
  if (item.action === 'annotation') {
    return (
      <button
        type="button"
        className="h-act"
        onClick={(e) => {
          e.stopPropagation();
          onJump('cadence');
        }}
      >
        Resolve<span className="h-k">r</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="h-act"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item);
      }}
    >
      Open<span className="h-k">o</span>
    </button>
  );
}

// ── scanner section ──────────────────────────────────────────────────────────

function ScannerSection({
  section,
  collapsed,
  listOpen,
  onToggle,
  onToggleList,
  onRescan,
  onReindex,
  onArchive,
  onResolve,
  onDismiss,
}: {
  section: HSectionVM;
  collapsed: boolean;
  listOpen: boolean;
  onToggle: () => void;
  onToggleList: () => void;
  onRescan: () => void;
  onReindex: () => void;
  onArchive: (path: string) => void;
  onResolve: (id: string, pagePath?: string, note?: string) => void;
  onDismiss: (id: string, pagePath?: string) => void;
}): ReactNode {
  const items = section.items;
  const shown = listOpen ? items : items.slice(0, SECTION_ITEM_CAP);
  const total = Math.max(section.itemsTotal, items.length);
  const needShowAll = items.length > SECTION_ITEM_CAP;

  return (
    <section id={section.id} className={`health-scanner${collapsed ? ' is-collapsed' : ''}`}>
      <div
        className="h-shead"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="h-bar">
          {sectionNum(section.num)} · {section.title}
        </span>
        <span className={`h-pill ${pillClass(section.status)}`}>{pillLabel(section.status)}</span>
        {section.source ? <span className="h-src">source: {section.source}</span> : null}
        <button
          type="button"
          className="h-srescan"
          onClick={(e) => {
            e.stopPropagation();
            onRescan();
          }}
        >
          {section.id === 'index-health' ? 'Reindex' : 'Rescan'}
        </button>
        <span className="h-chev" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </div>

      <div className="h-sbody">
        <p className="h-summary">{section.summary}</p>

        {section.criticalCard ? (
          <div className="health-critcard" role="alert">
            <div className="h-ch">
              <span className="h-dot is-crit" aria-hidden />
              <span className="h-ct">{section.criticalCard.title}</span>
            </div>
            <p>{section.criticalCard.body}</p>
            <div className="h-crow">
              <button type="button" className="h-act" onClick={onReindex}>
                Reindex now
              </button>
            </div>
          </div>
        ) : null}

        {section.isComposition ? (
          <CompositionTable section={section} />
        ) : (
          <>
            {section.metrics.length > 0 ? (
              <div className="health-metrics">
                {section.metrics.map((m) => (
                  <div key={`${section.id}:${m.label}`} className="health-metric" title={m.hint}>
                    <span className="h-ml">{m.label}</span>
                    <span className={`h-mv ${m.status === 'critical' ? 'is-crit' : ''}`}>
                      {m.value}
                      {m.delta ? <span className="h-md">{m.delta}</span> : null}
                    </span>
                    {m.hint ? (
                      <span className="h-mh">
                        {m.hintHref ? <Link href={m.hintHref}>{m.hint}</Link> : m.hint}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {section.id === 'index-health' ? (
              <div className="health-inlineactions">
                <button type="button" className="h-act" onClick={onReindex}>
                  Reindex now<span className="h-k">r</span>
                </button>
                <span className="h-note">
                  POST /api/resync · single shared in-flight scan · logged (agent-visible)
                </span>
              </div>
            ) : null}

            {items.length > 0 ? (
              <div className="health-items">
                <div className="h-icount">
                  <span>{section.itemsLabel}</span>
                  <span>
                    showing {shown.length} of {total}
                    {needShowAll && !listOpen ? (
                      <>
                        {' · '}
                        <button type="button" className="h-showall" onClick={onToggleList}>
                          show all
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
                {shown.map((item) =>
                  item.action === 'annotation' ? (
                    <AnnotationRow
                      key={item.id}
                      item={item}
                      onResolve={onResolve}
                      onDismiss={onDismiss}
                    />
                  ) : (
                    <ItemRow key={item.id} item={item} onArchive={onArchive} />
                  ),
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function CompositionTable({ section }: { section: HSectionVM }): ReactNode {
  const byType = section.compByType ?? [];
  const byTier = section.compByTier ?? [];
  const rows = Math.max(byType.length, byTier.length);
  return (
    <table className="health-comptable">
      <thead>
        <tr>
          <th>By type</th>
          <th>Pages</th>
          <th style={{ width: 24 }} />
          <th>By tier</th>
          <th>Pages</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, i) => {
          const t = byType[i];
          const tier = byTier[i];
          return (
            <tr key={i}>
              <td>{t?.label ?? ''}</td>
              <td className="h-n">{t ? t.count : ''}</td>
              <td />
              <td>{tier?.label ?? ''}</td>
              <td className="h-n">{tier ? tier.count : ''}</td>
            </tr>
          );
        })}
        <tr>
          <td className="h-lw" colSpan={2} style={{ color: 'var(--muted)' }}>
            total pages {section.compPages ?? 0}
          </td>
          <td />
          <td className="h-lw" colSpan={2} style={{ color: 'var(--muted)' }}>
            total links {section.compLinks ?? 0}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function ItemRow({
  item,
  onArchive,
}: {
  item: HItemVM;
  onArchive: (path: string) => void;
}): ReactNode {
  return (
    <div className="health-irow" tabIndex={0}>
      <span className={`h-dot ${dotClass(item.severity === 'critical' ? 'critical' : 'warn')}`} aria-hidden />
      <span className="health-sr-only">
        {pillLabel(item.severity === 'critical' ? 'critical' : 'warn')}:{' '}
      </span>
      <div className="h-body">
        <div className="h-ti">{item.title}</div>
        {item.detail ? <div className="h-td">{item.detail}</div> : null}
        <div className="h-tm">{metaLine(item)}</div>
      </div>
      <div className="h-side">
        {item.action === 'archive' && item.archivePath ? (
          <button
            type="button"
            className="h-act"
            onClick={() => onArchive(item.archivePath!)}
          >
            Archive<span className="h-k">a</span>
          </button>
        ) : null}
        <OpenAction item={item} />
      </div>
    </div>
  );
}

function OpenAction({ item }: { item: HItemVM }): ReactNode {
  if (!item.openHref) return null;
  if (item.external) {
    return (
      <a className="h-act" href={item.openHref} target="_blank" rel="noreferrer">
        {item.openLabel}
        <span className="h-k">o</span>
      </a>
    );
  }
  return (
    <Link className="h-act" href={item.openHref}>
      {item.openLabel}
      <span className="h-k">o</span>
    </Link>
  );
}

// ── cadence annotation row (resolve note + dismiss confirm) ──────────────────

function AnnotationRow({
  item,
  onResolve,
  onDismiss,
}: {
  item: HItemVM;
  onResolve: (id: string, pagePath?: string, note?: string) => void;
  onDismiss: (id: string, pagePath?: string) => void;
}): ReactNode {
  const [resolving, setResolving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className="health-irow" tabIndex={0}>
      <span className="h-dot is-warn" aria-hidden />
      <span className="health-sr-only">Attention: </span>
      <div className="h-body">
        <div className="h-ti">{item.title}</div>
        <div className="h-tm">{metaLine(item)}</div>
        <div className={`health-resolveform${resolving ? ' is-open' : ''}`}>
          <input
            type="text"
            value={note}
            placeholder="what closed this? → resolution_md"
            aria-label="resolution note"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && item.annId) {
                onResolve(item.annId, item.annPagePath, note || undefined);
                setResolving(false);
                setNote('');
              }
              if (e.key === 'Escape') setResolving(false);
            }}
          />
          <button
            type="button"
            className="h-act"
            onClick={() => {
              if (item.annId) onResolve(item.annId, item.annPagePath, note || undefined);
              setResolving(false);
              setNote('');
            }}
          >
            Save + resolve
          </button>
        </div>
        <div className={`health-dismissconfirm${confirming ? ' is-open' : ''}`}>
          <span>Dismiss — robin will not act on it.</span>
          <button type="button" className="h-act" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="h-act is-danger"
            onClick={() => {
              if (item.annId) onDismiss(item.annId, item.annPagePath);
              setConfirming(false);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="h-side">
        <button
          type="button"
          className="h-act"
          onClick={() => {
            setConfirming(false);
            setResolving((v) => !v);
          }}
        >
          Resolve<span className="h-k">r</span>
        </button>
        <button
          type="button"
          className="h-act is-danger"
          onClick={() => {
            setResolving(false);
            setConfirming((v) => !v);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── SYSTEM® footer ───────────────────────────────────────────────────────────

function SystemFooter({ vm }: { vm: HealthViewModel }): ReactNode {
  return (
    <footer className="health-sysfoot">
      <span className="h-bar">
        System<span className="h-reg">®</span> — what robin is
      </span>
      <p className="h-lede">
        Robin is {vm.footer.ownerPoss} <b>local second brain</b> — plain files, self-cleaning,
        built for the agent to live in.
      </p>
      <p>
        Sources land in <code>inbox/</code>, durable knowledge lives as HTML pages in{' '}
        <code>brain/</code>, generated artifacts go to <code>out/</code>, and operational logs
        append to <code>logs/</code>. The browser app you&apos;re reading serves brain pages,
        captures annotations, and triggers skills that run inside the Claude Code agent — ingest,
        morning brief, end-of-day consolidation, weekly review.
      </p>

      <p className="h-sublabel">The layers</p>
      <table className="health-layertable">
        <thead>
          <tr>
            <th>Layer</th>
            <th>What</th>
            <th>Count</th>
            <th>Surface</th>
            <th>Last write</th>
          </tr>
        </thead>
        <tbody>
          {vm.footer.layers.map((layer) => (
            <tr key={layer.layer} className={layer.sub ? 'h-sub' : undefined}>
              <td>{layer.layer}</td>
              <td>{layer.what}</td>
              <td className="h-n">{layer.count}</td>
              <td>
                <Link href={layer.surfaceHref}>{layer.surfaceLabel}</Link>
              </td>
              <td className="h-lw">{layer.lastWrite}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="h-prose-note">
        every count is live from the same catalog the scanners read — including decisions + tasks,
        which the old /about computed but never showed.
      </p>

      <p className="h-sublabel">The rhythm</p>
      <p>
        <code>/morning-brief</code> starts the day, new sources get <code>/ingest-source</code> or{' '}
        <code>/ingest-meeting</code>, durable insight is captured with <code>/learn</code>, the day
        is consolidated with <code>/remsleep</code>. Weekly review runs Mondays.
      </p>

      <p className="h-sublabel">Stack</p>
      <p>
        Next.js 16 · React 19 · Tailwind 4 · SQLite FTS5 + vector search · Claude Code skills · MCP
        server · single-user, local-only.
      </p>

      <p className="h-foottag">robin® health · everything is probably fine.</p>
    </footer>
  );
}
