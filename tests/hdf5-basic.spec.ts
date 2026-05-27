import { test, expect } from '@playwright/test';
import { HDF5_MINIMAL_URL, requireFixture, HDF5_MINIMAL } from './fixturePaths';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(() => {
  requireFixture(HDF5_MINIMAL);
});

test('HDF5 sample loads and exposes synthesized ROS topics in the sidebar', async ({ page }) => {
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message));

  await page.goto(`/?url=${HDF5_MINIMAL_URL}`);

  await expect(page.locator('body')).toContainText('/observations/joint_states', {
    timeout: 60_000,
  });
  await expect(page.locator('body')).toContainText('/observations/images/ext1');
  await expect(page.locator('body')).toContainText('/observations/ee_pose');
  await expect(page.locator('body')).toContainText('/action');

  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
});

test('HDF5 image topic can be opened into an Image panel', async ({ page }) => {
  await page.goto(`/?url=${HDF5_MINIMAL_URL}`);

  const imageTopicRow = page.getByText('/observations/images/ext1', { exact: false }).first();
  await expect(imageTopicRow).toBeVisible({ timeout: 60_000 });

  await imageTopicRow.click();

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 45_000 });
});
