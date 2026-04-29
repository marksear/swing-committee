// Regression guard for the Grade-C bypass-pool bug (April 2026).
//
// Symptom: the "Download bypass scan" button silently no-op'd when the
// user picked only Grade-C rows. Cause: /api/analyze calls buildScanPayload
// without bypassConfig, so the server-side `bypassEnabled` flag is false,
// the strict GRADE_TO_RISK_PCT table is used, and Grade-C signals are
// filtered out of bypass_candidate_entries. The frontend filtered the
// empty pool by ticker, got zero matches, early-returned.
//
// Fix: buildScanPayload now always populates bypass_candidate_entries from
// the extended (A+/A/B/C) ladder, regardless of the caller's bypass flag.
// The main shortlist stays strict so production behaviour is unchanged.
//
// Lives in its own file so the fix commit doesn't bundle with unrelated
// in-progress work in scanEmission.test.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildScanPayload } from './scanEmission.js';

function mockScannerResults(regime = 'GREEN') {
  return {
    timestamp: '2026-04-18T14:00:00.000Z',
    regime,
    regimeGate: { ukRegimeState: 'YELLOW', usRegimeState: 'GREEN', source: 'MCL' },
    results: { primary: [], watchlist: [] },
  };
}

describe('buildScanPayload — Grade-C inclusion in bypass pool', () => {
  it('includes Grade-C signals in bypass_candidate_entries even when caller did not enable bypass', async () => {
    // Mirrors the real /api/analyze call: no bypassConfig passed.
    const analysis = {
      mode: 'Bull Committee',
      summary: 'One A+, two Cs.',
      signals: [
        {
          ticker: 'NVDA', direction: 'LONG', verdict: 'TAKE TRADE',
          entry: '145.50-146.00', stop: '142.00', target: '154.00',
          grade: 'A+', pillarCount: 6, setupType: 'VCP Breakout',
        },
        {
          ticker: 'AIG', direction: 'LONG', verdict: 'WATCHLIST',
          entry: '78.50-79.50', stop: '77.16', target: '81.48',
          grade: 'C', pillarCount: 3, setupType: 'Near miss',
        },
        {
          ticker: 'JNJ', direction: 'SHORT', verdict: 'WATCHLIST',
          entry: '233.50-234.50', stop: '238.81', target: '227.32',
          grade: 'C', pillarCount: 3, setupType: 'Near miss',
        },
      ],
    };

    const { shortlistEntries, bypassCandidateEntries } = await buildScanPayload({
      formData: { accountSize: '10000', brokerMode: 'DEMO' },
      scannerResults: mockScannerResults(),
      analysisResult: analysis,
      now: new Date('2026-04-18T14:00:00Z'),
    });

    // Main shortlist stays strict: only the A+ TAKE-TRADE survives.
    assert.equal(shortlistEntries.length, 1);
    assert.equal(shortlistEntries[0].symbol, 'NVDA');

    // Bypass pool must include all three — A+ and both Cs — so the
    // frontend Download button can filter by any selected ticker.
    const bypassSymbols = bypassCandidateEntries.map((e) => e.symbol).sort();
    assert.deepEqual(bypassSymbols, ['AIG', 'JNJ', 'NVDA']);

    // Grade-C entries must be fully sized — the fix forces
    // bypassEnabled=true in the per-entry context so
    // BYPASS_GRADE_TO_RISK_PCT['C'] = 0.01 drives position sizing.
    // (Was 0.005 pre-2026-04-29, lifted to 0.01 in Task #52 to align
    // with the rest of the ladder per feedback_small_account_sizing.)
    const aigEntry = bypassCandidateEntries.find((e) => e.symbol === 'AIG');
    assert.ok(aigEntry);
    assert.equal(aigEntry.planned_risk_pct_account, 0.01);
    assert.ok(aigEntry.planned_stake_gbp_per_pt > 0,
      'Grade-C bypass entry must have a non-zero stake');
  });
});
