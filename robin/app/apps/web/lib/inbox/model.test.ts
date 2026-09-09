import { describe, expect, it } from 'vitest';
import type { CaptureData, CaptureSession } from '@/app/capture/types';
import { buildInboxData, extractFiledSourcePaths } from './model';

function session(
  sourcePath: string,
  status: CaptureSession['status'],
  kind: CaptureSession['kind'] = 'meeting',
): CaptureSession {
  return {
    id: sourcePath,
    kind,
    status,
    title: sourcePath,
    sourcePath,
    ...(status === 'ingested' ? { pagePath: sourcePath } : {}),
    href: `/fixture/${sourcePath}`,
    writer: {
      who: status === 'ingested' ? 'robin' : 'human',
      label: status === 'ingested' ? 'robin · ingest-meeting' : 'meeting-widget',
    },
    when: '2026-07-27T10:00:00.000Z',
    whenLabel: '10:00',
    attendees: [],
    ...(status === 'raw' && kind === 'meeting' ? { ingestPath: sourcePath } : {}),
    glyph: status === 'ingested' ? '◍' : '◑',
  };
}

function captureData(sessions: CaptureSession[]): CaptureData {
  return {
    sessions,
    recovery: [
      {
        id: 'inbox/meetings/audio/safe.partial.txt',
        kind: 'checkpoint',
        title: 'Safe checkpoint',
        sourcePath: 'inbox/meetings/audio/safe.partial.txt',
        detail: 'checkpoint',
        warn: true,
        glyph: '◑',
        when: '2026-07-27T09:00:00.000Z',
        href: '/fixture/recovery',
      },
    ],
    stats: {
      unfinished: 1,
      inboxRaw: sessions.filter((item) => item.status === 'raw').length,
      lastIngestLabel: '12m ago',
      degraded: false,
    },
  };
}

describe('extractFiledSourcePaths', () => {
  it('reads only explicit source receipt lines and deduplicates them', () => {
    const log = [
      '# Ingest Log',
      '- **source**: `inbox/meetings/alpha.md`',
      '- **output**: `logs/meetings/alpha.html`',
      'Mentioned inbox/meetings/not-a-receipt.md in prose.',
      '  - **source**: `inbox/interviews/beta.md`',
      '- **source**: `inbox/meetings/alpha.md`',
    ].join('\n');

    expect([...extractFiledSourcePaths(log)]).toEqual([
      'inbox/meetings/alpha.md',
      'inbox/interviews/beta.md',
    ]);
  });
});

describe('buildInboxData', () => {
  it('keeps only unfiled raw sources in the primary queue', () => {
    const filedRaw = session('inbox/meetings/filed.md', 'raw');
    const pendingInterview = session('inbox/interviews/pending.md', 'raw', 'interview');
    const durablePage = session('logs/meetings/filed.html', 'ingested');

    const result = buildInboxData(
      captureData([filedRaw, pendingInterview, durablePage]),
      new Set([filedRaw.sourcePath]),
    );

    expect(result.pending.map((item) => item.sourcePath)).toEqual([
      'inbox/interviews/pending.md',
    ]);
    expect(result.history).toEqual([durablePage]);
    expect(result.recovery).toHaveLength(1);
    expect(result.stats).toMatchObject({
      pending: 1,
      recovery: 1,
      history: 1,
      alreadyFiledSources: 1,
      lastIngestLabel: '12m ago',
    });
  });

  it('fails open when no receipt set is available', () => {
    const raw = session('inbox/meetings/visible.md', 'raw');
    expect(buildInboxData(captureData([raw])).pending).toEqual([raw]);
  });
});
