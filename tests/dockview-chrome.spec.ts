import { test, expect } from '@playwright/test';
import { MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';
import { openFixtureByUrl } from './helpers/rosview';

async function openFirstTabChromeMenuIfNeeded(page: import('@playwright/test').Page): Promise<void> {
  const directAdd = page.getByTestId('panel-tab-add-button').first();
  if (await directAdd.isVisible().catch(() => false)) {
    return;
  }
  const moreButton = page.getByTestId('panel-tab-more-button').first();
  await expect(moreButton).toBeVisible({ timeout: 30_000 });
  await moreButton.click();
}

test.describe('Dockview chrome', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('shows dockview, group add split, and tab close control', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await openFirstTabChromeMenuIfNeeded(page);
    await expect(page.getByTestId('panel-tab-add-button').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('panel-tab-close-button').first()).toBeVisible();
  });

  test('primary add creates a new tab in the group', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await openFirstTabChromeMenuIfNeeded(page);
    await expect(page.getByTestId('panel-tab-add-button').first()).toBeVisible({ timeout: 30_000 });

    const tabsBefore = await page.locator('.dv-tab').count();
    await page.getByTestId('panel-tab-add-button').first().click();
    const rawPanelType = page.getByRole('menuitem', { name: 'Raw', exact: true });
    await expect(rawPanelType).toBeVisible();
    await rawPanelType.hover();
    await page.getByRole('menuitem', { name: 'Add to tab group', exact: true }).press('Enter');
    await expect(async () => {
      const n = await page.locator('.dv-tab').count();
      expect(n).toBeGreaterThan(tabsBefore);
    }).toPass({ timeout: 15_000, intervals: [200, 500, 1000] });
  });

  test('tab context menu offers Close', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    const firstTab = page.locator('.dv-tab').first();
    await firstTab.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Close', exact: true })).toBeVisible();
    await page.mouse.click(0, 0);
  });

  test('tab labels show panel type (not topic basename)', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await expect(page.locator('.dv-tab').filter({ hasText: /^Image$/ }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('dockview theme class follows dark mode', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL, { query: { theme: 'dark' } });
    const dock = page.getByTestId('rosview-dockview');
    await expect(dock).toHaveAttribute('data-dockview-chrome-theme', 'dark');
    await expect(page.locator('.ros-dockview-theme-dark').first()).toBeVisible();
  });
});
