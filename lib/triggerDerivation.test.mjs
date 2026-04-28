/**
 * triggerDerivation.test.mjs — node --test harness for the §4.6 deterministic
 * trigger / stop / target derivation.
 *
 * Run with:
 *   node --test lib/triggerDerivation.test.mjs
 *
 * Per docs/lean_scan_spec.md §4.6: identical scanner inputs MUST produce
 * byte-identical outputs across runs. The 2026-04-18 drift on AIG/AMZN/
 * AVGO/BMY/CSX/JNJ — same OHLCV, different trigger/stop/target — must
 * not be possible under this module.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveTriggerStopTarget,
  __test__,
} from './triggerDerivation.js';

const { roundToTick } = __test__;

// ---------------------------------------------------------------------------
// LONG happy path
// ---------------------------------------------------------------------------

describe('deriveTriggerStopTarget — LONG', () => {
  it('produces expected zone / stop / target from known OHLC + ATR', () => {
    // lastClose=100, atrRaw=2 (Raschke / 0.5×ATR zone formula):
    //   trigger_low  = 100
    //   trigger_high = 100 + 2 × 0.5 = 101  (was 103 under old 3% formula)
    //   stop         = 100 - 2 × 1.5 = 97
    //   R            = 100 - 97 = 3
    //   target       = 100 + 3 × 3 = 109
    const row = { price: 100.0, atrRaw: 2.0 };
    const out = deriveTriggerStopTarget(row, 'LONG');
    assert.deepEqual(out, {
      trigger_low: 100.0,
      trigger_high: 101.0,
      stop: 97.0,
      target: 109.0,
    });
  });

  it('rounds to default 0.01 tick size for equities (TXN-shape)', () => {
    // lastClose=261.41, atrRaw=4.27 — typical equity numbers.
    //   trigger_low  = 261.41
    //   trigger_high = 261.41 + 4.27 × 0.5 = 263.545 → 263.54 or 263.55 (FP rounding)
    //   stop         = 261.41 - 4.27 × 1.5 = 255.005 → 255.00 or 255.01
    //   R            = 261.41 - stop ≈ 6.405
    //   target       = 261.41 + R × 3 ≈ 280.625 → 280.62 or 280.63
    const row = { price: 261.41, atrRaw: 4.27 };
    const out = deriveTriggerStopTarget(row, 'LONG');
    assert.equal(out.trigger_low, 261.41);
    // trigger_high near 263.545
    assert.ok(Math.abs(out.trigger_high - 263.545) < 0.011, `trigger_high ${out.trigger_high}`);
    // Stop near 255.005
    assert.ok(Math.abs(out.stop - 255.005) < 0.011, `stop ${out.stop}`);
    assert.ok(out.target > out.trigger_high, 'target should exceed trigger_high');
    // Direction-correctness: stop strictly below trigger_low for LONG.
    assert.ok(out.stop < out.trigger_low);
    // Zone is now NARROWER than under old 3% formula (was 103 for atr=2):
    //   263.545 / 261.41 = 1.00817 → ~0.82% buffer (was 3%)
    const bufferPct = (out.trigger_high - out.trigger_low) / out.trigger_low;
    assert.ok(bufferPct < 0.02, `buffer should be <2% on equity, got ${(bufferPct*100).toFixed(2)}%`);
  });

  it('respects custom tickSize when provided', () => {
    // FTSE 100 ticks 0.5 — chunky rounding
    const row = { price: 8050.0, atrRaw: 60.0, tickSize: 0.5 };
    const out = deriveTriggerStopTarget(row, 'LONG');
    // All outputs must be multiples of 0.5
    for (const [k, v] of Object.entries(out)) {
      assert.equal((v * 2) % 1, 0, `${k}=${v} not on 0.5 tick`);
    }
  });
});

// ---------------------------------------------------------------------------
// SHORT happy path
// ---------------------------------------------------------------------------

describe('deriveTriggerStopTarget — SHORT', () => {
  it('produces symmetric outputs vs LONG', () => {
    // lastClose=100, atrRaw=2 (Raschke / 0.5×ATR zone formula):
    //   trigger_high = 100
    //   trigger_low  = 100 - 2 × 0.5 = 99  (was 97 under old 3% formula)
    //   stop         = 100 + 2 × 1.5 = 103
    //   R            = 103 - 100 = 3
    //   target       = 100 - 3 × 3 = 91
    const row = { price: 100.0, atrRaw: 2.0 };
    const out = deriveTriggerStopTarget(row, 'SHORT');
    assert.deepEqual(out, {
      trigger_low: 99.0,
      trigger_high: 100.0,
      stop: 103.0,
      target: 91.0,
    });
  });

  it('keeps stop above trigger_high and target below trigger_low', () => {
    const row = { price: 250.0, atrRaw: 5.0 };
    const out = deriveTriggerStopTarget(row, 'SHORT');
    assert.ok(out.stop > out.trigger_high, 'SHORT stop must be above trigger_high');
    assert.ok(out.target < out.trigger_low, 'SHORT target must be below trigger_low');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — invalid inputs return null
// ---------------------------------------------------------------------------

describe('deriveTriggerStopTarget — invalid inputs return null', () => {
  it('null row → null', () => {
    assert.equal(deriveTriggerStopTarget(null, 'LONG'), null);
  });

  it('missing price → null', () => {
    assert.equal(deriveTriggerStopTarget({ atrRaw: 2.0 }, 'LONG'), null);
  });

  it('null price → null (NVDA-style failure mode)', () => {
    assert.equal(deriveTriggerStopTarget({ price: null, atrRaw: 2.0 }, 'LONG'), null);
  });

  it('zero price → null', () => {
    assert.equal(deriveTriggerStopTarget({ price: 0, atrRaw: 2.0 }, 'LONG'), null);
  });

  it('NaN price → null', () => {
    assert.equal(deriveTriggerStopTarget({ price: NaN, atrRaw: 2.0 }, 'LONG'), null);
  });

  it('Infinity price → null', () => {
    assert.equal(deriveTriggerStopTarget({ price: Infinity, atrRaw: 2.0 }, 'LONG'), null);
  });

  it('missing atr → null', () => {
    assert.equal(deriveTriggerStopTarget({ price: 100 }, 'LONG'), null);
  });

  it('zero atr → null (would produce trigger_low == stop)', () => {
    assert.equal(deriveTriggerStopTarget({ price: 100, atrRaw: 0 }, 'LONG'), null);
  });

  it('NaN atr → null', () => {
    assert.equal(deriveTriggerStopTarget({ price: 100, atrRaw: NaN }, 'LONG'), null);
  });

  it('invalid direction → null', () => {
    const row = { price: 100, atrRaw: 2 };
    assert.equal(deriveTriggerStopTarget(row, 'BOTH'), null);
    assert.equal(deriveTriggerStopTarget(row, 'WATCHLIST'), null);
    assert.equal(deriveTriggerStopTarget(row, ''), null);
  });
});

// ---------------------------------------------------------------------------
// Determinism — the whole point
// ---------------------------------------------------------------------------

describe('deriveTriggerStopTarget — determinism', () => {
  it('produces byte-identical output for byte-identical input across calls', () => {
    const row = { price: 261.41, atrRaw: 4.27 };
    const a = deriveTriggerStopTarget(row, 'LONG');
    const b = deriveTriggerStopTarget(row, 'LONG');
    const c = deriveTriggerStopTarget(row, 'LONG');
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });

  it('input mutation does not affect prior output', () => {
    const row = { price: 100, atrRaw: 2 };
    const out1 = deriveTriggerStopTarget(row, 'LONG');
    row.price = 999;
    row.atrRaw = 999;
    // out1 was computed before mutation — values must hold
    assert.equal(out1.trigger_low, 100);
    assert.equal(out1.trigger_high, 101);  // 100 + 0.5×2
    assert.equal(out1.target, 109);
  });
});

// ---------------------------------------------------------------------------
// roundToTick helper — direct tests for the rounding rule
// ---------------------------------------------------------------------------

describe('roundToTick', () => {
  it('rounds to 0.01 by default', () => {
    assert.equal(roundToTick(100.123, 0.01), 100.12);
    assert.equal(roundToTick(100.125, 0.01), 100.13); // banker's round on .5? JS uses round-half-to-even, but in this case lands at 100.13 due to FP rep
  });

  it('rounds to 0.5 ticks (FTSE)', () => {
    assert.equal(roundToTick(100.3, 0.5), 100.5);
    assert.equal(roundToTick(100.2, 0.5), 100.0);
    assert.equal(roundToTick(100.7, 0.5), 100.5);
  });

  it('returns value unchanged on invalid tick size', () => {
    assert.equal(roundToTick(100.123, 0), 100.123);
    assert.equal(roundToTick(100.123, NaN), 100.123);
    assert.equal(roundToTick(100.123, -0.01), 100.123);
  });
});
