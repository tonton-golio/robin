import { test, expect } from '@playwright/test';

/**
 * smoke.spec.ts
 *
 * Basic sanity checks: home page renders and the file-tree navigation is visible.
 */

test.describe('smoke', () => {
  test('home page loads and has robin in title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/robin/i);
  });

  test('file tree navigation is visible', async ({ page }) => {
    await page.goto('/');
    // The left-nav file tree should render as a <nav> element
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('brain section is present in tree', async ({ page }) => {
    await page.goto('/');
    // Directory nodes render as "▾ brain/" buttons — match by accessible name
    // using a regex anchored to the exact dir name to avoid substring conflicts.
    await expect(
      page.getByRole('button', { name: /brain\// })
    ).toBeVisible({ timeout: 10000 });
  });

  test('out section is present in tree', async ({ page }) => {
    await page.goto('/');
    // Use accessible name regex anchored at word boundary to avoid matching
    // a folder like "about_alex/" which also contains "out" as a substring.
    await expect(
      page.getByRole('button', { name: /\bout\// })
    ).toBeVisible({ timeout: 10000 });
  });
});
