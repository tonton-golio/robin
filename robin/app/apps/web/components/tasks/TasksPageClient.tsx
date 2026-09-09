'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TaskItem } from '@/lib/tasks';
import type { CalendarToday, CalendarWeek } from '@/lib/calendar';
import { buildTaskTree } from '@/lib/task-hierarchy';
import { stepStatus, statusColumnFromStatus, type StatusColumn } from '@/lib/task-display';
import { createPage } from '@/lib/actions/page';
import { useTaskBoard, type TaskPatch } from './useTaskBoard';
import {
  DEFAULT_VIEW,
  serializeParams,
  computeRollup,
  leafMatches,
  outcomeIndex,
  rollupThesis,
  CURRENT_OWNER,
  type ViewState,
  type RollupFilter,
  type CalMode,
} from './task-view';
import { Rollup } from './Rollup';
import { CalendarBand } from './CalendarBand';
import { TreeView } from './TreeView';
import { BoardView } from './BoardView';
import { MovePicker } from './MovePicker';
import { LoadingState, EmptyState, ErrorState, OverloadStrip } from './TaskStates';
import type { LeafRowHandlers, RowPanel } from './LeafRow';

const WINDOW = 120;
const CAL_MODES: CalMode[] = ['day', 'week', 'timeline'];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function TasksPageClient({
  initialTasks,
  week,
  today,
  initial,
}: {
  initialTasks: TaskItem[];
  week: CalendarWeek;
  today: CalendarToday | null;
  initial: ViewState;
}) {
  const router = useRouter();
  const board = useTaskBoard(initialTasks);
  const { tasks } = board;

  const [view, setViewState] = useState<ViewState>(initial);
  const [showDone, setShowDone] = useState(false);
  const [collapsedOutcomes, setCollapsedOutcomes] = useState<Set<string>>(new Set());
  const [collapsedWs, setCollapsedWs] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [panel, setPanel] = useState<RowPanel>(null);
  const [panelPath, setPanelPath] = useState<string | null>(null);
  const [moveTask, setMoveTask] = useState<TaskItem | null>(null);

  const elsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync view → URL (replaceState; never a history entry per keystroke).
  const setView = useCallback((next: Partial<ViewState>) => {
    setViewState((prev) => {
      const merged = { ...prev, ...next };
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname + serializeParams(merged));
      }
      return merged;
    });
  }, []);

  // ── derived model ──────────────────────────────────────────────────────
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const outcomeOf = useMemo(() => outcomeIndex(tasks), [tasks]);
  const outcomeOfLeaf = useCallback((t: TaskItem) => outcomeOf.get(t.slug) ?? null, [outcomeOf]);

  const leafToWs = useMemo(() => {
    const m = new Map<string, string>();
    for (const on of tree)
      for (const ws of on.workstreams) {
        const k = ws.workstream?.slug ?? '__orphan__';
        for (const leaf of ws.leaves) m.set(leaf.path, k);
      }
    return m;
  }, [tree]);
  const leafToOutcomeKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const on of tree) {
      const k = on.outcome?.slug ?? '__ungrouped__';
      for (const ws of on.workstreams) for (const leaf of ws.leaves) m.set(leaf.path, k);
    }
    return m;
  }, [tree]);

  const counts = useMemo(() => computeRollup(tasks), [tasks]);
  const thesis = useMemo(() => rollupThesis(tasks, counts), [tasks, counts]);

  const visibleLeaf = useCallback(
    (t: TaskItem) => leafMatches(t, view, outcomeOfLeaf, showDone),
    [view, outcomeOfLeaf, showDone],
  );

  // Ordered visible leaves (tree order) — used by board, focus, windowing.
  const orderedVisible = useMemo(() => {
    const out: TaskItem[] = [];
    for (const on of tree) for (const ws of on.workstreams) for (const leaf of ws.leaves) if (visibleLeaf(leaf)) out.push(leaf);
    return out;
  }, [tree, visibleLeaf]);

  const renderablePaths = useMemo(() => {
    if (orderedVisible.length <= WINDOW) return null;
    return new Set(orderedVisible.slice(0, WINDOW).map((t) => t.path));
  }, [orderedVisible]);

  const outcomeChips = useMemo(
    () => tree.filter((n) => n.outcome).map((n) => ({ slug: n.outcome!.slug, label: n.outcome!.title, count: n.active })),
    [tree],
  );

  // ── selection helpers ──────────────────────────────────────────────────
  const registerEl = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) elsRef.current.set(path, el);
    else elsRef.current.delete(path);
  }, []);

  const select = useCallback((path: string) => {
    setSelectedPath(path);
    setPanel(null);
    setPanelPath(null);
    const el = elsRef.current.get(path);
    el?.scrollIntoView({ block: 'nearest' });
  }, []);

  const moveFocus = useCallback(
    (delta: number) => {
      if (orderedVisible.length === 0) return;
      const idx = selectedPath ? orderedVisible.findIndex((t) => t.path === selectedPath) : -1;
      const next = Math.max(0, Math.min(orderedVisible.length - 1, idx + delta));
      const t = orderedVisible[next];
      if (t) select(t.path);
    },
    [orderedVisible, selectedPath, select],
  );

  const selectedTask = useMemo(
    () => tasks.find((t) => t.path === selectedPath) ?? null,
    [tasks, selectedPath],
  );

  // ── mutations ──────────────────────────────────────────────────────────
  const patch = useCallback((path: string, p: TaskPatch) => void board.patchTask(path, p), [board]);

  const openPanel = useCallback((path: string, p: RowPanel) => {
    setSelectedPath(path);
    setPanel(p);
    setPanelPath(p ? path : null);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    setPanelPath(null);
  }, []);

  const openTask = useCallback((t: TaskItem) => router.push(t.href), [router]);

  const onAddLeaf = useCallback(
    async (wsSlug: string, title: string): Promise<boolean> => {
      let slug = slugify(title);
      if (!slug) return false;
      // Avoid collision with an existing slug.
      if (tasks.some((t) => t.slug === slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      const res = await createPage({
        folder: 'brain/tasks',
        slug,
        type: 'task',
        frontmatter: { title, kind: 'task', parent: wsSlug, status: 'open', owner: CURRENT_OWNER },
        blocks: [],
      });
      if (res.ok) {
        board.reload();
        if (res.path) router.push(`/${res.path.replace(/\.html$/, '')}`);
        return true;
      }
      return false;
    },
    [tasks, board, router],
  );

  const leafHandlers: LeafRowHandlers = useMemo(
    () => ({
      onSelect: select,
      onStep: (t, dir) => patch(t.path, { status: stepStatus(t.state, dir) }),
      onOpenPanel: openPanel,
      onClosePanel: closePanel,
      onAppendNote: (path, text) => board.addNote(path, text),
      onPatch: patch,
      onMove: (t) => setMoveTask(t),
      onOpen: openTask,
      onRetry: (path) => board.retry(path),
      onReload: () => board.reload(),
    }),
    [select, patch, openPanel, closePanel, board, openTask],
  );

  const onSetStatus = useCallback(
    (t: TaskItem, col: StatusColumn) => {
      if (statusColumnFromStatus(t.state) === col) return;
      patch(t.path, { status: col });
    },
    [patch],
  );

  // ── collapse toggles ─────────────────────────────────────────────────────
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (moveTask) setMoveTask(null);
        else if (panel) closePanel();
        if (typing) (el as HTMLInputElement).blur();
        return;
      }
      if (typing) return;
      if (moveTask) return; // picker owns keys

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-1);
          break;
        case 'v':
          setView({ view: view.view === 'tree' ? 'board' : 'tree' });
          break;
        case '[':
          if (selectedTask) patch(selectedTask.path, { status: stepStatus(selectedTask.state, -1) });
          break;
        case ']':
          if (selectedTask) patch(selectedTask.path, { status: stepStatus(selectedTask.state, 1) });
          break;
        case '1':
        case '2':
        case '3':
        case '4': {
          if (!selectedTask) break;
          const cols: StatusColumn[] = ['open', 'in-progress', 'blocked', 'done'];
          const col = cols[Number(e.key) - 1];
          if (col) patch(selectedTask.path, { status: col });
          break;
        }
        case 'x':
          if (selectedTask) toggleSet(setCollapsedWs, leafToWs.get(selectedTask.path) ?? '__orphan__');
          break;
        case 'X':
          if (selectedTask) toggleSet(setCollapsedOutcomes, leafToOutcomeKey.get(selectedTask.path) ?? '__ungrouped__');
          break;
        case 'Enter':
          if (selectedTask) openTask(selectedTask);
          break;
        case 'O': {
          // cycle outcome filter
          const order = ['all', ...outcomeChips.map((c) => c.slug)];
          const i = order.indexOf(view.outcome);
          setView({ outcome: order[(i + 1) % order.length]! });
          break;
        }
        case 'C': {
          const i = CAL_MODES.indexOf(view.cal);
          setView({ calOpen: true, cal: CAL_MODES[(i + 1) % CAL_MODES.length]! });
          break;
        }
        case 'e':
          if (selectedTask) openTask(selectedTask);
          break;
        case 'c':
          if (selectedTask) openPanel(selectedTask.path, panel === 'log' ? null : 'log');
          break;
        case 'd':
          if (selectedTask) openPanel(selectedTask.path, panel === 'due' ? null : 'due');
          break;
        case 'D':
          if (selectedTask) openPanel(selectedTask.path, panel === 'clear' ? null : 'clear');
          break;
        case 'm':
          if (selectedTask) setMoveTask(selectedTask);
          break;
        case 'u':
          board.undoLast();
          break;
        case 'o':
          if (selectedTask) openTask(selectedTask);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        default:
          break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    moveTask,
    panel,
    selectedTask,
    view,
    outcomeChips,
    leafToWs,
    leafToOutcomeKey,
    moveFocus,
    patch,
    setView,
    openPanel,
    closePanel,
    openTask,
    board,
  ]);

  const clearFilters = useCallback(() => {
    setShowDone(false);
    setView({ ...DEFAULT_VIEW });
  }, [setView]);

  // ── render gating ────────────────────────────────────────────────────────
  const loading = board.isLoading && tasks.length === 0;
  const errored = Boolean(board.loadError) && tasks.length === 0;
  const parsedCount = tasks.filter((t) => (t.kind ?? 'task') === 'task').length;
  const empty = !loading && !errored && orderedVisible.length === 0;
  const overloaded = orderedVisible.length > WINDOW;

  const bandOpen = view.calOpen;

  return (
    <div className="tasks-page">
      {/* page status line (shell topbar carries crumbs) */}
      <div className="tk-status">
        <span className={`tk-live${board.isValidating ? ' on' : ''}`}>
          <i />
          {board.isValidating ? 'live · syncing' : 'live'}
        </span>
        <span className="r-mono tk-fresh">
          {counts.open} open · {counts.overdue} overdue · {board.isValidating ? 'loading…' : 'loaded'}
        </span>
      </div>

      <span className="r-bar tk-pagebar">Tasks</span>

      {errored ? (
        <ErrorState message={board.loadError?.message ?? '500'} onRetry={() => board.reload()} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <>
          <Rollup
            thesis={thesis}
            counts={counts}
            active={view.rf}
            onFilter={(rf: RollupFilter) => setView({ rf: view.rf === rf && rf !== 'all' ? 'all' : rf })}
            recede={bandOpen}
          />

          {/* view tabs + calendar toggle */}
          <div className="tk-views" role="tablist" aria-label="Task view">
            <button
              className="tk-view"
              role="tab"
              aria-selected={view.view === 'tree'}
              onClick={() => setView({ view: 'tree' })}
            >
              Tree<span className="k">v</span>
            </button>
            <button
              className="tk-view"
              role="tab"
              aria-selected={view.view === 'board'}
              onClick={() => setView({ view: 'board' })}
            >
              Board<span className="k">v</span>
            </button>
            <span className="tk-grow" />
            <button
              className="tk-caltoggle"
              aria-expanded={bandOpen}
              onClick={() => setView({ calOpen: !bandOpen })}
            >
              Calendar band {bandOpen ? '▾' : '▸'}
            </button>
          </div>

          {bandOpen ? (
            <CalendarBand
              mode={view.cal}
              onMode={(m) => setView({ cal: m })}
              today={today}
              week={week}
              tasks={tasks}
              ownerFilter={view.owner}
              onOwnerToggle={(owner) => setView({ owner: view.owner === owner ? '' : owner })}
              onReschedule={(path, p) => patch(path, p)}
            />
          ) : null}

          {/* controls */}
          <div className="tk-controls">
            <div className="tk-fgroup" role="group" aria-label="Outcome filter">
              <span className="tk-flabel r-mono">outcome</span>
              <button
                className="tk-chip"
                aria-pressed={view.outcome === 'all'}
                onClick={() => setView({ outcome: 'all' })}
              >
                All<span className="cnt">{outcomeChips.length}</span>
              </button>
              {outcomeChips.map((c) => (
                <button
                  key={c.slug}
                  className="tk-chip"
                  aria-pressed={view.outcome === c.slug}
                  onClick={() => setView({ outcome: view.outcome === c.slug ? 'all' : c.slug })}
                >
                  {c.label}
                  <span className="cnt">{c.count}</span>
                </button>
              ))}
            </div>
            <div className="tk-fgroup">
              <span className="tk-flabel r-mono">show</span>
              <div className="tk-searchrow">
                <span className="lab">/</span>
                <input
                  ref={searchRef}
                  type="text"
                  value={view.q}
                  onChange={(e) => setView({ q: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="filter tasks — title, owner, tag (updates ?q=)"
                  aria-label="Filter tasks"
                />
              </div>
              <button
                className="tk-togglebtn"
                aria-pressed={showDone}
                onClick={() => setShowDone((s) => !s)}
              >
                Show done leaves
              </button>
              {view.owner ? (
                <button className="tk-chip" aria-pressed onClick={() => setView({ owner: '' })}>
                  owner: {view.owner} ✕
                </button>
              ) : null}
            </div>
          </div>

          <div className="tk-countline">
            <span className="n r-mono">
              {orderedVisible.length} active leaves · {outcomeChips.length} outcomes · j/k move · v view · [ ] status ·
              O outcome · ? keys
            </span>
            <span className="n r-mono">sort: priority · due · touched</span>
          </div>

          {overloaded ? <OverloadStrip total={orderedVisible.length} shown={WINDOW} /> : null}

          {empty ? (
            <EmptyState parsed={parsedCount} filtered={0} onClearFilters={clearFilters} />
          ) : view.view === 'tree' ? (
            <TreeView
              nodes={tree}
              visibleLeaf={visibleLeaf}
              renderablePaths={renderablePaths}
              collapsedOutcomes={collapsedOutcomes}
              collapsedWs={collapsedWs}
              onToggleOutcome={(slug) => toggleSet(setCollapsedOutcomes, slug)}
              onToggleWs={(slug) => toggleSet(setCollapsedWs, slug)}
              selectedPath={selectedPath}
              saving={board.saving}
              rowErrors={board.rowErrors}
              flash={board.flash}
              panel={panel}
              panelPath={panelPath}
              leafHandlers={leafHandlers}
              registerEl={registerEl}
              onReparent={(path, parentSlug) => patch(path, { parent: parentSlug })}
              onAddLeaf={onAddLeaf}
            />
          ) : (
            <BoardView
              leaves={renderablePaths ? orderedVisible.slice(0, WINDOW) : orderedVisible}
              selectedPath={selectedPath}
              saving={board.saving}
              rowErrors={board.rowErrors}
              flash={board.flash}
              onSelect={select}
              onSetStatus={onSetStatus}
              onOpen={openTask}
              registerEl={registerEl}
            />
          )}

          <footer className="tk-footsrc r-mono">
            source: brain/tasks/*.html · {parsedCount} task pages · calendar snapshot merged read-only
          </footer>
        </>
      )}

      {moveTask ? (
        <MovePicker
          nodes={tree}
          onPick={(slug) => {
            patch(moveTask.path, { parent: slug });
            setMoveTask(null);
          }}
          onClose={() => setMoveTask(null)}
        />
      ) : null}

    </div>
  );
}
