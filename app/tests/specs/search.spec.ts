import { test, expect } from '@playwright/test';

/**
 * search.spec.ts
 *
 * Tests the search box: query returns results, clicking a result navigates
 * to the correct page.
 */

test.describe('search', () => {
  test('search box is visible on home page', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByRole('searchbox');
    await expect(searchBox).toBeVisible();
  });

  test('searching "risk" returns risk-register result', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByRole('searchbox');
    await searchBox.fill('risk');
    // Results panel should appear with a link to risk-register
    await expect(page.locator('[data-search-results]')).toBeVisible();
    // Summary of sample meeting also contains "risk register"; use first()
    await expect(page.locator('[data-search-results]').getByText(/risk register/i).first()).toBeVisible();
  });

  test('clicking a search result navigates to that page', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByRole('searchbox');
    await searchBox.fill('risk');
    await page.locator('[data-search-results]').getByText(/risk register/i).first().click();
    await expect(page).toHaveURL(/risk-register/);
    await expect(page.getByRole('heading', { name: /risk register/i })).toBeVisible();
  });

  test('searching "alex" returns person page result', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByRole('searchbox');
    await searchBox.fill('alex');
    await expect(page.locator('[data-search-results]')).toBeVisible();
    // Each result has title + summary both matching /alex/; use first()
    await expect(page.locator('[data-search-results]').getByText(/alex/i).first()).toBeVisible();
  });

  test('searching with no matches shows empty state', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByRole('searchbox');
    await searchBox.fill('xyzzy-does-not-exist-anywhere');
    // Either an empty-results element or no results list at all
    const results = page.locator('[data-search-results]');
    const count = await results.locator('a').count();
    expect(count).toBe(0);
  });
});
