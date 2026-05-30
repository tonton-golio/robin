export interface AnnotationEventLike {
  id?: unknown;
  annotation_id?: unknown;
  event?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  resolved_at?: unknown;
  page_path?: unknown;
  render_path?: unknown;
  kind?: unknown;
  comment_md?: unknown;
  anchor?: unknown;
  pin?: unknown;
  color?: unknown;
  resolution?: unknown;
  resolution_md?: unknown;
  result_link?: unknown;
  logPath?: unknown;
}

export type AnnotationKind = 'comment' | 'highlight';
export type AnnotationColor = 'amber' | 'cyan' | 'violet' | 'rust';
export type LearnCategory = 'preference' | 'correction' | 'task' | 'project' | 'person' | 'other';

export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = 'amber';
const LEARN_CATEGORIES = new Set<LearnCategory>([
  'preference',
  'correction',
  'task',
  'project',
  'person',
  'other',
]);

export interface AnnotationAnchor {
  block_path: number[];
  text_quote: {
    exact: string;
    prefix: string;
    suffix: string;
  };
  text_position: {
    start: number;
    end: number;
  };
}

export interface SlidePin {
  slide: number;
  x: number;
  y: number;
}

/**
 * Canonical annotation schema. This module is the single source of truth for
 * annotation event/record types, statuses and event names — there is no
 * separate `@robin/shared` copy. Keep readers (web app, API routes, the
 * comments page) aligned with the types and helpers defined here.
 */
export interface AnnotationEvent {
  id?: string;
  annotation_id?: string;
  event?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
  author?: string;
  page_path?: string;
  render_path?: string;
  page_hash?: string;
  kind?: AnnotationKind;
  comment_md?: string;
  color?: string;
  anchor?: AnnotationAnchor;
  pin?: SlidePin;
  learn?: {
    candidate?: boolean;
    category?: LearnCategory;
  };
  resolution?: string;
  resolution_md?: string;
  result_link?: string;
  logPath?: string;
}

export type AnnotationRecord = AnnotationEvent & {
  id: string;
  status: string;
  /**
   * True when the rendered page's current content hash no longer matches the
   * `page_hash` captured when the annotation was created — i.e. the page has
   * changed since the comment, so its anchor may be stale. `undefined` when no
   * creation hash is available to compare against.
   */
  pageChanged?: boolean;
};

export const CLOSED_ANNOTATION_STATUSES = new Set([
  'closed',
  'resolved',
  'archived',
  'deleted',
  'rejected',
]);

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function recordOf(event: object): Record<string, unknown> {
  return event as Record<string, unknown>;
}

export function annotationEventId(event: object): string | undefined {
  const record = recordOf(event);
  return stringValue(record['id']) ?? stringValue(record['annotation_id']);
}

export function annotationEventTimestamp(event: object): string {
  const record = recordOf(event);
  return (
    stringValue(record['updated_at']) ??
    stringValue(record['resolved_at']) ??
    stringValue(record['created_at']) ??
    ''
  );
}

export function annotationStatusFromEvent(value: unknown): string {
  const event = stringValue(value)?.toLowerCase();
  if (!event) return 'open';
  if (event.includes('rejected')) return 'rejected';
  if (event.includes('deleted')) return 'deleted';
  if (event.includes('archived')) return 'archived';
  if (event.includes('resolved') || event.includes('closed')) return 'resolved';
  return 'open';
}

export function annotationStatus(event: object): string {
  const record = recordOf(event);
  return (stringValue(record['status']) ?? annotationStatusFromEvent(record['event'])).toLowerCase();
}

export function isClosedAnnotationStatus(status: string): boolean {
  return CLOSED_ANNOTATION_STATUSES.has(status.toLowerCase());
}

export function isOpenAnnotationStatus(status: string): boolean {
  return !isClosedAnnotationStatus(status);
}

export function isAnnotationKind(value: unknown): value is AnnotationKind {
  return value === 'comment' || value === 'highlight';
}

export function normalizeLearnCategory(value: unknown): LearnCategory {
  return typeof value === 'string' && LEARN_CATEGORIES.has(value as LearnCategory)
    ? (value as LearnCategory)
    : 'other';
}

export function normalizeAnnotationPin(value: unknown): SlidePin | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const pin = value as Partial<SlidePin>;
  const { slide, x, y } = pin;
  if (
    typeof slide !== 'number' ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(slide) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return undefined;
  }
  return {
    slide: Math.max(0, Math.floor(slide)),
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

export function normalizeAnnotationAnchor(value: unknown): AnnotationAnchor | null {
  if (!value || typeof value !== 'object') return null;

  const anchor = value as Partial<AnnotationAnchor>;
  const quote = anchor.text_quote;
  const position = anchor.text_position;

  if (
    !quote ||
    typeof quote.exact !== 'string' ||
    typeof quote.prefix !== 'string' ||
    typeof quote.suffix !== 'string' ||
    !position ||
    !Number.isFinite(position.start) ||
    !Number.isFinite(position.end)
  ) {
    return null;
  }

  const start = Math.max(0, Math.floor(position.start));
  const end = Math.max(0, Math.floor(position.end));

  return {
    block_path: Array.isArray(anchor.block_path)
      ? anchor.block_path.filter((part): part is number => Number.isInteger(part))
      : [],
    text_quote: {
      exact: quote.exact.slice(0, 5000),
      prefix: quote.prefix.slice(-240),
      suffix: quote.suffix.slice(0, 240),
    },
    text_position: {
      start: Math.min(start, end),
      end: Math.max(start, end),
    },
  };
}

function displayScore(event: object): number {
  const record = recordOf(event);
  let score = 0;
  if (stringValue(record['comment_md'])) score += 8;
  if (record['anchor']) score += 4;
  if (record['pin']) score += 2;
  if (stringValue(record['kind'])) score += 1;
  return score;
}

function mergeDisplay<T extends object>(current: T, incoming: T): T {
  const currentFirst = displayScore(current) >= displayScore(incoming);
  const primary = currentFirst ? current : incoming;
  const secondary = currentFirst ? incoming : current;
  const primaryRecord = recordOf(primary);
  const secondaryRecord = recordOf(secondary);
  return {
    ...secondary,
    ...primary,
    comment_md: primaryRecord['comment_md'] ?? secondaryRecord['comment_md'],
    anchor: primaryRecord['anchor'] ?? secondaryRecord['anchor'],
    pin: primaryRecord['pin'] ?? secondaryRecord['pin'],
    page_path: primaryRecord['page_path'] ?? secondaryRecord['page_path'],
    render_path: primaryRecord['render_path'] ?? secondaryRecord['render_path'],
    page_hash: primaryRecord['page_hash'] ?? secondaryRecord['page_hash'],
    kind: primaryRecord['kind'] ?? secondaryRecord['kind'],
    color: primaryRecord['color'] ?? secondaryRecord['color'],
    created_at: primaryRecord['created_at'] ?? secondaryRecord['created_at'],
    resolution: primaryRecord['resolution'] ?? secondaryRecord['resolution'],
    resolution_md: primaryRecord['resolution_md'] ?? secondaryRecord['resolution_md'],
    result_link: primaryRecord['result_link'] ?? secondaryRecord['result_link'],
    logPath: primaryRecord['logPath'] ?? secondaryRecord['logPath'],
  } as T;
}

export function collapseAnnotationEvents<T extends object>(
  events: T[],
): Array<T & { status: string }> {
  const byId = new Map<string, { display: T; status: string; updatedAt: string; order: number }>();

  events.forEach((event, order) => {
    const record = recordOf(event);
    const id =
      annotationEventId(event) ??
      `${annotationEventTimestamp(event)}-${stringValue(record['comment_md']) ?? ''}-${order}`;
    const updatedAt = annotationEventTimestamp(event);
    const status = annotationStatus(event);
    const existing = byId.get(id);

    if (!existing) {
      byId.set(id, { display: event, status, updatedAt, order });
      return;
    }

    // A timestamp-less later event must NOT override a timestamped status: the
    // file-order fallback only applies when NEITHER event has a usable timestamp.
    // Otherwise a malformed (no created/updated/resolved_at) event appended after
    // a resolved one would resurrect its 'open' status and wipe the sort key.
    const newest =
      !existing.updatedAt ||
      (updatedAt !== '' && updatedAt >= existing.updatedAt) ||
      (!updatedAt && !existing.updatedAt && order > existing.order);

    byId.set(id, {
      display: mergeDisplay(existing.display, event),
      status: newest ? status : existing.status,
      updatedAt: newest ? updatedAt : existing.updatedAt,
      order: newest ? order : existing.order,
    });
  });

  return Array.from(byId.values())
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || b.order - a.order)
    .map(({ display, status }) => ({ ...display, status }));
}
