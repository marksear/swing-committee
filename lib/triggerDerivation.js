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
 * Formula (Raschke / Masterclass canonical: zone width is a multiple of
 * ATR, not a fixed percent — buffer scales with each stock's natural
 * volatility):
 *
 *   LONG:
 *     trigger_low  = lastClose
 *     trigger_high = lastClose + ATR14 × 0.5
 *     stop         = trigger_low − ATR14 × 1.5
 *     R            = trigger_low − stop
 *     target       = trigger_low + R × 3
 *
 *   SHORT (symmetric):
 *     trigger_high = lastClose
 *     trigger_low  = lastClose − ATR14 × 0.5
 *     stop         = trigger_high + ATR14 × 1.5
 *     R            = stop − trigger_high
 *     target       = trigger_high − R × 3
 *
 * Why ATR-based zone width instead of fixed 3% (Mark 2026-04-28):
 *   - Adapts to each stock's natural volatility — KO ($80 stock) gets a
 *     tight buffer, NVDA / TSLA get proportionally wider ones.
 *   - Aligns with Raschke / Minervini "natural volatility unit" framing.
 *   - Cuts the "distance to fire" by ~2-3× for typical-ATR stocks, making
 *     intraday-managed swing entries achievable in the 09:45–15:55 ET
 *     window. The fixed-3% formula was producing breakouts that needed
 *     full-session moves to fire (NVDA: +5.77 needed = 2.7% from current).
 *   - Improves R:R at fill from ~1.3:1 to ~2.2:1 (Task #63) — closer to
 *     the desk reference's 3:1 minimum.
 *
 * Tightened 2026-04-29 (LBR-aligned for intraday-managed profile):
 *   - Multiplier reduced from 0.5 → 0.35 ATR (a "third of a natural
 *     volatility unit" instead of a half).
 *   - Rationale: 0.5×ATR is the canonical buffer for MULTI-DAY swing
 *     trades where you have 2–3 days for confirmation. For same-day
 *     intraday-managed entries (09:45–15:55 ET), 0.5×ATR eats ~1/3 of
 *     the typical move before the strict-break gate fires. LMT today
 *     2026-04-29 is the case study: pivot 512.29, breakdown started
 *     ~10:00 ET, but trigger_low (503.90) wasn't crossed until 10:39 ET
 *     — by which time most of the move was gone.
 *   - 0.35×ATR is still a meaningful break (LMT example: $5.87 below
 *     pivot, well outside tick-noise) but fires materially earlier:
 *     LMT trigger_low becomes 506.42 instead of 503.90, R:R at fill
 *     rises from 2.00:1 to 2.24:1.
 *   - Rule 22 strict-break discipline is unchanged — the formula
 *     places trigger_low closer to the pivot, but the strict-break
 *     check (`last < trigger_low` for SHORT) still applies. No
 *     "any tick in zone fires" weakening per feedback_trigger_semantics.
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
const ZONE_BUFFER_ATR_MULT = 0.35; // third-of-ATR buffer — LBR-aligned for intraday-managed (was 0.5 swing-style)
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
    triggerHigh = lastClose + atr14 * ZONE_BUFFER_ATR_MULT;
    stop = triggerLow - atr14 * STOP_ATR_MULT;
    const R = triggerLow - stop;
    target = triggerLow + R * REWARD_R_MULT;
  } else {
    // SHORT — symmetric
    triggerHigh = lastClose;
    triggerLow = lastClose - atr14 * ZONE_BUFFER_ATR_MULT;
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
  ZONE_BUFFER_ATR_MULT,
  DEFAULT_TICK_SIZE,
  roundToTick,
};
