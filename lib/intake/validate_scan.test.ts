// validate_scan.test.ts — Vitest suite for the swing-committee TS validator.
//
// Mirrors the assertions in money-program-trading/tests/test_validate_scan.py
// so parity between the two implementations is machine-verifiable. When the
// Python tests change, these change with them.
//
// Runs under Vitest (`vitest run lib/intake/validate_scan.test.ts`). If
// swing-committee is on Jest, remove the vitest import and rely on injected
// globals — the describe/it/expect idiom is identical.

import { describe, it, expect } from 'vitest';
import {
  validateFullScan,
  validateScanPayload,
  hasBlockingFindings,
  type Finding,
} from './validate_scan';

import cleanFixture from './__fixtures__/scan_clean_example.json' with { type: 'json' };
import bypassFixture from './__fixtures__/scan_20260422_bypass.json' with { type: 'json' };

// ── Helpers ─────────────────────────────────────────────────────────

function codesOf(findings: Finding[], severity?: 'error' | 'warning'): Set<string> {
  return new Set(
    findings
      .filter((f) => !severity || f.severity === severity)
      .map((f) => f.rule_id),
  );
}

function countOf(findings: Finding[], ruleId: string): number {
  return findings.filter((f) => f.rule_id === ruleId).length;
}

// Deep clone a fixture so mutations in one test don't bleed into others.
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// ── Bypass fixture — must catch every known spec §2 defect ──────────

describe('bypass fixture (scan_20260422_bypass.json) — motivating defects', () => {
  const result = validateFullScan(bypassFixture as any);

  it('is not ingestable (ok === false)', () => {
    expect(result.ok).toBe(false);
    expect(hasBlockingFindings(result)).toBe(true);
  });

  it('flags MS, LMT, ABBV as orphans (shortlist.not_subset_of_universe)', () => {
    expect(codesOf(result.findings, 'error')).toContain('shortlist.not_subset_of_universe');
    const f = result.findings.find((x) => x.rule_id === 'shortlist.not_subset_of_universe');
    expect(f).toBeDefined();
    expect(new Set((f!.observed as any).orphans)).toEqual(new Set(['MS', 'LMT', 'ABBV']));
  });

  it('flags dead pillar engine (pillar.engine_dead)', () => {
    expect(codesOf(result.findings, 'warning')).toContain('pillar.engine_dead');
  });

  it('flags all three verdict mismatches (3× verdict.text_vs_extras_mismatch)', () => {
    expect(countOf(result.findings, 'verdict.text_vs_extras_mismatch')).toBe(3);
  });

  it('flags committee_mode=WATCH vs TAKE TRADE verdicts (committee.mode_vs_verdict)', () => {
    expect(codesOf(result.findings, 'error')).toContain('committee.mode_vs_verdict');
  });

  it('flags summary contradiction (summary.contradicts_shortlist)', () => {
    expect(codesOf(result.findings, 'warning')).toContain('summary.contradicts_shortlist');
  });

  it('flags all three stance N/A variants (3× each)', () => {
    expect(countOf(result.findings, 'stance.current_price_na')).toBe(3);
    expect(countOf(result.findings, 'stance.entry_zone_na')).toBe(3);
    expect(countOf(result.findings, 'stance.stop_risk_na')).toBe(3);
  });

  it('flags "LONG LONG" / "SHORT SHORT" duplicated setup_type_raw (3× setup_type.raw_duplicated)', () => {
    expect(countOf(result.findings, 'setup_type.raw_duplicated')).toBe(3);
  });

  it('flags regime YELLOW vs summary GREEN (regime.label_mismatch)', () => {
    expect(codesOf(result.findings, 'warning')).toContain('regime.label_mismatch');
  });

  it('flags blank version stamps (version.scanner_blank + version.rule_set_blank)', () => {
    const warnings = codesOf(result.findings, 'warning');
    expect(warnings).toContain('version.scanner_blank');
    expect(warnings).toContain('version.rule_set_blank');
  });

  it('flags missing bypass reason (gate_bypass.no_reason)', () => {
    expect(codesOf(result.findings, 'warning')).toContain('gate_bypass.no_reason');
  });

  it('flags all three missing pricing entries (3× shortlist.pricing_missing)', () => {
    expect(countOf(result.findings, 'shortlist.pricing_missing')).toBe(3);
  });

  it('drops GATE_BYPASS_ACTIVE — not yet mapped to TS (INFO severity pending)', () => {
    // Will reappear once the severity union gains 'info'. See TODO in validate_scan.ts.
    expect(codesOf(result.findings).has('gate_bypass.active')).toBe(false);
  });

  it('aggregate error/warning counts match the Python validator (5 error, 24 warning)', () => {
    const errors = result.findings.filter((f) => f.severity === 'error').length;
    const warnings = result.findings.filter((f) => f.severity === 'warning').length;
    expect(errors).toBe(5);
    expect(warnings).toBe(24);
  });
});

// ── Clean fixture — must be green except for the known risk-math WARN ──

describe('clean fixture (scan_clean_example.json) — known-good scan', () => {
  const result = validateFullScan(cleanFixture as any);

  it('produces zero errors (ok === true)', () => {
    expect(result.ok).toBe(true);
    const errors = result.findings.filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('shortlist is a subset of scored_universe', () => {
    expect(codesOf(result.findings).has('shortlist.not_subset_of_universe')).toBe(false);
  });

  it('pillar engine is not flagged dead', () => {
    expect(codesOf(result.findings).has('pillar.engine_dead')).toBe(false);
  });

  it('verdicts are consistent', () => {
    expect(codesOf(result.findings).has('verdict.text_vs_extras_mismatch')).toBe(false);
  });

  it('trips exactly one warning: risk.math_inconsistent on NVDA (IG spread-bet false positive pending fix)', () => {
    const warnings = result.findings.filter((f) => f.severity === 'warning');
    expect(warnings.length).toBe(1);
    expect(warnings[0].rule_id).toBe('risk.math_inconsistent');
  });
});

// ── Synthetic / targeted checks ─────────────────────────────────────

describe('synthetic scans — targeted check coverage', () => {
  it('LONG stop above trigger_low is an error (stop.direction_invalid)', () => {
    const scan = clone(cleanFixture) as any;
    scan.shortlist_entries[0].stop_price = 145.0; // > trigger_low 142.5
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('stop.direction_invalid');
  });

  it('SHORT stop below trigger_high is an error (stop.direction_invalid)', () => {
    const scan = clone(cleanFixture) as any;
    const e = scan.shortlist_entries[0];
    e.direction = 'SHORT';
    e.trigger_low = 100.0;
    e.trigger_high = 102.0;
    e.stop_price = 99.0; // must be > trigger_high for SHORT
    e.target_price = 90.0;
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('stop.direction_invalid');
  });

  it('LONG target below trigger_high is an error (target.direction_invalid)', () => {
    const scan = clone(cleanFixture) as any;
    scan.shortlist_entries[0].target_price = 140.0; // < trigger_high 144.2
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('target.direction_invalid');
  });

  it('duplicate (symbol,direction) in shortlist is an error (shortlist.duplicates)', () => {
    const scan = clone(cleanFixture) as any;
    scan.shortlist_entries.push(clone(scan.shortlist_entries[0]));
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('shortlist.duplicates');
  });

  it('invalid direction is an error (direction.invalid)', () => {
    const scan = clone(cleanFixture) as any;
    scan.shortlist_entries[0].direction = 'SIDEWAYS';
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('direction.invalid');
  });

  it('extras.pillarCount disagrees with pillar_votes count → error (pillar.votes_count_mismatch)', () => {
    const scan = clone(cleanFixture) as any;
    // Clean has 4 true votes; declare 2 to force mismatch.
    scan.shortlist_entries[0].extras.pillarCount = 2;
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('pillar.votes_count_mismatch');
  });

  it('null price on a scored universe entry is an error (universe.price_missing)', () => {
    const scan = clone(cleanFixture) as any;
    scan.scan_record.scored_universe[0].price = null;
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('universe.price_missing');
  });

  it('zero/negative price is an error (universe.price_missing)', () => {
    const scan = clone(cleanFixture) as any;
    scan.scan_record.scored_universe[1].price = 0;
    const errors = codesOf(validateFullScan(scan).findings, 'error');
    expect(errors).toContain('universe.price_missing');
  });
});

// ── Shape / API contract ────────────────────────────────────────────

describe('finding shape & API contract', () => {
  const result = validateFullScan(bypassFixture as any);

  it('every finding has the required shape-B fields', () => {
    for (const f of result.findings) {
      expect(f.severity === 'error' || f.severity === 'warning').toBe(true);
      expect(typeof f.rule_id).toBe('string');
      expect(f.rule_id.length).toBeGreaterThan(0);
      expect(typeof f.field_path).toBe('string');
      expect(typeof f.message).toBe('string');
      expect(f.message.length).toBeGreaterThan(0);
      expect(f).toHaveProperty('observed');
      expect(f).toHaveProperty('expected');
    }
  });

  it('all rule_ids use dotted lowercase snake_case', () => {
    for (const f of result.findings) {
      expect(f.rule_id).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it('ok === !findings.some(f => f.severity === "error")', () => {
    expect(result.ok).toBe(!result.findings.some((f) => f.severity === 'error'));
  });

  it('findings are sorted: errors before warnings, then by rule_id, then by field_path', () => {
    const sorted = [...result.findings].sort((a, b) => {
      const sev = (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1);
      if (sev !== 0) return sev;
      const rid = a.rule_id.localeCompare(b.rule_id);
      if (rid !== 0) return rid;
      return a.field_path.localeCompare(b.field_path);
    });
    expect(result.findings).toEqual(sorted);
  });

  it('validateScanPayload skips envelope checks (accepts decomposed shape from buildScanPayload)', () => {
    const full = bypassFixture as any;
    // Call the payload-shape API — no schema_version at the top.
    const result = validateScanPayload(full.scan_record, full.shortlist_entries);
    // Must still produce the 5 content ERRORs; envelope check codes must not appear.
    expect(result.ok).toBe(false);
    const codes = codesOf(result.findings);
    expect(codes.has('schema.top_level_missing')).toBe(false);
    expect(codes.has('schema.version_missing')).toBe(false);
    expect(codes.has('scan_record.shape_invalid')).toBe(false);
    // Core content errors still fire.
    expect(codes).toContain('shortlist.not_subset_of_universe');
    expect(codes).toContain('committee.mode_vs_verdict');
  });

  it('hasBlockingFindings returns true on bypass, false on clean', () => {
    expect(hasBlockingFindings(validateFullScan(bypassFixture as any))).toBe(true);
    expect(hasBlockingFindings(validateFullScan(cleanFixture as any))).toBe(false);
  });
});
