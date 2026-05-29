import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import path from 'path';
import {
  DEFAULT_ANNOTATION_COLOR,
  isAnnotationKind,
  normalizeAnnotationAnchor,
  normalizeAnnotationPin,
  normalizeLearnCategory,
  type AnnotationAnchor,
  type AnnotationEvent,
  type AnnotationKind,
  type LearnCategory,
  type SlidePin,
} from '@/lib/annotations';
import {
  appendAnnotationEvent,
  appendAnnotationStatusEvent,
  hashAnnotationPage,
  listAnnotations,
} from '@/lib/annotation-store';
import { locateVault } from '@/lib/vault';
import { OWNER_NAME } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AnnotationCreateBody {
  page_path: string;
  render_path: string;
  kind: AnnotationKind;
  comment_md: string;
  anchor: AnnotationAnchor;
  pin?: SlidePin;
  learn?: {
    candidate?: boolean;
    category?: LearnCategory;
  };
}

interface AnnotationStatusBody {
  id?: unknown;
  status?: unknown;
  page_path?: unknown;
  render_path?: unknown;
  resolution_md?: unknown;
  resolution?: unknown;
}

const UPDATE_STATUSES = new Set([
  'open',
  'needs-attention',
  'resolved',
  'rejected',
  'archived',
  'deleted',
]);

function jsonResponse(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

function safeVaultRelativePath(rawPath: string, ext: '.html' | '.md'): string | null {
  if (!rawPath.trim() || path.isAbsolute(rawPath) || rawPath.includes('\0')) {
    return null;
  }

  const normalized = path.normalize(rawPath).replace(/^\.\/+/, '');
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    !normalized.endsWith(ext) ||
    !(
      normalized.startsWith(`brain${path.sep}`) ||
      normalized.startsWith(`out${path.sep}`) ||
      normalized.startsWith(`inbox${path.sep}`) ||
      normalized.startsWith(`logs${path.sep}`)
    )
  ) {
    return null;
  }

  return normalized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const queryPath = url.searchParams.get('page_path') ?? '';
  const safePath = safeVaultRelativePath(queryPath, '.html');
  if (!safePath) return jsonResponse({ annotations: [] });

  const result = await listAnnotations({ pagePath: safePath });
  return jsonResponse({ annotations: result });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: AnnotationCreateBody;
  try {
    body = (await request.json()) as AnnotationCreateBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const pagePath = safeVaultRelativePath(String(body.page_path ?? ''), '.html');
  const renderPath = safeVaultRelativePath(String(body.render_path ?? ''), '.html');
  const anchor = normalizeAnnotationAnchor(body.anchor);
  const comment = typeof body.comment_md === 'string' ? body.comment_md.trim() : '';

  if (!pagePath || !renderPath) {
    return jsonResponse({ error: 'invalid_path' }, 400);
  }
  if (!isAnnotationKind(body.kind)) {
    return jsonResponse({ error: 'invalid_kind' }, 400);
  }
  if (!anchor) {
    return jsonResponse({ error: 'invalid_anchor' }, 400);
  }
  if (!comment && !anchor.text_quote.exact) {
    return jsonResponse({ error: 'empty_annotation' }, 400);
  }

  const createdAt = new Date().toISOString();
  const vault = locateVault();
  const id = `ann_${crypto.randomUUID()}`;
  const pin = normalizeAnnotationPin(body.pin);
  const event: AnnotationEvent = {
    id,
    event: 'annotation.created',
    status: 'open',
    created_at: createdAt,
    author: OWNER_NAME || 'user',
    page_path: pagePath,
    render_path: renderPath,
    page_hash: await hashAnnotationPage(vault, renderPath),
    kind: body.kind,
    comment_md: comment,
    color: DEFAULT_ANNOTATION_COLOR,
    pin,
    anchor,
    learn: {
      candidate: body.learn?.candidate ?? true,
      category: normalizeLearnCategory(body.learn?.category),
    },
  };

  const logPath = await appendAnnotationEvent(event, new Date(createdAt));

  return jsonResponse({ ok: true, id, logPath }, 201);
}

function normalizeUpdateStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const status = value.trim().toLowerCase();
  return UPDATE_STATUSES.has(status) ? status : null;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: AnnotationStatusBody;
  try {
    body = (await request.json()) as AnnotationStatusBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const status = normalizeUpdateStatus(body.status);
  const pagePath = typeof body.page_path === 'string'
    ? safeVaultRelativePath(body.page_path, '.html') ?? undefined
    : undefined;
  const renderPath = typeof body.render_path === 'string'
    ? safeVaultRelativePath(body.render_path, '.html') ?? undefined
    : undefined;
  const resolutionValue = typeof body.resolution_md === 'string' ? body.resolution_md : body.resolution;
  const resolutionMd = typeof resolutionValue === 'string' && resolutionValue.trim()
    ? resolutionValue.trim().slice(0, 2000)
    : undefined;

  if (!id.startsWith('ann_')) {
    return jsonResponse({ error: 'invalid_id' }, 400);
  }
  if (!status) {
    return jsonResponse({ error: 'invalid_status' }, 400);
  }

  const logPath = await appendAnnotationStatusEvent({
    id,
    status,
    pagePath,
    renderPath,
    resolutionMd,
  });

  return jsonResponse({ ok: true, id, status, logPath });
}
