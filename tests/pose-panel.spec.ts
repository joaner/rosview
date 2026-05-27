import { test, expect } from '@playwright/test';
import { MCAP_POSE_URL, requireFixture, MCAP_POSE } from './fixturePaths';

test.beforeAll(() => {
  requireFixture(MCAP_POSE);
});

test('PoseStamped fixture exposes pose topics by schema', async ({ page }) => {
  await page.goto(`/?url=${MCAP_POSE_URL}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('rosview-dockview')).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText('geometry_msgs/msg/PoseStamped').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('/io/pose/Left_Gripper')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('/io/pose/Right_Gripper')).toBeVisible({ timeout: 30_000 });
});
