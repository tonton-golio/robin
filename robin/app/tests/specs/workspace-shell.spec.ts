import { test, expect } from '../fixtures/robin-test';

const PRIMARY_LABELS = ['Day', 'Inbox', 'Review', 'Library', 'Publish'];

test.describe('Living Workspace shell', () => {
  test('desktop exposes five primary workspaces and one persistent file tree', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto('/');

    const sidebar = page.locator('.workspace-sidebar');
    await expect(sidebar).toBeVisible();
    for (const label of PRIMARY_LABELS) {
      await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(page.locator('.r-vault-tree:visible')).toHaveCount(1);
    await expect(page.locator('.workspace-file-tab')).toBeVisible();
    await expect(page.locator('.workspace-file-state')).toContainText(/read only|live|saved/i);
  });

  test('Review is a top-level workspace', async ({ page }) => {
    await page.goto('/');
    await page.locator('.workspace-sidebar').getByRole('link', { name: 'Review', exact: true }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole('heading', { level: 1, name: /review/i })).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar').getByRole('link', { name: 'Review', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('Capture is modal and returns focus to its trigger', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.workspace-topbar').getByRole('button', { name: 'Capture' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Meeting/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Interview/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Capture' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('desktop More drawer keeps secondary destinations out of primary navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open more tools' }).click();
    const drawer = page.getByRole('dialog', { name: 'More' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'System health', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(drawer.locator('.r-vault-tree')).toHaveCount(0);
  });

  test('retired shell chrome is absent and shortcut help follows the current view', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.locator('.robin-shell, .robin-rail, .robin-topbar, .tk-kbdbar')).toHaveCount(0);
    await page.keyboard.press('?');

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.robin-shortcut-group-label').getByText('Tasks', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('mobile uses five bottom actions, with Publish and files in the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('.workspace-sidebar')).toHaveCount(0);
    const mobile = page.locator('.workspace-mobile-nav');
    await expect(mobile).toBeVisible();
    await expect(mobile.locator(':scope > *')).toHaveText([
      /Day/,
      /Inbox/,
      /Capture/,
      /Library/,
      /Review/,
    ]);
    await expect(mobile.getByText('Publish', { exact: true })).toHaveCount(0);

    const filesTrigger = page.getByRole('button', { name: 'Open files and more' });
    await filesTrigger.click();
    const drawer = page.getByRole('dialog', { name: 'Files and more' });
    await expect(drawer.getByRole('link', { name: 'Publish', exact: true })).toBeVisible();
    await expect(drawer.locator('.r-vault-tree')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(filesTrigger).toBeFocused();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('canonical Library and Publish routes preserve their legacy aliases', async ({ page }) => {
    for (const route of ['/library', '/vault', '/publish', '/outputs']) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});
