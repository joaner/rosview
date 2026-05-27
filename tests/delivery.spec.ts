import { test, expect } from '@playwright/test';
import { MCAP_BASIC, MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';

test.beforeAll(() => {
  requireExamplesDir();
});

test('zh UI from ?lang= query', async ({ page }) => {
  await page.goto('/?lang=zh');
  await expect(page.locator('#rosview-root')).toHaveAttribute('data-language', 'zh');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ROS View');
});

test('zh UI from ?lang=zh-CN query (SEO-friendly)', async ({ page }) => {
  await page.goto('/?lang=zh-CN');
  await expect(page.locator('#rosview-root')).toHaveAttribute('data-language', 'zh');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ROS View');
});

test('remote single url opens fixture', async ({ page }) => {
  await page.goto(`/?url=${MCAP_BASIC_URL}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rosview-dockview')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
  await expect(page.locator('nav')).toContainText('test_5s.mcap', { timeout: 15_000 });
});

test('dockview theme class follows light mode', async ({ page }) => {
  await page.goto(`/?url=${MCAP_BASIC_URL}&theme=light`);
  await expect(page.getByTestId('rosview-dockview')).toBeVisible({ timeout: 30_000 });
  const dock = page.getByTestId('rosview-dockview');
  await expect(dock).toHaveAttribute('data-dockview-chrome-theme', 'light');
  await expect(page.locator('.ros-dockview-theme-light').first()).toBeVisible();
});

test.describe('local file upload', () => {
  test('local file via welcome hidden file input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles(MCAP_BASIC);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
  });
});
