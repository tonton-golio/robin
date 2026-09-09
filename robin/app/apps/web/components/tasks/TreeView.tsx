'use client';

import { useState } from 'react';
import type { OutcomeNode, WorkstreamNode } from '@/lib/task-hierarchy';
import type { TaskItem } from '@/lib/tasks';
import { LeafRow, type LeafRowHandlers, type RowPanel } from './LeafRow';
import type { RowError } from './useTaskBoard';

export interface TreeViewProps {
  nodes: OutcomeNode[];
  visibleLeaf: (t: TaskItem) => boolean;
  renderablePaths: Set<string> | null; // window cap; null = render all visible
  collapsedOutcomes: Set<string>;
  collapsedWs: Set<string>;
  onToggleOutcome: (slug: string) => void;
  onToggleWs: (slug: string) => void;
  selectedPath: string | null;
  saving: Set<string>;
  rowErrors: Record<string, RowError>;
  flash: Set<string>;
  panel: RowPanel;
  panelPath: string | null;
  leafHandlers: LeafRowHandlers;
  registerEl: (path: string, el: HTMLDivElement | null) => void;
  onReparent: (path: string, parentSlug: string) => void;
  onAddLeaf: (wsSlug: string, title: string) => Promise<boolean>;
}

function outcomeKey(node: OutcomeNode): string {
  return node.outcome?.slug ?? '__ungrouped__';
}
function wsKey(ws: WorkstreamNode): string {
  return ws.workstream?.slug ?? '__orphan__';
}

export function TreeView(props: TreeViewProps) {
  const { nodes } = props;
  return (
    <div id="viewTree" role="list" aria-label="Task tree">
      {nodes.map((node) => (
        <OutcomeGroup key={outcomeKey(node)} node={node} props={props} />
      ))}
    </div>
  );
}

function OutcomeGroup({ node, props }: { node: OutcomeNode; props: TreeViewProps }) {
  const key = outcomeKey(node);
  const collapsed = props.collapsedOutcomes.has(key);
  const [dropArmed, setDropArmed] = useState(false);
  const title = node.outcome?.title ?? 'Ungrouped';
  const due = node.outcome?.due ? ` · due ${node.outcome.due.slice(0, 10)}` : '';

  // Skip outcomes with no visible leaves under the current filter.
  const anyVisible = node.workstreams.some((ws) => ws.leaves.some(props.visibleLeaf));
  if (!anyVisible) return null;

  return (
    <div className="tk-outcome">
      <button
        className={`tk-obar${dropArmed ? ' drop' : ''}`}
        aria-expanded={!collapsed}
        onClick={() => props.onToggleOutcome(key)}
        onDragOver={(e) => {
          if (node.outcome) {
            e.preventDefault();
            setDropArmed(true);
          }
        }}
        onDragLeave={() => setDropArmed(false)}
        onDrop={(e) => {
          setDropArmed(false);
          const path = e.dataTransfer.getData('text/task-path');
          if (path && node.outcome) props.onReparent(path, node.outcome.slug);
        }}
      >
        <span className="r-bar">{title}</span>
        <span className="tk-om r-mono">
          {node.active} active · {node.done} done{due}
        </span>
        <span className="tk-chev">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed ? (
        <div className="tk-obody">
          {node.workstreams.map((ws) => (
            <WorkstreamGroup key={wsKey(ws)} ws={ws} props={props} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkstreamGroup({ ws, props }: { ws: WorkstreamNode; props: TreeViewProps }) {
  const key = wsKey(ws);
  const collapsed = props.collapsedWs.has(key);
  const [dropArmed, setDropArmed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const name = ws.workstream?.title ?? 'Ungrouped leaves';
  const canParent = Boolean(ws.workstream);

  const leaves = ws.leaves.filter(props.visibleLeaf);
  if (leaves.length === 0 && !ws.workstream) return null;

  async function submitAdd() {
    const t = title.trim();
    if (!t || busy || !ws.workstream) return;
    setBusy(true);
    const ok = await props.onAddLeaf(ws.workstream.slug, t);
    setBusy(false);
    if (ok) {
      setTitle('');
      setAdding(false);
    }
  }

  return (
    <div className="tk-ws">
      <div
        className={`tk-wshead${dropArmed ? ' drop' : ''}`}
        tabIndex={0}
        role="button"
        aria-expanded={!collapsed}
        onClick={() => props.onToggleWs(key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onToggleWs(key);
          }
        }}
        onDragOver={(e) => {
          if (canParent) {
            e.preventDefault();
            setDropArmed(true);
          }
        }}
        onDragLeave={() => setDropArmed(false)}
        onDrop={(e) => {
          setDropArmed(false);
          const path = e.dataTransfer.getData('text/task-path');
          if (path && ws.workstream) props.onReparent(path, ws.workstream.slug);
        }}
      >
        <span className="tk-wt">{name}</span>
        <span className="tk-wm r-mono">
          {ws.active} active · {ws.done} done
        </span>
        <span className="tk-chev">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed ? (
        <div className="tk-wsbody">
          {leaves.map((leaf) => {
            if (props.renderablePaths && !props.renderablePaths.has(leaf.path)) return null;
            return (
              <LeafRowDraggable key={leaf.path} leaf={leaf} props={props} />
            );
          })}
          {canParent ? (
            adding ? (
              <div className="tk-addleaf">
                <div className="tk-arow">
                  <input
                    autoFocus
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitAdd();
                      if (e.key === 'Escape') setAdding(false);
                    }}
                    placeholder="new task title…"
                    aria-label="New task title"
                  />
                  <button className="r-btn r-btn--primary tk-btn-sm" disabled={busy} onClick={submitAdd}>
                    Create task
                  </button>
                  <button className="r-btn tk-btn-sm" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
                <div className="tk-contract r-mono">
                  emits create-task contract → robin:type=task · robin:kind=task · robin:parent=
                  {ws.workstream!.slug} · robin:status=open · robin:owner=(you) · robin:created=now
                </div>
              </div>
            ) : (
              <button className="tk-addleaf-trigger" onClick={() => setAdding(true)}>
                + add leaf under {name} <span className="r-mono tk-key">N</span>
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LeafRowDraggable({ leaf, props }: { leaf: TaskItem; props: TreeViewProps }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/task-path', leaf.path)}
      className="tk-leaf-drag"
    >
      <LeafRow
        task={leaf}
        selected={props.selectedPath === leaf.path}
        saving={props.saving.has(leaf.path)}
        error={props.rowErrors[leaf.path]}
        flash={props.flash.has(leaf.path)}
        panel={props.selectedPath === leaf.path && props.panelPath === leaf.path ? props.panel : null}
        h={props.leafHandlers}
        registerEl={props.registerEl}
      />
    </div>
  );
}
