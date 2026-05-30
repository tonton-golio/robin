import { describe, expect, it } from 'vitest';
import {
  appBreadcrumbs,
  isDailyRoute,
  isOutputsRoute,
  isVaultRoute,
  vaultApiFileHref,
  vaultFileHref,
  vaultPageHref,
} from './routes';
import { normalizeVaultFilePath, normalizeVaultReadPath } from './vault-file';

describe('route helpers', () => {
  it('maps output storage paths to the outputs overview in breadcrumbs', () => {
    expect(appBreadcrumbs('/out/reports/weekly-plan')).toEqual([
      { label: 'outputs', href: '/outputs' },
      { label: 'reports' },
      { label: 'weekly plan' },
    ]);
  });

  it('maps daily log storage paths without duplicating logs/daily', () => {
    expect(appBreadcrumbs('/logs/daily/2026-05-29')).toEqual([
      { label: 'daily', href: '/daily' },
      { label: '2026 05 29' },
    ]);
  });

  it('maps file viewer paths back to their section overview', () => {
    expect(appBreadcrumbs('/file/out/presentations/demo.pdf')).toEqual([
      { label: 'outputs', href: '/outputs' },
      { label: 'presentations' },
      { label: 'demo.pdf' },
    ]);
  });

  it('encodes page, file, and API file routes consistently', () => {
    expect(vaultPageHref('out/monthly plan.html')).toBe('/out/monthly%20plan');
    expect(vaultFileHref('out/monthly plan.pdf')).toBe('/file/out/monthly%20plan.pdf');
    expect(vaultApiFileHref('out/monthly plan.pdf')).toBe('/api/file/out/monthly%20plan.pdf');
  });

  it('matches app sections for storage-backed routes', () => {
    expect(isOutputsRoute('/out/presentations/demo')).toBe(true);
    expect(isDailyRoute('/logs/daily/2026-05-29')).toBe(true);
    expect(isVaultRoute('/brain/projects/robin')).toBe(true);
    expect(isVaultRoute('/out/presentations/demo')).toBe(false);
  });
});

describe('vault path validators', () => {
  it('serve validator (normalizeVaultFilePath) rejects raw audio recordings', () => {
    // The serve deny-list keeps /api/file from handing raw recordings to clients.
    expect(normalizeVaultFilePath('inbox/meetings/audio/2026-05-30.webm')).toBeNull();
    expect(normalizeVaultFilePath('inbox/contracts/x.html')).toBeNull();
  });

  it('read validator (normalizeVaultReadPath) ALLOWS audio so transcribe can read its own upload', () => {
    // Regression for the transcribe-rejects-audio bug: the read path must permit
    // .webm/.mp3/.wav under an allowed root (it reads, never serves).
    expect(normalizeVaultReadPath('inbox/meetings/audio/2026-05-30.webm')).toBe(
      'inbox/meetings/audio/2026-05-30.webm',
    );
    expect(normalizeVaultReadPath('inbox/meetings/audio/clip.mp3')).toBe(
      'inbox/meetings/audio/clip.mp3',
    );
  });

  it('read validator still rejects traversal, NUL, absolute, and off-allowlist paths', () => {
    expect(normalizeVaultReadPath('../etc/passwd')).toBeNull();
    expect(normalizeVaultReadPath('/etc/passwd')).toBeNull();
    expect(normalizeVaultReadPath('inbox/x\0.webm')).toBeNull();
    expect(normalizeVaultReadPath('secrets/x.webm')).toBeNull();
  });
});

