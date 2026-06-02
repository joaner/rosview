import { test, expect } from '@playwright/test';
import { BVH_MINIMAL, BVH_MINIMAL_URL, requireFixture } from './fixturePaths';

test.describe.configure({ timeout: 60_000 });

test.beforeAll(() => {
  requireFixture(BVH_MINIMAL);
});

test('BVH sample loads and exposes skeleton topic in the sidebar', async ({ page }) => {
  await page.goto(`/?url=${BVH_MINIMAL_URL}`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('body')).toContainText('/bvh/skeleton', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
});
