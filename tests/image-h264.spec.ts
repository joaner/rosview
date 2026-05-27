import { test, expect } from '@playwright/test';
import { MCAP_H264_URL, requireFixture, MCAP_H264 } from './fixturePaths';

test.describe.configure({ timeout: 120_000 });

test.beforeAll(() => {
  requireFixture(MCAP_H264);
});

test('H.264 CompressedImage decodes without error', async ({ page }) => {
  await page.goto(`/?url=${MCAP_H264_URL}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rosview-dockview')).toBeVisible({ timeout: 60_000 });

  const play = page.getByRole('button', { name: 'Play playback' });
  if (await play.isVisible().catch(() => false)) {
    await play.click();
  }

  await expect(page.locator('canvas')).not.toHaveCount(0, { timeout: 90_000 });

  const hasDecodeFailure = await page.getByText(/decode failed|could not be decoded/i).count();
  expect(hasDecodeFailure).toBe(0);

  const imageStatus = page.getByTestId('image-panel-status');
  if (await page.getByTestId('image-panel-canvas').isVisible().catch(() => false)) {
    await expect(imageStatus).toBeVisible({ timeout: 90_000 });
    await expect(imageStatus).toHaveText(/\d+x\d+/);
  }
});
