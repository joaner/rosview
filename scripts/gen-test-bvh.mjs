/**
 * Copy minimal BVH fixture into public/examples/ for E2E.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR, EXAMPLES_DIR } from './mcap-fixture-utils.mjs';

const src = path.join(FIXTURES_DIR, 'media/minimal.bvh');
const dest = path.join(EXAMPLES_DIR, 'test_minimal.bvh');
fs.mkdirSync(EXAMPLES_DIR, { recursive: true });
fs.copyFileSync(src, dest);
console.log('Wrote', dest, `(${fs.statSync(dest).size} bytes)`);
