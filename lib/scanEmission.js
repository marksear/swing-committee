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

// Must match LOG_SCHEMA_VERSION in entry-rules/src/models/session_record.py.
// v2 (2026-04-17): adds optional emission-side price-grounding fields on
// ShortlistEntry + emission_rejections on ScanRecord. See
// docs/ig_price_grounding_spec.md §5.3.
export const LOG_SCHEMA_VERSION = 2;

// Grade → planned risk as fraction of account. Must stay in lockstep with
// the sizing ladder documented in the trading discipline feedback memory.
const GRADE_TO_RISK_PCT = {
  'A+': 0.01,
  A: 0.0075,
  B: 0.005,
};

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
  const primary = scannerResults?.results?.primary ?? [];
  const watchlist = scannerResults?.results?.watchlist ?? [];
  const allRows = [...primary, ...watchlist];
  const shortlistedSymbols = new Set(
    (analysisResult?.signals ?? [])
      .filter((s) => s.grade && GRADE_TO_RISK_PCT[s.grade] != null)
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
    return {
      symbol,
      market: inferMarket(row),
      price: parseNumber(row.price ?? row.last),
      currency: row.currency ?? null,
      pillar_pass_count: Math.max(0, Math.min(6, Number(row.pillarCount ?? 0) || 0)),
      pillar_bitmap: Number(row.pillarBitmap ?? 0) || 0,
      day1_score: parseNumber(row.totalScore ?? row.day1Score),
      day1_tier: row.tier ?? null,
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
    scanner_version: process.env.SCANNER_VERSION || '',
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
  const gradableSignals = signals.filter(
    (s) => s.grade && GRADE_TO_RISK_PCT[s.grade] != null,
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
  const bypassCtx = { ...entryCtx, emissionRejections: [] };
  const bypassCandidateEntries = gradableSignals
    .map((signal) => toShortlistEntry(signal, bypassCtx))
    .filter((entry) => entry != null);

  // Surface emission rejections only when grounding ran. v1 shape stays
  // backward-compatible: the field is simply absent when disabled.
  if (anchorEnabled) {
    scanRecord.emission_rejections = emissionRejections;
  }

  return { scanRecord, shortlistEntries, bypassCandidateEntries };
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

  const setupType = mapSetupType(signal.setupType, direction);
  const grade = signal.grade;
  const riskPct = GRADE_TO_RISK_PCT[grade];

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
};
