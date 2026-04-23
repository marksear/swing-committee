// validate_scan.ts — structural & semantic validator for swing-committee scan payloads.
//
// MUST stay in sync with money-program-trading/src/intake/validate_scan.py.
// The Python validator is the reference specification; this TypeScript port
// mirrors its check logic for use inside the /api/analyze/ route gate. When
// a check changes on either side, update both. See app/api/scanner/route.js
// :2062 and :2340 for the same cross-repo sync pattern applied elsewhere in
// this codebase.
//
// Output shape — "shape B" per the validator-finding-shape decision:
//   { ok: boolean, findings: Finding[] }
// A single `findings` array with per-finding `severity`. `ok` is derived from
// whether any finding has severity === 'error'. Warnings annotate without
// blocking. Adding 'info' / 'blocker' severities later is a non-breaking
// change — consumers switch on `severity`, not on top-level keys.
//
// Python → TS rule_id mapping (lowercase dotted snake):
//   SCHEMA_TOP_LEVEL                     → schema.top_level_missing
//   SCHEMA_VERSION_MISSING               → schema.version_missing
//   SCHEMA_VERSION_OUTDATED              → schema.version_outdated
//   SCAN_RECORD_SHAPE                    → scan_record.shape_invalid
//   SHORTLIST_NOT_SUBSET_OF_UNIVERSE     → shortlist.not_subset_of_universe
//   SHORTLIST_DUPLICATES                 → shortlist.duplicates
//   PILLAR_ENGINE_DEAD                   → pillar.engine_dead
//   PILLAR_VOTES_COUNT_MISMATCH          → pillar.votes_count_mismatch
//   VERDICT_TEXT_VS_EXTRAS_MISMATCH      → verdict.text_vs_extras_mismatch
//   COMMITTEE_MODE_VS_VERDICT            → committee.mode_vs_verdict
//   SUMMARY_CONTRADICTS_SHORTLIST        → summary.contradicts_shortlist
//   STANCE_CURRENT_PRICE_NA              → stance.current_price_na
//   STANCE_ENTRY_ZONE_NA                 → stance.entry_zone_na
//   STANCE_STOP_RISK_NA                  → stance.stop_risk_na
//   SETUP_TYPE_RAW_DUPLICATED            → setup_type.raw_duplicated
//   REGIME_LABEL_MISMATCH                → regime.label_mismatch
//   SCANNER_VERSION_BLANK                → version.scanner_blank
//   RULE_SET_VERSION_BLANK               → version.rule_set_blank
//   GATE_BYPASS_ACTIVE                   → (dropped; 'info' severity not yet in TS union)
//   GATE_BYPASS_NO_REASON                → gate_bypass.no_reason
//   SHORTLIST_PRICING_MISSING            → shortlist.pricing_missing
//   UNIVERSE_PRICE_MISSING               → universe.price_missing
//   DIRECTION_INVALID                    → direction.invalid
//   STOP_DIRECTION_INVALID               → stop.direction_invalid
//   TARGET_DIRECTION_INVALID             → target.direction_invalid
//   RISK_MATH_INCONSISTENT               → risk.math_inconsistent
//   VALIDATOR_INTERNAL_ERROR             → validator.internal_error
//
// TODO: Port GATE_BYPASS_ACTIVE once the Finding.severity union gains 'info'.
// TODO: The risk.math_inconsistent check false-positives on legitimate IG
// spread-bet sizing for US symbols (×100 points→GBP conversion that the
// check doesn't model). Fix tracked separately — do not patch it here.

// ── Types ─────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  rule_id: string;
  field_path: string;
  message: string;
  observed: unknown;
  expected: unknown;
}

export interface ValidationResult {
  ok: boolean;
  findings: Finding[];
}

// Inputs are deliberately loose. A validator's whole job is to handle
// malformed payloads; constraining the input shape upstream would mask
// the exact cases we want to flag.
type Dict = Record<string, any>;
type ScanRecord = Dict;
type ShortlistEntry = Dict;
type Scan = Dict;

// ── Public API ────────────────────────────────────────────────────────

/**
 * Validate the payload as emitted by buildScanPayload() inside
 * /api/analyze/route.js. Accepts the two halves separately (matches the
 * destructure `{ scanRecord, shortlistEntries } = buildScanPayload(...)`)
 * and skips the top-level envelope checks (schema_version, scan_record
 * shape) which buildScanPayload enforces by construction.
 */
export function validateScanPayload(
  scanRecord: ScanRecord,
  shortlistEntries: ShortlistEntry[],
): ValidationResult {
  const scan: Scan = {
    schema_version: 2,
    scan_record: scanRecord,
    shortlist_entries: shortlistEntries ?? [],
  };
  return runChecks(scan, { skipEnvelope: true });
}

/**
 * Validate a full scan dict as it would be loaded from a downloaded file.
 * Shape matches validate_scan.py's top-level input. Use this for parity
 * testing against the Python fixtures (scan_clean_example.json,
 * scan_20260422_bypass.json).
 */
export function validateFullScan(scan: Scan): ValidationResult {
  return runChecks(scan, { skipEnvelope: false });
}

/**
 * Call-site helper for the /api/analyze/ gate. True iff at least one
 * finding has severity === 'error'.
 */
export function hasBlockingFindings(result: ValidationResult): boolean {
  return result.findings.some((f) => f.severity === 'error');
}

// ── Helpers ───────────────────────────────────────────────────────────

function getPath(obj: any, ...keys: (string | number)[]): any {
  let cur: any = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function countTrue(d: Dict | null | undefined): number | null {
  if (!d || typeof d !== 'object') return null;
  return Object.values(d).filter((v) => v === true).length;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1 };

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const rid = a.rule_id.localeCompare(b.rule_id);
    if (rid !== 0) return rid;
    return a.field_path.localeCompare(b.field_path);
  });
}

// Regexes aligned 1:1 with validate_scan.py's _STANCE_*_RE.
// The /m flag makes `$` match end-of-line, matching Python's re.MULTILINE.
const STANCE_VERDICT_RE = /\*\*VERDICT:\*\*\s*([A-Z ]+?)\s*$/m;
const STANCE_CURRENT_PRICE_RE = /Current Price:\s*([^\n]+)/m;
const STANCE_ENTRY_ZONE_RE = /Entry Zone:\s*([^\n]+)/m;
const STANCE_STOP_LINE_RE = /Stop Loss:\s*([^(\n]+?)\s*\(([^)]+) risk\)/m;

// ── Check registry ────────────────────────────────────────────────────

interface CheckSpec {
  name: string;
  envelope: boolean; // skipped when called via validateScanPayload
  run: (scan: Scan) => Finding[];
}

const CHECKS: CheckSpec[] = [
  { name: 'schema_top_level', envelope: true, run: checkSchemaTopLevel },
  { name: 'scan_record_shape', envelope: true, run: checkScanRecordShape },
  { name: 'shortlist_subset_of_universe', envelope: false, run: checkShortlistSubsetOfUniverse },
  { name: 'shortlist_duplicates', envelope: false, run: checkShortlistDuplicates },
  { name: 'pillar_engine_produced_signal', envelope: false, run: checkPillarEngineProducedSignal },
  { name: 'shortlist_pillar_votes_match_count', envelope: false, run: checkShortlistPillarVotesMatchCount },
  { name: 'verdict_extras_matches_stance', envelope: false, run: checkVerdictExtrasMatchesStance },
  { name: 'committee_mode_vs_shortlist_verdicts', envelope: false, run: checkCommitteeModeVsShortlistVerdicts },
  { name: 'summary_vs_shortlist', envelope: false, run: checkSummaryVsShortlist },
  { name: 'committee_stance_has_real_values', envelope: false, run: checkCommitteeStanceHasRealValues },
  { name: 'setup_type_raw', envelope: false, run: checkSetupTypeRaw },
  { name: 'regime_consistency', envelope: false, run: checkRegimeConsistency },
  { name: 'version_stamping', envelope: false, run: checkVersionStamping },
  { name: 'gate_bypass_flag', envelope: false, run: checkGateBypassFlag },
  { name: 'shortlist_pricing_populated', envelope: false, run: checkShortlistPricingPopulated },
  { name: 'universe_prices_present', envelope: false, run: checkUniversePricesPresent },
  { name: 'direction_valid', envelope: false, run: checkDirectionValid },
  { name: 'stop_relative_to_trigger', envelope: false, run: checkStopRelativeToTrigger },
  { name: 'target_relative_to_trigger', envelope: false, run: checkTargetRelativeToTrigger },
  { name: 'risk_math_consistent', envelope: false, run: checkRiskMathConsistent },
];

// ── Orchestrator ──────────────────────────────────────────────────────

interface RunOptions {
  skipEnvelope: boolean;
}

function runChecks(scan: Scan, options: RunOptions): ValidationResult {
  const findings: Finding[] = [];
  const list = options.skipEnvelope ? CHECKS.filter((c) => !c.envelope) : CHECKS;
  for (const check of list) {
    try {
      findings.push(...check.run(scan));
    } catch (err) {
      findings.push({
        severity: 'error',
        rule_id: 'validator.internal_error',
        field_path: '',
        message: `check ${check.name} threw: ${String(err)}`,
        observed: { check: check.name, error: String(err) },
        expected: 'check runs without exception',
      });
    }
  }
  const sorted = sortFindings(findings);
  return {
    ok: !sorted.some((f) => f.severity === 'error'),
    findings: sorted,
  };
}

// ── Individual checks ─────────────────────────────────────────────────

function checkSchemaTopLevel(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const required = ['schema_version', 'scan_record', 'shortlist_entries'];
  const missing = required.filter((k) => !(k in scan));
  if (missing.length > 0) {
    out.push({
      severity: 'error',
      rule_id: 'schema.top_level_missing',
      field_path: '$',
      message: `Top-level keys missing: ${missing.join(', ')}`,
      observed: { missing },
      expected: { keys: required },
    });
  }
  const ver = scan.schema_version;
  if (ver === undefined || ver === null) {
    out.push({
      severity: 'error',
      rule_id: 'schema.version_missing',
      field_path: 'schema_version',
      message: 'schema_version not set at top level',
      observed: ver,
      expected: 2,
    });
  } else if (typeof ver === 'number' && ver < 2) {
    out.push({
      severity: 'warning',
      rule_id: 'schema.version_outdated',
      field_path: 'schema_version',
      message: `schema_version ${ver} < 2; this validator targets v2`,
      observed: ver,
      expected: { min: 2 },
    });
  }
  return out;
}

function checkScanRecordShape(scan: Scan): Finding[] {
  const sr = scan.scan_record;
  if (!sr || typeof sr !== 'object') return []; // top-level check already flagged
  const required = ['scanned_at_utc', 'scored_universe', 'regime', 'extras'];
  const missing = required.filter((k) => !(k in sr));
  if (missing.length === 0) return [];
  return [
    {
      severity: 'error',
      rule_id: 'scan_record.shape_invalid',
      field_path: 'scan_record',
      message: `scan_record missing keys: ${missing.join(', ')}`,
      observed: { missing },
      expected: { keys: required },
    },
  ];
}

function checkShortlistSubsetOfUniverse(scan: Scan): Finding[] {
  const universe: Dict[] = getPath(scan, 'scan_record', 'scored_universe') ?? [];
  const universeSymbols = new Set(
    universe
      .map((u) => (u && typeof u === 'object' ? u.symbol : undefined))
      .filter((s): s is string => typeof s === 'string' && s.length > 0),
  );
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  const orphans: string[] = [];
  for (const entry of shortlist) {
    if (!entry || typeof entry !== 'object') continue;
    const sym = entry.symbol;
    if (sym && !universeSymbols.has(sym)) orphans.push(sym);
  }
  if (orphans.length === 0) return [];
  return [
    {
      severity: 'error',
      rule_id: 'shortlist.not_subset_of_universe',
      field_path: 'shortlist_entries[].symbol',
      message:
        `${orphans.length} shortlisted symbol(s) were not in scored_universe: ` +
        `${orphans.join(', ')}. Shortlist must be a subset of what the scanner ` +
        `actually scored — even in gate_bypass mode.`,
      observed: { orphans, universe_size: universeSymbols.size },
      expected: 'every shortlist_entries[].symbol appears in scored_universe[].symbol',
    },
  ];
}

function checkShortlistDuplicates(scan: Scan): Finding[] {
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  const counts = new Map<string, number>();
  for (const entry of shortlist) {
    if (!entry || typeof entry !== 'object') continue;
    const key = `${entry.symbol ?? ''}|${entry.direction ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dupes: string[] = [];
  for (const [k, v] of counts) if (v > 1) dupes.push(k);
  if (dupes.length === 0) return [];
  return [
    {
      severity: 'error',
      rule_id: 'shortlist.duplicates',
      field_path: 'shortlist_entries[]',
      message: `Duplicate (symbol,direction) in shortlist: ${dupes.join(', ')}`,
      observed: { duplicates: dupes },
      expected: 'no repeated (symbol,direction) pair',
    },
  ];
}

function checkPillarEngineProducedSignal(scan: Scan): Finding[] {
  const universe: Dict[] = getPath(scan, 'scan_record', 'scored_universe') ?? [];
  if (universe.length < 5) return []; // not enough signal to judge
  const allZeroPass = universe.every((u) => (u?.pillar_pass_count ?? 0) === 0);
  const allNullScore = universe.every((u) => u?.day1_score == null);
  if (!(allZeroPass && allNullScore)) return [];
  return [
    {
      severity: 'warning',
      rule_id: 'pillar.engine_dead',
      field_path: 'scan_record.scored_universe[]',
      message:
        `All ${universe.length} scored tickers have pillar_pass_count=0 and ` +
        `day1_score=null. Pillar engine likely failed to execute; expect ` +
        `non-zero variance on a healthy scan.`,
      observed: {
        universe_size: universe.length,
        nonzero_pillar_count: 0,
        non_null_day1_score_count: 0,
      },
      expected: 'at least one ticker with non-zero pillar_pass_count or non-null day1_score',
    },
  ];
}

function checkShortlistPillarVotesMatchCount(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const votes = entry.pillar_votes;
    const declared = entry.extras?.pillarCount;
    const counted = countTrue(votes);
    if (counted === null) return;
    if (declared !== undefined && declared !== null && declared !== counted) {
      out.push({
        severity: 'error',
        rule_id: 'pillar.votes_count_mismatch',
        field_path: `shortlist_entries[${i}]`,
        message:
          `[${entry.symbol ?? '?'}] extras.pillarCount=${declared} but ` +
          `pillar_votes has ${counted} true entries`,
        observed: { counted, declared },
        expected: 'extras.pillarCount === count of true values in pillar_votes',
      });
    }
  });
  return out;
}

function checkVerdictExtrasMatchesStance(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const stance: string = entry.committee_stance ?? '';
    const extrasVerdict = entry.extras?.verdict;
    const m = STANCE_VERDICT_RE.exec(stance);
    if (!m || !extrasVerdict) return;
    const stanceVerdict = m[1].trim().toUpperCase();
    const declared = String(extrasVerdict).trim().toUpperCase();
    if (stanceVerdict !== declared) {
      out.push({
        severity: 'error',
        rule_id: 'verdict.text_vs_extras_mismatch',
        field_path: `shortlist_entries[${i}]`,
        message:
          `[${entry.symbol ?? '?'}] committee_stance verdict ` +
          `"${stanceVerdict}" != extras.verdict "${declared}"`,
        observed: { stance_verdict: stanceVerdict, extras_verdict: declared },
        expected: 'stance VERDICT line matches extras.verdict (case-insensitive)',
      });
    }
  });
  return out;
}

function checkCommitteeModeVsShortlistVerdicts(scan: Scan): Finding[] {
  const mode = getPath(scan, 'scan_record', 'extras', 'committee_mode');
  if (!mode || String(mode).toUpperCase() !== 'WATCH') return [];
  const offenders: string[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  for (const entry of shortlist) {
    if (!entry || typeof entry !== 'object') continue;
    const extrasVerdict = String(entry.extras?.verdict ?? '').toUpperCase();
    const stance: string = entry.committee_stance ?? '';
    const m = STANCE_VERDICT_RE.exec(stance);
    const stanceVerdict = m ? m[1].trim().toUpperCase() : '';
    if (extrasVerdict === 'TAKE TRADE' || stanceVerdict === 'TAKE TRADE') {
      offenders.push(entry.symbol ?? '?');
    }
  }
  if (offenders.length === 0) return [];
  return [
    {
      severity: 'error',
      rule_id: 'committee.mode_vs_verdict',
      field_path: 'shortlist_entries[]',
      message:
        `committee_mode=WATCH but shortlist entries carry TAKE TRADE ` +
        `verdicts: ${offenders.join(', ')}`,
      observed: { committee_mode: mode, offenders },
      expected: 'committee_mode=WATCH implies no TAKE TRADE verdicts in shortlist',
    },
  ];
}

function checkSummaryVsShortlist(scan: Scan): Finding[] {
  const summary = String(getPath(scan, 'scan_record', 'extras', 'summary') ?? '').toLowerCase();
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  if (summary.includes('no scanner-approved trades') && shortlist.length > 0) {
    return [
      {
        severity: 'warning',
        rule_id: 'summary.contradicts_shortlist',
        field_path: 'scan_record.extras.summary',
        message:
          `summary says "No scanner-approved trades available" but ` +
          `shortlist_entries has ${shortlist.length} candidate(s)`,
        observed: { summary_says_none: true, shortlist_size: shortlist.length },
        expected: 'summary text consistent with shortlist size',
      },
    ];
  }
  return [];
}

function checkCommitteeStanceHasRealValues(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const stance: string = entry.committee_stance ?? '';
    const sym = entry.symbol ?? '?';

    const hasRefPrice = ['reference_last_traded', 'trigger_low', 'trigger_high'].some(
      (k) => entry[k] != null,
    );
    const mCur = STANCE_CURRENT_PRICE_RE.exec(stance);
    if (hasRefPrice && mCur && mCur[1].includes('N/A')) {
      out.push({
        severity: 'warning',
        rule_id: 'stance.current_price_na',
        field_path: `shortlist_entries[${i}].committee_stance`,
        message:
          `[${sym}] committee_stance says "Current Price: N/A" but entry has ` +
          `reference/trigger prices available`,
        observed: {
          stance_line: mCur[0].trim(),
          reference_last_traded: entry.reference_last_traded ?? null,
        },
        expected: 'Current Price populated when reference/trigger prices exist',
      });
    }

    if (entry.trigger_low != null && entry.trigger_high != null) {
      const mZone = STANCE_ENTRY_ZONE_RE.exec(stance);
      if (mZone && mZone[1].includes('N/A')) {
        out.push({
          severity: 'warning',
          rule_id: 'stance.entry_zone_na',
          field_path: `shortlist_entries[${i}].committee_stance`,
          message:
            `[${sym}] committee_stance says "Entry Zone: N/A" but ` +
            `trigger_low/trigger_high are set`,
          observed: {
            stance_line: mZone[0].trim(),
            trigger_low: entry.trigger_low,
            trigger_high: entry.trigger_high,
          },
          expected: 'Entry Zone populated when trigger_low/trigger_high exist',
        });
      }
    }

    const mStop = STANCE_STOP_LINE_RE.exec(stance);
    if (mStop && mStop[2].includes('N/A')) {
      out.push({
        severity: 'warning',
        rule_id: 'stance.stop_risk_na',
        field_path: `shortlist_entries[${i}].committee_stance`,
        message:
          `[${sym}] committee_stance shows stop with "(N/A risk)" — ` +
          `risk calc not populated in template`,
        observed: {
          stance_line: mStop[0].trim(),
          planned_risk_gbp: entry.planned_risk_gbp ?? null,
        },
        expected: 'Stop Loss line carries numeric £risk, not "N/A risk"',
      });
    }
  });
  return out;
}

function checkSetupTypeRaw(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const raw = entry.extras?.setupType_raw;
    const direction = entry.direction ?? '';
    if (raw && direction && String(raw).trim() === `${direction} ${direction}`) {
      out.push({
        severity: 'warning',
        rule_id: 'setup_type.raw_duplicated',
        field_path: `shortlist_entries[${i}].extras.setupType_raw`,
        message:
          `[${entry.symbol ?? '?'}] extras.setupType_raw="${raw}" looks like ` +
          `direction duplicated (template probably wrote ` +
          `\`direction + direction\` instead of \`direction + setup_type\`)`,
        observed: { setupType_raw: raw, direction },
        expected: '"{direction} {setup_type}", e.g. "LONG L-A"',
      });
    }
  });
  return out;
}

function checkRegimeConsistency(scan: Scan): Finding[] {
  const regime = getPath(scan, 'scan_record', 'regime', 'regime');
  const summary: string = getPath(scan, 'scan_record', 'extras', 'summary') ?? '';
  if (!regime || !summary) return [];
  const matches = Array.from(summary.matchAll(/\b(GREEN|YELLOW|RED)\s+regime\b/gi));
  for (const m of matches) {
    const label = m[1].toUpperCase();
    if (label !== String(regime).toUpperCase()) {
      return [
        {
          severity: 'warning',
          rule_id: 'regime.label_mismatch',
          field_path: 'scan_record.regime.regime',
          message:
            `scan_record.regime.regime="${regime}" but summary text ` +
            `references "${label} regime"`,
          observed: { regime, summary_mentions: label },
          expected: 'summary text consistent with scan_record.regime.regime',
        },
      ];
    }
  }
  return [];
}

function checkVersionStamping(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const entries: Array<[string, string]> = [
    ['scanner_version', 'version.scanner_blank'],
    ['rule_set_version', 'version.rule_set_blank'],
  ];
  for (const [key, ruleId] of entries) {
    const val = getPath(scan, 'scan_record', key);
    if (val === null || val === undefined || val === '') {
      out.push({
        severity: 'warning',
        rule_id: ruleId,
        field_path: `scan_record.${key}`,
        message:
          `scan_record.${key} is blank — every scan must be stamped with the ` +
          `code version that produced it for traceability`,
        observed: val ?? null,
        expected: 'non-empty version string',
      });
    }
  }
  return out;
}

function checkGateBypassFlag(scan: Scan): Finding[] {
  const bypass = getPath(scan, 'scan_record', 'gate_bypass');
  if (bypass !== true) return [];
  const reason = getPath(scan, 'scan_record', 'extras', 'bypass_reason');
  // NOTE: GATE_BYPASS_ACTIVE (INFO in the Python source) is intentionally
  // dropped from this TS port until the Finding.severity union gains 'info'.
  // See TODO at the top of the file.
  if (!reason) {
    return [
      {
        severity: 'warning',
        rule_id: 'gate_bypass.no_reason',
        field_path: 'scan_record.extras.bypass_reason',
        message:
          `gate_bypass=true but no extras.bypass_reason set — operators need ` +
          `a human-readable justification for audit`,
        observed: { gate_bypass: true, bypass_reason: reason ?? null },
        expected: 'non-empty bypass_reason when gate_bypass=true',
      },
    ];
  }
  return [];
}

function checkShortlistPricingPopulated(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const missing = ['price_source', 'price_as_of_utc', 'reference_last_traded'].filter(
      (k) => entry[k] == null || entry[k] === '',
    );
    if (missing.length > 0) {
      out.push({
        severity: 'warning',
        rule_id: 'shortlist.pricing_missing',
        field_path: `shortlist_entries[${i}]`,
        message: `[${entry.symbol ?? '?'}] missing pricing metadata: ${missing.join(', ')}`,
        observed: { missing },
        expected: 'price_source, price_as_of_utc, reference_last_traded all populated',
      });
    }
  });
  return out;
}

function checkUniversePricesPresent(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const universe: Dict[] = getPath(scan, 'scan_record', 'scored_universe') ?? [];
  universe.forEach((u, i) => {
    if (!u || typeof u !== 'object') return;
    const price = u.price;
    if (price == null || (typeof price === 'number' && price <= 0)) {
      out.push({
        severity: 'error',
        rule_id: 'universe.price_missing',
        field_path: `scan_record.scored_universe[${i}].price`,
        message:
          `[${u.symbol ?? '?'}] scored_universe entry has no valid price ` +
          `(got ${JSON.stringify(price)})`,
        observed: price ?? null,
        expected: 'positive number',
      });
    }
  });
  return out;
}

function checkDirectionValid(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const d = entry.direction;
    if (d !== 'LONG' && d !== 'SHORT') {
      out.push({
        severity: 'error',
        rule_id: 'direction.invalid',
        field_path: `shortlist_entries[${i}].direction`,
        message:
          `[${entry.symbol ?? '?'}] direction=${JSON.stringify(d)} is not one of LONG/SHORT`,
        observed: d ?? null,
        expected: ['LONG', 'SHORT'],
      });
    }
  });
  return out;
}

function checkStopRelativeToTrigger(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const d = entry.direction;
    const tl = entry.trigger_low;
    const th = entry.trigger_high;
    const sp = entry.stop_price;
    if (d == null || tl == null || th == null || sp == null) return;
    const sym = entry.symbol ?? '?';
    if (d === 'LONG' && sp >= tl) {
      out.push({
        severity: 'error',
        rule_id: 'stop.direction_invalid',
        field_path: `shortlist_entries[${i}].stop_price`,
        message: `[${sym}] LONG stop_price=${sp} must be below trigger_low=${tl}`,
        observed: { stop_price: sp, trigger_low: tl, direction: d },
        expected: 'stop_price < trigger_low for LONG',
      });
    } else if (d === 'SHORT' && sp <= th) {
      out.push({
        severity: 'error',
        rule_id: 'stop.direction_invalid',
        field_path: `shortlist_entries[${i}].stop_price`,
        message: `[${sym}] SHORT stop_price=${sp} must be above trigger_high=${th}`,
        observed: { stop_price: sp, trigger_high: th, direction: d },
        expected: 'stop_price > trigger_high for SHORT',
      });
    }
  });
  return out;
}

function checkTargetRelativeToTrigger(scan: Scan): Finding[] {
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const d = entry.direction;
    const tl = entry.trigger_low;
    const th = entry.trigger_high;
    const tp = entry.target_price;
    if (d == null || tl == null || th == null || tp == null) return;
    const sym = entry.symbol ?? '?';
    if (d === 'LONG' && tp <= th) {
      out.push({
        severity: 'error',
        rule_id: 'target.direction_invalid',
        field_path: `shortlist_entries[${i}].target_price`,
        message: `[${sym}] LONG target_price=${tp} must be above trigger_high=${th}`,
        observed: { target_price: tp, trigger_high: th, direction: d },
        expected: 'target_price > trigger_high for LONG',
      });
    } else if (d === 'SHORT' && tp >= tl) {
      out.push({
        severity: 'error',
        rule_id: 'target.direction_invalid',
        field_path: `shortlist_entries[${i}].target_price`,
        message: `[${sym}] SHORT target_price=${tp} must be below trigger_low=${tl}`,
        observed: { target_price: tp, trigger_low: tl, direction: d },
        expected: 'target_price < trigger_low for SHORT',
      });
    }
  });
  return out;
}

function checkRiskMathConsistent(scan: Scan): Finding[] {
  // KNOWN LIMITATION — false-positives on legitimate IG spread-bet sizing for
  // US symbols (the ×100 points→GBP conversion is not modelled here). Fix
  // tracked in a separate PR so the call-site's SCAN_STRICT default-off
  // period can absorb the WARN without blocking downloads.
  const out: Finding[] = [];
  const shortlist: Dict[] = scan.shortlist_entries ?? [];
  shortlist.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const tl = entry.trigger_low;
    const th = entry.trigger_high;
    const sp = entry.stop_price;
    const stake = entry.planned_stake_gbp_per_pt;
    const declared = entry.planned_risk_gbp;
    if (tl == null || th == null || sp == null || stake == null || declared == null) return;
    const mid = (tl + th) / 2;
    const implied = stake * Math.abs(mid - sp);
    if (declared <= 0 || Math.abs(implied - declared) / declared > 0.10) {
      out.push({
        severity: 'warning',
        rule_id: 'risk.math_inconsistent',
        field_path: `shortlist_entries[${i}].planned_risk_gbp`,
        message:
          `[${entry.symbol ?? '?'}] planned_risk_gbp=${declared} but stake ` +
          `${stake} × |mid−stop| ≈ ${implied.toFixed(2)} (>10% divergence)`,
        observed: {
          declared,
          implied: Number(implied.toFixed(2)),
          stake,
          mid,
          stop: sp,
        },
        expected: '|implied - declared| / declared <= 0.10',
      });
    }
  });
  return out;
}
