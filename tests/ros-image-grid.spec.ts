import { test, expect } from '@playwright/test';
import { MCAP_3CAM_URL, requireFixture, MCAP_3CAM } from './fixturePaths';

test.describe.configure({ timeout: 120_000 });

test.beforeAll(() => {
  requireFixture(MCAP_3CAM);
});

test('loads the three-camera compressed image sample without empty decoder payloads', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(message.text());
    }
  });

  await page.goto(`/?url=${MCAP_3CAM_URL}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rosview-dockview')).toBeVisible({ timeout: 60_000 });

  const imagePanels = page.getByTestId('image-panel');
  await expect(imagePanels).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText(/Failed to construct 'ImageDecoder'|No image data provided/i)).toHaveCount(0);

  const play = page.getByRole('button', { name: 'Play playback' });
  if (await play.isVisible().catch(() => false)) {
    await play.click();
  }

  await expect(page.getByTestId('image-panel-status')).toHaveCount(3, { timeout: 90_000 });
  const statusTexts = await page.getByTestId('image-panel-status').allTextContents();
  expect(statusTexts).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\d+x\d+/),
    expect.stringMatching(/^\d+x\d+/),
    expect.stringMatching(/^\d+x\d+/),
  ]));

  await page.waitForTimeout(4_000);
  await expect(page.getByTestId('image-panel-status')).toHaveCount(3);
  await expect(page.getByText(/Image decode failed|Compressed image payload is empty|No image data provided/i)).toHaveCount(0);
  expect(pageErrors.filter((entry) => /ImageDecoder|No image data provided/i.test(entry))).toEqual([]);
});
