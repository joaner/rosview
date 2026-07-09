import { test, expect } from '@playwright/test';
import {
  BAG_MULTI,
  MCAP_BASIC,
  MCAP_BASIC_URL,
  MCAP_MULTI_BASE,
  MCAP_MULTI_FILTERED,
  MCAP_MULTI_INCREMENTAL,
  fixtureExists,
  requireExamplesDir,
} from './fixturePaths';
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

test.describe('multi-source merge', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(() => {
    requireExamplesDir();
  });

  test('multiple mcap files opened together merge into one session', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles([MCAP_MULTI_BASE, MCAP_MULTI_INCREMENTAL]);
    await waitForRosviewReady(page);

    // Topics from both files are present in the same session.
    await expect(
      page.getByRole('button', { name: '/camera/front/image_raw/compressed', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '/joint_states', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '/analysis/hand_pose_overlay/compressed', exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Base spans 0-5s, incremental spans 3-7s; the merged range is their
    // union (0-7s), not either file's own range.
    await expect(page.getByTestId('playback-time-line')).toContainText('00:07.000', { timeout: 30_000 });

    // The Data tab shows one merged-session row, not two switchable entries.
    await page.getByRole('tab', { name: 'Data' }).click();
    await expect(page.getByText('2 files merged')).toBeVisible();
  });

  test('adding a file to an already-loaded session merges it in', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles([MCAP_MULTI_BASE]);
    await waitForRosviewReady(page);

    await expect(page.getByRole('button', { name: '/joint_states', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '/analysis/hand_pose_overlay/compressed', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId('playback-time-line')).toContainText('00:05.000', { timeout: 30_000 });

    // Drop a second file in while the base recording is already active: it
    // should extend the current session (grow topics + time range) rather
    // than switching to a separate, independently-switchable dataset.
    await page.locator('#rosview-inline-file').setInputFiles([MCAP_MULTI_INCREMENTAL]);
    await expect(
      page.getByRole('button', { name: '/analysis/hand_pose_overlay/compressed', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('playback-time-line')).toContainText('00:07.000', { timeout: 30_000 });

    await page.getByRole('tab', { name: 'Data' }).click();
    await expect(page.getByText('2 files merged')).toBeVisible();
    await expect(page.getByText('files merged', { exact: false })).toHaveCount(1);
  });

  test('topic "more" menu shows the source file once sessions are merged', async ({ page }) => {
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles([MCAP_MULTI_BASE, MCAP_MULTI_INCREMENTAL]);
    await waitForRosviewReady(page);

    const topicRow = page.getByRole('button', { name: '/analysis/hand_pose_overlay/compressed', exact: true });
    await expect(topicRow).toBeVisible({ timeout: 30_000 });
    await topicRow.getByRole('button', { name: 'Topic actions' }).click();
    await expect(page.getByText(/Source: .*test_multi_incremental\.mcap/)).toBeVisible();
  });

  test('mcap and bag files merge together (mixed formats)', async ({ page }) => {
    test.skip(!fixtureExists(BAG_MULTI), 'test_multi.bag fixture not available');
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles([MCAP_MULTI_BASE, BAG_MULTI]);
    await waitForRosviewReady(page);

    await expect(page.getByRole('button', { name: '/joint_states', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '/bag/joint_states', exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a file derived via the mcap filter CLI merges with a hand-authored one', async ({ page }) => {
    test.skip(
      !fixtureExists(MCAP_MULTI_FILTERED),
      'test_multi_filtered.mcap not generated (mcap CLI not installed)',
    );
    await page.goto('/');
    await page.locator('#rosview-landing-file').setInputFiles([MCAP_MULTI_FILTERED, MCAP_MULTI_INCREMENTAL]);
    await waitForRosviewReady(page);

    // test_multi_filtered.mcap (0-5s, mcap filter -y /joint_states) + the
    // hand-authored incremental file (3-7s) => union is 0-7s.
    await expect(page.getByRole('button', { name: '/joint_states', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '/analysis/hand_pose_overlay/compressed', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('playback-time-line')).toContainText('00:07.000', { timeout: 30_000 });
  });
});
