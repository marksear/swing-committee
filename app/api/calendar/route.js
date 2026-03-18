// Financial Calendar API — fetches economic events and earnings from Finnhub
import { US_STOCKS, UK_STOCKS } from '../../../lib/universe.js'

// 6-hour cache for both endpoints
let economicCache = { data: null, timestamp: 0 }
let earningsCache = { data: null, timestamp: 0 }
const CACHE_TTL = 6 * 60 * 60 * 1000

// Build lookup sets for filtering earnings to universe stocks
const UK_BARE = new Set(UK_STOCKS.map(t => t.replace('.L', '')))
const UK_REVERSE = Object.fromEntries(UK_STOCKS.map(t => [t.replace('.L', ''), t]))
const ALL_TICKERS = new Set([...US_STOCKS, ...UK_BARE])

function formatDate(d) {
  return d.toISOString().split('T')[0]
}

async function fetchEconomicCalendar(from, to) {
  if (economicCache.data && Date.now() - economicCache.timestamp < CACHE_TTL) {
    return economicCache.data
  }

  const key = process.env.FINNHUB_API_KEY
  if (!key) {
    console.warn('[Calendar] FINNHUB_API_KEY not set — skipping economic calendar')
    return []
  }

  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Finnhub economic: ${res.status}`)
    const json = await res.json()

    const events = (json.economicCalendar || [])
      .filter(e => e.impact === 'high' || e.impact === 'medium')
      .map(e => ({
        date: e.time?.split(' ')[0] || '',
        time: e.time || '',
        event: e.event || '',
        country: e.country || '',
        impact: e.impact || 'medium',
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        prev: e.prev ?? null,
        unit: e.unit || '',
        type: 'economic',
      }))

    economicCache = { data: events, timestamp: Date.now() }
    console.log(`[Calendar] Fetched ${events.length} economic events (${from} to ${to})`)
    return events
  } catch (error) {
    console.error('[Calendar] Economic calendar fetch failed:', error.message)
    return economicCache.data || []
  }
}

async function fetchEarningsCalendar(from, to) {
  if (earningsCache.data && Date.now() - earningsCache.timestamp < CACHE_TTL) {
    return earningsCache.data
  }

  const key = process.env.FINNHUB_API_KEY
  if (!key) {
    console.warn('[Calendar] FINNHUB_API_KEY not set — skipping earnings calendar')
    return []
  }

  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Finnhub earnings: ${res.status}`)
    const json = await res.json()

    const events = (json.earningsCalendar || [])
      .filter(e => ALL_TICKERS.has(e.symbol))
      .map(e => ({
        date: e.date || '',
        symbol: UK_REVERSE[e.symbol] || e.symbol,
        epsEstimate: e.epsEstimate ?? null,
        epsActual: e.epsActual ?? null,
        revenueEstimate: e.revenueEstimate ?? null,
        revenueActual: e.revenueActual ?? null,
        hour: e.hour || '',
        type: 'earnings',
      }))

    earningsCache = { data: events, timestamp: Date.now() }
    console.log(`[Calendar] Fetched ${events.length} earnings events for universe stocks (${from} to ${to})`)
    return events
  } catch (error) {
    console.error('[Calendar] Earnings calendar fetch failed:', error.message)
    return earningsCache.data || []
  }
}

export async function GET() {
  try {
    const today = new Date()
    const twoWeeks = new Date(today)
    twoWeeks.setDate(twoWeeks.getDate() + 14)

    const from = formatDate(today)
    const to = formatDate(twoWeeks)

    const [economic, earnings] = await Promise.all([
      fetchEconomicCalendar(from, to),
      fetchEarningsCalendar(from, to),
    ])

    // Merge and sort by date
    const events = [...economic, ...earnings].sort((a, b) => a.date.localeCompare(b.date))

    return Response.json({
      events,
      fromDate: from,
      toDate: to,
      counts: {
        economic: economic.length,
        earnings: earnings.length,
        total: events.length,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Calendar] API error:', error)
    return Response.json(
      { error: 'Failed to fetch calendar data', details: error.message },
      { status: 500 }
    )
  }
}
