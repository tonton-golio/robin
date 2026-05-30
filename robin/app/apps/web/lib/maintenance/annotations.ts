import { annotationLogDir, listAnnotations } from '@/lib/annotation-store';
import { pageHref } from '@/lib/catalog';
import type { MaintenanceItem } from './types';
import { readJsonlDir, timestampValue } from './shared';

export interface AnnotationSection {
  title: string;
  source: string;
  totalEvents: number;
  malformedEvents: number;
  openCount: number;
  items: OpenAnnotation[];
}

export interface OpenAnnotation {
  id: string;
  status: string;
  kind?: string;
  pagePath?: string;
  renderPath?: string;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
  logPath: string;
}

export async function getAnnotationSection(limit: number): Promise<AnnotationSection> {
  const relDir = annotationLogDir();
  const [result, annotations] = await Promise.all([
    readJsonlDir(relDir),
    listAnnotations(),
  ]);
  const open = annotations
    .map((item): OpenAnnotation => ({
      id: item.id,
      status: item.status,
      kind: item.kind,
      pagePath: item.page_path,
      renderPath: item.render_path,
      comment: item.comment_md,
      createdAt: timestampValue(item.created_at),
      updatedAt: item.updated_at ?? item.resolved_at ?? item.created_at,
      logPath: item.logPath ?? relDir,
    }))
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''));

  return {
    title: 'Open annotations',
    source: relDir,
    totalEvents: result.totalLines,
    malformedEvents: result.malformed,
    openCount: open.length,
    items: open.slice(0, limit),
  };
}

export function annotationItem(item: OpenAnnotation): MaintenanceItem {
  return {
    id: `annotation:${item.id}`,
    title: item.comment ? item.comment.slice(0, 120) : item.pagePath ?? item.id,
    detail: item.kind ? `${item.kind} annotation is ${item.status}.` : `Annotation is ${item.status}.`,
    path: item.pagePath ?? item.renderPath ?? item.logPath,
    href: item.renderPath ? pageHref(item.renderPath) : undefined,
    meta: [item.createdAt, item.logPath].filter((value): value is string => Boolean(value)),
    severity: 'warning',
  };
}
