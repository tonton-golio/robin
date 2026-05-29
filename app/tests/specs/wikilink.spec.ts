import { test, expect } from '@playwright/test';

/**
 * wikilink.spec.ts
 *
 * Tests wikilink resolution:
 *  - A link to an existing slug navigates correctly.
 *  - A broken wikilink is rendered with data-broken attribute.
 *  - A callout is rendered as <aside data-callout>.
 */

test.describe('wikilinks', () => {
  test('wikilink to existing page (alex-rivera) navigates', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    // risk-register.html has <a data-wiki="alex-rivera" href="/p/brain/people/team/alex-rivera">
    const link = page.locator('a[data-wiki="alex-rivera"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/alex-rivera/);
    await expect(page.getByRole('heading', { name: /alex rivera/i })).toBeVisible();
  });

  test('broken wikilink is rendered with data-broken attribute', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    // risk-register.html has <a data-wiki="nonexistent-slug" data-broken="missing">
    const brokenLink = page.locator('a[data-wiki="nonexistent-slug"][data-broken]');
    await expect(brokenLink).toBeVisible();
  });

  test('broken wikilink has data-broken="missing" value', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    const brokenLink = page.locator('a[data-wiki="nonexistent-slug"]');
    await expect(brokenLink).toHaveAttribute('data-broken', 'missing');
  });

  test('callout is rendered as aside with data-callout', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    const callout = page.locator('aside[data-callout="warning"]');
    await expect(callout).toBeVisible();
  });

  test('resolved wikilink href points to correct path', async ({ page }) => {
    await page.goto('/p/brain/risk-register');
    const link = page.locator('a[data-wiki="alex-rivera"]').first();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/p\/.*alex-rivera/);
  });
});
