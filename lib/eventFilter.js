/**
 * eventFilter.js — suppress trade signals that collide with scheduled events.
 *
 * Two classes of event will kill a swing trade before the chart gets a say:
 *
 * 1. **Earnings** — an upcoming release on a candidate's own ticker. Holding a
 *    2–3 day swing through earnings is a coin-flip regardless of the setup's
 *    technical quality. We suppress longs and shorts alike when the ticker is
 *    scheduled within `earningsDays` calendar days of the scan date.
 *
 * 2. **High-impact macro** — FOMC meetings, CPI/NFP prints, BoE rate
 *    decisions. These move the whole tape; a breakout initiated 30 minutes
 *    before a 14:00 GMT FOMC decision is essentially a news bet, not a
 *    technical trade. We suppress all new entries within `macroBlockoutHours`
 *    of a high-impact event's scheduled time.
 *
 * Design principles
 * -----------------
 * - Pure function. No I/O, no env reads — the calling route fetches calendar
 *   data and passes it in. Makes it trivially testable under `node --test`.
 * - Fails open: an empty or malformed calendar payload returns all candidates
 *   untouched. The filter is a belt; the scanner's own rules are the braces.
 * - Returns BOTH the passed signals AND the suppression records so the
 *   emitter can surface "why wasn't X shortlisted?" in the scan handoff.
 * - Market-aware: earnings events from Finnhub come with `.symbol` in bare
 *   US form ("VOD") regardless of our internal convention ("VOD.L"). The
 *   matcher normalises both sides before comparing.
 *
 * Integration
 * -----------
 * `buildScanPayload` in scanEmission.js accepts an optional `calendar` arg.
 * When present, it calls `filterByEvents` after the gradable-signal filter
 * and before shortlist emission, moving suppressions into
 * `scanRecord.event_suppressions[]` for downstream inspection.
 *
 * See `app/api/calendar/route.js` for the shape of the calendar payload.
 * See `docs/event_filter_spec.md` for the acceptance criteria.
 */

// High-impact economic events that justify a macro blackout. Finnhub's
// `event` strings vary slightly across releases; the matcher uses
// case-insensitive substring checks.
//
// Rationale: these are the events I've personally seen move the S&P by
// >0.5% in the first 2 minutes post-release. Less-volatile releases
// (housing starts, trade balance) don't clear the bar for a blackout.
const HIGH_IMPACT_EVENT_PATTERNS = [
  /\bfomc\b/i,
  /\bfed(eral)?\s+(funds|rate|interest)/i,
  /\b(cpi|inflation)\b/i,
  /\bnon-?farm\s*payrolls?\b/i,
  /\bnfp\b/i,
  /\bunemployment\s+rate\b/i,
  /\bgdp\b/i,
  /\bboe\b/i,           // Bank of England
  /\bbank\s+of\s+england\b/i,
  /\becb\b/i,           // European Central Bank
  /\bppi\b/i,           // Producer Price Index
  /\bpce\b/i,           // Fed's preferred inflation gauge
  /\bjolts\b/i,         // Labor turnover — noisy but watched
];

// Default windows. Tunable per-call; these are the defaults I'd run with
// on a £500 small account where a single bad earnings print wipes a
// week's worth of edge.
const DEFAULT_EARNINGS_DAYS = 3;
const DEFAULT_MACRO_BLOCKOUT_HOURS = 2;
const DEFAULT_MACRO_LOOKAHEAD_HOURS = 48;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a symbol to bare-ticker form for cross-source matching. */
function bareSymbol(sym) {
  if (!sym || typeof sym !== 'string') return '';
  return sym.toUpperCase().replace(/\.L$/i, '').trim();
}

/** Parse Finnhub's "YYYY-MM-DD" earnings date into a Date at UTC noon.
 *
 *  Noon is arbitrary but avoids timezone edge cases where "2026-04-20" in
 *  America/New_York might straddle a boundary versus Europe/London. We only
 *  care about day-level proximity, so noon-UTC is close enough.
 */
function parseDateOnly(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/** Parse Finnhub's "YYYY-MM-DD HH:MM:SS" (UTC) econ event time.
 *
 *  Finnhub returns economic calendar times in UTC already (per their docs);
 *  we treat them as such. If the string has no time component, falls back
 *  to parseDateOnly which assumes noon-UTC.
 */
function parseEventTime(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  // "2026-04-20 12:30:00" → ISO "2026-04-20T12:30:00Z"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const iso = trimmed.replace(' ', 'T') + 'Z';
    const dt = new Date(iso);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  // Bare date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseDateOnly(trimmed);
  }
  // Fallback — let Date do its best
  const dt = new Date(trimmed);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/** Is this economic event "high impact" by title or by Finnhub's flag? */
function isHighImpact(event) {
  if (!event || typeof event !== 'object') return false;
  if (String(event.impact || '').toLowerCase() === 'high') return true;
  const title = String(event.event || '');
  return HIGH_IMPACT_EVENT_PATTERNS.some((re) => re.test(title));
}

/** Day-count between two Dates (floor, UTC-anchored). Negative if b is before a. */
function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  // Anchor to UTC midnight of each date so partial days don't drift the count.
  const midnightA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const midnightB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((midnightB - midnightA) / MS);
}

// ---------------------------------------------------------------------------
// Indexing — build O(1) lookup tables from a calendar payload
// ---------------------------------------------------------------------------

/**
 * Pre-compute the soonest upcoming earnings per ticker and the set of
 * upcoming high-impact macro events within the lookahead window.
 *
 * Passing the calendar through this once per scan lets `filterByEvents`
 * stay O(n) over candidates instead of O(n × events).
 */
export function indexCalendar(calendar, { now = new Date(), macroLookaheadHours = DEFAULT_MACRO_LOOKAHEAD_HOURS } = {}) {
  const earningsBySymbol = new Map(); // bareSym → { date, hour, raw }
  const macroEvents = [];             // [{ time: Date, event, country, raw }]

  if (!calendar || !Array.isArray(calendar.events)) {
    return { earningsBySymbol, macroEvents };
  }

  const cutoff = new Date(now.getTime() + macroLookaheadHours * 3600 * 1000);

  for (const ev of calendar.events) {
    if (!ev || typeof ev !== 'object') continue;

    if (ev.type === 'earnings') {
      const sym = bareSymbol(ev.symbol);
      if (!sym) continue;
      const dt = parseDateOnly(ev.date);
      if (!dt) continue;
      // Skip earnings in the past (they already happened — no blackout).
      if (dt.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
        continue;
      }
      // Keep the soonest upcoming earnings per ticker
      const prev = earningsBySymbol.get(sym);
      if (!prev || dt < prev.date) {
        earningsBySymbol.set(sym, { date: dt, hour: ev.hour || '', raw: ev });
      }
      continue;
    }

    if (ev.type === 'economic') {
      if (!isHighImpact(ev)) continue;
      const time = parseEventTime(ev.time || ev.date);
      if (!time) continue;
      if (time < now) continue;        // past event — no blackout
      if (time > cutoff) continue;     // beyond our lookahead
      macroEvents.push({ time, event: ev.event || '', country: ev.country || '', raw: ev });
      continue;
    }
    // Unknown event types are silently skipped — fail open.
  }

  // Keep macro events sorted by time so the "nearest upcoming" check is cheap.
  macroEvents.sort((a, b) => a.time - b.time);

  return { earningsBySymbol, macroEvents };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Filter candidates against the calendar.
 *
 * @param {object} args
 * @param {Array<object>} args.candidates  Each must have `ticker`. Other fields
 *                                         (direction, grade, etc.) are passed
 *                                         through unchanged on pass/suppress.
 * @param {object|null} args.calendar      Payload from /api/calendar, or the
 *                                         pre-indexed result of `indexCalendar`.
 * @param {Date} [args.now]                Injectable clock (tests).
 * @param {number} [args.earningsDays]     Calendar days before earnings to
 *                                         start suppressing. Default 3.
 * @param {number} [args.macroBlockoutHours] Hours either side of a high-impact
 *                                         macro event within which to suppress
 *                                         new entries. Default 2.
 * @param {number} [args.macroLookaheadHours] How far ahead to scan the macro
 *                                         calendar. Default 48. Ignored when
 *                                         `calendar` is pre-indexed.
 * @returns {{ passed: object[], suppressions: object[] }}
 */
export function filterByEvents({
  candidates,
  calendar,
  now = new Date(),
  earningsDays = DEFAULT_EARNINGS_DAYS,
  macroBlockoutHours = DEFAULT_MACRO_BLOCKOUT_HOURS,
  macroLookaheadHours = DEFAULT_MACRO_LOOKAHEAD_HOURS,
}) {
  if (!Array.isArray(candidates)) {
    return { passed: [], suppressions: [] };
  }

  // Support both raw calendar payloads and pre-indexed results. The
  // distinguishing marker is `earningsBySymbol`; if present, we assume
  // the caller already called indexCalendar.
  const idx = calendar && calendar.earningsBySymbol instanceof Map
    ? calendar
    : indexCalendar(calendar, { now, macroLookaheadHours });

  const { earningsBySymbol, macroEvents } = idx;
  const blockoutMs = macroBlockoutHours * 3600 * 1000;

  const passed = [];
  const suppressions = [];

  // Pre-compute the nearest upcoming macro event (if any) — single scalar
  // shared across candidates, since it's timestamped absolutely (not per-ticker).
  const macroImminent = macroEvents.find((m) => {
    const delta = m.time.getTime() - now.getTime();
    return delta >= 0 && delta <= blockoutMs;
  }) || null;

  for (const cand of candidates) {
    const ticker = cand?.ticker;
    if (!ticker || typeof ticker !== 'string') {
      // Can't match without a ticker — fail open, keep it.
      passed.push(cand);
      continue;
    }

    // 1. Earnings blackout — per-ticker.
    const earn = earningsBySymbol.get(bareSymbol(ticker));
    if (earn) {
      const days = daysBetween(now, earn.date);
      if (days >= 0 && days <= earningsDays) {
        suppressions.push({
          ticker,
          reason: 'EARNINGS_IMMINENT',
          event: earn.raw.event || `Earnings (${ticker})`,
          days_until: days,
          event_date: earn.date.toISOString().slice(0, 10),
          hour: earn.hour || null,
        });
        continue;
      }
    }

    // 2. Macro blackout — all-ticker.
    if (macroImminent) {
      const hoursUntil = (macroImminent.time.getTime() - now.getTime()) / 3_600_000;
      suppressions.push({
        ticker,
        reason: 'MACRO_BLACKOUT',
        event: macroImminent.event,
        country: macroImminent.country,
        hours_until: +hoursUntil.toFixed(2),
        event_time_utc: macroImminent.time.toISOString(),
      });
      continue;
    }

    passed.push(cand);
  }

  return { passed, suppressions };
}

// ---------------------------------------------------------------------------
// Exports for tests
// ---------------------------------------------------------------------------

export const __test__ = {
  bareSymbol,
  parseDateOnly,
  parseEventTime,
  isHighImpact,
  daysBetween,
  HIGH_IMPACT_EVENT_PATTERNS,
  DEFAULT_EARNINGS_DAYS,
  DEFAULT_MACRO_BLOCKOUT_HOURS,
};
