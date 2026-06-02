import { test, expect } from '@playwright/test';
import { MCAP_BASIC, MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';
import { expectDockviewTopic, openFixtureByUrl, waitForRosviewReady } from './helpers/rosview';

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

test.describe('MCAP delivery', () => {
  test.describe.configure({ timeout: 90_000 });

  test('remote single url opens fixture', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await expectDockviewTopic(page, '/camera/');
    await expect(page.locator('nav')).toContainText('test_5s.mcap', { timeout: 15_000 });
  });

  test('dockview theme class follows light mode', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL, { query: { theme: 'light' } });
    const dock = page.getByTestId('rosview-dockview');
    await expect(dock).toHaveAttribute('data-dockview-chrome-theme', 'light');
    await expect(page.locator('.ros-dockview-theme-light').first()).toBeVisible();
  });

  test.describe('local file upload', () => {
    test('local file via welcome hidden file input', async ({ page }) => {
      await page.goto('/');
      await page.locator('#rosview-landing-file').setInputFiles(MCAP_BASIC);
      await waitForRosviewReady(page);
      await expectDockviewTopic(page, '/camera/');
    });
  });
});
