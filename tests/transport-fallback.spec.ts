import { test, expect } from '@playwright/test';
import { MCAP_BASIC_URL, requireExamplesDir } from './fixturePaths';
import { expectDockviewTopic, openFixtureByUrl } from './helpers/rosview';

test.describe('transport fallback', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('exposes selected transport mode on dockview shell', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL);
    await expectDockviewTopic(page, '/camera/');
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', /^(sab|transfer|comlink)$/);
  });

  test('query parameter forces transfer mode', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL, { query: { transport: 'transfer' } });
    await expectDockviewTopic(page, '/camera/');
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', 'transfer');
  });

  test('query parameter forces comlink mode', async ({ page }) => {
    await openFixtureByUrl(page, MCAP_BASIC_URL, { query: { transport: 'comlink' } });
    await expectDockviewTopic(page, '/camera/');
    await expect(page.getByTestId('rosview-dockview')).toHaveAttribute('data-transport-mode', 'comlink');
  });
});
