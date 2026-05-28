import { test, expect } from '@playwright/test';
import { MCAP_BASIC, MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';
import { expectDockviewTopic, openFixtureByUrl, waitForRosviewReady } from './helpers/rosview';

test.describe('multi-source URLs and sidebar', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('single url= opens fixture', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await expectDockviewTopic(page, '/camera/');
    await expect(page.getByTestId('playback-loaded-range').first()).toBeVisible();
  });

  test('local file via welcome hidden file input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles(MCAP_BASIC);
    await waitForRosviewReady(page);
    await expectDockviewTopic(page, '/camera/');
  });
});
