// Stock Scanner API - Uses Yahoo Finance data to find swing trade candidates
// Applies the Six Pillars methodology for ranking

// Universe of instruments to scan
const UNIVERSE = {
  // Top 50 S&P 500 by market cap + liquid names
  usStocks: [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK-B', 'UNH', 'JNJ',
    'V', 'XOM', 'JPM', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'PEP',
    'KO', 'COST', 'AVGO', 'LLY', 'WMT', 'MCD', 'CSCO', 'ACN', 'TMO', 'ABT',
    'CRM', 'DHR', 'NKE', 'VZ', 'ADBE', 'CMCSA', 'NFLX', 'INTC', 'AMD', 'QCOM',
    'TXN', 'PM', 'UNP', 'NEE', 'RTX', 'HON', 'LOW', 'BA', 'SPGI', 'CAT'
  ],
  // FTSE 100 most liquid names
  ukStocks: [
    'SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'BP.L', 'GSK.L', 'RIO.L', 'REL.L', 'DGE.L', 'BATS.L',
    'LSEG.L', 'NG.L', 'AAL.L', 'GLEN.L', 'VOD.L', 'BHP.L', 'PRU.L', 'LLOY.L', 'BARC.L', 'RKT.L',
    'IMB.L', 'SSE.L', 'AHT.L', 'BA.L', 'CPG.L', 'EXPN.L', 'STAN.L', 'ABF.L', 'ANTO.L', 'CRH.L',
    'FERG.L', 'IAG.L', 'IHG.L', 'KGF.L', 'LAND.L', 'LGEN.L', 'MNG.L', 'NWG.L', 'PSON.L', 'RR.L',
    'SBRY.L', 'SGE.L', 'SMDS.L', 'SMT.L', 'SN.L', 'SPX.L', 'SVT.L', 'TSCO.L', 'WPP.L', 'WTB.L'
  ],
  // Major indices
  indices: [
    '^GSPC',   // S&P 500
    '^DJI',    // Dow Jones
    '^IXIC',   // NASDAQ Composite
    '^FTSE',   // FTSE 100
    '^GDAXI',  // DAX
    '^FCHI',   // CAC 40
    '^N225',   // Nikkei 225
    '^HSI',    // Hang Seng
  ],
  // Major forex pairs
  forex: [
    'GBPUSD=X',  // GBP/USD
    'EURUSD=X',  // EUR/USD
    'USDJPY=X',  // USD/JPY
    'AUDUSD=X',  // AUD/USD
    'USDCAD=X',  // USD/CAD
    'USDCHF=X',  // USD/CHF
    'EURGBP=X',  // EUR/GBP
    'GBPJPY=X',  // GBP/JPY
  ],
  // Major cryptocurrencies
  crypto: [
    'BTC-USD',   // Bitcoin
    'ETH-USD',   // Ethereum
    'BNB-USD',   // Binance Coin
    'XRP-USD',   // Ripple
    'SOL-USD',   // Solana
    'ADA-USD',   // Cardano
    'DOGE-USD',  // Dogecoin
    'AVAX-USD',  // Avalanche
  ],
  // Key commodities (legacy, mapped to indices for now)
  commodities: [
    'GC=F',  // Gold
    'SI=F',  // Silver
    'CL=F',  // WTI Crude Oil
    'BZ=F',  // Brent Crude
    'NG=F',  // Natural Gas
    'HG=F',  // Copper
  ]
}

export async function POST(request) {
  try {
    const {
      mode = 'short_term',
      marketTrend = 'neutral',
      shortSellingAllowed = true,
      // Instrument filters - default to US and UK stocks for backwards compatibility
      instruments = { ukStocks: true, usStocks: true, indices: false, forex: false, crypto: false },
      // Regime Gate data - benchmark status and distribution days
      regimeGate = { riskOn: true, benchmarkAbove50MA: true, distributionDays: 0 }
    } = await request.json()

    console.log(`Starting scan for mode: ${mode}, trend: ${marketTrend}, shorts: ${shortSellingAllowed}`)
    console.log(`Instruments:`, instruments)
    console.log(`Regime Gate: riskOn=${regimeGate.riskOn}, benchmark>${regimeGate.benchmarkAbove50MA ? 'rising' : 'falling'} 50MA, dist days=${regimeGate.distributionDays}`)

    // Build list of tickers to scan based on instrument preferences
    let tickersToScan = []
    if (instruments.usStocks) tickersToScan = tickersToScan.concat(UNIVERSE.usStocks)
    if (instruments.ukStocks) tickersToScan = tickersToScan.concat(UNIVERSE.ukStocks)
    if (instruments.indices) tickersToScan = tickersToScan.concat(UNIVERSE.indices)
    if (instruments.forex) tickersToScan = tickersToScan.concat(UNIVERSE.forex)
    if (instruments.crypto) tickersToScan = tickersToScan.concat(UNIVERSE.crypto)

    // If nothing selected, default to US + UK stocks
    if (tickersToScan.length === 0) {
      tickersToScan = [...UNIVERSE.usStocks, ...UNIVERSE.ukStocks]
    }

    // Fetch historical data for all tickers
    const scanResults = await Promise.all(
      tickersToScan.map(ticker => scanTicker(ticker, mode))
    )

    // Filter out errors and sort by score
    const validResults = scanResults
      .filter(r => r && !r.error && r.score !== null)
      .sort((a, b) => b.score - a.score)

    // ========================================
    // REGIME GATE - Single Yes/No for Aggressiveness
    // ========================================
    // Risk-On: Benchmark > rising 50DMA AND distribution days ≤ 4
    // Risk-Off: Tighten filters, raise thresholds, suggest smaller positions
    const isRiskOn = regimeGate.riskOn

    // Base thresholds adjusted by Regime Gate
    let longScoreThreshold, shortScoreThreshold, longPillarMin, shortPillarMin
    let positionSizeMultiplier = 1.0  // 1.0 = full size, 0.5 = half size

    if (isRiskOn) {
      // RISK-ON: Standard thresholds, trend-adjusted
      if (marketTrend === 'up') {
        longScoreThreshold = 70
        shortScoreThreshold = 75
        longPillarMin = 5
        shortPillarMin = 5
      } else if (marketTrend === 'down') {
        longScoreThreshold = 75
        shortScoreThreshold = 70
        longPillarMin = 5
        shortPillarMin = 5
      } else {
        longScoreThreshold = 70
        shortScoreThreshold = 70
        longPillarMin = 5
        shortPillarMin = 5
      }
      positionSizeMultiplier = 1.0
    } else {
      // RISK-OFF: Tighter thresholds, fewer trades, half position size
      longScoreThreshold = 80      // Raise from 70/75 to 80
      shortScoreThreshold = 75     // Keep shorts at 75
      longPillarMin = 6            // Require ALL 6 pillars for longs
      shortPillarMin = 5           // Keep shorts at 5
      positionSizeMultiplier = 0.5 // Half position size
    }

    // Count passing pillars for each result
    const countPassingPillars = (r) => Object.values(r.pillars).filter(p => p.score >= 5).length
    const countBearishPillars = (r) => Object.values(r.pillars).filter(p => p.score <= 3).length

    // Filter longs: score threshold + minimum pillars passing
    const longCandidates = validResults
      .filter(r => r.direction === 'LONG')
      .filter(r => r.score >= longScoreThreshold && countPassingPillars(r) >= longPillarMin)

    // Filter shorts: score threshold + minimum pillars bearish
    // Only include shorts if short selling is allowed
    const shortCandidates = shortSellingAllowed
      ? validResults
          .filter(r => r.direction === 'SHORT')
          .filter(r => r.score >= shortScoreThreshold && countBearishPillars(r) >= shortPillarMin)
      : []

    // Watchlist: lower threshold, for monitoring
    const watchlistCandidates = validResults
      .filter(r => r.direction === 'WATCH')
      .slice(0, 10)

    return Response.json({
      timestamp: new Date().toISOString(),
      mode,
      instruments,
      shortSellingAllowed,
      marketTrend,
      // Regime Gate status - per market and overall
      regimeGate: {
        riskOn: isRiskOn,
        uk: regimeGate.uk || { riskOn: true, aboveMa50: true, distributionDays: 0 },
        us: regimeGate.us || { riskOn: true, aboveMa50: true, distributionDays: 0 },
        positionSizeMultiplier
      },
      thresholds: {
        long: { score: longScoreThreshold, pillars: longPillarMin },
        short: { score: shortScoreThreshold, pillars: shortPillarMin }
      },
      totalScanned: tickersToScan.length,
      results: {
        long: longCandidates,
        short: shortCandidates,
        watchlist: watchlistCandidates
      },
      summary: {
        longCount: longCandidates.length,
        shortCount: shortCandidates.length,
        watchlistCount: watchlistCandidates.length,
        topLong: longCandidates[0]?.ticker || null,
        topShort: shortCandidates[0]?.ticker || null
      }
    })
  } catch (error) {
    console.error('Scanner error:', error)
    return Response.json(
      { error: 'Scanner failed', details: error.message },
      { status: 500 }
    )
  }
}

async function scanTicker(ticker, mode) {
  try {
    // Fetch 6 months of daily data for technical analysis
    const days = mode === 'short_term' ? 90 : 180
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${days}d`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      return { ticker, error: 'Fetch failed' }
    }

    const data = await response.json()
    const result = data.chart?.result?.[0]

    if (!result || !result.indicators?.quote?.[0]) {
      return { ticker, error: 'No data' }
    }

    const meta = result.meta
    const timestamps = result.timestamp || []
    const quote = result.indicators.quote[0]
    const closes = quote.close || []
    const highs = quote.high || []
    const lows = quote.low || []
    const volumes = quote.volume || []

    // Need at least 63 days of data for position swing analysis
    if (closes.length < 63) {
      return { ticker, error: 'Insufficient data' }
    }

    // Filter out null values
    const validCloses = closes.filter(c => c !== null)
    if (validCloses.length < 50) {
      return { ticker, error: 'Too many gaps' }
    }

    // Calculate technical indicators
    const indicators = calculateIndicators(closes, highs, lows, volumes)

    // Calculate pillar scores
    const pillars = calculatePillarScores(indicators, mode)

    // Determine direction and overall score
    let { direction, score, reasoning } = determineTradeDirection(pillars, indicators, mode)

    // Check for post-earnings/news volatility spike
    // If detected, demote LONG/SHORT to WATCH with warning
    let volatilityWarning = null
    if (indicators.isVolatilitySpike && (direction === 'LONG' || direction === 'SHORT')) {
      volatilityWarning = indicators.volatilityWarning
      // Keep the original direction info but add warning
      reasoning = `⚠️ ${volatilityWarning}. Original signal: ${direction} - ${reasoning}`
      // Demote to WATCH - don't trade right after volatile days
      direction = 'WATCH'
    }

    // Calculate ATR-based trade management (entry, stop, targets)
    const tradeManagement = calculateTradeManagement(
      indicators.currentPrice,
      indicators.atrRaw,
      direction,
      indicators.recentHigh,
      indicators.recentLow
    )

    // Get entry timing guidance
    const entryTiming = getEntryTiming(ticker)

    return {
      ticker,
      name: meta.shortName || ticker,
      price: meta.regularMarketPrice,
      currency: meta.currency,
      change: meta.previousClose
        ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2) + '%'
        : indicators.momentum5d?.toFixed(2) + '%',
      direction,
      score,
      pillars,
      indicators: {
        rsi: indicators.rsi,
        momentum5d: indicators.momentum5d,
        momentum20d: indicators.momentum20d,
        momentum63d: indicators.momentum63d,
        priceVsMa50: indicators.priceVsMa50,
        priceVsMa200: indicators.priceVsMa200,
        ma50VsMa200: indicators.ma50VsMa200,
        volumeRatio: indicators.volumeRatio,
        atr: indicators.atr,
        distanceFrom52High: indicators.distanceFrom52High,
        distanceFrom52Low: indicators.distanceFrom52Low
      },
      // ATR-based trade management
      tradeManagement,
      entryTiming,
      volatilityWarning,
      reasoning
    }
  } catch (error) {
    return { ticker, error: error.message }
  }
}

function calculateIndicators(closes, highs, lows, volumes) {
  const n = closes.length
  const currentPrice = closes[n - 1]

  // Moving Averages
  const ma10 = average(closes.slice(-10))
  const ma20 = average(closes.slice(-20))
  const ma50 = average(closes.slice(-50))
  const ma200 = n >= 200 ? average(closes.slice(-200)) : average(closes.slice(-Math.min(n, 150)))

  // Momentum (% returns)
  const momentum5d = ((currentPrice - closes[n - 6]) / closes[n - 6] * 100)
  const momentum20d = ((currentPrice - closes[n - 21]) / closes[n - 21] * 100)
  const momentum63d = n >= 64 ? ((currentPrice - closes[n - 64]) / closes[n - 64] * 100) : null

  // RSI (14-period)
  const rsi = calculateRSI(closes, 14)

  // Volume analysis
  const avgVolume20 = average(volumes.slice(-20))
  const recentVolume = average(volumes.slice(-5))
  const volumeRatio = recentVolume / avgVolume20

  // ATR (14-period) for volatility
  const atrRaw = calculateATR(highs, lows, closes, 14)
  const atrPercent = (atrRaw / currentPrice) * 100

  // Recent high/low for trade management (last 10 days)
  const recentHighs = highs.slice(-10).filter(h => h !== null)
  const recentLows = lows.slice(-10).filter(l => l !== null)
  const recentHigh = recentHighs.length > 0 ? Math.max(...recentHighs) : currentPrice
  const recentLow = recentLows.length > 0 ? Math.min(...recentLows) : currentPrice

  // 52-week high/low (approximate with available data)
  const high52 = Math.max(...highs.filter(h => h !== null))
  const low52 = Math.min(...lows.filter(l => l !== null))
  const distanceFrom52High = ((currentPrice - high52) / high52 * 100)
  const distanceFrom52Low = ((currentPrice - low52) / low52 * 100)

  // Price vs MAs
  const priceVsMa50 = ((currentPrice - ma50) / ma50 * 100)
  const priceVsMa200 = ((currentPrice - ma200) / ma200 * 100)
  const ma50VsMa200 = ((ma50 - ma200) / ma200 * 100)

  // Volatility Contraction Pattern (VCP) detection
  // Look for decreasing range over last 4 weeks
  const ranges = []
  for (let i = 0; i < 4; i++) {
    const weekStart = n - 5 * (i + 1)
    const weekEnd = n - 5 * i
    if (weekStart >= 0) {
      const weekHighs = highs.slice(weekStart, weekEnd).filter(h => h !== null)
      const weekLows = lows.slice(weekStart, weekEnd).filter(l => l !== null)
      if (weekHighs.length > 0 && weekLows.length > 0) {
        ranges.push(Math.max(...weekHighs) - Math.min(...weekLows))
      }
    }
  }
  const vcpScore = ranges.length >= 3 && ranges[0] < ranges[1] && ranges[1] < ranges[2] ? 1 : 0

  // Trend strength (ADX approximation using directional movement)
  const trendStrength = Math.abs(momentum20d) > 10 ? 'strong' : Math.abs(momentum20d) > 5 ? 'moderate' : 'weak'

  // Volatility spike detection (post-earnings / news days)
  // Check if yesterday's range was abnormally large vs ATR
  const yesterdayHigh = highs[n - 1]
  const yesterdayLow = lows[n - 1]
  const yesterdayClose = closes[n - 1]
  const yesterdayRange = yesterdayHigh && yesterdayLow ? yesterdayHigh - yesterdayLow : 0
  const rangeVsAtr = atrRaw > 0 ? yesterdayRange / atrRaw : 0

  // Detect if close is far from the day's extreme (gap between close and low/high)
  // For shorts: if close >> low, the low was a spike down that recovered
  // For longs: if close << high, the high was a spike up that faded
  const closeVsLow = yesterdayLow > 0 ? ((yesterdayClose - yesterdayLow) / yesterdayLow * 100) : 0
  const closeVsHigh = yesterdayHigh > 0 ? ((yesterdayHigh - yesterdayClose) / yesterdayHigh * 100) : 0

  // Flag as volatile if: range > 2x ATR AND close recovered significantly from extreme
  const isVolatilitySpike = rangeVsAtr > 2 && (closeVsLow > 3 || closeVsHigh > 3)
  const volatilityWarning = isVolatilitySpike
    ? `High volatility day (${rangeVsAtr.toFixed(1)}x ATR) - wait for consolidation`
    : null

  return {
    currentPrice,
    ma10, ma20, ma50, ma200,
    momentum5d, momentum20d, momentum63d,
    rsi,
    volumeRatio,
    atr: atrPercent,
    atrRaw,           // Raw ATR value for stop/target calculations
    recentHigh,       // 10-day high for entry zone
    recentLow,        // 10-day low for entry zone
    distanceFrom52High,
    distanceFrom52Low,
    priceVsMa50,
    priceVsMa200,
    ma50VsMa200,
    vcpScore,
    trendStrength,
    // Volatility spike detection
    isVolatilitySpike,
    volatilityWarning,
    rangeVsAtr
  }
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50 // Default neutral

  let gains = 0
  let losses = 0

  // Calculate initial average gain/loss
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) gains += change
    else losses += Math.abs(change)
  }

  const avgGain = gains / period
  const avgLoss = losses / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function calculateATR(highs, lows, closes, period = 14) {
  const n = closes.length
  if (n < period + 1) return 0

  let atrSum = 0
  for (let i = n - period; i < n; i++) {
    const high = highs[i] || closes[i]
    const low = lows[i] || closes[i]
    const prevClose = closes[i - 1]

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    atrSum += tr
  }

  return atrSum / period
}

/**
 * Calculate ATR-based trade management levels
 * Returns entry zone, stop loss, T1 (1.5R), T2 (2.5R), and R:R ratio
 */
function calculateTradeManagement(currentPrice, atr, direction, recentHigh, recentLow) {
  if (!atr || atr <= 0) {
    return null
  }

  // Entry zone: current price +/- 0.2 ATR for limit orders (tighter zone)
  const entryBuffer = atr * 0.2

  if (direction === 'LONG') {
    // For longs: entry slightly below current, stop below that
    const entryHigh = currentPrice
    const entryLow = Math.max(currentPrice - entryBuffer, recentLow)
    const entryMid = (entryHigh + entryLow) / 2

    // Stop loss: 1 ATR below entry low (gives room for normal volatility)
    const stopLoss = entryLow - atr

    // Risk per share
    const risk = entryMid - stopLoss

    // Targets based on R multiples
    const target1 = entryMid + (risk * 1.5)  // T1 = 1.5R
    const target2 = entryMid + (risk * 2.5)  // T2 = 2.5R

    // R:R ratio (using T2 as the main target)
    const reward = target2 - entryMid
    const riskRewardRatio = reward / risk

    return {
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss,
      target1,
      target2,
      risk,
      riskRewardRatio: riskRewardRatio.toFixed(1)
    }
  } else if (direction === 'SHORT') {
    // For shorts: entry slightly above current, stop above that
    const entryLow = currentPrice
    const entryHigh = Math.min(currentPrice + entryBuffer, recentHigh)
    const entryMid = (entryHigh + entryLow) / 2

    // Stop loss: 1 ATR above entry high
    const stopLoss = entryHigh + atr

    // Risk per share
    const risk = stopLoss - entryMid

    // Targets based on R multiples (lower prices for shorts)
    const target1 = entryMid - (risk * 1.5)  // T1 = 1.5R
    const target2 = entryMid - (risk * 2.5)  // T2 = 2.5R

    // R:R ratio
    const reward = entryMid - target2
    const riskRewardRatio = reward / risk

    return {
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss,
      target1,
      target2,
      risk,
      riskRewardRatio: riskRewardRatio.toFixed(1)
    }
  }

  return null
}

/**
 * Get entry timing guidance based on market
 * Avoid volatile opens: first 30 minutes of trading
 */
function getEntryTiming(ticker) {
  // Determine market based on ticker
  const isUK = ticker.endsWith('.L')
  const isForex = ticker.includes('=X')
  const isCrypto = ticker.includes('-USD') && !ticker.startsWith('^')

  if (isCrypto || isForex) {
    // 24-hour markets - no specific timing restriction
    return {
      market: isForex ? 'Forex' : 'Crypto',
      avoidUntil: null,
      note: 'Trades 24/7 - enter at discretion'
    }
  }

  if (isUK) {
    return {
      market: 'UK',
      avoidUntil: '09:00 GMT',
      note: 'Avoid first 30 min (08:00-09:00 GMT)'
    }
  }

  // Default to US
  return {
    market: 'US',
    avoidUntil: '10:00 ET',
    note: 'Avoid first 30 min (09:30-10:00 ET)'
  }
}

function average(arr) {
  const valid = arr.filter(v => v !== null && !isNaN(v))
  if (valid.length === 0) return 0
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function calculatePillarScores(indicators, mode) {
  const pillars = {
    livermore: { score: 0, max: 10, notes: [] },
    oneil: { score: 0, max: 10, notes: [] },
    minervini: { score: 0, max: 10, notes: [] },
    darvas: { score: 0, max: 10, notes: [] },
    raschke: { score: 0, max: 10, notes: [] },
    weinstein: { score: 0, max: 10, notes: [] }
  }

  // LIVERMORE - Pivotal Points & Timing
  // Rewards: breakout from consolidation, strong momentum, not chasing
  if (indicators.vcpScore > 0) {
    pillars.livermore.score += 4
    pillars.livermore.notes.push('VCP forming')
  }
  if (indicators.momentum5d > 2 && indicators.momentum5d < 8) {
    pillars.livermore.score += 3
    pillars.livermore.notes.push('Early momentum')
  } else if (indicators.momentum5d > 8) {
    pillars.livermore.score += 1
    pillars.livermore.notes.push('Extended - may be chasing')
  }
  if (indicators.distanceFrom52High > -15 && indicators.distanceFrom52High < 0) {
    pillars.livermore.score += 3
    pillars.livermore.notes.push('Near 52w high')
  }

  // O'NEIL - CANSLIM & Leadership
  // Rewards: RS (relative strength), near new highs, volume confirmation
  if (indicators.distanceFrom52High > -10) {
    pillars.oneil.score += 4
    pillars.oneil.notes.push('Within 10% of 52w high')
  } else if (indicators.distanceFrom52High > -25) {
    pillars.oneil.score += 2
    pillars.oneil.notes.push('Within 25% of 52w high')
  }
  if (indicators.volumeRatio > 1.3) {
    pillars.oneil.score += 3
    pillars.oneil.notes.push('Volume surge')
  }
  if (indicators.momentum63d > 20) {
    pillars.oneil.score += 3
    pillars.oneil.notes.push('Strong RS (63d momentum)')
  } else if (indicators.momentum63d > 0) {
    pillars.oneil.score += 1
    pillars.oneil.notes.push('Positive RS')
  }

  // MINERVINI - SEPA & Trend Template
  // Rewards: Stage 2 setup, price above MAs, MAs stacked correctly
  let minerviniChecks = 0
  if (indicators.priceVsMa50 > 0) {
    minerviniChecks++
    pillars.minervini.notes.push('Above 50MA')
  }
  if (indicators.priceVsMa200 > 0) {
    minerviniChecks++
    pillars.minervini.notes.push('Above 200MA')
  }
  if (indicators.ma50VsMa200 > 0) {
    minerviniChecks++
    pillars.minervini.notes.push('50MA > 200MA')
  }
  if (indicators.distanceFrom52Low > 30) {
    minerviniChecks++
    pillars.minervini.notes.push('30%+ above 52w low')
  }
  if (indicators.distanceFrom52High > -25) {
    minerviniChecks++
    pillars.minervini.notes.push('Within 25% of 52w high')
  }
  pillars.minervini.score = Math.min(10, minerviniChecks * 2)

  // DARVAS - Box Theory
  // Rewards: clear range, breakout potential, volume on breakout
  if (indicators.atr < 3) {
    pillars.darvas.score += 3
    pillars.darvas.notes.push('Low volatility (tight box)')
  } else if (indicators.atr < 5) {
    pillars.darvas.score += 2
    pillars.darvas.notes.push('Moderate volatility')
  }
  if (indicators.vcpScore > 0) {
    pillars.darvas.score += 4
    pillars.darvas.notes.push('Contracting range')
  }
  if (indicators.volumeRatio > 1.2 && indicators.momentum5d > 0) {
    pillars.darvas.score += 3
    pillars.darvas.notes.push('Volume on up move')
  }

  // RASCHKE - Momentum & Mean Reversion
  // For trending mode: rewards momentum continuation
  // For mean reversion: rewards oversold bounces
  if (mode === 'short_term') {
    // Short-term favors momentum
    if (indicators.rsi > 50 && indicators.rsi < 70) {
      pillars.raschke.score += 4
      pillars.raschke.notes.push('RSI in bullish zone')
    } else if (indicators.rsi > 70) {
      pillars.raschke.score += 1
      pillars.raschke.notes.push('RSI overbought - caution')
    } else if (indicators.rsi < 30) {
      pillars.raschke.score += 3
      pillars.raschke.notes.push('RSI oversold - bounce potential')
    }
    if (indicators.momentum5d > 3) {
      pillars.raschke.score += 3
      pillars.raschke.notes.push('5-day momentum positive')
    }
    if (indicators.trendStrength === 'strong') {
      pillars.raschke.score += 3
      pillars.raschke.notes.push('Strong trend')
    }
  } else {
    // Position swing favors trend following
    if (indicators.momentum20d > 5) {
      pillars.raschke.score += 4
      pillars.raschke.notes.push('20-day momentum strong')
    }
    if (indicators.rsi > 40 && indicators.rsi < 65) {
      pillars.raschke.score += 3
      pillars.raschke.notes.push('RSI healthy for trend')
    }
    if (indicators.trendStrength === 'strong') {
      pillars.raschke.score += 3
      pillars.raschke.notes.push('Strong trend established')
    }
  }

  // WEINSTEIN - Stage Analysis
  // Rewards: Stage 2 (above rising 30-week MA equivalent)
  if (indicators.priceVsMa200 > 5 && indicators.ma50VsMa200 > 0) {
    pillars.weinstein.score += 5
    pillars.weinstein.notes.push('Stage 2 - advancing')
  } else if (indicators.priceVsMa200 > 0) {
    pillars.weinstein.score += 3
    pillars.weinstein.notes.push('Above 200MA')
  } else if (indicators.priceVsMa200 < -10) {
    pillars.weinstein.score += 0
    pillars.weinstein.notes.push('Stage 4 - avoid longs')
  }
  if (indicators.momentum63d > 10) {
    pillars.weinstein.score += 3
    pillars.weinstein.notes.push('Relative strength positive')
  }
  if (indicators.volumeRatio > 1.2) {
    pillars.weinstein.score += 2
    pillars.weinstein.notes.push('Volume confirming')
  }

  return pillars
}

function determineTradeDirection(pillars, indicators, mode) {
  // Calculate total pillar score
  const totalScore = Object.values(pillars).reduce((sum, p) => sum + p.score, 0)
  const maxScore = Object.values(pillars).reduce((sum, p) => sum + p.max, 0)
  const scorePercent = (totalScore / maxScore) * 100

  // Count pillars passing (score >= 5 out of 10)
  const passingPillars = Object.values(pillars).filter(p => p.score >= 5).length

  const reasoning = []

  // LONG criteria
  if (passingPillars >= 4 && scorePercent >= 50 &&
      indicators.priceVsMa50 > 0 && indicators.momentum20d > 0) {
    reasoning.push(`${passingPillars}/6 pillars passing`)
    reasoning.push(`Score: ${scorePercent.toFixed(0)}%`)
    if (indicators.distanceFrom52High > -10) reasoning.push('Near 52w high')
    if (indicators.volumeRatio > 1.2) reasoning.push('Volume confirming')

    return {
      direction: 'LONG',
      score: scorePercent,
      reasoning: reasoning.join(', ')
    }
  }

  // SHORT criteria (inverse of long)
  // Count bearish pillars (inverse scoring - low scores are good for shorts)
  const bearishPillars = Object.values(pillars).filter(p => p.score <= 3).length

  if (indicators.priceVsMa50 < -5 && indicators.priceVsMa200 < 0 &&
      indicators.momentum20d < -5 && indicators.rsi < 45) {
    reasoning.push(`${bearishPillars}/6 pillars bearish`)
    reasoning.push(`Score: ${(100 - scorePercent).toFixed(0)}%`)
    if (indicators.distanceFrom52High < -20) reasoning.push('Far from 52w high')
    if (indicators.rsi < 30) reasoning.push('Oversold')

    // Score shorts by how bearish they are (inverse of pillar score)
    const shortScore = 100 - scorePercent

    return {
      direction: 'SHORT',
      score: Math.max(shortScore, Math.abs(indicators.momentum20d) * 2),
      reasoning: reasoning.join(', ')
    }
  }

  // WATCHLIST criteria - interesting but not ready
  if (passingPillars >= 2 || indicators.vcpScore > 0 ||
      (indicators.rsi < 35 && indicators.priceVsMa200 > -20)) {
    reasoning.push(`${passingPillars}/6 pillars`)
    if (indicators.vcpScore > 0) reasoning.push('VCP forming')
    if (indicators.rsi < 35) reasoning.push('Oversold bounce potential')

    return {
      direction: 'WATCH',
      score: scorePercent,
      reasoning: reasoning.join(', ')
    }
  }

  // No trade
  return {
    direction: 'NONE',
    score: scorePercent,
    reasoning: 'Does not meet criteria'
  }
}
