/**
 * capture_baseline.mjs — grab a deterministic snapshot of the scan
 * emission transform before the scan-UI narrowing refactor.
 *
 * Why
 * ---
 * The UI refactor collapses 6 wizard steps into 1 screen and moves
 * account constants from form state to a config file. We want to be
 * able to assert that `buildScanPayload` (the contract with
 * entry-rules) still produces the same JSON before and after the
 * refactor. That requires a frozen input + expected output pair that
 * is reproducible without hitting any external API.
 *
 * What this writes
 * ----------------
 * - baseline/input_fixture.json   — the inputs used
 * - baseline/expected_output.json — buildScanPayload's result
 *
 * After each refactor commit, run `node scripts/verify_baseline.mjs`
 * to confirm the output is still identical. Any diff = flagged
 * regression that needs a reason.
 *
 * Usage
 * -----
 *   node scripts/capture_baseline.mjs
 *
 * The fixture is the same one used by lib/scanEmission.test.mjs so
 * this script tracks whatever the test suite already exercises.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildScanPayload } from '../lib/scanEmission.js';

// ── Fixtures (kept in sync with lib/scanEmission.test.mjs) ───────────

function mockScannerResults(regime = 'GREEN') {
  return {
    regime,
    mclScore: 0.72,
    results: {
      primary: [
        { ticker: 'NVDA', score: 92, tier: 'A', market: 'US' },
        { ticker: 'AAPL', score: 88, tier: 'A', market: 'US' },
      ],
      watchlist: [{ ticker: 'BARC.L', score: 71, tier: 'B', market: 'UK' }],
      dayTrades: { vix: 14.2 },
    },
  };
}

function mockAnalysisResult() {
  return {
    mode: 'Bull Committee',
    summary: 'Three high-grade setups this morning.',
    signals: [
      {
        ticker: 'NVDA',
        name: 'NVDA',
        direction: 'LONG',
        verdict: 'TAKE TRADE',
        entry: '145.50-146.00',
        stop: '142.00',
        target: '154.00',
        grade: 'A+',
        pillarCount: 6,
        setupType: 'VCP Breakout',
        riskReward: '2.4:1',
        rawSection: 'markdown...',
      },
      {
        ticker: 'AAPL',
        name: 'AAPL',
        direction: 'SHORT',
        verdict: 'TAKE TRADE',
        entry: '220.00',
        stop: '224.50',
        target: '210.00',
        grade: 'A',
        pillarCount: 5,
        setupType: 'Head & Shoulders Breakdown',
        riskReward: '2.2:1',
        rawSection: 'markdown...',
      },
      {
        ticker: 'BARC.L',
        name: 'Barclays',
        direction: 'WATCHLIST ONLY',
        verdict: 'WATCHLIST',
        grade: null,
        setupType: 'Breakout Watch',
        rawSection: 'markdown...',
      },
      // Invalid row — LONG with stop above trigger — must be dropped.
      {
        ticker: 'BAD1',
        direction: 'LONG',
        verdict: 'TAKE TRADE',
        entry: '100.00',
        stop: '105.00',
        target: '110.00',
        grade: 'B',
        setupType: 'Pullback',
        rawSection: 'markdown...',
      },
      {
        ticker: 'TSLA',
        direction: 'LONG',
        verdict: 'DAY TRADE',
        entry: '250.00',
        stop: '246.00',
        target: '258.00',
        grade: 'B',
        setupType: 'Pocket Pivot',
        rawSection: 'markdown...',
      },
    ],
  };
}

// ── Build the fixture + capture ──────────────────────────────────────

const INPUT_FIXTURE = {
  formData: { accountSize: '10000', brokerMode: 'DEMO' },
  scannerResults: mockScannerResults('GREEN'),
  analysisResult: mockAnalysisResult(),
  ruleSetVersion: 'baseline-2026-04-24',
  now: '2026-04-24T13:45:00.000Z', // serialized; re-hydrated below
};

const baselineDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'baseline',
);

await mkdir(baselineDir, { recursive: true });

const result = await buildScanPayload({
  ...INPUT_FIXTURE,
  now: new Date(INPUT_FIXTURE.now),
});

await writeFile(
  path.join(baselineDir, 'input_fixture.json'),
  JSON.stringify(INPUT_FIXTURE, null, 2) + '\n',
  'utf8',
);

await writeFile(
  path.join(baselineDir, 'expected_output.json'),
  JSON.stringify(result, null, 2) + '\n',
  'utf8',
);

console.log('Baseline captured:');
console.log('  baseline/input_fixture.json');
console.log('  baseline/expected_output.json');
console.log('');
console.log(`scanRecord.shortlist_count = ${result.scanRecord?.shortlist_count ?? 'n/a'}`);
console.log(`shortlistEntries.length    = ${result.shortlistEntries?.length ?? 'n/a'}`);
console.log(
  `bypassCandidateEntries.length = ${result.bypassCandidateEntries?.length ?? 'n/a'}`,
);
