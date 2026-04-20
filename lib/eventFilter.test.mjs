/**
 * eventFilter.test.mjs — node --test harness for the Session 10 event filter.
 *
 * Run with:
 *   node --test lib/eventFilter.test.mjs
 *
 * Spec: Session 10 — suppress signals whose ticker has earnings within N days
 * or that fall inside an FOMC / high-impact macro blackout window.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterByEvents,
  indexCalendar,
  __test__,
} from './eventFilter.js';

const {
  bareSymbol,
  parseDateOnly,
  parseEventTime,
  isHighImpact,
  daysBetween,
} = __test__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-20T12:00:00Z'); // Monday noon UTC — our anchor.

/** Return an ISO-like "YYYY-MM-DD HH:MM:SS" Finnhub-shaped timestamp. */
function finnhubTs(iso) {
  return iso.replace('T', ' ').replace('Z', '').replace(/\.\d+/, '');
}

function earnings(symbol, date, hour = 'bmo') {
  return { type: 'earnings', symbol, date, hour };
}

function economic(event, time, { country = 'US', impact = 'high' } = {}) {
  return { type: 'economic', event, time, country, impact };
}

// ---------------------------------------------------------------------------
// bareSymbol
// ---------------------------------------------------------------------------

describe('bareSymbol', () => {
  it('strips .L for LSE tickers', () => {
    assert.equal(bareSymbol('VOD.L'), 'VOD');
    assert.equal(bareSymbol('SHEL.L'), 'SHEL');
  });
  it('leaves bare US tickers untouched', () => {
    assert.equal(bareSymbol('AAPL'), 'AAPL');
  });
  it('upper-cases and trims', () => {
    assert.equal(bareSymbol('  aapl '), 'AAPL');
  });
  it('handles junk input gracefully', () => {
    assert.equal(bareSymbol(null), '');
    assert.equal(bareSymbol(undefined), '');
    assert.equal(bareSymbol(123), '');
  });
});

// ---------------------------------------------------------------------------
// parseDateOnly / parseEventTime
// ---------------------------------------------------------------------------

describe('parseDateOnly', () => {
  it('parses YYYY-MM-DD to UTC noon', () => {
    const dt = parseDateOnly('2026-04-22');
    assert.ok(dt instanceof Date);
    assert.equal(dt.toISOString(), '2026-04-22T12:00:00.000Z');
  });
  it('returns null for non-date strings', () => {
    assert.equal(parseDateOnly('not a date'), null);
    assert.equal(parseDateOnly(''), null);
    assert.equal(parseDateOnly(null), null);
  });
});

describe('parseEventTime', () => {
  it('parses Finnhub "YYYY-MM-DD HH:MM:SS" as UTC', () => {
    const dt = parseEventTime('2026-04-22 14:30:00');
    assert.equal(dt.toISOString(), '2026-04-22T14:30:00.000Z');
  });
  it('accepts "YYYY-MM-DD HH:MM" without seconds', () => {
    const dt = parseEventTime('2026-04-22 14:30');
    assert.equal(dt.toISOString(), '2026-04-22T14:30:00.000Z');
  });
  it('falls back to parseDateOnly for bare dates', () => {
    const dt = parseEventTime('2026-04-22');
    assert.equal(dt.toISOString(), '2026-04-22T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// isHighImpact
// ---------------------------------------------------------------------------

describe('isHighImpact', () => {
  it('accepts Finnhub impact=high verbatim', () => {
    assert.equal(isHighImpact({ impact: 'high', event: 'Random' }), true);
  });
  it('detects FOMC by title even when impact is missing', () => {
    assert.equal(isHighImpact({ event: 'FOMC Rate Decision' }), true);
  });
  it('detects CPI / NFP / GDP by title', () => {
    assert.equal(isHighImpact({ event: 'CPI YoY' }), true);
    assert.equal(isHighImpact({ event: 'Non-Farm Payrolls' }), true);
    assert.equal(isHighImpact({ event: 'GDP Advance Q1' }), true);
  });
  it('rejects medium-impact noise', () => {
    assert.equal(isHighImpact({ event: 'Housing Starts', impact: 'medium' }), false);
    assert.equal(isHighImpact({ event: 'Trade Balance', impact: 'low' }), false);
  });
  it('rejects malformed input', () => {
    assert.equal(isHighImpact(null), false);
    assert.equal(isHighImpact({}), false);
  });
});

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

describe('daysBetween', () => {
  it('counts whole calendar days, UTC-anchored', () => {
    const a = new Date('2026-04-20T23:59:00Z');
    const b = new Date('2026-04-21T00:01:00Z');
    // Different UTC date => 1 day apart regardless of the tiny clock delta.
    assert.equal(daysBetween(a, b), 1);
  });
  it('returns 0 when same UTC date', () => {
    const a = new Date('2026-04-20T00:00:00Z');
    const b = new Date('2026-04-20T23:59:00Z');
    assert.equal(daysBetween(a, b), 0);
  });
  it('returns negative when b is before a', () => {
    const a = new Date('2026-04-22T12:00:00Z');
    const b = new Date('2026-04-20T12:00:00Z');
    assert.equal(daysBetween(a, b), -2);
  });
});

// ---------------------------------------------------------------------------
// indexCalendar
// ---------------------------------------------------------------------------

describe('indexCalendar', () => {
  it('keeps soonest upcoming earnings per ticker', () => {
    const cal = {
      events: [
        earnings('AAPL', '2026-04-28'),
        earnings('AAPL', '2026-04-24'), // earlier — wins
        earnings('MSFT', '2026-04-30'),
      ],
    };
    const { earningsBySymbol } = indexCalendar(cal, { now: NOW });
    assert.equal(earningsBySymbol.size, 2);
    assert.equal(earningsBySymbol.get('AAPL').date.toISOString().slice(0, 10), '2026-04-24');
    assert.equal(earningsBySymbol.get('MSFT').date.toISOString().slice(0, 10), '2026-04-30');
  });

  it('drops earnings that already happened', () => {
    const cal = {
      events: [
        earnings('AAPL', '2026-04-18'), // before NOW (2026-04-20)
      ],
    };
    const { earningsBySymbol } = indexCalendar(cal, { now: NOW });
    assert.equal(earningsBySymbol.size, 0);
  });

  it('keeps only high-impact macro events within lookahead', () => {
    const cal = {
      events: [
        economic('FOMC Rate Decision', '2026-04-22 10:00:00'), // +46h, inside 48h
        economic('Housing Starts', '2026-04-21 12:30:00', { impact: 'medium' }),
        economic('CPI YoY', '2026-04-30 12:30:00'),            // beyond 48h
        economic('Non-Farm Payrolls', '2026-04-21 12:30:00'),  // +24.5h, inside
      ],
    };
    const { macroEvents } = indexCalendar(cal, { now: NOW });
    // FOMC (+46h) is in; NFP (+24.5h) is in.
    // Housing Starts rejected (medium), CPI rejected (>48h out).
    assert.equal(macroEvents.length, 2);
    assert.ok(macroEvents[0].time <= macroEvents[1].time, 'sorted by time');
  });

  it('respects a custom macroLookaheadHours', () => {
    const cal = {
      events: [
        economic('FOMC Rate Decision', '2026-04-23 12:00:00'), // +72h
      ],
    };
    // Default 48h excludes it
    assert.equal(indexCalendar(cal, { now: NOW }).macroEvents.length, 0);
    // Stretched 96h includes it
    assert.equal(
      indexCalendar(cal, { now: NOW, macroLookaheadHours: 96 }).macroEvents.length,
      1
    );
  });

  it('returns empty indexes on missing or malformed calendar', () => {
    const a = indexCalendar(null, { now: NOW });
    assert.equal(a.earningsBySymbol.size, 0);
    assert.equal(a.macroEvents.length, 0);
    const b = indexCalendar({ events: 'not-an-array' }, { now: NOW });
    assert.equal(b.earningsBySymbol.size, 0);
  });
});

// ---------------------------------------------------------------------------
// filterByEvents — end-to-end
// ---------------------------------------------------------------------------

describe('filterByEvents — earnings blackout', () => {
  it('suppresses a candidate with earnings inside the window', () => {
    const cal = { events: [earnings('AAPL', '2026-04-22')] }; // 2 days away
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL', grade: 'A+' }, { ticker: 'MSFT', grade: 'A' }],
      calendar: cal,
      now: NOW,
      earningsDays: 3,
    });
    assert.equal(passed.length, 1);
    assert.equal(passed[0].ticker, 'MSFT');
    assert.equal(suppressions.length, 1);
    assert.equal(suppressions[0].ticker, 'AAPL');
    assert.equal(suppressions[0].reason, 'EARNINGS_IMMINENT');
    assert.equal(suppressions[0].days_until, 2);
  });

  it('passes a candidate whose earnings is beyond the window', () => {
    const cal = { events: [earnings('AAPL', '2026-04-27')] }; // 7 days away
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: cal,
      now: NOW,
      earningsDays: 3,
    });
    assert.equal(passed.length, 1);
    assert.equal(suppressions.length, 0);
  });

  it('matches UK tickers with .L suffix against bare-symbol earnings', () => {
    const cal = { events: [earnings('VOD', '2026-04-22')] };
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'VOD.L', grade: 'B' }],
      calendar: cal,
      now: NOW,
    });
    assert.equal(passed.length, 0);
    assert.equal(suppressions.length, 1);
    assert.equal(suppressions[0].ticker, 'VOD.L'); // preserved in suppression record
  });

  it('respects a custom earningsDays window', () => {
    const cal = { events: [earnings('AAPL', '2026-04-25')] }; // 5 days away
    // Default (3) passes it
    assert.equal(filterByEvents({ candidates: [{ ticker: 'AAPL' }], calendar: cal, now: NOW }).passed.length, 1);
    // Stricter (7) suppresses it
    assert.equal(filterByEvents({ candidates: [{ ticker: 'AAPL' }], calendar: cal, now: NOW, earningsDays: 7 }).suppressions.length, 1);
  });

  it('day-zero earnings (today) is suppressed', () => {
    const cal = { events: [earnings('AAPL', '2026-04-20')] }; // today
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: cal,
      now: NOW,
    });
    assert.equal(passed.length, 0);
    assert.equal(suppressions[0].days_until, 0);
  });
});

describe('filterByEvents — macro blackout', () => {
  it('suppresses all candidates inside an FOMC blackout window', () => {
    // FOMC in 1 hour — default blockout is 2 hours, so this fires.
    const cal = {
      events: [economic('FOMC Rate Decision', '2026-04-20 13:00:00')],
    };
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }, { ticker: 'VOD.L' }],
      calendar: cal,
      now: NOW,
      macroBlockoutHours: 2,
    });
    assert.equal(passed.length, 0);
    assert.equal(suppressions.length, 2);
    assert.ok(suppressions.every((s) => s.reason === 'MACRO_BLACKOUT'));
    assert.ok(suppressions.every((s) => s.event.toLowerCase().includes('fomc')));
  });

  it('passes candidates when FOMC is beyond the blackout', () => {
    // FOMC in 5 hours, blockout 2h — clear.
    const cal = {
      events: [economic('FOMC Rate Decision', '2026-04-20 17:00:00')],
    };
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: cal,
      now: NOW,
      macroBlockoutHours: 2,
    });
    assert.equal(passed.length, 1);
    assert.equal(suppressions.length, 0);
  });

  it('ignores past macro events', () => {
    const cal = {
      events: [economic('FOMC Rate Decision', '2026-04-20 11:00:00')], // 1h ago
    };
    const { passed } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: cal,
      now: NOW,
    });
    assert.equal(passed.length, 1);
  });

  it('prioritises earnings over macro when both apply', () => {
    // AAPL has earnings in 1 day AND there's an FOMC in 1 hour.
    // Earnings gets reported first (per-ticker reason), not macro.
    const cal = {
      events: [
        earnings('AAPL', '2026-04-21'),
        economic('FOMC Rate Decision', '2026-04-20 13:00:00'),
      ],
    };
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: cal,
      now: NOW,
    });
    assert.equal(passed.length, 0);
    assert.equal(suppressions[0].reason, 'EARNINGS_IMMINENT');
  });
});

describe('filterByEvents — degenerate inputs', () => {
  it('fails open with no calendar', () => {
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: null,
      now: NOW,
    });
    assert.equal(passed.length, 1);
    assert.equal(suppressions.length, 0);
  });

  it('fails open with malformed calendar', () => {
    const { passed } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }],
      calendar: { events: 'garbage' },
      now: NOW,
    });
    assert.equal(passed.length, 1);
  });

  it('returns empty on missing candidates', () => {
    const { passed, suppressions } = filterByEvents({ calendar: { events: [] }, now: NOW });
    assert.equal(passed.length, 0);
    assert.equal(suppressions.length, 0);
  });

  it('passes candidates with missing ticker through untouched (fail open)', () => {
    const { passed } = filterByEvents({
      candidates: [{ notATicker: 'oops' }, { ticker: 'AAPL' }],
      calendar: { events: [earnings('AAPL', '2026-04-22')] },
      now: NOW,
    });
    // AAPL suppressed, the ticker-less one kept.
    assert.equal(passed.length, 1);
    assert.deepEqual(passed[0], { notATicker: 'oops' });
  });

  it('accepts pre-indexed calendar to avoid re-indexing cost', () => {
    const idx = indexCalendar({ events: [earnings('AAPL', '2026-04-22')] }, { now: NOW });
    const { passed, suppressions } = filterByEvents({
      candidates: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
      calendar: idx,
      now: NOW,
    });
    assert.equal(passed.length, 1);
    assert.equal(passed[0].ticker, 'MSFT');
    assert.equal(suppressions.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Real-world shapes — smoke tests using the Finnhub payload exactly as the
// /api/calendar route emits it.
// ---------------------------------------------------------------------------

describe('filterByEvents — /api/calendar payload shapes', () => {
  it('handles a realistic mixed payload', () => {
    const cal = {
      events: [
        // Earnings — bare US ticker, BMO
        {
          type: 'earnings',
          date: '2026-04-22',
          symbol: 'AAPL',
          epsEstimate: 1.53,
          epsActual: null,
          hour: 'bmo',
        },
        // Earnings — LSE name Finnhub returns as bare "VOD"
        {
          type: 'earnings',
          date: '2026-04-23',
          symbol: 'VOD',
          hour: 'amc',
        },
        // High-impact macro
        {
          type: 'economic',
          date: '2026-04-21',
          time: '2026-04-21 12:30:00',
          event: 'CPI YoY',
          country: 'US',
          impact: 'high',
        },
        // Medium-impact noise (ignored)
        {
          type: 'economic',
          date: '2026-04-20',
          time: '2026-04-20 13:00:00',
          event: 'Consumer Confidence',
          country: 'US',
          impact: 'medium',
        },
      ],
    };

    const { passed, suppressions } = filterByEvents({
      candidates: [
        { ticker: 'AAPL', grade: 'A+' },
        { ticker: 'VOD.L', grade: 'A' },
        { ticker: 'MSFT', grade: 'B' },
      ],
      calendar: cal,
      now: NOW,
    });

    const bySymbol = Object.fromEntries(suppressions.map((s) => [s.ticker, s]));
    assert.ok(bySymbol['AAPL'], 'AAPL suppressed for earnings');
    assert.equal(bySymbol['AAPL'].reason, 'EARNINGS_IMMINENT');
    assert.ok(bySymbol['VOD.L'], 'VOD.L suppressed for earnings');
    // MSFT has no event — should pass unless the CPI window catches it.
    // CPI is 24.5h away from NOW, default macroBlockoutHours=2 => MSFT passes.
    assert.equal(passed.length, 1);
    assert.equal(passed[0].ticker, 'MSFT');
  });
});
