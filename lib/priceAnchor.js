/**
 * priceAnchor.js — emission-side price grounding for scan handoff.
 *
 * Fetches a fresh reference quote per ticker just before ShortlistEntry
 * emission, then evaluates whether the LLM's trigger zone is close enough
 * to that quote to be trustworthy. Entries that fail the drift / staleness /
 * currency checks are dropped at emit time (not recentered) and surfaced in
 * scanRecord.emission_rejections so a steady-state DEMO run can monitor the
 * rate.
 *
 * Spec: docs/ig_price_grounding_spec.md §6.
 *
 * The fetch path mirrors the same Yahoo URL construction used by
 * app/api/prices/route.js. Pulling that into a shared helper is a follow-up;
 * for now both call shapes match so the two stay drift-free.
 */

const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function yahooUrl(ticker) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
}

async function fetchYahooOne(ticker, fetchImpl) {
  const yahooTicker = ticker.toUpperCase().trim();
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(yahooUrl(yahooTicker), {
    headers: { 'User-Agent': YAHOO_USER_AGENT },
  });
  if (res.ok) return parseYahoo(yahooTicker, await res.json());

  // Mirror /api/prices: bare-symbol miss → retry with .L (UK fallback).
  if (!yahooTicker.includes('.')) {
    const ukRes = await fetchFn(yahooUrl(`${yahooTicker}.L`), {
      headers: { 'User-Agent': YAHOO_USER_AGENT },
    });
    if (ukRes.ok) return parseYahoo(`${yahooTicker}.L`, await ukRes.json());
  }
  return null;
}

function parseYahoo(ticker, data) {
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const last = meta?.regularMarketPrice;
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) return null;
  // regularMarketTime is unix seconds; fall back to "now" if absent so the
  // staleness check has something to compare against.
  const tsSec = typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime : null;
  const asOfUtc = tsSec
    ? new Date(tsSec * 1000).toISOString()
    : new Date().toISOString();
  return {
    ticker,
    last,
    asOfUtc,
    source: 'yahoo_chart',
    currency: meta.currency || null,
  };
}

/**
 * Fetch reference quotes for a set of tickers.
 *
 * Missing tickers are simply absent from the returned Map — toShortlistEntry
 * treats absent → NO_REFERENCE_QUOTE. Errors are swallowed for the same
 * reason: the rejection path is the right surface, not an exception.
 *
 * @param {string[]} tickers
 * @param {object} [opts]
 * @param {string} [opts.source='yahoo_chart']
 * @param {number} [opts.concurrency=8]
 * @param {Function} [opts.fetchImpl]      Test seam; defaults to global fetch.
 * @returns {Promise<Map<string, {last:number, asOfUtc:string, source:string, currency:string|null}>>}
 */
export async function fetchAnchorQuotes(
  tickers,
  { source = 'yahoo_chart', concurrency = 8, fetchImpl } = {},
) {
  const out = new Map();
  if (!Array.isArray(tickers) || tickers.length === 0) return out;
  if (source !== 'yahoo_chart') {
    // Future sources (ig_snapshot, finnhub) plug in here. Until then, an
    // unknown source returns an empty map and every entry rejects with
    // NO_REFERENCE_QUOTE — fail loud rather than silently shipping unanchored.
    return out;
  }

  const queue = [...new Set(tickers)];
  const workerCount = Math.min(Math.max(1, concurrency), queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try {
        const quote = await fetchYahooOne(t, fetchImpl);
        if (quote) out.set(t, quote);
      } catch (_) {
        // Absent → NO_REFERENCE_QUOTE downstream.
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Compare an LLM-emitted trigger-zone midpoint to a reference quote.
 *
 * Returns one of three shapes:
 *   { ok: true,  drift }
 *   { ok: false, reason: 'NO_REFERENCE_QUOTE' }
 *   { ok: false, reason: 'CURRENCY_MISMATCH', drift }   // drift > 1000%
 *   { ok: false, reason: 'DRIFT_OVER_THRESHOLD', drift }
 *
 * The CURRENCY_MISMATCH branch matches spec §6.2: a >1000% gap is almost
 * always a GBp/GBP scale error rather than genuine market drift.
 */
export function evaluateDrift({ llmTriggerMid, reference, maxDriftPct = 0.15 }) {
  if (reference == null || reference <= 0 || !Number.isFinite(reference)) {
    return { ok: false, reason: 'NO_REFERENCE_QUOTE' };
  }
  if (llmTriggerMid == null || !Number.isFinite(llmTriggerMid)) {
    return { ok: false, reason: 'NO_REFERENCE_QUOTE' };
  }
  const drift = Math.abs(llmTriggerMid - reference) / reference;
  // Scale mismatch heuristic: one side at least 10× the other → almost
  // certainly a GBp/GBP coercion miss, not real drift. Use the symmetric
  // max/min ratio so it triggers regardless of which side is larger.
  if (llmTriggerMid > 0) {
    const ratio = Math.max(llmTriggerMid, reference) / Math.min(llmTriggerMid, reference);
    if (ratio > 10) return { ok: false, reason: 'CURRENCY_MISMATCH', drift };
  }
  if (drift > maxDriftPct) return { ok: false, reason: 'DRIFT_OVER_THRESHOLD', drift };
  return { ok: true, drift };
}

/**
 * Is this quote fresh enough to anchor against?
 *
 * v1 is a blanket maxAgeSec; the TODO is to widen this outside RTH so a
 * pre-market scan doesn't auto-reject on quotes that are simply waiting for
 * the open. Until that lands, callers can override maxAgeSec per call.
 */
export function stalenessOk(asOfUtc, { maxAgeSec = 600, now = new Date() } = {}) {
  if (!asOfUtc) return false;
  const t = new Date(asOfUtc).getTime();
  if (Number.isNaN(t)) return false;
  const ageSec = (now.getTime() - t) / 1000;
  if (ageSec < 0) return true; // future-dated quote — trust the source.
  return ageSec <= maxAgeSec;
}

/**
 * Canonical currency for a ticker. UK Yahoo (.L) returns prices in pence
 * (GBp); IG quotes UK in pence too. Canonical scale = GBp.
 */
export function expectedCurrency(ticker) {
  if (typeof ticker !== 'string') return 'USD';
  return ticker.toUpperCase().endsWith('.L') ? 'GBp' : 'USD';
}

/**
 * Coerce a price to canonical scale based on its declared currency. Used
 * before drift comparison so a GBP-quoted UK price is converted to GBp,
 * matching the IG scale that the LLM levels are presumably written in.
 *
 * No-op for USD or for already-canonical inputs.
 */
export function coerceToCanonical(value, currency, ticker) {
  if (value == null || !Number.isFinite(value)) return value;
  if (expectedCurrency(ticker) !== 'GBp') return value;
  if (currency === 'GBP') return value * 100;
  return value;
}

const _api = {
  fetchAnchorQuotes,
  evaluateDrift,
  stalenessOk,
  expectedCurrency,
  coerceToCanonical,
};
export default _api;
