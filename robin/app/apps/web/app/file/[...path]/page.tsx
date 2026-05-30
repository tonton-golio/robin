import fs from 'fs/promises';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import path from 'path';
import type React from 'react';
import {
  absoluteVaultFilePath,
  contentTypeForPath,
  isTextFile,
  normalizeVaultFilePath,
  statVaultFile,
} from '@/lib/vault-file';
import { vaultApiFileHref, vaultRootLabel } from '@/lib/routes';
import { PageHeader, Button, Card, EmptyState } from '@/components/ui';

interface FilePageProps {
  params: Promise<{ path: string[] }>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(relPath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(path.extname(relPath).toLowerCase());
}

function isPdf(relPath: string): boolean {
  return path.extname(relPath).toLowerCase() === '.pdf';
}

export default async function FilePage({ params }: FilePageProps): Promise<React.ReactElement> {
  const { path: segments } = await params;
  const relPath = normalizeVaultFilePath(segments);
  if (!relPath) notFound();

  let stat: { size: number; mtime: Date; isFile: boolean };
  try {
    stat = await statVaultFile(relPath);
  } catch {
    notFound();
  }

  if (!stat.isFile) notFound();

  const contentUrl = vaultApiFileHref(relPath);
  const ext = path.extname(relPath).toLowerCase();
  const contentType = contentTypeForPath(relPath);
  let textContent: string | null = null;

  if (isTextFile(relPath) && stat.size <= 1024 * 1024) {
    textContent = await fs.readFile(absoluteVaultFilePath(relPath), 'utf-8');
  }

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14">
      <PageHeader
        eyebrow={vaultRootLabel(relPath.split('/')[0] ?? '')}
        title={path.basename(relPath)}
        sub={<span className="font-mono">{relPath}</span>}
        actions={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">{formatBytes(stat.size)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{stat.mtime.toLocaleString()}</span>
            <Button asChild variant="outline" size="sm">
              <Link href={contentUrl}>Open</Link>
            </Button>
          </div>
        }
      />

      {textContent !== null ? (
        <Card className="gap-0 overflow-hidden p-0">
          <pre className="max-h-[calc(100vh-220px)] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-muted-foreground">
            <code>{textContent}</code>
          </pre>
        </Card>
      ) : isImage(relPath) ? (
        <Card className="grid min-h-[420px] place-items-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={contentUrl}
            alt={path.basename(relPath)}
            className="max-h-[calc(100vh-220px)] max-w-full rounded-md"
          />
        </Card>
      ) : isPdf(relPath) ? (
        <Card className="gap-0 overflow-hidden p-0">
          <iframe
            className="block h-[calc(100vh-200px)] w-full border-0"
            src={contentUrl}
            title={path.basename(relPath)}
          />
        </Card>
      ) : (
        <EmptyState title={`No inline preview for ${ext || contentType}.`} hint="Use Open to view the file directly." />
      )}
    </div>
  );
}
