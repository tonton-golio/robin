import { test, expect } from '@playwright/test';

/**
 * brain.spec.ts
 *
 * Verifies that individual brain pages render correctly — titles, headings,
 * body content, frontmatter-derived metadata.
 */

test.describe('brain pages', () => {
  test('hub index page loads', async ({ page }) => {
    await page.goto('/p/brain/_index');
    await expect(page.getByRole('heading', { name: /brain index/i })).toBeVisible();
  });

  test('risk-register page renders heading', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    await expect(page.getByRole('heading', { name: /risk register/i })).toBeVisible();
  });

  test('risk-register page has article body', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    const article = page.locator('article[data-robin-doc]');
    await expect(article).toBeVisible();
  });

  test('person page (alex-rivera) loads', async ({ page }) => {
    await page.goto('/p/brain/people/team/alex-rivera');
    await expect(page.getByRole('heading', { name: /alex rivera/i })).toBeVisible();
  });

  test('task page (sample-task) loads', async ({ page }) => {
    await page.goto('/p/brain/tasks/sample-task');
    await expect(page.getByRole('heading', { name: /sample task/i })).toBeVisible();
  });

  test('project page (beacon) loads', async ({ page }) => {
    await page.goto('/p/brain/projects/beacon');
    await expect(page.getByRole('heading', { name: /beacon/i })).toBeVisible();
  });

  test('meeting artifact page loads', async ({ page }) => {
    await page.goto('/p/logs/meetings/2026-05-26-sample');
    await expect(page.getByRole('heading', { name: /sample meeting/i })).toBeVisible();
  });

  test('page title reflects doc title', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    await expect(page).toHaveTitle(/risk register/i);
  });
});
