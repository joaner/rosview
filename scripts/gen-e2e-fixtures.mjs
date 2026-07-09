/**
 * Generate all Playwright E2E fixtures into public/examples/.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} script */
function runNode(script) {
  const scriptPath = path.join(__dirname, script);
  const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** @param {string} script */
function runPython(script) {
  const scriptPath = path.join(__dirname, script);
  const result = spawnSync('python3', [scriptPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNode('gen-test-mcap.mjs');
runNode('gen-test-mcap-pose.mjs');
runNode('gen-test-mcap-3cam.mjs');
runNode('gen-test-mcap-h264.mjs');
runNode('gen-test-mcap-compressed-depth.mjs');
runPython('gen-test-hdf5.py');
runNode('gen-test-bvh.mjs');

// Multi-source merge fixtures. gen-test-mcap-filtered.mjs and gen-test-bag.py
// each self-skip (exit 0) when their optional external tool (`mcap` CLI /
// `rosbags` package) isn't installed, so this pipeline still succeeds for
// contributors without them; CI installs both (see .github/workflows/ci.yml).
runNode('gen-test-mcap-multi-base.mjs');
runNode('gen-test-mcap-multi-incremental.mjs');
runNode('gen-test-mcap-filtered.mjs');
runPython('gen-test-bag.py');

console.log('[gen-e2e-fixtures] all fixtures ready');
