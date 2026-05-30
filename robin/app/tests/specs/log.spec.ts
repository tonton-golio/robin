import { test, expect } from '@playwright/test';

/**
 * log.spec.ts
 *
 * Tests that logs/changelog.md and logs/ingest-log.md are rendered as markdown in
 * the dedicated Logs tab. These files stay as .md and are rendered via
 * marked() at view-time, not indexed as HTML pages.
 */

test.describe('log files', () => {
  test('changelog renders as markdown', async ({ page }) => {
    await page.goto('/p/_logs/changelog');
    // LogView renders a static h1 + the markdown also has # Changelog; use first()
    await expect(page.getByRole('heading', { name: /changelog/i }).first()).toBeVisible();
  });

  test('changelog shows dated entries', async ({ page }) => {
    await page.goto('/p/_logs/changelog');
    // Fixture logs/changelog.md contains a 2026-05-26 entry
    await expect(page.getByText(/2026-05/).first()).toBeVisible();
  });

  test('ingest log renders as markdown', async ({ page }) => {
    await page.goto('/p/_logs/ingest');
    // The static LogView title is "Ingest Log"; the markdown heading may vary
    await expect(page.getByRole('heading', { name: /ingest/i }).first()).toBeVisible();
  });

  test('ingest log shows dated entries', async ({ page }) => {
    await page.goto('/p/_logs/ingest');
    await expect(page.getByText(/2026-05/).first()).toBeVisible();
  });

  test('changelog is not an HTML page in the file tree', async ({ page }) => {
    // changelog.md should NOT appear as a /p/out route (only via _logs/)
    const response = await page.goto('/p/out/_changelog');
    // Should return 404 since it's not an indexed HTML page
    expect(response?.status()).toBe(404);
  });
});
