import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
  absoluteVaultFilePath,
  contentTypeForPath,
  normalizeVaultFilePath,
  statVaultFile,
} from '@/lib/vault-file';

interface FileApiProps {
  params: Promise<{ path: string[] }>;
}

export async function GET(_request: NextRequest, { params }: FileApiProps): Promise<NextResponse> {
  const { path } = await params;
  const relPath = normalizeVaultFilePath(path);
  if (!relPath) {
    return NextResponse.json({ error: 'unsafe_path' }, { status: 400 });
  }

  try {
    const stat = await statVaultFile(relPath);
    if (!stat.isFile) {
      return NextResponse.json({ error: 'not_file' }, { status: 404 });
    }

    const body = await fs.readFile(absoluteVaultFilePath(relPath));
    return new NextResponse(body, {
      headers: {
        'content-type': contentTypeForPath(relPath),
        'content-length': String(stat.size),
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
