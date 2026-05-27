import { test, expect } from '@playwright/test';
import { MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';

test.describe('transport fallback', () => {
  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('exposes selected transport mode on dockview shell', async ({ page }) => {
    await page.goto(`/?url=${MCAP_BASIC_URL}`);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', /^(sab|transfer|comlink)$/);
  });

  test('query parameter forces transfer mode', async ({ page }) => {
    await page.goto(`/?url=${MCAP_BASIC_URL}&transport=transfer`);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', 'transfer');
  });

  test('query parameter forces comlink mode', async ({ page }) => {
    await page.goto(`/?url=${MCAP_BASIC_URL}&transport=comlink`);
    await expect(page.getByTestId('rosview-dockview')).toContainText('/camera/', { timeout: 30_000 });
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', 'comlink');
  });
});
