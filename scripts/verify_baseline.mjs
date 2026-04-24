/**
 * verify_baseline.mjs — re-run buildScanPayload against the frozen
 * input fixture and diff against the captured expected output.
 *
 * Exit code 0 = clean; exit code 1 = regression (prints a diff summary).
 *
 * Use this after any commit in the scan-UI narrowing branch to prove
 * the emission contract is unchanged.
 *
 * Usage
 * -----
 *   node scripts/verify_baseline.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildScanPayload } from '../lib/scanEmission.js';

const baselineDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'baseline',
);

// UUIDs are regenerated on every call (scan_id, candidate_id). Normalise
// them to a stable placeholder before comparison so the diff surfaces
// REAL schema/field changes rather than UUID churn.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normaliseUuids(obj) {
  return JSON.parse(JSON.stringify(obj, null, 2).replace(UUID_RE, '<<UUID>>'));
}

const input = JSON.parse(
  await readFile(path.join(baselineDir, 'input_fixture.json'), 'utf8'),
);
const expectedRaw = JSON.parse(
  await readFile(path.join(baselineDir, 'expected_output.json'), 'utf8'),
);

const actualRaw = await buildScanPayload({
  ...input,
  now: new Date(input.now),
});

const expected = normaliseUuids(expectedRaw);
const actual = normaliseUuids(actualRaw);

const expectedStr = JSON.stringify(expected, null, 2);
const actualStr = JSON.stringify(actual, null, 2);

if (expectedStr === actualStr) {
  console.log('BASELINE OK — buildScanPayload output unchanged.');
  process.exit(0);
}

// Diff summary: which top-level keys differ, which fields in scanRecord.
console.error('BASELINE REGRESSION — output differs from baseline/expected_output.json');
console.error('');

const topKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
for (const key of topKeys) {
  const e = JSON.stringify(expected[key]);
  const a = JSON.stringify(actual[key]);
  if (e !== a) {
    console.error(`  • ${key}: changed`);
    if (key === 'scanRecord' && expected.scanRecord && actual.scanRecord) {
      const fKeys = new Set([
        ...Object.keys(expected.scanRecord),
        ...Object.keys(actual.scanRecord),
      ]);
      for (const fk of fKeys) {
        const ef = JSON.stringify(expected.scanRecord[fk]);
        const af = JSON.stringify(actual.scanRecord[fk]);
        if (ef !== af) {
          console.error(`      - scanRecord.${fk}: ${ef} → ${af}`);
        }
      }
    }
  }
}

process.exit(1);
