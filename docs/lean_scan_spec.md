# Spec: Lean Scan — strip the LLM narrative, collapse the UI

**Status:** Draft · 2026-04-17 · Revised 2026-04-18 (added §4.6 deterministic trigger/stop/target derivation)
**Author:** Mark / committee
**Target repo:** `swing-committee`
**Bumps:** none (LOG_SCHEMA v2 stays; handoff payload shape unchanged)

---

## 1. Problem

A single scan currently takes 3–5 minutes. The cost sits almost entirely in one LLM call:

- `app/api/analyze/route.js` → `client.messages.create` with `max_tokens: 12288`
- Prompt asks for a 7-part narrative analysis (PART A market regime, PART B positions, PART C watchlist, PART D three-committee-positions, PART E chair's decision, PART F decision journal, PART G pillar reminder)
- Only the embedded JSON block (`jsonData.trades[]`) is used downstream to build the scan handoff
- Parts A–G are rendered as "Report tabs" in the UI — prose that Mark confirms is dead weight ("if I want to read something I can do that manually")

~95% of generated tokens feed display-only surfaces. At Sonnet speed that's minutes of nothing useful.

**Second problem observed 2026-04-18.** Two scans of identical Saturday-closed-market data produced different `trigger_low`, `trigger_high`, `stop`, `target` values for six C-grade watchlist rows (AIG, AMZN, AVGO, BMY, CSX, JNJ). Grades, committee stance, and the B-grade bypass pick were stable; rationale strings were reworded as expected; but the numeric trigger/stop/target fields drifted by small amounts despite `temperature: 0`. This is LLM non-determinism leaking into fields that ought to be a pure function of OHLCV. Mechanical fields should not be LLM output at all — see §4.6.

## 2. Goal

Two goals, driving one rework:

1. **Latency.** Reduce scan time to **~30–60 seconds** by asking the LLM for structured output only, and collapse the UI to a single results screen that shows what matters.
2. **Determinism.** The LLM decides the *qualitative* fields (direction, grade, verdict, rationale). The *quantitative* fields (trigger zone, stop, target) are derived deterministically from the scanner row. Running the same scan twice with zero market change should yield byte-identical trigger/stop/target columns; only `rationale_one_liner` may vary.

Non-goal: changing the scan handoff file shape. `shortlist_entries`, `bypass_candidate_entries`, `emission_rejections`, `schema_version: 2` all stay exactly as today. Entry-rules does not need to re-verify anything.

## 3. What gets kept

- **Yahoo scanner stage (`/api/scanner`)** — unchanged. Still pulls universe, runs Six Pillars, returns ranked long/short/watchlist pools. This is the discovery layer and it's fine.
- **Market context layer (`/api/market-context`, `/api/market-pulse`, `/api/calendar`)** — unchanged. Still feeds the regime gate + MCL policy.
- **Scan handoff** (`lib/scanEmission.js`, `lib/priceAnchor.js`) — unchanged. All the v2 anchor + emission-rejection work we just shipped stays.
- **Bypass flow** — kept. User still picks 1–3 tickers; `downloadBypassScanJson` still stamps `gate_bypass: true` + `bypass_until` and downloads a separate file. Entry-rules-side bypass logic untouched.
- **Grade → risk ladder** (A+/A/B = 1%/0.75%/0.5%) — unchanged.

## 4. What gets cut

### 4.1 LLM output format

**Before:** `max_tokens: 12288`, prompt asks for prose Parts A–G plus embedded JSON.

**After:** `max_tokens: 2048`, prompt asks for a **single JSON object only**, no prose, no Parts. Claude's response should be pure JSON (or a `\`\`\`json` block, to tolerate mild wrapping).

Required JSON shape (qualitative fields only — trigger/stop/target are NOT in LLM output, they are server-derived per §4.6):

```json
{
  "committee": "WATCH" | "TAKE" | "STAND_ASIDE",
  "summary": "<≤200 char one-liner overall committee stance>",
  "trades": [
    {
      "ticker": "AMD",
      "direction": "LONG" | "SHORT",
      "grade": "A+" | "A" | "B" | "C" | "D",
      "verdict": "TAKE-TRADE" | "WATCHLIST" | "DAY-TRADE" | "SKIP",
      "rationale_one_liner": "<≤140 char summary: why this grade, what's the edge>"
    }
  ],
  "positionReviews": [],
  "positionSummary": null
}
```

Note: `positionReviews` and `positionSummary` are kept in the contract (emitted as empty) so `scanEmission.js` doesn't need schema changes. If/when we reintroduce open-position reasoning, they populate.

`rationale_one_liner` is the only prose field. It replaces the 7-part narrative entirely. It's the 1-liner the UI renders per candidate so Mark can eyeball why a grade was assigned. ≤140 chars — a tweet's worth.

`trigger_low`, `trigger_high`, `stop`, `target` are **deliberately absent** from the LLM schema. They are computed server-side after the LLM returns, using deterministic formulas against the scanner's OHLCV + ATR data. See §4.6 for the derivation module and the reasoning.

### 4.2 Prompt rewrite

`buildFullPrompt(formData, marketPulse, livePrices, scannerResults)` needs a rewrite. Keep the **context** (rules, pillars, regime, scanner results, live prices) but replace the **output instructions** with:

```
OUTPUT: respond with a single JSON object matching the schema below. No
preamble, no narrative parts, no report sections. JSON only. Every trade
must include a rationale_one_liner of ≤140 characters explaining the
grade in plain English.

DO NOT emit trigger_low, trigger_high, stop, or target. Those numbers are
derived by the server from the scanner row; LLM-emitted values would
introduce run-to-run drift. Your job is direction, grade, verdict, and
the rationale — the qualitative call. Arithmetic stays deterministic.

SCHEMA: { ... the shape above ... }
```

Temperature stays `0`. Models: **Sonnet only** (drop the Opus fallback — at the reduced token count Sonnet is never going to need it, and the fallback adds latency when Sonnet is just slow-not-failing). With trigger/stop/target removed, `max_tokens: 1536` is enough (~5–7 numeric fields × 20 trades ≈ 150 tokens saved per response); leave at 2048 for headroom.

### 4.3 `parseResponse` simplification

Current `parseResponse` builds a fat result object with `marketRegime`, `positionsReview`, `watchlistSignals`, `committeePositions`, `chairDecision`, `decisionJournal`, `pillarReminder`, `fullAnalysis` — all extracted via `extractSection(responseText, 'PART X', 'PART Y')`. All of these become dead fields.

**After:**

```js
function parseResponse(responseText, scannerResults = null) {
  const jsonData = extractJsonData(responseText)
  if (!jsonData) {
    throw new Error('LLM did not return valid JSON — scan aborted')
  }
  return {
    mode: jsonData.committee || 'STAND_ASIDE',
    summary: jsonData.summary || '',
    signals: convertJsonToSignals(jsonData, scannerResults),
    parsedPositions: jsonData.positionReviews || [],
    positionSummary: jsonData.positionSummary || null,
  }
}
```

- Drop `marketRegime`, `positionsReview`, `watchlistSignals`, `committeePositions`, `chairDecision`, `decisionJournal`, `pillarReminder`, `fullAnalysis` from the returned object.
- Delete `extractSection`, `extractCommitteeStance`, `extractSummary`, `extractSignals` (non-JSON fallback extractors). JSON failure is now fatal — previously we'd silently fall back to prose-scraping, which we no longer need.
- `extractJsonData` stays. `convertJsonToSignals` stays and must:
  1. Pick up the new `rationale_one_liner` field and attach it to each signal (so the UI can render it).
  2. For each trade, look up the matching scanner row by ticker and call `deriveTriggerStopTarget(row, direction)` (new module — see §4.6). Merge the returned `{trigger_low, trigger_high, stop, target}` onto the signal. If the scanner row is missing or derivation returns `null`, drop the trade and log a rejection (mirrors the existing emission-rejection path).

### 4.4 UI collapse

In `components/SwingCommitteeApp.jsx`:

- **Delete** the entire `Report Tabs` block (currently rendering Summary / Market Regime / Positions Review / Watchlist / Committee Positions / Chair's Decision / Decision Journal / Pillar Reminder tabs).
- **Keep** the scan form (instrument toggles, watchlist tickers, regime inputs) — unchanged.
- **Keep** the scan handoff block (download button + bypass ticker picker) — unchanged.
- **Replace** the report tabs area with a single compact candidates table:

  | col | source |
  |---|---|
  | symbol | `signal.ticker` |
  | dir | LONG / SHORT |
  | grade | A+ / A / B / C / D (colour-coded) |
  | trigger | `trigger_low – trigger_high` |
  | stop | `signal.stop` |
  | target | `signal.target` |
  | why | `signal.rationale_one_liner` (≤140 chars, word-wrapped) |

  Sort: grade descending (A+ first), then by `score` from scanner.

  **Word-wrap for the `why` column:** do **not** truncate or ellipsis-clip. Let the full rationale wrap into a paragraph within its cell (`whitespace-normal`, `leading-snug`, no `max-height`). The row grows vertically to fit. Other columns (symbol, dir, grade, trigger, stop, target) stay single-line and vertically top-aligned so the row reads cleanly even when `why` wraps to 2–3 lines. Rationale for wrapping over ellipsis: the 1-liner is the only prose on the page and Mark reads it to sanity-check grades — truncating defeats that.

- **Keep** the committee-stance header ("WATCH / TAKE / STAND ASIDE") and the one-liner `summary`.
- Everything else in the right-hand report panel goes.

### 4.5 Model fallback

Drop the Opus fallback in `analyze/route.js`. Keep:

- Sonnet primary, 2 retries on 429/529/503 with exponential backoff (5s, 10s)
- On final failure, return 503 with a clear error. No silent degradation.

### 4.6 Deterministic trigger / stop / target derivation

**Evidence this is needed.** Two scans 2026-04-18, Saturday, markets closed, scanner inputs effectively unchanged. Grade distribution and committee stance identical across runs. The single B-grade bypass pick (IMB) was byte-identical on trigger/stop/target. CSCO was identical. But six C-grade watchlist rows (AIG, AMZN, AVGO, BMY, CSX, JNJ) had different numeric trigger zones and/or stops and/or targets. The LLM — at `temperature: 0` — is introducing variation into fields that are a deterministic function of price data. That's a bug class, not a feature.

**Fix.** Remove `trigger_low`, `trigger_high`, `stop`, `target` from the LLM JSON schema (done in §4.1). Compute them server-side from scanner OHLCV + ATR using the same formulas the backtest harness will use (see `/Users/mark.sear/CoWork/entry-rules/money-program-trading/docs/backtest_harness_spec.md`). One formula, one source of truth, live and backtest agree.

**New module: `lib/triggerDerivation.js`.**

```js
/**
 * Derive trigger zone, stop, and target from a scanner row.
 * Must stay in lockstep with src/backtest/replay_scanner.py so live
 * and backtest produce identical numbers for identical OHLCV input.
 *
 * @param {object} scannerRow  scanner output for this ticker; must
 *   include at least lastClose and atr14. Other fields (tickSize,
 *   priceUnit) used if present.
 * @param {'LONG'|'SHORT'} direction
 * @returns {{trigger_low, trigger_high, stop, target} | null}
 *   null if required inputs are missing or non-finite.
 */
export function deriveTriggerStopTarget(scannerRow, direction) {
  // Implementation is a thin wrapper around the canonical formula.
  // Exact numbers (buffer %, ATR multiple, R multiple) MUST match the
  // Python backtest replay. If the backtest spec changes the formula,
  // change it here in the same PR — do not let the two drift.
}
```

**Starting formula** (matches the backtest harness draft; finalise when that lands):

```
LONG:
  trigger_low  = lastClose
  trigger_high = lastClose × 1.03
  stop         = trigger_low − ATR14 × 1.5
  R            = trigger_low − stop
  target       = trigger_low + R × 3

SHORT: symmetric
  trigger_high = lastClose
  trigger_low  = lastClose × 0.97
  stop         = trigger_high + ATR14 × 1.5
  R            = stop − trigger_high
  target       = trigger_high − R × 3
```

Round all outputs to the instrument's tick size (use `scannerRow.tickSize` if available; fall back to 2 d.p. for equities). Whole-tick rounding avoids flickery sub-tick numbers in the UI.

**Where it's called.** `convertJsonToSignals` in `app/api/analyze/route.js`:

```js
for (const trade of jsonData.trades) {
  const row = findScannerRowByTicker(scannerResults, trade.ticker)
  if (!row) { emissionRejections.push({ticker: trade.ticker, reason: 'SCANNER_ROW_MISSING'}); continue }
  const levels = deriveTriggerStopTarget(row, trade.direction)
  if (!levels) { emissionRejections.push({ticker: trade.ticker, reason: 'DERIVATION_FAILED'}); continue }
  signals.push({
    ...trade,
    ...levels,                           // trigger_low, trigger_high, stop, target
    rationale_one_liner: trade.rationale_one_liner,
    score: row.score,                    // for UI sort
  })
}
```

**What stays in the LLM's hands.** Direction (LONG/SHORT), grade (A+/A/B/C/D), verdict (TAKE-TRADE/WATCHLIST/DAY-TRADE/SKIP), one-liner rationale. That's the "cognitive work" — *is this a setup? how good? why?*. The LLM keeps the judgment; arithmetic moves off its plate.

**Consequences:**
- Run-to-run stability: given byte-identical scanner output, the trigger/stop/target columns across the candidates table are byte-identical. Only the grade, verdict, and rationale can drift. That drift is acceptable — we can measure it.
- Live/backtest parity: the same `(ticker, OHLCV)` input produces the same `(trigger_low, trigger_high, stop, target)` whether it's a live scan or a 60-day replay. This is what makes backtesting meaningful.
- Token savings: LLM emits ~4 fewer numeric fields × ~20 trades ≈ ~80–150 fewer tokens per response. Small but free.
- Better error surface: if derivation fails (missing ATR14, weird price), we log an emission-rejection with a clear reason code instead of the LLM silently producing a bad number.

**Risk.** If the deterministic formula is wrong for a given market condition (e.g. gap days where `close` isn't a sensible trigger anchor), every trade is uniformly wrong. Mitigation: backtest the formula against 60 days of real setups before making it the only code path. If the harness shows the formula systematically mis-triggers, refine the formula — don't fall back to LLM-emitted numbers.

**Dependency on backtest harness.** This section should ship *together with* or *after* the Python harness derivation so the two can be asserted equal by test. Sequencing:
1. Backtest harness lands (Sunday 2026-04-19) with the Python formula.
2. Port the same formula into `lib/triggerDerivation.js`.
3. A test fixture: 10 scanner rows with known OHLCV, hand-computed expected outputs; both JS and Python implementations produce identical numbers.
4. Ship lean scan with derivation in place.

If the harness slips, the lean scan can still ship the *schema* changes (drop trigger/stop/target from LLM) but needs a temporary JS-only derivation until the harness catches up. Don't ship lean-scan without derivation — that would leave the candidates table with missing columns.

## 5. Files touched

### swing-committee

- `app/api/analyze/route.js` — rewrite `buildFullPrompt` (remove trigger/stop/target from schema, add "do not emit arithmetic" instruction), simplify `parseResponse`, drop Opus fallback, drop `extractSection`/`extractCommitteeStance`/`extractSummary`/`extractSignals`; update `convertJsonToSignals` to merge server-derived trigger/stop/target per §4.6
- `lib/triggerDerivation.js` — **new** module per §4.6. Pure function, no side effects. Must match the backtest harness Python formula exactly.
- `components/SwingCommitteeApp.jsx` — delete Report Tabs JSX + associated state; add candidates table component
- `lib/scanEmission.js` — ensure `rationale_one_liner` flows through into `ShortlistEntry` if we want it in the handoff (**optional**, see §7)
- Tests:
  - new `app/api/analyze/analyze.test.mjs` asserting the lean prompt contract + parse happy path
  - new `lib/triggerDerivation.test.mjs` — 6+ cases covering LONG/SHORT/malformed/edge rounding
  - new `lib/liveBacktestParity.test.mjs` — shared fixture (10 scanner rows) asserts JS `deriveTriggerStopTarget` output matches a JSON snapshot produced by the Python harness

### entry-rules

- None. Schema contract unchanged.
- **Cross-repo constraint:** the Python backtest formula in `src/backtest/replay_scanner.py` and the JS formula in `lib/triggerDerivation.js` are now a coupled pair. A change in one must land with a matching change in the other.

## 6. Does `rationale_one_liner` belong in the scan handoff?

**Two options. Prefer A.**

**Option A (default): UI-only.** The one-liner is only used by the web UI for sanity-check display. Not attached to `ShortlistEntry`. Entry-rules doesn't see it. Cleanest: no pydantic change, no v3 bump.

**Option B: also ship to entry-rules.** Add `rationale_one_liner` as an optional v2-additive field on `ShortlistEntry` (same pattern as `price_source`). Entry-rules journal could then show the grade rationale alongside each trigger. Adds noise, not clearly load-bearing, can be bolted on later.

Go with A for now.

## 7. Tests

- `analyze.test.mjs` — given a mocked Anthropic response (pure JSON, no trigger/stop/target fields), `parseResponse` produces `{mode, summary, signals, parsedPositions, positionSummary}` with no report-section fields.
- `analyze.test.mjs` — given a malformed response (no JSON block), `parseResponse` throws and `/api/analyze` returns a 500 with a readable error.
- `analyze.test.mjs` — given a JSON response with 3 trades, each with a `rationale_one_liner`, `convertJsonToSignals` attaches the field to each signal AND merges server-derived trigger/stop/target from a mocked scanner row.
- `analyze.test.mjs` — given a trade whose ticker isn't in the scanner results, `convertJsonToSignals` drops it and adds an `emissionRejections` entry with reason `SCANNER_ROW_MISSING`.
- `triggerDerivation.test.mjs` — LONG case with known OHLC+ATR produces expected trigger_low/high/stop/target to 2 d.p.
- `triggerDerivation.test.mjs` — SHORT case (symmetric) produces expected values.
- `triggerDerivation.test.mjs` — missing `lastClose` returns `null`.
- `triggerDerivation.test.mjs` — missing `atr14` returns `null`.
- `triggerDerivation.test.mjs` — non-finite input (NaN, Infinity) returns `null`.
- `triggerDerivation.test.mjs` — tickSize rounding: row with `tickSize: 0.01` vs `tickSize: 0.5` produces different rounded outputs.
- `liveBacktestParity.test.mjs` — load a shared JSON fixture (10 rows with OHLCV + expected outputs), assert every row's JS-derived output matches the Python harness snapshot exactly. Fails loudly if either formula drifts.
- All existing `lib/scanEmission.test.mjs` + `lib/priceAnchor.test.mjs` tests must still pass unchanged (66 tests today).

## 8. Rollout

1. Land the lean spec on a branch (`lean-scan`).
2. Merge → Vercel auto-deploys.
3. Manual check on next scan: timer in DevTools Network tab for `/api/analyze` — expect ~30–60s not 3–5 min.
4. Confirm the downloaded `scan_*.json` is byte-identical in shape (diff against a pre-merge scan for the same universe). Schema version still `2`, `shortlist_entries` still populated, `emission_rejections` still present (if flag on).
5. If anything in the entry-rules ingest barks, revert — we know how to do that surgically.

No feature flag this time. The cut is large enough that flag-gating both paths doubles the maintenance surface with no upside.

## 9. What this does NOT touch

- `lib/priceAnchor.js` — stays.
- `lib/scanEmission.js` — stays (unless we go Option B for the one-liner).
- Entry-rules repo — stays.
- `/api/scanner` (Yahoo Six Pillars filter) — stays.
- Bypass flow — stays.

## 10. Checklist for Claude Code

**Prerequisite:** Python backtest harness (§4.6) has shipped with the canonical trigger/stop/target formula, OR implement a JS-only formula in this PR and flag the Python port as a follow-up in the backtest-harness session.

- [ ] Rewrite `buildFullPrompt` to request JSON-only output with the schema in §4.1 (no trigger/stop/target fields)
- [ ] Add the "do not emit arithmetic" instruction per §4.2
- [ ] Reduce `max_tokens` to `2048`
- [ ] Drop Opus fallback; keep Sonnet with 2 retries
- [ ] Rewrite `parseResponse` per §4.3
- [ ] Create `lib/triggerDerivation.js` implementing the §4.6 formula (match the Python harness exactly)
- [ ] Update `convertJsonToSignals` to look up scanner row by ticker and merge derived trigger/stop/target per §4.6
- [ ] Ensure `convertJsonToSignals` propagates `rationale_one_liner` onto each signal
- [ ] Ensure missing-scanner-row and derivation-failure cases produce `emissionRejections` entries (don't silently drop)
- [ ] Delete `extractSection`, `extractCommitteeStance`, `extractSummary`, `extractSignals` (dead code after this change)
- [ ] Delete Report Tabs block in `SwingCommitteeApp.jsx`; add compact candidates table
- [ ] Write `app/api/analyze/analyze.test.mjs` with the four test cases in §7
- [ ] Write `lib/triggerDerivation.test.mjs` with the six+ test cases in §7
- [ ] Write `lib/liveBacktestParity.test.mjs` — requires a shared fixture from the backtest harness
- [ ] Verify `npm test` passes (existing 66 + new tests)
- [ ] Verify scan handoff file shape is byte-identical for a fixed scanner input (before/after diff)
- [ ] **Determinism check:** run the lean scan twice on a closed-market day with the same scanner input; confirm the trigger/stop/target columns are byte-identical across both runs. The 2026-04-18 drift (AIG/AMZN/AVGO/BMY/CSX/JNJ) must not reproduce.
