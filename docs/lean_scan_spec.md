# Spec: Lean Scan — strip the LLM narrative, collapse the UI

**Status:** Draft · 2026-04-17
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

## 2. Goal

Reduce the scan time to **~30–60 seconds** by asking the LLM for structured output only, and collapse the UI to a single results screen that shows what matters.

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

Required JSON shape (identical semantics to today's `jsonData`, just without the surrounding narrative):

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
      "trigger_low": 155.20,
      "trigger_high": 158.40,
      "stop": 150.00,
      "target": 170.00,
      "rationale_one_liner": "<≤140 char summary: why this grade, what's the edge>"
    }
  ],
  "positionReviews": [],
  "positionSummary": null
}
```

Note: `positionReviews` and `positionSummary` are kept in the contract (emitted as empty) so `scanEmission.js` doesn't need schema changes. If/when we reintroduce open-position reasoning, they populate.

`rationale_one_liner` is the only prose field. It replaces the 7-part narrative entirely. It's the 1-liner the UI renders per candidate so Mark can eyeball why a grade was assigned. ≤140 chars — a tweet's worth.

### 4.2 Prompt rewrite

`buildFullPrompt(formData, marketPulse, livePrices, scannerResults)` needs a rewrite. Keep the **context** (rules, pillars, regime, scanner results, live prices) but replace the **output instructions** with:

```
OUTPUT: respond with a single JSON object matching the schema below. No
preamble, no narrative parts, no report sections. JSON only. Every trade
must include a rationale_one_liner of ≤140 characters explaining the
grade in plain English.

SCHEMA: { ... the shape above ... }
```

Temperature stays `0`. Models: **Sonnet only** (drop the Opus fallback — at 2k tokens Sonnet is never going to need it, and the fallback adds latency when Sonnet is just slow-not-failing).

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
- `extractJsonData` stays. `convertJsonToSignals` stays and must pick up the new `rationale_one_liner` field and attach it to each signal (so the UI can render it).

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
  | why | `signal.rationale_one_liner` (≤140 chars, ellipsis on overflow) |

  Sort: grade descending (A+ first), then by `score` from scanner.

- **Keep** the committee-stance header ("WATCH / TAKE / STAND ASIDE") and the one-liner `summary`.
- Everything else in the right-hand report panel goes.

### 4.5 Model fallback

Drop the Opus fallback in `analyze/route.js`. Keep:

- Sonnet primary, 2 retries on 429/529/503 with exponential backoff (5s, 10s)
- On final failure, return 503 with a clear error. No silent degradation.

## 5. Files touched

### swing-committee

- `app/api/analyze/route.js` — rewrite `buildFullPrompt`, simplify `parseResponse`, drop Opus fallback, drop `extractSection`/`extractCommitteeStance`/`extractSummary`/`extractSignals`
- `components/SwingCommitteeApp.jsx` — delete Report Tabs JSX + associated state; add candidates table component
- `lib/scanEmission.js` — ensure `rationale_one_liner` flows through into `ShortlistEntry` if we want it in the handoff (**optional**, see §7)
- Tests: new `app/api/analyze/analyze.test.mjs` asserting the lean prompt contract + parse happy path

### entry-rules

- None. Schema contract unchanged.

## 6. Does `rationale_one_liner` belong in the scan handoff?

**Two options. Prefer A.**

**Option A (default): UI-only.** The one-liner is only used by the web UI for sanity-check display. Not attached to `ShortlistEntry`. Entry-rules doesn't see it. Cleanest: no pydantic change, no v3 bump.

**Option B: also ship to entry-rules.** Add `rationale_one_liner` as an optional v2-additive field on `ShortlistEntry` (same pattern as `price_source`). Entry-rules journal could then show the grade rationale alongside each trigger. Adds noise, not clearly load-bearing, can be bolted on later.

Go with A for now.

## 7. Tests

- `analyze.test.mjs` — given a mocked Anthropic response (pure JSON), `parseResponse` produces `{mode, summary, signals, parsedPositions, positionSummary}` with no report-section fields.
- `analyze.test.mjs` — given a malformed response (no JSON block), `parseResponse` throws and `/api/analyze` returns a 500 with a readable error.
- `analyze.test.mjs` — given a JSON response with 3 trades, each with a `rationale_one_liner`, `convertJsonToSignals` attaches the field to each signal.
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

- [ ] Rewrite `buildFullPrompt` to request JSON-only output with the schema in §4.1
- [ ] Reduce `max_tokens` to `2048`
- [ ] Drop Opus fallback; keep Sonnet with 2 retries
- [ ] Rewrite `parseResponse` per §4.3
- [ ] Ensure `convertJsonToSignals` propagates `rationale_one_liner` onto each signal
- [ ] Delete `extractSection`, `extractCommitteeStance`, `extractSummary`, `extractSignals` (dead code after this change)
- [ ] Delete Report Tabs block in `SwingCommitteeApp.jsx`; add compact candidates table
- [ ] Write `app/api/analyze/analyze.test.mjs` with the three test cases in §7
- [ ] Verify `npm test` passes (existing 66 + new tests)
- [ ] Verify scan handoff file shape is byte-identical for a fixed scanner input (before/after diff)
