/**
 * triggerDerivation.js — deterministic trigger / stop / target derivation
 * from scanner OHLCV + ATR data.
 *
 * Per docs/lean_scan_spec.md §4.6:
 *
 *   Two scans 2026-04-18 of identical Saturday-closed-market data
 *   produced different trigger_low/trigger_high/stop/target values for
 *   six C-grade rows despite temperature: 0. The LLM was introducing
 *   variation into fields that are a deterministic function of price
 *   data — a bug class, not a feature.
 *
 *   Fix: remove trigger/stop/target from the LLM JSON schema and
 *   compute them server-side from scanner OHLCV + ATR using the same
 *   formulas the backtest harness will use.
 *
 * Formula (matches the backtest harness draft; finalise when that lands):
 *
 *   LONG:
 *     trigger_low  = lastClose
 *     trigger_high = lastClose × 1.03
 *     stop         = trigger_low − ATR14 × 1.5
 *     R            = trigger_low − stop
 *     target       = trigger_low + R × 3
 *
 *   SHORT (symmetric):
 *     trigger_high = lastClose
 *     trigger_low  = lastClose × 0.97
 *     stop         = trigger_high + ATR14 × 1.5
 *     R            = stop − trigger_high
 *     target       = trigger_high − R × 3
 *
 * Round all outputs to the instrument's tick size (use scannerRow.tickSize
 * if available; fall back to 0.01 / 2 d.p. for equities).
 *
 * Cross-repo constraint: the Python backtest formula in
 * money-program-trading/src/backtest/replay_scanner.py and this JS formula
 * are now a coupled pair. A change in one must land with a matching change
 * in the other. Drift breaks live/backtest parity, which makes backtests
 * meaningless.
 */

const STOP_ATR_MULT = 1.5;
const REWARD_R_MULT = 3.0;
const ZONE_BUFFER_PCT = 0.03; // 3% zone width — buy-stop placed at +3% above pivot
const DEFAULT_TICK_SIZE = 0.01;

/**
 * Round a number to the nearest multiple of `tickSize`.
 *
 * Whole-tick rounding avoids flickery sub-tick numbers in the UI and
 * matches what the broker will actually accept on order entry.
 */
function roundToTick(value, tickSize) {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return value;
  }
  return Math.round(value / tickSize) * tickSize;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Derive trigger zone, stop, and target from a scanner row.
 *
 * @param {object} scannerRow scanner output for this ticker; must include
 *   at least `price` (lastClose) and `atrRaw` (ATR14 in price units).
 *   Optional: `tickSize` (defaults to 0.01).
 * @param {'LONG'|'SHORT'} direction
 * @returns {{trigger_low: number, trigger_high: number, stop: number, target: number} | null}
 *   null if required inputs are missing or non-finite.
 */
export function deriveTriggerStopTarget(scannerRow, direction) {
  if (!scannerRow || (direction !== 'LONG' && direction !== 'SHORT')) {
    return null;
  }
  // Scanner fallback fix from 2026-04-27: row.price is set via
  // meta.regularMarketPrice → meta.previousClose → last 1d close. Treat
  // it as the lastClose anchor for derivation.
  const lastClose = scannerRow.price;
  const atr14 = scannerRow.atrRaw;
  if (!isFiniteNumber(lastClose) || lastClose <= 0) return null;
  if (!isFiniteNumber(atr14) || atr14 <= 0) return null;

  const tickSize = isFiniteNumber(scannerRow.tickSize) && scannerRow.tickSize > 0
    ? scannerRow.tickSize
    : DEFAULT_TICK_SIZE;

  let triggerLow;
  let triggerHigh;
  let stop;
  let target;

  if (direction === 'LONG') {
    triggerLow = lastClose;
    triggerHigh = lastClose * (1 + ZONE_BUFFER_PCT);
    stop = triggerLow - atr14 * STOP_ATR_MULT;
    const R = triggerLow - stop;
    target = triggerLow + R * REWARD_R_MULT;
  } else {
    // SHORT — symmetric
    triggerHigh = lastClose;
    triggerLow = lastClose * (1 - ZONE_BUFFER_PCT);
    stop = triggerHigh + atr14 * STOP_ATR_MULT;
    const R = stop - triggerHigh;
    target = triggerHigh - R * REWARD_R_MULT;
  }

  // Round all numeric outputs to the tick size. Defensive: if rounding
  // produced a non-finite or invalid value (shouldn't happen with valid
  // inputs above, but ATR14 ≈ 0 edge cases), return null rather than
  // emit garbage.
  const out = {
    trigger_low: roundToTick(triggerLow, tickSize),
    trigger_high: roundToTick(triggerHigh, tickSize),
    stop: roundToTick(stop, tickSize),
    target: roundToTick(target, tickSize),
  };
  for (const v of Object.values(out)) {
    if (!isFiniteNumber(v) || v <= 0) return null;
  }

  // Direction-correctness invariants (defensive — should always hold).
  if (direction === 'LONG') {
    if (out.stop >= out.trigger_low) return null;
    if (out.target <= out.trigger_high) return null;
  } else {
    if (out.stop <= out.trigger_high) return null;
    if (out.target >= out.trigger_low) return null;
  }

  return out;
}

// Test hook — exported only so tests can poke at internals.
export const __test__ = {
  STOP_ATR_MULT,
  REWARD_R_MULT,
  ZONE_BUFFER_PCT,
  DEFAULT_TICK_SIZE,
  roundToTick,
};
