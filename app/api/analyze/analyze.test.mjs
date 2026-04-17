// Lean-scan tests — see docs/lean_scan_spec.md §7.
//
// Covers the JSON-only parse path in /api/analyze/route.js after the narrative
// Parts A–G were removed. These tests import the route module directly, so we
// must stub ANTHROPIC_API_KEY before import (the module instantiates a client
// at load time — the client is never called in these tests, but the
// constructor refuses to run without an apiKey).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseResponse, convertJsonToSignals } = await import('./route.js')

// ---------------------------------------------------------------------------
// §7 case 1 — happy path parse
// ---------------------------------------------------------------------------

test('parseResponse — happy path JSON response produces {mode, summary, signals, parsedPositions, positionSummary}', () => {
  const mockResponse = '```json\n' + JSON.stringify({
    committee: 'TAKE',
    summary: 'Two A-grade longs in semis, one B-grade short in energy.',
    trades: [
      {
        ticker: 'NVDA',
        direction: 'LONG',
        grade: 'A+',
        verdict: 'TAKE-TRADE',
        trigger_low: 155.20,
        trigger_high: 158.40,
        stop: 150.00,
        target: 170.00,
        rationale_one_liner: '6/6 pillars, VCP breakout, sector RS top decile',
      },
      {
        ticker: 'AMD',
        direction: 'LONG',
        grade: 'A',
        verdict: 'TAKE-TRADE',
        trigger_low: 142.00,
        trigger_high: 144.00,
        stop: 138.00,
        target: 152.00,
        rationale_one_liner: '5/6 pillars, pullback to rising 20d MA',
      },
      {
        ticker: 'XLE',
        direction: 'SHORT',
        grade: 'B',
        verdict: 'TAKE-TRADE',
        trigger_low: 88.40,
        trigger_high: 89.00,
        stop: 91.00,
        target: 83.00,
        rationale_one_liner: '4/6 pillars, failed breakout at resistance',
      },
    ],
    positionReviews: [],
    positionSummary: null,
  }, null, 2) + '\n```'

  const result = parseResponse(mockResponse, {})

  // Required top-level fields.
  assert.equal(result.mode, 'TAKE', 'mode should come from jsonData.committee')
  assert.equal(result.summary.startsWith('Two A-grade'), true, 'summary preserved')
  assert.ok(Array.isArray(result.signals), 'signals is an array')
  assert.equal(result.signals.length, 3, 'all three trades converted to signals')
  assert.deepEqual(result.parsedPositions, [], 'empty positionReviews passes through')
  assert.equal(result.positionSummary, null, 'null positionSummary preserved')

  // Fields that MUST NOT be present after the lean-scan refactor
  // (these were the old narrative Parts A–G extracted by extractSection).
  const deadFields = [
    'marketRegime',
    'positionsReview',
    'watchlistSignals',
    'committeePositions',
    'chairDecision',
    'decisionJournal',
    'pillarReminder',
    'fullAnalysis',
  ]
  for (const f of deadFields) {
    assert.equal(Object.hasOwn(result, f), false, `result should not contain dead field ${f}`)
  }

  // Every signal has the rationale propagated through convertJsonToSignals.
  for (const s of result.signals) {
    assert.ok(typeof s.rationale_one_liner === 'string' && s.rationale_one_liner.length > 0,
      `signal ${s.ticker} should carry rationale_one_liner`)
  }

  // Verdict normalisation: TAKE-TRADE (hyphen) → TAKE TRADE (space) so
  // scanEmission's legacy filter still matches.
  for (const s of result.signals) {
    assert.equal(s.verdict, 'TAKE TRADE', `${s.ticker} verdict normalised to legacy form`)
  }
})

// ---------------------------------------------------------------------------
// §7 case 2 — malformed response
// ---------------------------------------------------------------------------

test('parseResponse — throws on response with no JSON block', () => {
  assert.throws(
    () => parseResponse('this is plain prose, no JSON anywhere', {}),
    /LLM did not return valid JSON/,
  )
})

test('parseResponse — throws on response with broken JSON', () => {
  // Malformed JSON inside a ```json block. extractJsonData tries three
  // strategies; all must fail before parseResponse throws.
  const broken = '```json\n{ "committee": "TAKE", "trades": [\n```'
  assert.throws(
    () => parseResponse(broken, {}),
    /LLM did not return valid JSON/,
  )
})

// ---------------------------------------------------------------------------
// §7 case 3 — rationale + trigger_low/high + entry-as-object propagation
// ---------------------------------------------------------------------------

test('convertJsonToSignals — attaches rationale_one_liner + trigger_low/high + entry as {low,high} on every trade', () => {
  const jsonData = {
    committee: 'TAKE',
    summary: '',
    trades: [
      { ticker: 'A', direction: 'LONG', grade: 'A+', verdict: 'TAKE-TRADE',
        trigger_low: 10, trigger_high: 11, stop: 9, target: 14,
        rationale_one_liner: 'first rationale' },
      { ticker: 'B', direction: 'SHORT', grade: 'A', verdict: 'TAKE-TRADE',
        trigger_low: 20, trigger_high: 21, stop: 23, target: 17,
        rationale_one_liner: 'second rationale' },
      { ticker: 'C', direction: 'LONG', grade: 'B', verdict: 'TAKE-TRADE',
        trigger_low: 30, trigger_high: 31, stop: 29, target: 34,
        rationale_one_liner: 'third rationale' },
    ],
  }

  const signals = convertJsonToSignals(jsonData, {})

  assert.equal(signals.length, 3, 'three signals produced')
  const rationales = signals.map((s) => s.rationale_one_liner)
  assert.deepEqual(rationales, ['first rationale', 'second rationale', 'third rationale'],
    'rationales preserved in order')

  // trigger_low / trigger_high as numeric scalars on the signal itself.
  assert.equal(signals[0].trigger_low, 10)
  assert.equal(signals[0].trigger_high, 11)
  assert.equal(signals[1].trigger_low, 20)
  assert.equal(signals[2].trigger_high, 31)

  // entry as {low, high} object — the shape scanEmission's parseTriggerZone
  // already understands (see lib/scanEmission.js:108–115).
  for (const s of signals) {
    assert.equal(typeof s.entry, 'object', `${s.ticker} entry is an object`)
    assert.ok(s.entry !== null, `${s.ticker} entry is non-null`)
    assert.equal(typeof s.entry.low, 'number', `${s.ticker} entry.low is number`)
    assert.equal(typeof s.entry.high, 'number', `${s.ticker} entry.high is number`)
    assert.ok(s.entry.low <= s.entry.high, `${s.ticker} entry.low ≤ entry.high`)
  }

  // scanEmission shortlist filter expects space-separated verdicts.
  for (const s of signals) {
    assert.equal(s.verdict, 'TAKE TRADE', `${s.ticker} verdict space-normalised`)
  }
})

test('convertJsonToSignals — falls back when trigger_low/trigger_high absent', () => {
  // Back-compat path: if an LLM response predates the new schema, the
  // converter should fall through to the old `entry` string field rather
  // than crashing.
  const jsonData = {
    trades: [
      { ticker: 'X', direction: 'LONG', grade: 'A', verdict: 'TAKE-TRADE',
        entry: '100.00-102.00', stop: 95, target: 110,
        rationale_one_liner: 'legacy shape' },
    ],
  }
  const signals = convertJsonToSignals(jsonData, {})
  assert.equal(signals.length, 1)
  assert.equal(signals[0].entry, '100.00-102.00', 'legacy string entry preserved')
  assert.equal(signals[0].trigger_low, null, 'trigger_low null when absent')
  assert.equal(signals[0].trigger_high, null, 'trigger_high null when absent')
})

test('convertJsonToSignals — canonical ticker-name override still works', () => {
  // Regression guard for the SMT.L hallucination fix (see
  // memory/feedback_ai_prompts.md). Scanner-sourced names MUST override
  // whatever the LLM produced.
  const jsonData = {
    trades: [
      {
        ticker: 'SMT.L',
        direction: 'LONG',
        grade: 'A',
        verdict: 'TAKE-TRADE',
        trigger_low: 1350,
        trigger_high: 1370,
        stop: 1322,
        target: 1402,
        rationale_one_liner: 'test',
        tradeAnalysis: { company: 'Smiths Group PLC' }, // hallucination
      },
    ],
  }
  const scannerResults = {
    results: {
      long: [{ ticker: 'SMT.L', name: 'Scottish Mortgage Inv Tr' }],
      short: [],
      watchlist: [],
    },
  }

  const signals = convertJsonToSignals(jsonData, scannerResults)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].name, 'Scottish Mortgage Inv Tr', 'canonical name wins over hallucination')
  // And the override wrote back into the JSON object so build*AnalysisText
  // picked it up:
  assert.equal(jsonData.trades[0].tradeAnalysis.company, 'Scottish Mortgage Inv Tr',
    'company field mutated in place so rawSection sees the correct name')
})
