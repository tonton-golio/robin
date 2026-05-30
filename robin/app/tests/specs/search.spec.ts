import { test, expect } from '@playwright/test';

/**
 * search.spec.ts
 *
 * Page search lives in the command palette (⌘K), not on the home dashboard.
 * These tests open the palette, run a plain (non-slash) query, and confirm it
 * returns page hits under the "Pages" group and that selecting one navigates.
 */

const PALETTE = '.robin-cmdk';

async function openPalette(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(PALETTE)).toBeVisible();
  return page.getByRole('combobox', { name: /command palette/i });
}

test.describe('search', () => {
  test('the command palette searches pages', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('risk');
    await expect(page.locator(`${PALETTE} .robin-cmdk-group`, { hasText: 'Pages' })).toBeVisible();
    await expect(
      page.locator(`${PALETTE} .robin-cmdk-item`).filter({ hasText: /risk register/i }),
    ).toBeVisible();
  });

  test('clicking a search result navigates to that page', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('risk');
    await page
      .locator(`${PALETTE} .robin-cmdk-item`)
      .filter({ hasText: /risk register/i })
      .first()
      .click();
    await expect(page).toHaveURL(/risk-register/);
    await expect(page.getByRole('heading', { name: /risk register/i })).toBeVisible();
  });

  test('searching for a person returns the person page', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('alex');
    await expect(
      page.locator(`${PALETTE} .robin-cmdk-item`).filter({ hasText: /alex rivera/i }),
    ).toBeVisible();
  });

  test('an arbitrary query resolves to results (vector recall, no hang)', async ({ page }) => {
    // RRF search fuses FTS with vector kNN, which always returns nearest
    // neighbours — so even an off-vocabulary query surfaces pages rather than
    // hanging on "Searching…". This guards that the palette always resolves.
    const input = await openPalette(page);
    await input.fill('xyzzy nonsense query');
    await expect(page.locator(`${PALETTE} .robin-cmdk-item`).first()).toBeVisible();
  });
});
