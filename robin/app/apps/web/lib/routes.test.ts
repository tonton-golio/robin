import { describe, expect, it } from 'vitest';
import {
  isCandidatesRoute,
  isDailyRoute,
  isDayWorkspaceRoute,
  isInboxWorkspaceRoute,
  isLibraryWorkspaceRoute,
  isOutputsRoute,
  isPublishWorkspaceRoute,
  isReviewWorkspaceRoute,
  isVaultRoute,
  vaultApiFileHref,
  vaultFileHref,
  vaultPageHref,
} from './routes';
import { normalizeVaultFilePath, normalizeVaultReadPath } from './vault-file';

describe('route helpers', () => {
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

  it('matches the candidates section on exact and nested paths only', () => {
    expect(isCandidatesRoute('/candidates')).toBe(true);
    expect(isCandidatesRoute('/candidates/jordan-lee')).toBe(true);
    expect(isCandidatesRoute('/candidates-archive')).toBe(false);
    expect(isCandidatesRoute('/tasks')).toBe(false);
    expect(isCandidatesRoute('/')).toBe(false);
  });

  it('exposes workspace route predicates while preserving URL aliases', () => {
    expect(isDayWorkspaceRoute('/logs/daily/2026-05-29')).toBe(true);
    expect(isInboxWorkspaceRoute('/file/inbox/meetings/demo.md')).toBe(true);
    expect(isReviewWorkspaceRoute('/comments')).toBe(true);
    expect(isLibraryWorkspaceRoute('/p/brain/projects/robin')).toBe(true);
    expect(isPublishWorkspaceRoute('/p/out/presentations/demo')).toBe(true);

    // Overlaps are intentional and resolved by the precedence contract in
    // workspaces.ts; bookmarked file routes remain compatible.
    expect(isVaultRoute('/inbox/meetings/demo')).toBe(true);
    expect(isLibraryWorkspaceRoute('/inbox/meetings/demo')).toBe(true);
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
