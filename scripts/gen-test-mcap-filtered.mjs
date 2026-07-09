#!/usr/bin/env node
/**
 * Derive public/examples/test_multi_filtered.mcap from test_multi_base.mcap
 * using the real `mcap` CLI's `filter` subcommand (not @mcap/core), per the
 * multi-source-merge test plan's requirement to exercise `mcap filter` for
 * fixture generation.
 *
 * Requires gen-test-mcap-multi-base.mjs to have run first. Skips gracefully
 * (exit 0, no output file) when the `mcap` CLI isn't on PATH, so contributors
 * without it installed still get every other fixture; tests that depend on
 * this file self-skip when it's absent. CI installs the CLI so it always
 * runs there (see .github/workflows/ci.yml).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXAMPLES_DIR } from './mcap-fixture-utils.mjs';

const baseFile = path.join(EXAMPLES_DIR, 'test_multi_base.mcap');
const outFile = path.join(EXAMPLES_DIR, 'test_multi_filtered.mcap');

function mcapCliAvailable() {
  const result = spawnSync('mcap', ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

if (!fs.existsSync(baseFile)) {
  console.error(`[gen-test-mcap-filtered] missing ${baseFile}; run gen-test-mcap-multi-base.mjs first`);
  process.exit(1);
}

if (!mcapCliAvailable()) {
  console.warn(
    '[gen-test-mcap-filtered] `mcap` CLI not found on PATH; skipping test_multi_filtered.mcap.\n' +
      '  Install it (brew install mcap, or https://github.com/foxglove/mcap/releases?q=mcap-cli)\n' +
      '  to exercise the "mcap filter"-derived fixture. Tests that depend on it self-skip when\n' +
      '  the file is absent.',
  );
  // Remove stale output from a previous run so dependent tests see it as
  // genuinely unavailable rather than stale.
  if (fs.existsSync(outFile)) fs.rmSync(outFile);
  process.exit(0);
}

// Only /joint_states survives the filter; pairs with
// test_multi_incremental.mcap in tests to prove a CLI-derived file merges
// correctly alongside a hand-authored one.
const result = spawnSync('mcap', ['filter', baseFile, '-o', outFile, '-y', '/joint_states'], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error('[gen-test-mcap-filtered] mcap filter failed with status', result.status);
  process.exit(result.status ?? 1);
}
console.log('Wrote', outFile);
