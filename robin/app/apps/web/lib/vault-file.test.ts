import { describe, expect, it } from 'vitest';
import {
  normalizeVaultFilePath,
  normalizeVaultReadPath,
  normalizeVaultServePath,
} from './vault-file';

// `brain/` is HTML-only, so durable binary media (Marck's brand masters) lives
// under `assets/`, and brain pages <img> it through /api/file. That root is
// reachable from the serve/read paths and deliberately NOT from the write path.
describe('the assets/ media root', () => {
  it('is served, so the brand previews a brain page references resolve', () => {
    expect(normalizeVaultServePath('assets/brand/previews/logos-svg.jpg')).toBe(
      'assets/brand/previews/logos-svg.jpg',
    );
    expect(normalizeVaultServePath(['assets', 'brand', 'posters', 'Posters A1.pdf'])).toBe(
      'assets/brand/posters/Posters A1.pdf',
    );
  });

  it('is readable, so internal reads of the masters work too', () => {
    expect(normalizeVaultReadPath('assets/brand/logos/svg/mark.svg')).toBe(
      'assets/brand/logos/svg/mark.svg',
    );
  });

  it('is NOT writable — assets/ must never receive an authored page', () => {
    // normalizeVaultFilePath backs page save/create/move. Widening it would let
    // HTML pages be authored outside brain/, which the format contract forbids.
    expect(normalizeVaultFilePath('assets/brand/sneaky-page.html')).toBeNull();
    expect(normalizeVaultFilePath('assets/brand/previews/logos-svg.jpg')).toBeNull();
  });

  it('keeps every other guard, including the sensitive deny-list', () => {
    expect(normalizeVaultServePath('assets/brand/../../etc/passwd')).toBeNull();
    expect(normalizeVaultServePath('/assets/brand/x.png')).toBeNull();
    expect(normalizeVaultServePath('assets/x\0.png')).toBeNull();
    // Raw voice captures under assets/ are refused the same as inbox recordings.
    expect(normalizeVaultServePath('assets/voice/raw/clip.mp3')).toBeNull();
    expect(normalizeVaultServePath('secrets/x.png')).toBeNull();
  });

  it('leaves the ordinary roots working through the serve path', () => {
    expect(normalizeVaultServePath('brain/standards/brand-identity.html')).toBe(
      'brain/standards/brand-identity.html',
    );
    expect(normalizeVaultServePath('inbox/contracts/x.html')).toBeNull();
  });
});
