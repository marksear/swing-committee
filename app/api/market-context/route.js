/**
 * Market Context Layer (MCL) — Phase 1
 * Fetches 10 Yahoo Finance tickers and computes 4 independent market context factors:
 *   1. Risk Sentiment (ES, NQ, GC)
 *   2. Volatility Regime (VIX)
 *   3. Macro Pressure (TNX, DXY)
 *   4. Global Session Flow (Nikkei, Hang Seng, ASX)
 *
 * Advisory only — does NOT feed into scanner. User still decides regime manually.
 */

// ── Ticker Universe ──
const TICKERS = {
  // Tier 1 — core signals
  ES: 'ES=F',       // S&P 500 E-mini futures
  NQ: 'NQ=F',       // Nasdaq 100 E-mini futures
  VIX: '^VIX',      // CBOE Volatility Index
  TNX: '^TNX',      // 10-Year Treasury Yield
  DXY: 'DX-Y.NYB',  // US Dollar Index
  GC: 'GC=F',       // Gold futures
  // Tier 2 — enrichment (graceful degradation)
  N225: '^N225',     // Nikkei 225
  HSI: '^HSI',       // Hang Seng Index
  AXJO: '^AXJO',     // ASX 200
  CL: 'CL=F',       // Crude Oil futures
}

const TIER1_KEYS = ['ES', 'NQ', 'VIX', 'TNX', 'DXY', 'GC']
const TIER2_KEYS = ['N225', 'HSI', 'AXJO', 'CL']

// ── Yahoo Finance fetch ──
async function fetchTickerData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  const meta = result.meta
  const closes = result.indicators?.quote?.[0]?.close?.filter(c => c !== null) || []
  const price = meta.regularMarketPrice
  const previousClose = meta.previousClose || meta.chartPreviousClose

  if (!price || !previousClose) return null

  const change = price - previousClose
  const changePercent = ((change / previousClose) * 100)

  return {
    symbol,
    price,
    previousClose,
    change: parseFloat(change.toFixed(4)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    closes,  // last 5 daily closes for trend analysis
    marketState: meta.marketState || 'UNKNOWN',
    available: true,
  }
}

// ── Factor Computations ──

function computeRiskSentiment(tickers) {
  const es = tickers.ES
  const nq = tickers.NQ
  const gc = tickers.GC

  const futuresChanges = [es?.changePercent, nq?.changePercent].filter(v => v !== undefined && v !== null)
  const avgFuturesChange = futuresChanges.length > 0
    ? futuresChanges.reduce((a, b) => a + b, 0) / futuresChanges.length
    : null

  const gcChange = gc?.changePercent ?? null

  // Determine confidence
  const availableCount = [es, nq, gc].filter(t => t?.available).length
  const confidence = availableCount >= 3 ? 'HIGH' : availableCount >= 2 ? 'MEDIUM' : availableCount >= 1 ? 'LOW' : 'NONE'

  if (avgFuturesChange === null) {
    return { state: 'UNKNOWN', confidence: 'NONE', inputs: { es: null, nq: null, gc: null } }
  }

  let state = 'NEUTRAL'
  if (avgFuturesChange > 0.3 && (gcChange === null || gcChange < 0.3)) {
    state = 'RISK_ON'
  } else if (avgFuturesChange < -0.3 && (gcChange === null || gcChange > 0.3)) {
    state = 'RISK_OFF'
  }

  return {
    state,
    confidence,
    inputs: {
      es: es?.available ? { price: es.price, change: es.changePercent } : null,
      nq: nq?.available ? { price: nq.price, change: nq.changePercent } : null,
      gc: gc?.available ? { price: gc.price, change: gc.changePercent } : null,
    }
  }
}

function computeVolatilityRegime(tickers) {
  const vix = tickers.VIX

  if (!vix?.available) {
    return { state: 'UNKNOWN', confidence: 'NONE', inputs: { vixLevel: null, vix5dAvg: null, vixTrend: null } }
  }

  const vixLevel = vix.price
  const closes = vix.closes || []
  const has5dHistory = closes.length >= 3  // at least a few days for comparison

  // 5-day average from available closes
  const vix5dAvg = closes.length > 0
    ? parseFloat((closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(2))
    : vixLevel

  const vixTrend = vixLevel > vix5dAvg * 1.02 ? 'rising'
    : vixLevel < vix5dAvg * 0.98 ? 'falling'
    : 'stable'

  const confidence = has5dHistory ? 'HIGH' : 'MEDIUM'

  let state = 'NORMAL'
  if (vixLevel > 25 || (vixLevel > 20 && vixTrend === 'rising')) {
    state = 'HIGH_VOL'
  } else if (vixLevel < 15) {
    state = 'LOW_VOL'
  }

  return {
    state,
    confidence,
    inputs: {
      vixLevel: parseFloat(vixLevel.toFixed(2)),
      vix5dAvg,
      vixTrend,
    }
  }
}

function computeMacroPressure(tickers) {
  const tnx = tickers.TNX
  const dxy = tickers.DXY

  const availableCount = [tnx, dxy].filter(t => t?.available).length
  const confidence = availableCount >= 2 ? 'HIGH' : availableCount >= 1 ? 'MEDIUM' : 'NONE'

  if (availableCount === 0) {
    return { state: 'UNKNOWN', confidence: 'NONE', inputs: { yieldChange: null, dollarChange: null } }
  }

  const yieldChange = tnx?.changePercent ?? null
  const dollarChange = dxy?.changePercent ?? null

  // Count headwind / tailwind signals
  let headwindCount = 0
  let tailwindCount = 0

  if (yieldChange !== null) {
    if (yieldChange > 0.5) headwindCount++
    if (yieldChange < -0.5) tailwindCount++
  }

  if (dollarChange !== null) {
    if (dollarChange > 0.3) headwindCount++
    if (dollarChange < -0.3) tailwindCount++
  }

  let state = 'NEUTRAL'
  if (headwindCount >= 2) {
    state = 'HEADWIND'
  } else if (tailwindCount >= 2) {
    state = 'TAILWIND'
  } else if (headwindCount >= 1 && tailwindCount === 0) {
    state = 'HEADWIND'
  } else if (tailwindCount >= 1 && headwindCount === 0) {
    state = 'TAILWIND'
  }

  return {
    state,
    confidence,
    inputs: {
      yieldChange: tnx?.available ? { price: tnx.price, change: tnx.changePercent } : null,
      dollarChange: dxy?.available ? { price: dxy.price, change: dxy.changePercent } : null,
    }
  }
}

function computeGlobalFlow(tickers) {
  const n225 = tickers.N225
  const hsi = tickers.HSI
  const axjo = tickers.AXJO

  const asiaData = [n225, hsi, axjo].filter(t => t?.available)
  const availableCount = asiaData.length
  const confidence = availableCount >= 3 ? 'HIGH' : availableCount >= 2 ? 'MEDIUM' : availableCount >= 1 ? 'LOW' : 'NONE'

  if (availableCount === 0) {
    return { state: 'UNKNOWN', confidence: 'NONE', inputs: { nikkei: null, hangSeng: null, asx: null } }
  }

  const changes = asiaData.map(t => t.changePercent)
  const avgAsiaChange = changes.reduce((a, b) => a + b, 0) / changes.length
  const allPositive = changes.every(c => c > 0)
  const allNegative = changes.every(c => c < 0)
  const allSameDirection = allPositive || allNegative

  let state = 'MIXED'
  if (avgAsiaChange > 0.3 && allSameDirection) {
    state = 'FOLLOW_THROUGH'
  } else if (avgAsiaChange < -0.3 && allSameDirection) {
    state = 'REVERSAL_RISK'
  }

  return {
    state,
    confidence,
    inputs: {
      nikkei: n225?.available ? { price: n225.price, change: n225.changePercent } : null,
      hangSeng: hsi?.available ? { price: hsi.price, change: hsi.changePercent } : null,
      asx: axjo?.available ? { price: axjo.price, change: axjo.changePercent } : null,
    }
  }
}

// ── GET Handler ──
export async function GET() {
  try {
    // Fetch all tickers in parallel with graceful failure handling
    const tickerEntries = Object.entries(TICKERS)
    const results = await Promise.allSettled(
      tickerEntries.map(([, symbol]) => fetchTickerData(symbol))
    )

    // Build ticker lookup
    const tickers = {}
    const tickerRaw = {}
    tickerEntries.forEach(([key, symbol], i) => {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        tickers[key] = result.value
        tickerRaw[symbol] = {
          price: result.value.price,
          change: result.value.change,
          changePercent: result.value.changePercent,
          marketState: result.value.marketState,
          available: true,
        }
      } else {
        tickers[key] = { available: false, symbol }
        tickerRaw[symbol] = { available: false }
      }
    })

    // Data quality metrics
    const allAvailable = Object.values(tickers).filter(t => t.available).length
    const tier1Available = TIER1_KEYS.filter(k => tickers[k]?.available).length

    // Compute 4 factors
    const factors = {
      riskSentiment: computeRiskSentiment(tickers),
      volatilityRegime: computeVolatilityRegime(tickers),
      macroPressure: computeMacroPressure(tickers),
      globalFlow: computeGlobalFlow(tickers),
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      factors,
      tickers: tickerRaw,
      dataQuality: {
        available: allAvailable,
        total: tickerEntries.length,
        tier1Available,
        tier1Total: TIER1_KEYS.length,
      }
    })
  } catch (error) {
    console.error('Market context error:', error)
    return Response.json(
      { error: 'Failed to fetch market context', details: error.message },
      { status: 500 }
    )
  }
}
