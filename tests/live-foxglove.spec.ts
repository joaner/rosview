/**
 * Live ROS 2 e2e against stock foxglove_bridge + demo publishers.
 *
 * Preflight: `scripts/live-ros-stack.sh preflight` (or ROSVIEW_LIVE_URL).
 * Skip when ROS/bridge is unavailable so CI without ROS stays green.
 *
 * Env:
 *   ROSVIEW_LIVE_URL   default ws://127.0.0.1:8765
 *   ROSVIEW_LIVE_SKIP  set to 1 to force skip
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBrowserDiagnostics } from './helpers/rosview';

const LIVE_URL = (process.env.ROSVIEW_LIVE_URL ?? 'ws://127.0.0.1:8765').trim();
const FORCE_SKIP = process.env.ROSVIEW_LIVE_SKIP === '1';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STACK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'live-ros-stack.sh');

/** Prefer goal scratch dir when present; else local test-results. */
function evidenceDir(): string {
  const fromEnv = process.env.ROSVIEW_LIVE_EVIDENCE_DIR?.trim();
  if (fromEnv) return fromEnv;
  const goalScratch = '/tmp/grok-goal-ad8ddf3b8b9f/implementer';
  if (fs.existsSync(goalScratch)) return goalScratch;
  return path.join(REPO_ROOT, 'test-results', 'live-foxglove');
}

function preflightLiveStack(): { ok: boolean; log: string } {
  if (FORCE_SKIP) {
    return { ok: false, log: 'ROSVIEW_LIVE_SKIP=1' };
  }
  if (!fs.existsSync(STACK_SCRIPT)) {
    return { ok: false, log: `missing ${STACK_SCRIPT}` };
  }
  try {
    const out = execFileSync(STACK_SCRIPT, ['preflight'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_PROXY: 'localhost,127.0.0.1,::1',
        no_proxy: 'localhost,127.0.0.1,::1',
      },
      timeout: 30_000,
    });
    return { ok: out.includes('PREFLIGHT_OK'), log: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      log: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n'),
    };
  }
}

const preflight = preflightLiveStack();
const SCRATCH = evidenceDir();
fs.mkdirSync(SCRATCH, { recursive: true });
fs.writeFileSync(path.join(SCRATCH, 'ros-preflight.log'), preflight.log, 'utf8');

test.describe('Live Foxglove WebSocket', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(() => {
    test.skip(!preflight.ok, `Live ROS stack not available:\n${preflight.log}`);
  });

  test('connects, lists topics, shows LIVE chrome', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const logLines: string[] = [];
    const log = (line: string) => {
      logLines.push(`[${new Date().toISOString()}] ${line}`);
    };

    log(`goto ?url=${LIVE_URL}`);
    await page.goto(`/?url=${encodeURIComponent(LIVE_URL)}`, { waitUntil: 'domcontentloaded' });

    const root = page.locator('#rosview-root');
    await expect(root).toHaveAttribute('data-player-presence', 'ready', { timeout: 60_000 });
    log('player presence ready');

    await expect(page.getByTestId('playback-live-badge')).toBeVisible({ timeout: 15_000 });
    log('LIVE badge visible');

    // Play/pause usable for live stream
    const pauseBtn = page.getByRole('button', { name: 'Pause playback' });
    const playBtn = page.getByRole('button', { name: 'Play playback' });
    // Auto-play starts as playing
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      await expect(playBtn).toBeVisible();
      await playBtn.click();
      await expect(pauseBtn).toBeVisible();
      log('play/pause toggled');
    } else {
      await expect(playBtn).toBeVisible();
      await playBtn.click();
      await expect(pauseBtn).toBeVisible();
      log('started play from paused');
    }

    // Seek/step disabled in live mode
    const stepBack = page.getByRole('button', { name: /Step backward/i });
    await expect(stepBack).toBeDisabled();
    log('step back disabled');

    // Topics tab list — expected demo publishers
    const expectedTopics = ['/chatter', '/camera/image_raw', '/joint_states'];
    for (const topic of expectedTopics) {
      const row = page.locator('[data-testid="sidebar-topic-row"][data-topic-name="' + topic + '"]');
      await expect(row).toBeVisible({ timeout: 30_000 });
      log(`topic visible: ${topic}`);
    }

    // Capture evidence
    const shotPath = path.join(SCRATCH, 'live-ready.png');
    await page.screenshot({ path: shotPath, fullPage: true });
    log(`screenshot ${shotPath}`);

    if (diagnostics.pageErrors.length > 0) {
      log(`pageErrors: ${diagnostics.pageErrors.join(' | ')}`);
    }
    fs.writeFileSync(path.join(SCRATCH, 'live-e2e.log'), logLines.join('\n') + '\n', 'utf8');

    // Fatal page errors abort the test
    expect(
      diagnostics.pageErrors,
      `uncaught page errors:\n${diagnostics.pageErrors.join('\n')}`,
    ).toEqual([]);
  });
});
