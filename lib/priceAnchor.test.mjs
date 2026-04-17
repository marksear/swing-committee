/**
 * priceAnchor.test.mjs — node --test harness for the emission-side anchor.
 *
 * Run with:
 *   node --test lib/priceAnchor.test.mjs
 *
 * Spec: docs/ig_price_grounding_spec.md §6.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coerceToCanonical,
  evaluateDrift,
  expectedCurrency,
  fetchAnchorQuotes,
  stalenessOk,
} from './priceAnchor.js';

// ---------------------------------------------------------------------------
// evaluateDrift
// ---------------------------------------------------------------------------

describe('evaluateDrift', () => {
  it('passes when drift is within threshold', () => {
    const v = evaluateDrift({ llmTriggerMid: 100, reference: 102, maxDriftPct: 0.15 });
    assert.equal(v.ok, true);
    assert.ok(v.drift > 0 && v.drift < 0.05);
  });

  it('rejects DRIFT_OVER_THRESHOLD when drift exceeds threshold', () => {
    const v = evaluateDrift({ llmTriggerMid: 100, reference: 130, maxDriftPct: 0.15 });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'DRIFT_OVER_THRESHOLD');
    assert.ok(v.drift > 0.15);
  });

  it('rejects exactly at threshold as ok (≤, not <)', () => {
    // 15% exactly — boundary: spec uses > maxDriftPct as the rejection cut.
    const v = evaluateDrift({ llmTriggerMid: 115, reference: 100, maxDriftPct: 0.15 });
    assert.equal(v.ok, true);
  });

  it('rejects NO_REFERENCE_QUOTE when reference is null/0/negative/NaN', () => {
    for (const ref of [null, 0, -1, NaN, undefined]) {
      const v = evaluateDrift({ llmTriggerMid: 100, reference: ref });
      assert.equal(v.ok, false, `ref=${ref}`);
      assert.equal(v.reason, 'NO_REFERENCE_QUOTE');
    }
  });

  it('rejects NO_REFERENCE_QUOTE when triggerMid is missing', () => {
    const v = evaluateDrift({ llmTriggerMid: null, reference: 100 });
    assert.equal(v.reason, 'NO_REFERENCE_QUOTE');
  });

  it('flags CURRENCY_MISMATCH when drift exceeds 1000% (scale error)', () => {
    // LLM emitted GBP=15.50, reference GBp=1550 — 99x drift => scale flip.
    const v = evaluateDrift({ llmTriggerMid: 15.5, reference: 1550 });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'CURRENCY_MISMATCH');
    // drift is normalised by reference; the scale heuristic uses max/min
    // ratio (here ~100) so drift itself is just the standard ~0.99.
    assert.ok(v.drift >= 0);
  });
});

// ---------------------------------------------------------------------------
// stalenessOk
// ---------------------------------------------------------------------------

describe('stalenessOk', () => {
  const now = new Date('2026-04-17T15:00:00Z');

  it('accepts a quote inside the window', () => {
    const fresh = new Date(now.getTime() - 60_000).toISOString(); // 1 min old
    assert.equal(stalenessOk(fresh, { maxAgeSec: 600, now }), true);
  });

  it('rejects a quote older than the window', () => {
    const stale = new Date(now.getTime() - 3_600_000).toISOString(); // 1h old
    assert.equal(stalenessOk(stale, { maxAgeSec: 600, now }), false);
  });

  it('rejects null / invalid timestamps', () => {
    assert.equal(stalenessOk(null, { now }), false);
    assert.equal(stalenessOk('not-a-date', { now }), false);
  });

  it('accepts a future-dated quote (clock skew tolerated)', () => {
    const future = new Date(now.getTime() + 5_000).toISOString();
    assert.equal(stalenessOk(future, { now }), true);
  });
});

// ---------------------------------------------------------------------------
// expectedCurrency / coerceToCanonical
// ---------------------------------------------------------------------------

describe('expectedCurrency', () => {
  it('maps .L tickers to GBp', () => {
    assert.equal(expectedCurrency('VOD.L'), 'GBp');
    assert.equal(expectedCurrency('vod.l'), 'GBp');
  });
  it('defaults to USD for non-.L tickers', () => {
    assert.equal(expectedCurrency('AAPL'), 'USD');
    assert.equal(expectedCurrency('BRK-B'), 'USD');
  });
  it('handles non-string inputs defensively', () => {
    assert.equal(expectedCurrency(null), 'USD');
    assert.equal(expectedCurrency(undefined), 'USD');
  });
});

describe('coerceToCanonical', () => {
  it('passes USD prices through unchanged', () => {
    assert.equal(coerceToCanonical(155.42, 'USD', 'AMD'), 155.42);
  });
  it('passes GBp .L prices through unchanged', () => {
    assert.equal(coerceToCanonical(75.5, 'GBp', 'VOD.L'), 75.5);
  });
  it('multiplies GBP .L prices by 100 to canonicalise to GBp', () => {
    assert.equal(coerceToCanonical(0.755, 'GBP', 'VOD.L'), 75.5);
  });
  it('treats unknown currency on .L as already-pence (Yahoo default)', () => {
    assert.equal(coerceToCanonical(75.5, null, 'VOD.L'), 75.5);
  });
  it('returns nullish inputs unchanged', () => {
    assert.equal(coerceToCanonical(null, 'USD', 'AMD'), null);
  });
});

// ---------------------------------------------------------------------------
// fetchAnchorQuotes — exercised with an injected fetch
// ---------------------------------------------------------------------------

function mockYahooFetch(byTicker) {
  return async (url) => {
    const m = url.match(/\/chart\/([^?]+)/);
    const t = m ? m[1] : null;
    const quote = byTicker[t];
    if (!quote) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            {
              meta: {
                regularMarketPrice: quote.last,
                regularMarketTime: quote.tsSec,
                currency: quote.currency || 'USD',
              },
            },
          ],
        },
      }),
    };
  };
}

describe('fetchAnchorQuotes', () => {
  it('returns an empty Map for empty input', async () => {
    const m = await fetchAnchorQuotes([]);
    assert.equal(m.size, 0);
  });

  it('builds a Map keyed by ticker on a happy path', async () => {
    const fetchImpl = mockYahooFetch({
      AMD: { last: 155.42, tsSec: 1_715_000_000, currency: 'USD' },
      AAPL: { last: 178.9, tsSec: 1_715_000_000, currency: 'USD' },
    });
    const m = await fetchAnchorQuotes(['AMD', 'AAPL'], { fetchImpl });
    assert.equal(m.size, 2);
    assert.equal(m.get('AMD').last, 155.42);
    assert.equal(m.get('AMD').source, 'yahoo_chart');
    assert.equal(m.get('AAPL').currency, 'USD');
  });

  it('omits tickers that fail to fetch (downstream → NO_REFERENCE_QUOTE)', async () => {
    const fetchImpl = mockYahooFetch({
      AMD: { last: 155.42, tsSec: 1_715_000_000 },
      // AAPL deliberately missing
    });
    const m = await fetchAnchorQuotes(['AMD', 'AAPL'], { fetchImpl });
    assert.equal(m.size, 1);
    assert.equal(m.has('AAPL'), false);
  });

  it('returns an empty Map for unknown source (forces all to NO_REFERENCE_QUOTE)', async () => {
    const m = await fetchAnchorQuotes(['AMD'], { source: 'finnhub' });
    assert.equal(m.size, 0);
  });
});
