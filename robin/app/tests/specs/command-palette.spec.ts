import { test, expect } from '@playwright/test';

/**
 * command-palette.spec.ts
 *
 * Tests the Cmd+K command palette, focusing on the slash ("/") command mode:
 * typing a leading "/" switches the palette from page-search into a filtered
 * action/command list, shows the COMMAND badge, filters as you type, and runs
 * the selected command (navigation).
 */

const PALETTE = '.robin-cmdk';

async function openPalette(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(PALETTE)).toBeVisible();
  return page.getByPlaceholder(/Search pages|Run a command/);
}

test.describe('command palette', () => {
  test('opens with Cmd+K and shows quick actions + slash tip', async ({ page }) => {
    await openPalette(page);
    await expect(page.locator(`${PALETTE} .robin-cmdk-group`, { hasText: 'Quick actions' })).toBeVisible();
    await expect(page.locator(`${PALETTE} .robin-cmdk-tip`)).toContainText('Type');
  });

  test('typing "/" enters command mode with the COMMAND badge', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('/');
    // Command mode is conveyed by the COMMAND badge + the "Commands" group.
    await expect(page.locator('.robin-cmdk-mode-badge')).toHaveText(/command/i);
    // The full command list should render under a "Commands" heading.
    await expect(page.locator(`${PALETTE} .robin-cmdk-group`, { hasText: 'Commands' })).toBeVisible();
    await expect(page.locator(`${PALETTE} .robin-cmdk-item`).filter({ hasText: 'New page' })).toBeVisible();
  });

  test('command term filters the list', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('/graph');
    const items = page.locator(`${PALETTE} .robin-cmdk-item`);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Open Graph');
  });

  test('filtering matches on keywords, not just the label', async ({ page }) => {
    const input = await openPalette(page);
    // "reindex" is a keyword for the Resync command, not in its label.
    await input.fill('/reindex');
    await expect(page.locator(`${PALETTE} .robin-cmdk-item`).filter({ hasText: 'Resync vault' })).toBeVisible();
  });

  test('a non-matching command shows the empty state', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('/zzzznope');
    await expect(page.locator(`${PALETTE} .robin-cmdk-empty`)).toContainText('No command matches');
  });

  test('running a command navigates (Enter on /graph)', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('/graph');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/graph$/);
    await expect(page.locator(PALETTE)).toHaveCount(0);
  });

  test('without a slash, the palette stays in search mode (no command badge)', async ({ page }) => {
    const input = await openPalette(page);
    await input.fill('risk');
    // Search mode shows page results, never the command badge.
    await expect(page.locator('.robin-cmdk-mode-badge')).toHaveCount(0);
    // No "Commands" group should appear in plain search mode.
    await expect(page.locator(`${PALETTE} .robin-cmdk-group`, { hasText: 'Commands' })).toHaveCount(0);
  });
});
