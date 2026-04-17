# Spec: IG-Anchored Price Grounding for Scan Emission

**Status:** Draft · 2026-04-17
**Author:** Mark / committee
**Target repo:** `swing-committee` (Next.js / Vercel)
**Paired work in:** `entry-rules/money-program-trading` (scan_anchor already landed)
**Bumps:** `LOG_SCHEMA_VERSION` 1 → 2, `rule_set_version`

---

## 1. Problem

The LLM fabricates entry/stop/target levels. When the LLM's internal price is stale or wrong, the emitted `ShortlistEntry` is unusable on the execution side.

**Canonical incident (2026-04-15 DEMO run):**

- LLM emitted AMD `entry=$138–$140`, `stop=$135`, `target=$145`.
- IG quoted AMD at ~$155 at the moment the scan was ingested.
- The gap wasn't bad LLM judgment — it was a stale price model. Levels that anchor on $138 when the market is at $155 will never trigger, will whipsaw, or will fill on a stop immediately.

`entry-rules` now guards against this with **scan_anchor** (`src/engine/scan_anchor.py`): every shortlist entry's trigger-zone midpoint is checked against IG's current last-traded, and entries with >15% drift are rejected before they become candidates. That's a defensive band-aid. It catches the damage but doesn't fix the source.

**This spec fixes the source.** The swing-committee emits ShortlistEntry levels that are already anchored to a real, timestamped quote from the same side of the data fence as execution. Drift rejections should be 0 in steady state; any non-zero rate indicates clock skew or an outage, not an LLM error.

---

## 2. Current emission path

Scan handoff is built by `lib/scanEmission.js`:

1. `app/api/analyze/route.js` calls the LLM, parses text into `signals[]` via `parseResponse`.
2. `buildScanPayload({ formData, scannerResults, analysisResult, ... })` takes those parsed signals and maps each qualifying one through `toShortlistEntry(signal, ctx)` — see `lib/scanEmission.js:328`.
3. `toShortlistEntry` parses LLM-authored strings (`signal.entry`, `signal.stop`, `signal.target`) into floats via `parseTriggerZone` / `parseNumber`, derives sizing, and returns the wire-shape object.
4. The payload is returned in the HTTP response; the user downloads `scan_YYYYMMDD.json` which is consumed by `entry-rules/session_init.py`.

**`lib/universe.js`** is the canonical ticker list (US_STOCKS ~125 names, UK_STOCKS ~52, UK_STOCKS_250 ~48).

**`app/api/prices/route.js`** already fetches prices from Yahoo Finance for display purposes. It is **not called** during scan emission — the LLM prompt has "live prices" injected into it (`buildFullPrompt` accepts `livePrices`), but there is no post-hoc ground-truthing of the LLM's returned levels.

---

## 3. What "anchored" means

Before a `ShortlistEntry` is emitted, we attach a fresh quote for its symbol and validate the LLM's trigger zone against that quote. Three outcomes:

| outcome | action |
|---|---|
| LLM trigger-zone midpoint within `max_drift_pct` (default 15%) of reference price | emit entry; attach `price_source`, `reference_last_traded`, `price_as_of_utc` |
| drift exceeds threshold | **drop the entry** at emit time; log to `scan_record.emission_rejections[]` |
| no quote available (feed error / outside hours / unknown symbol) | drop the entry; log rejection with reason `NO_REFERENCE_QUOTE` |

**Key decision — we drop, not recenter.** If the LLM's zone is miles off, recentering it implies we understand the setup better than the LLM. We don't. A dropped entry is safer than a rewritten one; the LLM will get another chance tomorrow.

---

## 4. Price source: Yahoo (now) → IG (later)

Three candidates:

- **Yahoo Finance** (existing, via `app/api/prices/route.js`). Free, no auth, already integrated. Delayed ~15 min on some symbols but good enough for a drift check. Best starting point.
- **IG REST snapshot** (via `entry-rules`). Ground truth because execution will quote the same feed. Requires server-side IG credentials in Vercel's env, plus rate-limit handling (30 req/min hard cap on IG). Worth adopting later but not day 1.
- **Finnhub** (not yet integrated). Good free tier, but adds a new dependency; punt to Session 10 if we want tick-level freshness without IG complexity.

**Recommendation:** start with Yahoo. Document the `price_source` field so entry-rules can distinguish Yahoo-anchored scans from IG-anchored scans later. The drift check on the entry-rules side (which *does* use IG) already catches Yahoo↔IG divergence; this spec's goal is to drastically reduce the rate at which that check fires.

Switching to IG later is additive — `price_source` just becomes `"ig_snapshot"` instead of `"yahoo_chart"`, and the default drift threshold on the entry-rules side can tighten from 15% to 5%.

---

## 5. Schema changes

### 5.1 `ShortlistEntry` — additive fields

Add three fields to the object returned by `toShortlistEntry`:

```js
{
  // ...existing fields...
  price_source: "yahoo_chart",        // enum: "yahoo_chart" | "ig_snapshot" | "finnhub" | "none"
  price_as_of_utc: "2026-04-17T14:32:01Z",
  reference_last_traded: 155.42,      // float, in the same currency as the trigger zone
}
```

All three are **nullable** to keep backward compat with older scan files. When `price_source === "none"`, the other two are null and the entry should be treated as pre-grounding (ingested only for replay purposes).

### 5.2 `ScanRecord.emission_rejections[]` — new array

Add a top-level field to the scan record to surface drop reasons. This is the emission-side counterpart of `scan_anchor`'s ingest-side rejections:

```js
{
  // ...existing scanRecord fields...
  emission_rejections: [
    {
      symbol: "AMD",
      direction: "LONG",
      grade: "A",
      reason: "DRIFT_OVER_THRESHOLD",    // enum below
      llm_trigger_mid: 139.00,
      reference_last_traded: 155.42,
      drift_pct: 0.106,
      price_source: "yahoo_chart",
      price_as_of_utc: "2026-04-17T14:32:01Z",
    },
    // ...
  ],
}
```

**`reason` enum:** `DRIFT_OVER_THRESHOLD` · `NO_REFERENCE_QUOTE` · `STALE_QUOTE` · `CURRENCY_MISMATCH`.

### 5.3 Version bumps

- `LOG_SCHEMA_VERSION` in `lib/scanEmission.js:37`: `1` → `2`.
- `src/models/session_record.py` on entry-rules side: matching bump.
- `rule_set_version` (SHA-based, env-provided) automatically rolls when the deploy lands.

Ingest on the entry-rules side must accept both v1 and v2 scans for a transition window so backtests and in-flight scan files don't break. v1 scans will simply have all three new fields absent → treated as "pre-grounding".

---

## 6. Implementation

### 6.1 New file: `lib/priceAnchor.js`

Pure transform + fetcher. Takes a list of tickers, returns a `Map<string, { last: number, asOfUtc: string, source: string, currency: string }>`.

```js
export async function fetchAnchorQuotes(tickers, { source = "yahoo_chart", concurrency = 8 } = {}) {
  // batch-dispatch to /api/prices or a direct fetcher
  // return Map, missing tickers absent from map
}

export function evaluateDrift({ llmTriggerMid, reference, maxDriftPct = 0.15 }) {
  if (reference == null || reference <= 0) return { ok: false, reason: "NO_REFERENCE_QUOTE" };
  const drift = Math.abs(llmTriggerMid - reference) / reference;
  if (drift > maxDriftPct) return { ok: false, reason: "DRIFT_OVER_THRESHOLD", drift };
  return { ok: true, drift };
}

export function stalenessOk(asOfUtc, { maxAgeSec = 600 } = {}) {
  // Market-hours-aware: tolerate longer staleness outside RTH.
}
```

Keep it side-effect-free where possible so it is unit-testable. The fetch path internally calls the existing `/api/prices` route (avoid duplicating the Yahoo URL construction).

### 6.2 Modify `lib/scanEmission.js`

Turn `buildScanPayload` into an async function (it is currently sync). Before the `.map(toShortlistEntry)` step:

1. Compute the set of tickers that would otherwise produce a ShortlistEntry.
2. Call `fetchAnchorQuotes(tickers)`.
3. Inside `toShortlistEntry`, look up the anchor for `signal.ticker`:
   - no anchor → push rejection `NO_REFERENCE_QUOTE`, return `null`.
   - `stalenessOk` false → push rejection `STALE_QUOTE`, return `null`.
   - `currency !== expected(signal.ticker)` → `CURRENCY_MISMATCH`, return `null`.
   - `evaluateDrift` false → push rejection `DRIFT_OVER_THRESHOLD`, return `null`.
   - otherwise → attach `price_source`, `price_as_of_utc`, `reference_last_traded` and return the entry.
4. Collect all rejections into `scanRecord.emission_rejections`.

**Anchor price scale for UK GBp symbols** — Yahoo returns UK stocks in pence (GBp). The LLM sometimes emits GBP and sometimes GBp. Decide one canon (GBp, matching IG's native scaling) and coerce both inputs to it before drift comparison. Log `CURRENCY_MISMATCH` when the LLM clearly drifted to the wrong scale (>1000% drift → scale mismatch, not genuine drift).

### 6.3 Modify `app/api/analyze/route.js`

`buildScanPayload` is now async → `await` it. No other changes here.

### 6.4 Dev-only flag

Add `process.env.PRICE_ANCHOR_ENABLED` (default `true` in production, toggle via Vercel env for staging). When `false`, emit v1 behaviour (no anchors, no rejections array). Useful for A/B comparison during the first week post-deploy.

---

## 7. Entry-rules compatibility

On the entry-rules side:

- `src/models/shortlist_entry.py` adds three optional fields (`price_source: str | None`, `price_as_of_utc: datetime | None`, `reference_last_traded: float | None`). Optional → ingest accepts v1 scans.
- `src/models/scan_record.py` adds optional `emission_rejections: list[EmissionRejection] | None`.
- `src/ingestion/scan_anchor.py` — when `price_source == "yahoo_chart"` keep the existing 15% drift guard; when `price_source == "ig_snapshot"` tighten to 5%. When `price_source is None` (legacy scan) keep current behaviour.
- `session_init.py` — surface `emission_rejections` in the scan ingest summary line alongside the existing `scan_anchor` rejections. These are two different rejection surfaces and should be logged distinctly.

---

## 8. Test plan

### 8.1 Unit (swing-committee)

- `lib/priceAnchor.test.js`: `evaluateDrift` edge cases (zero reference, negative, exact threshold); `stalenessOk` across market hours; currency normalisation (GBp ↔ GBP).
- `lib/scanEmission.test.js`: given a fixture of LLM signals + mock anchor map, assert:
  - entries within threshold pass through with anchor fields attached
  - entries over threshold are absent from `shortlistEntries` and present in `emission_rejections`
  - `NO_REFERENCE_QUOTE` and `STALE_QUOTE` paths tested
  - `LOG_SCHEMA_VERSION` serialised as 2

### 8.2 Integration (swing-committee)

- Run `app/api/analyze` against a fixture of scannerResults covering the AMD@278-vs-IG incident shape. Assert the AMD row is rejected at emission with `DRIFT_OVER_THRESHOLD`.
- Run a real LLM call with `PRICE_ANCHOR_ENABLED=true` against today's universe; assert zero crashes and a non-empty `emission_rejections` (empty is suspicious — either the LLM is perfectly aligned, or anchoring isn't running).

### 8.3 End-to-end (DEMO)

On the entry-rules side, after the next DEMO scan that uses a v2 payload:

- `scan_anchor` ingest-side drift rejections should drop to 0 or near-0.
- `scan_record.emission_rejections.length` should be visible in `session_init.py` summary output and non-zero on a typical day.
- Any entry with `price_source == "yahoo_chart"` that *does* get rejected by `scan_anchor` is a real Yahoo-vs-IG divergence — investigate manually the first few times to calibrate.

**Acceptance:** after one DEMO week, the daily `scan_anchor` rejection count averages < 1 per scan. (Current DEMO baseline: ~2–4 per scan.)

---

## 9. Rollout

1. Branch `price-grounding-v2` off main.
2. Land `lib/priceAnchor.js` + unit tests (no behaviour change yet, no schema bump).
3. Wire through `scanEmission.js` behind `PRICE_ANCHOR_ENABLED=false`. Bump `LOG_SCHEMA_VERSION` to 2 in the same PR.
4. Land entry-rules' matching schema bump (accept v1 or v2; tightened drift threshold for `ig_snapshot`; keep existing for `yahoo_chart`). **This PR ships before flag-on.**
5. Set `PRICE_ANCHOR_ENABLED=true` in Vercel prod. Run one DEMO scan; confirm ingest.
6. Monitor `emission_rejections` and `scan_anchor` rejection counts for one DEMO week.
7. Session 10 follow-up: swap Yahoo for IG snapshot as `price_source`. Tighten threshold to 5% on the entry-rules side for `ig_snapshot` grade.

---

## 10. Out of scope

- Recentering trigger zones. Drop, don't rewrite.
- Touching `dayTradeScorer.js` or `mclPolicy.js`. Those run pre-LLM; this spec is entirely post-LLM emission.
- Finnhub integration. Parked for Session 10.
- Enforcing anchoring on the LLM prompt side. `livePrices` injection in `buildFullPrompt` is best-effort context and can stay unchanged — this spec catches LLM drift regardless of whether prompting catches it first.

---

## 11. Files touched (checklist for Claude Code)

swing-committee:
- `lib/scanEmission.js` (async, rejections, anchor attachment, version bump)
- `lib/priceAnchor.js` (new)
- `app/api/analyze/route.js` (await)
- `docs/ig_price_grounding_spec.md` (this file — keep up to date as implementation reveals surprises)
- unit tests under `lib/__tests__/` or adjacent

entry-rules:
- `src/models/shortlist_entry.py` (optional new fields)
- `src/models/scan_record.py` (optional `emission_rejections`)
- `src/models/session_record.py` (`LOG_SCHEMA_VERSION` → 2)
- `src/engine/scan_anchor.py` (source-aware threshold)
- `src/session_init.py` (surface emission rejections in summary)
- matching tests
