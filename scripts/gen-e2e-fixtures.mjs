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
runPython('gen-test-hdf5.py');
runNode('gen-test-bvh.mjs');

console.log('[gen-e2e-fixtures] all fixtures ready');
