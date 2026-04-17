/**
 * scanEmission.test.mjs — node --test harness for the scan emission layer.
 *
 * Run with:
 *   node --test lib/scanEmission.test.mjs
 *
 * The verification step of Build session 2 additionally pipes the emitted
 * JSON into pydantic's ScanRecord / ShortlistEntry on the entry-rules side
 * to prove round-trip compatibility.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  LOG_SCHEMA_VERSION,
  __test__,
  buildScanPayload,
  emitScanFiles,
} from './scanEmission.js';

const { mapSetupType, parseTriggerZone, parseNumber, GRADE_TO_RISK_PCT } = __test__;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

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
      // Long, VCP breakout, A+
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
      // Short, H&S, A
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
      // Watchlist-only — should be excluded from shortlist
      {
        ticker: 'BARC.L',
        name: 'Barclays',
        direction: 'WATCHLIST ONLY',
        verdict: 'WATCHLIST',
        grade: null,
        setupType: 'Breakout Watch',
        rawSection: 'markdown...',
      },
      // Invalid row: LONG with stop ABOVE trigger — should be dropped
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
      // Day trade, B
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

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe('parseTriggerZone', () => {
  it('parses single prices', () => {
    assert.deepEqual(parseTriggerZone('145.50'), { low: 145.5, high: 145.5 });
  });
  it('parses dash-separated zones', () => {
    assert.deepEqual(parseTriggerZone('145.50-146.00'), { low: 145.5, high: 146.0 });
  });
  it('parses en-dash zones', () => {
    assert.deepEqual(parseTriggerZone('145.50–146.00'), { low: 145.5, high: 146.0 });
  });
  it('strips currency symbols', () => {
    assert.deepEqual(parseTriggerZone('£1,450.00'), { low: 1450, high: 1450 });
  });
  it('accepts numbers', () => {
    assert.deepEqual(parseTriggerZone(145.5), { low: 145.5, high: 145.5 });
  });
  it('accepts zone objects', () => {
    assert.deepEqual(parseTriggerZone({ low: 1, high: 2 }), { low: 1, high: 2 });
  });
  it('normalises reversed zones', () => {
    assert.deepEqual(parseTriggerZone('150-140'), { low: 140, high: 150 });
  });
  it('returns null for unparseable input', () => {
    assert.equal(parseTriggerZone('nope'), null);
    assert.equal(parseTriggerZone(null), null);
  });
});

describe('parseNumber', () => {
  it('strips symbols', () => assert.equal(parseNumber('£1,450.00'), 1450));
  it('accepts numbers', () => assert.equal(parseNumber(42), 42));
  it('rejects garbage', () => assert.equal(parseNumber('abc'), null));
});

describe('mapSetupType', () => {
  const cases = [
    ['VCP Breakout', 'LONG', 'L-A'],
    ['volatility contraction pattern', 'LONG', 'L-A'],
    ['Breakout Watch', 'LONG', 'L-A'],
    ['First Pullback to EMA', 'LONG', 'L-B'],
    ['Buyable Gap Up', 'LONG', 'L-C'],
    ['Pocket Pivot', 'LONG', 'L-D'],
    ['Head & Shoulders Breakdown', 'SHORT', 'S-A'],
    ['Rally into Resistance', 'SHORT', 'S-B'],
    ['Shortable Gap Down', 'SHORT', 'S-C'],
    ['Climax Top Reversal', 'SHORT', 'S-D'],
    ['Failed Breakout Short', 'SHORT', 'S-E'],
    // Unknown → default by direction
    ['something wild', 'LONG', 'L-A'],
    ['something wild', 'SHORT', 'S-A'],
    [null, 'LONG', 'L-A'],
  ];
  for (const [input, dir, expected] of cases) {
    it(`${JSON.stringify(input)} (${dir}) → ${expected}`, () => {
      assert.equal(mapSetupType(input, dir), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// buildScanPayload — the whole transform
// ---------------------------------------------------------------------------

describe('buildScanPayload', () => {
  it('produces a well-formed ScanRecord + shortlist', () => {
    const { scanRecord, shortlistEntries } = buildScanPayload({
      formData: { accountSize: '10000', brokerMode: 'DEMO' },
      scannerResults: mockScannerResults('GREEN'),
      analysisResult: mockAnalysisResult(),
      ruleSetVersion: 'abcd123',
      now: new Date('2026-04-16T09:30:00Z'),
    });

    // ScanRecord — structural checks (shape matches entry-rules/src/models/scan_record.py)
    assert.equal(scanRecord.schema_version, LOG_SCHEMA_VERSION);
    assert.equal(scanRecord.scanned_at_utc, '2026-04-16T09:30:00.000Z');
    assert.equal(scanRecord.broker_mode, 'DEMO');
    assert.equal(scanRecord.universe_size, 3);
    assert.equal(scanRecord.regime.regime, 'GREEN');
    assert.equal(scanRecord.regime.regime_score, 0.72);
    assert.equal(scanRecord.regime.vix_level, 14.2);
    assert.equal(scanRecord.scored_universe.length, 3);
    assert.equal(scanRecord.scored_universe[0].symbol, 'NVDA');
    assert.equal(scanRecord.scored_universe[0].shortlisted, true);
    assert.equal(scanRecord.scored_universe[0].grade, 'A+');
    assert.equal(scanRecord.scored_universe[2].symbol, 'BARC.L');
    assert.equal(scanRecord.scored_universe[2].shortlisted, false);
    assert.ok(scanRecord.scan_id);
    assert.equal(scanRecord.rule_set_version, 'abcd123');
    assert.equal(scanRecord.extras.account_size_gbp, 10000);
    assert.equal(scanRecord.extras.scan_date, '2026-04-16');

    // Shortlist — 3 valid entries (NVDA, AAPL, TSLA); the two invalid rows dropped
    assert.equal(shortlistEntries.length, 3);
    const [nvda, aapl, tsla] = shortlistEntries;

    // NVDA — LONG VCP A+
    assert.equal(nvda.symbol, 'NVDA');
    assert.equal(nvda.direction, 'LONG');
    assert.equal(nvda.setup_type, 'L-A');
    assert.equal(nvda.grade, 'A+');
    assert.equal(nvda.trigger_low, 145.5);
    assert.equal(nvda.trigger_high, 146.0);
    assert.equal(nvda.stop_price, 142.0);
    assert.equal(nvda.target_price, 154.0);
    assert.equal(nvda.planned_risk_pct_account, GRADE_TO_RISK_PCT['A+']);
    // risk_per_pt = 145.5 - 142 = 3.5. risk_gbp = 10000 * 0.01 = 100. stake = 100/3.5 ≈ 28.57
    assert.equal(nvda.planned_risk_gbp, 100);
    assert.equal(nvda.planned_stake_gbp_per_pt, 28.57);
    assert.equal(nvda.broker_mode, 'DEMO');
    assert.equal(nvda.market, 'US');
    assert.equal(nvda.extras.setupType_raw, 'VCP Breakout');

    // AAPL — SHORT H&S A
    assert.equal(aapl.symbol, 'AAPL');
    assert.equal(aapl.direction, 'SHORT');
    assert.equal(aapl.setup_type, 'S-A');
    assert.equal(aapl.trigger_low, 220.0);
    assert.equal(aapl.trigger_high, 220.0);
    assert.equal(aapl.stop_price, 224.5);
    assert.ok(aapl.stop_price > aapl.trigger_high); // SHORT stop on correct side

    // TSLA — day trade, B
    assert.equal(tsla.symbol, 'TSLA');
    assert.equal(tsla.grade, 'B');
    assert.equal(tsla.planned_risk_pct_account, GRADE_TO_RISK_PCT.B);
  });

  it('drops invalid rows rather than emit unvalidated data', () => {
    const { shortlistEntries } = buildScanPayload({
      formData: { accountSize: '10000' },
      scannerResults: mockScannerResults(),
      analysisResult: {
        signals: [
          {
            ticker: 'BAD1',
            direction: 'LONG',
            verdict: 'TAKE TRADE',
            entry: '100',
            stop: '105', // wrong side
            grade: 'A',
            setupType: 'VCP',
            rawSection: '',
          },
          {
            ticker: 'BAD2',
            direction: 'SHORT',
            verdict: 'TAKE TRADE',
            entry: '100',
            stop: '95', // wrong side
            grade: 'A',
            setupType: 'H&S',
            rawSection: '',
          },
          {
            ticker: 'BAD3',
            direction: 'LONG',
            verdict: 'TAKE TRADE',
            entry: 'nonsense',
            stop: 'also nonsense',
            grade: 'A',
            setupType: 'VCP',
            rawSection: '',
          },
        ],
      },
    });
    assert.equal(shortlistEntries.length, 0);
  });

  it('defaults broker_mode to DEMO when unset', () => {
    const { scanRecord } = buildScanPayload({
      formData: {},
      scannerResults: mockScannerResults(),
      analysisResult: { signals: [] },
    });
    assert.equal(scanRecord.broker_mode, 'DEMO');
  });

  it('handles zero account size without dividing by zero', () => {
    const { shortlistEntries } = buildScanPayload({
      formData: { accountSize: '0' },
      scannerResults: mockScannerResults(),
      analysisResult: mockAnalysisResult(),
    });
    for (const e of shortlistEntries) {
      assert.equal(e.planned_risk_gbp, 0);
      assert.equal(e.planned_stake_gbp_per_pt, 0);
    }
  });

  it('defaults gate_bypass=false / bypass_until=null when no bypassConfig passed', () => {
    const { scanRecord } = buildScanPayload({
      formData: { accountSize: '10000', brokerMode: 'DEMO' },
      scannerResults: mockScannerResults(),
      analysisResult: mockAnalysisResult(),
    });
    assert.equal(scanRecord.gate_bypass, false);
    assert.equal(scanRecord.bypass_until, null);
  });

  it('emits gate_bypass=true + bypass_until and filters shortlist by selectedTickers', () => {
    const { scanRecord, shortlistEntries } = buildScanPayload({
      formData: { accountSize: '10000', brokerMode: 'DEMO' },
      scannerResults: mockScannerResults('GREEN'),
      analysisResult: mockAnalysisResult(),
      bypassConfig: { enabled: true, bypassUntil: '2026-05-07' },
      selectedTickers: ['NVDA', 'TSLA'],
    });
    assert.equal(scanRecord.gate_bypass, true);
    assert.equal(scanRecord.bypass_until, '2026-05-07');
    // NVDA + TSLA pass through; AAPL is valid but wasn't selected, so it's filtered out.
    const symbols = shortlistEntries.map((e) => e.symbol).sort();
    assert.deepEqual(symbols, ['NVDA', 'TSLA']);
  });

  it('refuses bypass with broker_mode=LIVE', () => {
    assert.throws(
      () =>
        buildScanPayload({
          formData: { accountSize: '10000', brokerMode: 'LIVE' },
          scannerResults: mockScannerResults(),
          analysisResult: mockAnalysisResult(),
          bypassConfig: { enabled: true, bypassUntil: '2026-05-07' },
        }),
      /only permitted with broker_mode=DEMO/,
    );
  });

  it('refuses bypass without a bypassUntil date', () => {
    assert.throws(
      () =>
        buildScanPayload({
          formData: { accountSize: '10000', brokerMode: 'DEMO' },
          scannerResults: mockScannerResults(),
          analysisResult: mockAnalysisResult(),
          bypassConfig: { enabled: true, bypassUntil: null },
        }),
      /requires bypassUntil as YYYY-MM-DD/,
    );
  });

  it('refuses bypass with a malformed bypassUntil date', () => {
    assert.throws(
      () =>
        buildScanPayload({
          formData: { accountSize: '10000', brokerMode: 'DEMO' },
          scannerResults: mockScannerResults(),
          analysisResult: mockAnalysisResult(),
          bypassConfig: { enabled: true, bypassUntil: '07/05/2026' },
        }),
      /YYYY-MM-DD/,
    );
  });

  it('selectedTickers alone (no bypass) still filters shortlist — forward-compatible', () => {
    const { scanRecord, shortlistEntries } = buildScanPayload({
      formData: { accountSize: '10000', brokerMode: 'DEMO' },
      scannerResults: mockScannerResults(),
      analysisResult: mockAnalysisResult(),
      selectedTickers: ['AAPL'],
    });
    assert.equal(scanRecord.gate_bypass, false);
    assert.equal(scanRecord.bypass_until, null);
    assert.equal(shortlistEntries.length, 1);
    assert.equal(shortlistEntries[0].symbol, 'AAPL');
  });
});

// ---------------------------------------------------------------------------
// emitScanFiles — end-to-end file write
// ---------------------------------------------------------------------------

describe('emitScanFiles', () => {
  it('writes scan_YYYYMMDD.json and appends to trades.json', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-emit-'));
    try {
      const now = new Date('2026-04-16T09:30:00Z');
      const { scanRecord, shortlistEntries } = buildScanPayload({
        formData: { accountSize: '10000', brokerMode: 'DEMO' },
        scannerResults: mockScannerResults(),
        analysisResult: mockAnalysisResult(),
        now,
      });
      const { scanPath, tradesPath } = await emitScanFiles({
        dataDir: tmp,
        scanRecord,
        shortlistEntries,
        now,
      });

      // scan_YYYYMMDD.json exists and parses
      assert.ok(scanPath.endsWith('scan_20260416.json'), `got ${scanPath}`);
      await stat(scanPath);
      const content = JSON.parse(await readFile(scanPath, 'utf8'));
      assert.equal(content.schema_version, LOG_SCHEMA_VERSION);
      assert.equal(content.scan_record.scan_id, scanRecord.scan_id);
      assert.equal(content.shortlist_entries.length, 3);

      // trades.json is NDJSON with one summary line
      const lines = (await readFile(tradesPath, 'utf8')).trim().split('\n');
      assert.equal(lines.length, 1);
      const summary = JSON.parse(lines[0]);
      assert.equal(summary.kind, 'scan_summary');
      assert.equal(summary.scan_id, scanRecord.scan_id);
      assert.equal(summary.shortlist_count, 3);
      assert.equal(summary.grade_counts['A+'], 1);
      assert.equal(summary.grade_counts['A'], 1);
      assert.equal(summary.grade_counts['B'], 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('appends (does not overwrite) trades.json across multiple scans', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'scan-emit-'));
    try {
      for (let i = 0; i < 3; i++) {
        const now = new Date(`2026-04-1${6 + i}T09:30:00Z`);
        const { scanRecord, shortlistEntries } = buildScanPayload({
          formData: { accountSize: '10000' },
          scannerResults: mockScannerResults(),
          analysisResult: mockAnalysisResult(),
          now,
        });
        await emitScanFiles({ dataDir: tmp, scanRecord, shortlistEntries, now });
      }
      const lines = (await readFile(path.join(tmp, 'trades.json'), 'utf8'))
        .trim()
        .split('\n');
      assert.equal(lines.length, 3);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
