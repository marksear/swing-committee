/**
 * scanEmission.js — build the scan handoff payload.
 *
 * Two entry points:
 *   buildScanPayload({...})  pure transform; safe in any runtime (Vercel too).
 *                            Returns { scanRecord, shortlistEntries } ready to
 *                            be JSON-stringified. Used by /api/analyze and by
 *                            local CLI tools.
 *   emitScanFiles({...})     writes the handoff to disk. NOT used on Vercel
 *                            (serverless fs is ephemeral/read-only). Kept for
 *                            local CLI use, backtests, and future scheduled
 *                            jobs. Performs atomic writes (tmp + rename) and
 *                            appends a scan_summary line to data/trades.json.
 *
 * PRODUCTION FLOW (Vercel web app):
 *   /api/analyze → buildScanPayload → JSON in response body → UI download
 *   button drops scan_YYYYMMDD.json onto the user's disk → user moves it to
 *   entry-rules/money-program-trading/data/scans/ → session_init.py ingests.
 *
 * The shapes here must stay in lockstep with the Pydantic models in
 *   entry-rules/money-program-trading/src/models/
 *     session_record.py (LOG_SCHEMA_VERSION)
 *     scan_record.py    (ScanRecord, RegimeSnapshot, UniverseScoreEntry)
 *     shortlist_entry.py (ShortlistEntry, PillarVotes)
 *     log_enums.py      (BrokerMode, SessionLabel, RegimeState, CandidateGrade)
 *     common.py         (EntryType, Direction, Market)
 *
 * If those models change, bump LOG_SCHEMA_VERSION below and on the Python side
 * together — ingest queries partition on it.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  coerceToCanonical,
  evaluateDrift,
  expectedCurrency,
  fetchAnchorQuotes,
  stalenessOk,
} from './priceAnchor.js';
import { filterByEvents, indexCalendar } from './eventFilter.js';

/**
 * No-op server-side archive hook. Real archival is client-driven in the
 * current rollout (see §5.2 below). Kept as a named export so a future
 * Vercel Blob / S3 backend can drop in without touching call sites.
 */
export async function archiveScanPayload(payload) {
  // Intentionally empty. Do not log the full payload — it's large and
  // leaks shortlist content into Vercel's log retention.
  return;
}

// Must match LOG_SCHEMA_VERSION in entry-rules/src/models/session_record.py.
// v2 (2026-04-17): adds optional emission-side price-grounding fields on
// ShortlistEntry + emission_rejections on ScanRecord. See
// docs/ig_price_grounding_spec.md §5.3.
export const LOG_SCHEMA_VERSION = 2;

// Grade → planned risk as fraction of account. Must stay in lockstep with
// the sizing ladder documented in the trading discipline feedback memory.
//
// Production ladder is strictly A+/A/B. This table is the sole enforcement
// boundary — if a grade is not a key here, signals with that grade are
// filtered out of the shortlist entirely. Do NOT add C here: that would
// silently let a Grade-C TAKE-TRADE signal into a live shortlist.
const GRADE_TO_RISK_PCT = {
  'A+': 0.01,
  A: 0.0075,
  B: 0.005,
};

// Bypass-only extension. Consulted ONLY when scanRecord.gate_bypass=true
// (which is DEMO-only by construction). Sized at B's 0.5% so the resulting
// stake clears IG's £0.10/pt floor and the end-to-end pipeline actually
// exercises during mechanics testing. The real C policy (per
// entry-rules/src/backtest/trade_management.risk_percent_for_grade) is 0%
// — this is a pragmatic override for shakedown only.
const BYPASS_GRADE_TO_RISK_PCT = {
  'A+': 0.01,
  A: 0.0075,
  B: 0.005,
  C: 0.005,
};

function resolveRiskPct(grade, { bypassEnabled }) {
  const table = bypassEnabled ? BYPASS_GRADE_TO_RISK_PCT : GRADE_TO_RISK_PCT;
  return table[grade] ?? null;
}

// ---------------------------------------------------------------------------
// Setup-type mapping (free-text → EntryType enum token)
// ---------------------------------------------------------------------------

// Maps the free-form `setupType` strings that swing-committee emits today to
// the typed EntryType values that entry-rules understands. Matching is
// case-insensitive and substring-based — first match wins. Anything that
// doesn't match falls back to L-A / S-A by direction and stashes the raw
// string in `extras.setupType_raw` so nothing is lost.
// Order matters — more-specific patterns first so they win over generic ones.
// "Failed Breakout Short" must match S-E before the generic /breakout/ pattern
// below can claim it for L-A/S-A.
const SETUP_TYPE_PATTERNS = [
  // Short — specific
  { re: /failed.?breakout/i, long: null, short: 'S-E' },
  { re: /head.?and.?shoulders|h&s|head.?&.?shoulders/i, long: null, short: 'S-A' },
  { re: /climax|top.?reversal|exhaustion/i, long: null, short: 'S-D' },
  { re: /gap.?down|sgd|shortable gap/i, long: null, short: 'S-C' },
  { re: /rally.?into.?resistance|bounce/i, long: null, short: 'S-B' },
  // Long — specific
  { re: /gap.?up|bgu|buyable gap/i, long: 'L-C', short: null },
  { re: /pocket pivot/i, long: 'L-D', short: null },
  { re: /secondary|re.?entry|re-entry/i, long: 'L-E', short: null },
  { re: /pullback|ema pullback|first pullback/i, long: 'L-B', short: 'S-B' },
  // Generic — fall-through
  { re: /vcp|volatility contraction|breakout/i, long: 'L-A', short: 'S-A' },
  { re: /resistance/i, long: null, short: 'S-B' },
];

function mapSetupType(rawSetup, direction) {
  const isLong = direction === 'LONG';
  const defaultToken = isLong ? 'L-A' : 'S-A';
  if (!rawSetup || typeof rawSetup !== 'string') return defaultToken;
  for (const { re, long, short } of SETUP_TYPE_PATTERNS) {
    if (re.test(rawSetup)) {
      const token = isLong ? long : short;
      if (token) return token;
    }
  }
  return defaultToken;
}

// ---------------------------------------------------------------------------
// Price parsing helpers
// ---------------------------------------------------------------------------

// Accepts "145.50", "145.50-146.00", "£145.50", "$1,450.00", zone objects
// { low, high }, or numbers. Returns { low, high } floats or null on failure.
function parseTriggerZone(entry) {
  if (entry == null) return null;
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    const low = parseNumber(entry.low);
    const high = parseNumber(entry.high ?? entry.low);
    if (low != null && high != null) {
      return { low: Math.min(low, high), high: Math.max(low, high) };
    }
    return null;
  }
  if (typeof entry === 'number') return { low: entry, high: entry };
  if (typeof entry !== 'string') return null;
  const cleaned = entry.replace(/[£$,]/g, '').trim();
  const zoneMatch = cleaned.match(/(-?\d+\.?\d*)\s*[-–—]\s*(-?\d+\.?\d*)/);
  if (zoneMatch) {
    const a = Number(zoneMatch[1]);
    const b = Number(zoneMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { low: Math.min(a, b), high: Math.max(a, b) };
    }
  }
  const single = parseNumber(cleaned);
  if (single != null) return { low: single, high: single };
  return null;
}

function parseNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[£$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Pillar votes — derive six-bool struct from whatever signal-level info exists
// ---------------------------------------------------------------------------

// Today swing-committee only records `pillarCount` (0–6), not which specific
// pillars voted. For now we set all six to false and stash `pillarCount` in
// extras so nothing is lost; later, when the scorer emits the full bitmap,
// update this mapping.
function buildPillarVotes(signal) {
  return {
    livermore: false,
    oneil: false,
    minervini: false,
    darvas: false,
    raschke: false,
    weinstein: false,
  };
}

// ---------------------------------------------------------------------------
// Main transform
// ---------------------------------------------------------------------------

/**
 * Build the ScanRecord + ShortlistEntry payloads from swing-committee inputs.
 *
 * @param {object} args
 * @param {object} args.formData         formData from the UI (accountSize, brokerMode, etc.)
 * @param {object} args.scannerResults   output of /api/scanner (universe + regime)
 * @param {object} args.analysisResult   output of /api/analyze (signals + committee stance)
 * @param {string} [args.ruleSetVersion] short git SHA — stamped on every row
 * @param {Date}   [args.now]            injectable clock for tests
 * @param {{enabled: boolean, bypassUntil: string|null}} [args.bypassConfig]
 *                                       Gate-bypass (mechanics-test) config. When
 *                                       enabled=true, the emitted scanRecord carries
 *                                       `gate_bypass: true` and `bypass_until` (YYYY-MM-DD);
 *                                       entry-rules' ingest refuses bypass with broker_mode=LIVE
 *                                       or with an expired bypass_until. Default: off.
 * @param {string[]|Set<string>} [args.selectedTickers]
 *                                       If provided (typically alongside bypassConfig), the
 *                                       shortlist is filtered down to exactly these symbols —
 *                                       the user's curated picks on a mechanics-test run.
 *                                       Case-sensitive; pass uppercase tickers.
 * @param {object} [args.anchorOptions]  Test seam — forwarded to fetchAnchorQuotes
 *                                       (e.g. ``{ fetchImpl }``).
 * @param {Map<string,object>} [args.anchorMap]
 *                                       Pre-computed anchor map. When provided, skips
 *                                       fetchAnchorQuotes — used by tests that want to
 *                                       exercise the rejection paths deterministically.
 *                                       Ignored when grounding is disabled.
 * @param {object|null} [args.calendar]  Optional /api/calendar payload
 *                                       ({ events: [...] }) for the Session 10 event
 *                                       filter. When provided AND EVENT_FILTER_ENABLED
 *                                       is truthy, signals whose ticker has earnings
 *                                       within 3 days or whose scan falls inside a
 *                                       2h FOMC/NFP/CPI blackout are dropped from the
 *                                       shortlist and recorded under
 *                                       `scanRecord.event_suppressions[]`. Default: no
 *                                       filter — preserves v1/v2 behaviour exactly.
 * @param {object} [args.eventFilterConfig]
 *                                       Override the event filter's thresholds:
 *                                       `{ earningsDays, macroBlockoutHours,
 *                                          macroLookaheadHours }`.
 * @returns {Promise<{ scanRecord: object, shortlistEntries: object[], bypassCandidateEntries: object[] }>}
 */
export async function buildScanPayload({
  formData = {},
  scannerResults = null,
  analysisResult = null,
  ruleSetVersion = '',
  now = new Date(),
  bypassConfig = null,
  selectedTickers = null,
  anchorOptions = undefined,
  anchorMap = undefined,
  calendar = null,
  eventFilterConfig = null,
}) {
  const scanId = randomUUID();
  const brokerMode = (formData.brokerMode || 'DEMO').toUpperCase() === 'LIVE' ? 'LIVE' : 'DEMO';
  const accountSizeGbp = parseNumber(formData.accountSize) ?? 0;
  const scannedAtUtc = now.toISOString();

  // Bypass validation — mirrors the pydantic ScanRecord model_validator so we
  // fail fast here rather than emit a payload the ingester will refuse. Bypass
  // is DEMO-only by construction; we don't even permit emitting a LIVE bypass
  // payload. bypass_until is mandatory when enabled.
  const bypassEnabled = !!(bypassConfig && bypassConfig.enabled);
  let bypassUntil = null;
  if (bypassEnabled) {
    if (brokerMode !== 'DEMO') {
      throw new Error('gate_bypass is only permitted with broker_mode=DEMO');
    }
    bypassUntil = bypassConfig.bypassUntil;
    if (!bypassUntil || !/^\d{4}-\d{2}-\d{2}$/.test(bypassUntil)) {
      throw new Error('gate_bypass requires bypassUntil as YYYY-MM-DD');
    }
  }
  const selectedSet = selectedTickers
    ? new Set(
        (Array.isArray(selectedTickers) ? selectedTickers : [...selectedTickers]).map((t) =>
          String(t).toUpperCase(),
        ),
      )
    : null;

  // Regime snapshot — scannerResults.regime is 'GREEN'|'YELLOW'|'RED'
  const regimeRaw = (scannerResults?.regime || 'YELLOW').toUpperCase();
  const regime = {
    regime: regimeRaw === 'GREEN' || regimeRaw === 'RED' ? regimeRaw : 'YELLOW',
    regime_score: parseNumber(scannerResults?.mclScore),
    vix_level: parseNumber(scannerResults?.results?.dayTrades?.vix),
    breadth_us: parseNumber(scannerResults?.breadthUs),
    breadth_uk: parseNumber(scannerResults?.breadthUk),
    notes: scannerResults?.regimeContext || '',
  };

  // Universe scoring — every scanner row becomes one UniverseScoreEntry.
  // We keep the full universe, not just shortlisted tickers — that's the whole
  // point of this file (retrospective "why wasn't X shortlisted?" queries).
  //
  // Row-source reconciliation: the real /api/scanner/route.js emits
  //   results.long, results.short, results.watchlist, results.dayTrades
  // Historical scanEmission.test.mjs fixtures use a synthetic `results.primary`
  // shape. Read BOTH so production and tests stay in parity. No dedup needed —
  // the scanner excludes trade-tickers from the watchlist at route.js:320.
  const primary = scannerResults?.results?.primary ?? [
    ...(scannerResults?.results?.long ?? []),
    ...(scannerResults?.results?.short ?? []),
  ];
  const watchlist = scannerResults?.results?.watchlist ?? [];
  const allRows = [...primary, ...watchlist];

  // Day-1 capture score lookup. dayTradeScorer.js returns rich candidate objects
  // keyed by ticker; pull total_score + tier into universe rows. Synthetic test
  // fixtures instead stamp row.totalScore / row.tier directly — the per-row
  // readers below honour both.
  const dayTradeByTicker = new Map(
    (scannerResults?.results?.dayTrades?.candidates ?? [])
      .filter((c) => c && c.ticker)
      .map((c) => [c.ticker, c]),
  );

  // Pillar count: real scanner rows carry longPassing / shortPassing and no
  // composite pillarCount; pick the side that matches the row's direction.
  // Synthetic fixtures pre-aggregate to pillarCount — take that when present.
  const rowPillarCount = (row) => {
    if (row.pillarCount != null) return Number(row.pillarCount) || 0;
    const dir = String(row.direction || '').toUpperCase();
    if (dir === 'SHORT') return Number(row.shortPassing ?? 0) || 0;
    // LONG, BOTH, WATCH, or missing → prefer long; fall back to short
    return Number(row.longPassing ?? row.shortPassing ?? 0) || 0;
  };

  const shortlistedSymbols = new Set(
    (analysisResult?.signals ?? [])
      .filter((s) => s.grade && resolveRiskPct(s.grade, { bypassEnabled }) != null)
      .filter((s) => ['TAKE TRADE', 'DAY TRADE'].includes((s.verdict || '').toUpperCase()))
      .map((s) => s.ticker),
  );
  const gradeBySymbol = new Map(
    (analysisResult?.signals ?? [])
      .filter((s) => s.grade)
      .map((s) => [s.ticker, s.grade]),
  );
  const scoredUniverse = allRows.map((row) => {
    const symbol = row.ticker ?? row.symbol ?? '';
    const dayTradeEntry = dayTradeByTicker.get(symbol);
    return {
      symbol,
      market: inferMarket(row),
      price: parseNumber(row.price ?? row.last),
      currency: row.currency ?? null,
      pillar_pass_count: Math.max(0, Math.min(6, rowPillarCount(row))),
      pillar_bitmap: Number(row.pillarBitmap ?? 0) || 0,
      day1_score: parseNumber(
        row.totalScore ?? row.day1Score ?? dayTradeEntry?.total_score,
      ),
      day1_tier: row.tier ?? dayTradeEntry?.tier ?? null,
      grade: gradeBySymbol.get(symbol) ?? null,
      shortlisted: shortlistedSymbols.has(symbol),
      rejection_reason: row.rejectionReason ?? null,
      rejection_code: row.rejectionCode ?? null,
    };
  });

  // ScanRecord — shape must match entry-rules' src/models/scan_record.py.
  const scanRecord = {
    scan_id: scanId,
    session_id: null, // ingester fills
    scanned_at_utc: scannedAtUtc,
    universe_size: scoredUniverse.length,
    broker_mode: brokerMode,
    regime,
    scored_universe: scoredUniverse,
    // Prefer an explicit SCANNER_VERSION (e.g. a semver set in Vercel env).
    // Otherwise fall back to the commit SHA Vercel auto-injects on every deploy
    // — gives a traceable, self-maintaining stamp so the
    // `version.scanner_blank` validator warning doesn't fire.
    scanner_version:
      process.env.SCANNER_VERSION
      || process.env.VERCEL_GIT_COMMIT_SHA
      || '',
    rule_set_version: ruleSetVersion,
    schema_version: LOG_SCHEMA_VERSION,
    // gate_bypass + bypass_until live at the top level of ScanRecord (not in
    // extras) — they're typed pydantic fields with a model_validator on the
    // entry-rules side. When bypass is off, emit the canonical off-values so
    // ingests stay deterministic across payload versions.
    gate_bypass: bypassEnabled,
    bypass_until: bypassUntil,
    extras: {
      scan_date: now.toISOString().slice(0, 10),
      account_size_gbp: accountSizeGbp,
      session_label: 'US_REGULAR',
      committee_mode: analysisResult?.mode ?? null,
      summary: analysisResult?.summary ?? null,
    },
  };

  // ShortlistEntry rows — one per TAKE-TRADE / DAY-TRADE signal with a grade.
  // If a selection set was passed (typical on a mechanics-test bypass run),
  // filter the shortlist down to just those tickers. This is the whole point
  // of the bypass UX: the user curates 1–3 picks by hand.
  const signals = analysisResult?.signals ?? [];

  // Gradable = has a grade in the risk ladder. Applies to both paths.
  // Under bypass we extend the ladder to include C (DEMO-only shakedown).
  const gradableSignals = signals.filter(
    (s) => s.grade && resolveRiskPct(s.grade, { bypassEnabled }) != null,
  );
  // Parallel pool for bypass candidates. Always uses the extended ladder
  // (A+/A/B/C) regardless of the caller's bypass flag — /api/analyze builds
  // a scan without knowing whether the user will turn bypass on afterwards,
  // and the download button reads from scan.bypass_candidate_entries. If we
  // only populated this when bypassEnabled=true we'd strand Grade-C picks
  // in an empty pool and the Download button would silently no-op.
  // This does NOT affect the main shortlist (below) which stays strict.
  const bypassGradableSignals = signals.filter(
    (s) => s.grade && BYPASS_GRADE_TO_RISK_PCT[s.grade] != null,
  );

  // ── Emission-side price grounding (spec §6) ────────────────────────────
  // Default is OFF — flips to true via Vercel env after the entry-rules
  // ingest side has shipped acceptance for v2 payloads. When off we emit
  // the v1 shape (no anchor fields, emission_rejections=null).
  const anchorEnabled = priceAnchorEnabled();
  const emissionRejections = [];
  let anchorMapResolved = null;
  if (anchorEnabled) {
    if (anchorMap instanceof Map) {
      anchorMapResolved = anchorMap;
    } else {
      const tickersToAnchor = Array.from(
        new Set(
          gradableSignals
            .map((s) => s.ticker)
            .filter((t) => typeof t === 'string' && t.length > 0),
        ),
      );
      anchorMapResolved = await fetchAnchorQuotes(tickersToAnchor, anchorOptions);
    }
  }

  const entryCtx = {
    scanId,
    accountSizeGbp,
    brokerMode,
    ruleSetVersion,
    createdAtUtc: scannedAtUtc,
    anchorEnabled,
    anchorMap: anchorMapResolved,
    emissionRejections, // mutated by toShortlistEntry on rejection
    now,
    bypassEnabled,
  };

  // Normal shortlist: TAKE-TRADE / DAY-TRADE only. This is what goes to the
  // ingester on a non-bypass run.
  let shortlistEntries = gradableSignals
    .filter((s) => ['TAKE TRADE', 'DAY TRADE'].includes((s.verdict || '').toUpperCase()))
    .map((signal) => toShortlistEntry(signal, entryCtx))
    .filter((entry) => entry != null);

  if (selectedSet) {
    shortlistEntries = shortlistEntries.filter((e) =>
      selectedSet.has(String(e.symbol).toUpperCase()),
    );
  }

  // Bypass candidates: EVERY gradable signal regardless of verdict. Used by
  // the frontend's mechanics-test bypass download — the user curates 1–3
  // WATCHLIST picks and we want to ship sized, zone-valid shortlist entries
  // for them even though they didn't trip a TAKE-TRADE verdict. DEMO-only;
  // the ingester refuses bypass on LIVE and with expired bypass_until.
  // Use a separate rejections sink so bypass-candidate rejections don't
  // double-count against the main shortlist when a ticker appears in both
  // (every TAKE-TRADE signal is also gradable).
  // Force bypassEnabled=true in this context so toShortlistEntry's
  // resolveRiskPct() consults the extended (A+/A/B/C) table when sizing.
  // Without this override, Grade-C entries would pass the outer filter
  // (bypassGradableSignals) but then get nulled inside toShortlistEntry.
  const bypassCtx = { ...entryCtx, emissionRejections: [], bypassEnabled: true };
  const bypassCandidateEntries = bypassGradableSignals
    .map((signal) => toShortlistEntry(signal, bypassCtx))
    .filter((entry) => entry != null);

  // Surface emission rejections in two cases:
  //   1. Anchor grounding is enabled (spec §6) — always attach, even if
  //      empty array, so v2-aware consumers see the field reliably.
  //   2. Any rule (e.g. Rule R3 stop ≤ 8%) pushed a rejection — attach
  //      so the operator can audit why a candidate dropped, regardless
  //      of anchor mode.
  if (anchorEnabled || emissionRejections.length > 0) {
    scanRecord.emission_rejections = emissionRejections;
  }

  // ── Session 10 event filter ────────────────────────────────────────────
  // Default OFF — only runs when a calendar payload is supplied AND the
  // env flag is on. This preserves the v1/v2 handoff shape byte-for-byte
  // when not explicitly opted into.
  //
  // When active, we drop from the TAKE-TRADE/DAY-TRADE shortlist any
  // candidate whose ticker has earnings within 3 calendar days, or any
  // candidate (all tickers) within 2h of a high-impact macro event. The
  // dropped entries surface as `scanRecord.event_suppressions[]` so the
  // frontend can render a "why wasn't X shortlisted?" panel.
  //
  // Bypass candidates are NOT filtered — the whole point of a mechanics-
  // test bypass is that the operator is consciously overriding the gates.
  if (eventFilterActive(calendar)) {
    const cfg = eventFilterConfig || {};
    const idx = indexCalendar(calendar, {
      now,
      macroLookaheadHours: cfg.macroLookaheadHours,
    });
    // Filter by symbol — the shortlist entries carry `symbol` (not `ticker`)
    // as their canonical field, so we shim it for the filter input.
    const asCandidates = shortlistEntries.map((e) => ({
      ticker: e.symbol,
      _entry: e,
    }));
    const { passed, suppressions } = filterByEvents({
      candidates: asCandidates,
      calendar: idx,
      now,
      earningsDays: cfg.earningsDays,
      macroBlockoutHours: cfg.macroBlockoutHours,
    });
    shortlistEntries = passed.map((p) => p._entry);
    if (suppressions.length > 0) {
      scanRecord.event_suppressions = suppressions;
    }
  }

  // ── Archive tap ──────────────────────────────────────────────────
  // Fire-and-forget; never block the API response on archival.
  queueMicrotask(() => {
    archiveScanPayload({ scanRecord, shortlistEntries, bypassCandidateEntries })
      .catch((err) => console.warn('[scanEmission] archive failed:', err?.message));
  });

  return { scanRecord, shortlistEntries, bypassCandidateEntries };
}

// Feature flag — default OFF. When a route wants event filtering to run,
// it either sets EVENT_FILTER_ENABLED=1 in the environment AND passes a
// calendar payload, or it can force-pass a calendar explicitly (the env
// gate exists so a missing FINNHUB_API_KEY in deploy doesn't silently
// disable the filter after it's been wired in).
function eventFilterActive(calendar) {
  if (!calendar) return false;
  const v = process.env.EVENT_FILTER_ENABLED;
  if (v == null) return false;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

// Feature flag — default OFF in this PR. Flips via Vercel env after the
// entry-rules ingest side ships acceptance for v2 payloads (spec §6.4).
function priceAnchorEnabled() {
  const v = process.env.PRICE_ANCHOR_ENABLED;
  if (v == null) return false;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function inferMarket(row) {
  if (row.market === 'UK' || row.market === 'US') return row.market;
  const sym = row.ticker ?? row.symbol ?? '';
  // UK spread-bet symbols typically end in .L
  return sym.endsWith('.L') ? 'UK' : 'US';
}

function toShortlistEntry(signal, ctx) {
  const {
    scanId,
    accountSizeGbp,
    brokerMode,
    ruleSetVersion,
    createdAtUtc,
    anchorEnabled,
    anchorMap,
    emissionRejections,
    now,
    bypassEnabled = false,
  } = ctx;
  const direction = (signal.direction || '').toUpperCase();
  if (direction !== 'LONG' && direction !== 'SHORT') return null;

  const zone = parseTriggerZone(signal.entry);
  const stopPrice = parseNumber(signal.stop);
  if (!zone || stopPrice == null) return null;

  // Enforce the ShortlistEntry validator rule: stop must be on the correct
  // side of the zone. If swing-committee produced an inconsistent row, drop
  // it rather than emit an invalid entry that will fail pydantic ingest.
  if (direction === 'LONG' && stopPrice >= zone.low) return null;
  if (direction === 'SHORT' && stopPrice <= zone.high) return null;

  // ── Rule R3 — Stop distance ≤ 8% of entry price ──────────────────────
  // Per docs/specs/CANONICAL_ENTRY_RULES.md §R3 and the desk reference:
  // 'Max stop distance 8%. If risk budget can't fit the stop within 8%,
  // SKIP the trade. Never widen the budget.' Worst-case entry side:
  // trigger_high for LONG, trigger_low for SHORT (the side that gives
  // the *largest* stop distance — most conservative reading of the
  // rule). Drop the row and log an emission_rejection so the operator
  // can see WHY a candidate didn't reach the shortlist.
  const entryRef = direction === 'LONG' ? zone.high : zone.low;
  if (entryRef > 0) {
    const stopDistance = Math.abs(entryRef - stopPrice);
    const stopPct = stopDistance / entryRef;
    if (stopPct > 0.08) {
      emissionRejections.push({
        symbol: signal.ticker,
        direction,
        grade: signal.grade,
        reason: 'STOP_DISTANCE_EXCEEDS_8PCT',
        stop_distance_pct: stopPct,
        threshold: 0.08,
        entry_ref: entryRef,
        stop_price: stopPrice,
      });
      return null;
    }
  }

  const setupType = mapSetupType(signal.setupType, direction);
  const grade = signal.grade;
  const riskPct = resolveRiskPct(grade, { bypassEnabled });
  if (riskPct == null) return null;

  // ── Emission-side anchor check (spec §6) ──────────────────────────────
  // When grounding is disabled, skip entirely and emit v1 shape (anchor
  // fields stay null). When enabled, look up the reference quote and either
  // attach it to the entry or push a rejection and drop the entry.
  let priceSource = null;
  let priceAsOfUtc = null;
  let referenceLastTraded = null;
  if (anchorEnabled) {
    const triggerMid = (zone.low + zone.high) / 2;
    const anchor = anchorMap ? anchorMap.get(signal.ticker) : null;
    const reject = (reason, extra = {}) => {
      emissionRejections.push({
        symbol: signal.ticker,
        direction,
        grade,
        reason,
        llm_trigger_mid: triggerMid,
        reference_last_traded: anchor?.last ?? null,
        drift_pct: extra.drift ?? null,
        price_source: anchor?.source ?? 'none',
        price_as_of_utc: anchor?.asOfUtc ?? null,
      });
      return null;
    };

    if (!anchor) return reject('NO_REFERENCE_QUOTE');
    if (!stalenessOk(anchor.asOfUtc, { now })) return reject('STALE_QUOTE');

    // Coerce both inputs to canonical scale (GBp for .L, USD elsewhere)
    // before drift comparison. Yahoo .L returns GBp directly; if the LLM
    // somehow emitted GBP, evaluateDrift's >1000% branch catches it.
    const refCanonical = coerceToCanonical(anchor.last, anchor.currency, signal.ticker);
    const expected = expectedCurrency(signal.ticker);
    const verdict = evaluateDrift({
      llmTriggerMid: triggerMid,
      reference: refCanonical,
    });
    if (!verdict.ok) return reject(verdict.reason, { drift: verdict.drift ?? null });

    priceSource = anchor.source;
    priceAsOfUtc = anchor.asOfUtc;
    referenceLastTraded = refCanonical;
    // expected is informational — used to flag mismatch via the drift
    // heuristic above. Reading it here keeps the linter happy without
    // adding a no-op statement.
    void expected;
  }

  // Sizing — abs(trigger − stop) × stake = risk. stake = risk / dist.
  const triggerRef = direction === 'LONG' ? zone.low : zone.high;
  const riskPerPt = Math.abs(triggerRef - stopPrice);
  const plannedRiskGbp = accountSizeGbp > 0 ? +(accountSizeGbp * riskPct).toFixed(2) : 0;
  let plannedStake = 0;
  if (riskPerPt > 0 && plannedRiskGbp > 0) {
    plannedStake = +(plannedRiskGbp / riskPerPt).toFixed(2);
    // IG minimum £0.10/pt
    if (plannedStake > 0 && plannedStake < 0.1) plannedStake = 0.1;
  }

  return {
    candidate_id: randomUUID(),
    scan_id: scanId,
    session_id: null, // ingester fills this
    symbol: signal.ticker,
    market: inferMarket({ ticker: signal.ticker }),
    direction,
    setup_type: setupType,
    grade,
    trigger_low: zone.low,
    trigger_high: zone.high,
    stop_price: stopPrice,
    target_price: parseNumber(signal.target),
    planned_stake_gbp_per_pt: plannedStake,
    planned_risk_gbp: plannedRiskGbp,
    planned_risk_pct_account: riskPct,
    pillar_votes: buildPillarVotes(signal),
    committee_stance: (signal.rawSection || '').slice(0, 500),
    day1_score: parseNumber(signal.totalScore) ?? parseNumber(signal.day1Score),
    day1_tier: signal.tier ?? null,
    price_source: priceSource,
    price_as_of_utc: priceAsOfUtc,
    reference_last_traded: referenceLastTraded,
    broker_mode: brokerMode,
    created_at_utc: createdAtUtc,
    schema_version: LOG_SCHEMA_VERSION,
    rule_set_version: ruleSetVersion,
    extras: {
      setupType_raw: signal.setupType ?? null,
      pillarCount: signal.pillarCount ?? null,
      riskReward: signal.riskReward ?? null,
      verdict: signal.verdict ?? null,
    },
    notes: '',
  };
}

// ---------------------------------------------------------------------------
// Atomic write helpers
// ---------------------------------------------------------------------------

// Atomic temp-file-then-rename. On POSIX rename is atomic within a filesystem;
// on Windows it's atomic only for same-volume moves. Since data/ lives under
// the repo, both platforms are fine for this use case.
async function writeFileAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, targetPath);
}

// data/trades.json is an NDJSON append-log. Each line is one
// `scan_summary` event; readers should parse line-by-line. Append is
// non-atomic but durable-enough — if the process crashes mid-write we
// lose at most the current line, and the scan file itself is already
// written atomically.
async function appendJsonLine(targetPath, obj) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(obj) + '\n';
  await fs.appendFile(targetPath, line, 'utf8');
}

/**
 * Emit the scan handoff files. Best-effort — errors are logged and re-thrown
 * so the caller can decide whether to surface them. The analyze route wraps
 * this in its own try/catch so emission failure never fails the analysis.
 *
 * @param {object} args
 * @param {string} args.dataDir           absolute or repo-relative data/ path
 * @param {object} args.scanRecord        output of buildScanPayload
 * @param {object[]} args.shortlistEntries output of buildScanPayload
 * @param {Date} [args.now]
 * @returns {Promise<{scanPath: string, tradesPath: string}>}
 */
export async function emitScanFiles({
  dataDir,
  scanRecord,
  shortlistEntries,
  now = new Date(),
}) {
  // YYYYMMDD — UTC to keep day boundaries deterministic across timezones.
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const scanPath = path.join(dataDir, 'scans', `scan_${ymd}.json`);
  const tradesPath = path.join(dataDir, 'trades.json');

  const scanFile = {
    schema_version: LOG_SCHEMA_VERSION,
    scan_record: scanRecord,
    shortlist_entries: shortlistEntries,
  };
  await writeFileAtomic(scanPath, JSON.stringify(scanFile, null, 2));

  const gradeCounts = shortlistEntries.reduce((acc, e) => {
    acc[e.grade] = (acc[e.grade] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    kind: 'scan_summary',
    ts_utc: now.toISOString(),
    scan_id: scanRecord.scan_id,
    scan_date: scanRecord.scan_date,
    broker_mode: scanRecord.broker_mode,
    regime: scanRecord.regime_snapshot?.state ?? null,
    universe_count: scanRecord.universe_score_entries?.length ?? 0,
    shortlist_count: shortlistEntries.length,
    grade_counts: gradeCounts,
    scan_file: path.relative(dataDir, scanPath),
    schema_version: LOG_SCHEMA_VERSION,
  };
  await appendJsonLine(tradesPath, summary);

  return { scanPath, tradesPath };
}

// ---------------------------------------------------------------------------
// Named exports for testing
// ---------------------------------------------------------------------------

export const __test__ = {
  mapSetupType,
  parseTriggerZone,
  parseNumber,
  buildPillarVotes,
  GRADE_TO_RISK_PCT,
  BYPASS_GRADE_TO_RISK_PCT,
  resolveRiskPct,
};
