import { test, expect } from '@playwright/test';
import { MCAP_BASIC, MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';

test.describe('multi-source URLs and sidebar', () => {
  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('single url= opens fixture', async ({ page }) => {
    await page.goto(`/?url=${MCAP_BASIC_URL}`);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
    await expect(page.getByTestId('playback-loaded-range').first()).toBeVisible();
  });

  test('local file via welcome hidden file input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles(MCAP_BASIC);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
  });
});
