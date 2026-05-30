import { test, expect } from '@playwright/test';

/**
 * smoke.spec.ts
 *
 * Basic sanity checks: the home dashboard renders with the primary nav rail, and
 * the file tree on /vault shows the top-level vault sections.
 */

test.describe('smoke', () => {
  test('home page loads and has robin in title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/robin/i);
  });

  test('primary navigation rail is visible', async ({ page }) => {
    await page.goto('/');
    // The left rail is the app's primary navigation landmark.
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
  });

  test('file tree is visible on the vault page', async ({ page }) => {
    await page.goto('/vault');
    await expect(page.locator('.vault-tree')).toBeVisible();
  });

  test('brain section is present in the vault tree', async ({ page }) => {
    await page.goto('/vault');
    // Directory rows render as role="button" with the folder name.
    await expect(page.getByRole('button', { name: /^brain$/i })).toBeVisible({ timeout: 10000 });
  });

  test('out section is present in the vault tree', async ({ page }) => {
    await page.goto('/vault');
    await expect(page.getByRole('button', { name: /^out$/i })).toBeVisible({ timeout: 10000 });
  });
});
