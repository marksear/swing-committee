// Stock Scanner API - Uses Yahoo Finance data to find swing trade candidates
// Applies the Six Pillars methodology for ranking

// Universe of instruments to scan
const UNIVERSE = {
  // S&P 100 (top 100 by market cap) + top 25 Nasdaq-100 not in S&P 100
  // ~125 unique US names covering mega-cap and large-cap growth/tech
  usStocks: [
    // ── S&P 100 (by market cap) ──
    'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'BRK-B', 'WMT',
    'LLY', 'JPM', 'XOM', 'V', 'JNJ', 'MA', 'ORCL', 'COST', 'ABBV', 'HD',
    'BAC', 'PG', 'CVX', 'CAT', 'KO', 'AMD', 'GE', 'NFLX', 'PLTR', 'CSCO',
    'MRK', 'PM', 'GS', 'MS', 'WFC', 'RTX', 'UNH', 'IBM', 'TMUS', 'INTC',
    'MCD', 'AXP', 'PEP', 'LIN', 'VZ', 'TXN', 'T', 'AMGN', 'ABT', 'NEE',
    'C', 'GILD', 'BA', 'TMO', 'DIS', 'CRM', 'ISRG', 'SCHW', 'BLK', 'DE',
    'LOW', 'PFE', 'UNP', 'HON', 'DHR', 'LMT', 'QCOM', 'UBER', 'ACN', 'COP',
    'BKNG', 'COF', 'MDT', 'BMY', 'CMCSA', 'MO', 'NOW', 'INTU', 'ADBE', 'SBUX',
    'SO', 'UPS', 'CVS', 'DUK', 'GD', 'NKE', 'MMM', 'AMT', 'USB', 'FDX',
    'EMR', 'BK', 'MDLZ', 'CL', 'GM', 'SPG', 'TGT', 'MET', 'AIG', 'PYPL',
    // ── Nasdaq-100 top 25 NOT in S&P 100 ──
    'ASML', 'LRCX', 'AMAT', 'KLAC', 'ADI', 'SHOP', 'PDD', 'PANW', 'ARM', 'APP',
    'CRWD', 'CEG', 'MELI', 'WDC', 'MAR', 'STX', 'ADP', 'REGN', 'SNPS', 'CDNS',
    'ORLY', 'MNST', 'CTAS', 'CSX', 'ABNB'
  ],
  // FTSE 100 — top 50 most liquid by market cap
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
      regimeGate = { riskOn: true, benchmarkAbove50MA: true, distributionDays: 0 },
      // Account data for position sizing (£ per point)
      accountSize = null,
      riskPerTrade = null
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

    // Parse account data for position sizing
    const acctSize = accountSize ? parseFloat(accountSize) : null
    const riskPct = riskPerTrade ? parseFloat(riskPerTrade) : null

    // ========================================
    // REGIME GATE - 3-State Model with Alignment
    // ========================================
    // Computed BEFORE scan loop so scanTicker can use regimeState for dynamic targets
    // GREEN: Risk-On + up/neutral trend → favour longs, full size
    // RED:   Risk-Off OR down trend → favour shorts, full size
    // YELLOW: Mixed signals → both sides elevated threshold, half size
    const isRiskOn = regimeGate.riskOn

    let regimeState  // GREEN, YELLOW, RED
    if (isRiskOn && (marketTrend === 'up' || marketTrend === 'neutral')) {
      regimeState = 'GREEN'
    } else if (!isRiskOn || marketTrend === 'down') {
      regimeState = 'RED'
    } else {
      regimeState = 'YELLOW'
    }

    // Fetch historical data for all tickers
    const scanResults = await Promise.all(
      tickersToScan.map(ticker => scanTicker(ticker, mode, acctSize, riskPct, regimeState))
    )

    // Filter out errors and sort by score
    const validResults = scanResults
      .filter(r => r && !r.error && r.score !== null)
      .sort((a, b) => b.score - a.score)

    // Thresholds by regime: WITH the tape = standard, AGAINST = exceptional
    let longScoreThreshold, shortScoreThreshold, longPillarMin, shortPillarMin
    let longSizeMultiplier = 1.0, shortSizeMultiplier = 1.0

    switch (regimeState) {
      case 'GREEN':
        // Longs: standard (aligned with tape)
        longScoreThreshold = 70
        longPillarMin = 4
        longSizeMultiplier = 1.0
        // Shorts: need exceptional quality (fighting the tape)
        shortScoreThreshold = 85
        shortPillarMin = 5
        shortSizeMultiplier = 0.5
        break
      case 'RED':
        // Shorts: standard (aligned with tape)
        shortScoreThreshold = 70
        shortPillarMin = 4
        shortSizeMultiplier = 1.0
        // Longs: need exceptional quality (fighting the tape)
        longScoreThreshold = 85
        longPillarMin = 5
        longSizeMultiplier = 0.5
        break
      case 'YELLOW':
      default:
        // Both sides: elevated threshold, half size, be picky
        longScoreThreshold = 75
        shortScoreThreshold = 75
        longPillarMin = 4
        shortPillarMin = 4
        longSizeMultiplier = 0.5
        shortSizeMultiplier = 0.5
        break
    }

    // Count passing pillars using bidirectional scores
    const countLongPassing = (r) => Object.values(r.pillars).filter(p => p.longScore >= 5).length
    const countShortPassing = (r) => Object.values(r.pillars).filter(p => p.shortScore >= 5).length

    // =====================================================
    // STAGE 3: REGIME FILTER — the strict gate
    // BOTH direction stocks: regime picks the side
    // =====================================================

    // Resolve BOTH → LONG or SHORT based on regime, then apply thresholds
    const resolvedResults = validResults.map(r => {
      if (r.direction !== 'BOTH') return r

      // Regime picks the favoured side; YELLOW picks the stronger score
      let resolvedDir
      if (regimeState === 'GREEN') {
        resolvedDir = 'LONG'
      } else if (regimeState === 'RED') {
        resolvedDir = shortSellingAllowed ? 'SHORT' : 'LONG'  // fallback to long if shorts disabled
      } else {
        // YELLOW: pick the stronger side
        resolvedDir = (r.longScore || 0) >= (r.shortScore || 0) ? 'LONG' : 'SHORT'
      }

      // Use the score for the resolved direction
      const resolvedScore = resolvedDir === 'LONG' ? (r.longScore || r.score) : (r.shortScore || r.score)

      // Update pillar .score for the resolved direction
      const resolvedPillars = { ...r.pillars }
      for (const [key, pillar] of Object.entries(resolvedPillars)) {
        resolvedPillars[key] = {
          ...pillar,
          score: resolvedDir === 'SHORT' ? pillar.shortScore : pillar.longScore
        }
      }

      return {
        ...r,
        direction: resolvedDir,
        score: resolvedScore,
        pillars: resolvedPillars,
        reasoning: `Regime ${regimeState} → ${resolvedDir}. ${r.reasoning}`
      }
    })

    // Filter longs: score threshold + minimum long pillars passing
    const longCandidates = resolvedResults
      .filter(r => r.direction === 'LONG')
      .filter(r => r.score >= longScoreThreshold && countLongPassing(r) >= longPillarMin)

    // Filter shorts: score threshold + minimum short pillars passing
    const shortCandidates = shortSellingAllowed
      ? resolvedResults
          .filter(r => r.direction === 'SHORT')
          .filter(r => r.score >= shortScoreThreshold && countShortPassing(r) >= shortPillarMin)
      : []

    // Watchlist: WATCH + anything that didn't make the cut from resolved BOTH/LONG/SHORT
    const tradeTickers = new Set([
      ...longCandidates.map(r => r.ticker),
      ...shortCandidates.map(r => r.ticker)
    ])
    const watchlistCandidates = resolvedResults
      .filter(r => r.direction === 'WATCH' || (r.direction !== 'NONE' && !tradeTickers.has(r.ticker)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)

    // Compute trade management for resolved BOTH candidates (was deferred from scanTicker)
    // Then apply regime size multiplier to £ per point
    const finaliseCandidates = (candidates, multiplier) => {
      return candidates.map(c => {
        let tm = c.tradeManagement

        // If tradeManagement is null (was BOTH, now resolved), compute it
        if (!tm && c.rawIndicators) {
          const ri = c.rawIndicators
          const dir = c.direction
          const dirPassing = dir === 'SHORT' ? countShortPassing(c) : countLongPassing(c)
          tm = calculateTradeManagement({
            currentPrice: ri.currentPrice,
            atr: ri.atrRaw,
            direction: dir,
            recentHigh: ri.recentHigh,
            recentLow: ri.recentLow,
            accountSize: acctSize,
            riskPercent: riskPct,
            regimeSizeMultiplier: 1.0,
            score: c.score,
            pillarsPassing: dirPassing,
            regimeState,
            fractalTarget: c.fractalTarget || null,
            airPocketOk: true,
            nearestResistance: ri.nearestResistance,
            nearestSupport: ri.nearestSupport,
          })
        }

        // Apply regime size multiplier to £/pt
        if (tm && tm.poundsPerPoint && acctSize && riskPct) {
          tm = {
            ...tm,
            poundsPerPoint: parseFloat((tm.poundsPerPoint * multiplier).toFixed(4)),
            effectiveRisk: parseFloat((tm.effectiveRisk * multiplier).toFixed(2)),
            regimeMultiplier: multiplier
          }
        }

        return {
          ...c,
          tradeManagement: tm,
          setupTier: tm?.setupTier || c.setupTier || null,
        }
      })
    }

    const longResults = finaliseCandidates(longCandidates, longSizeMultiplier)
    const shortResults = finaliseCandidates(shortCandidates, shortSizeMultiplier)

    return Response.json({
      timestamp: new Date().toISOString(),
      mode,
      instruments,
      shortSellingAllowed,
      marketTrend,
      // Regime Gate status - 3-state model
      regimeGate: {
        riskOn: isRiskOn,
        regimeState,  // GREEN, YELLOW, RED
        uk: regimeGate.uk || { riskOn: true, aboveMa50: true, distributionDays: 0 },
        us: regimeGate.us || { riskOn: true, aboveMa50: true, distributionDays: 0 },
        positionSizeMultiplier: {
          long: longSizeMultiplier,
          short: shortSizeMultiplier
        }
      },
      thresholds: {
        long: { score: longScoreThreshold, pillars: longPillarMin },
        short: { score: shortScoreThreshold, pillars: shortPillarMin }
      },
      totalScanned: tickersToScan.length,
      results: {
        long: longResults,
        short: shortResults,
        watchlist: watchlistCandidates
      },
      summary: {
        longCount: longResults.length,
        shortCount: shortResults.length,
        watchlistCount: watchlistCandidates.length,
        topLong: longResults[0]?.ticker || null,
        topShort: shortResults[0]?.ticker || null
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

/**
 * Check if ticker has earnings within ±2 days
 * Returns { nearEarnings: boolean, earningsDate: string|null, daysUntilEarnings: number|null, earningsWarning: string|null }
 */
async function checkEarningsProximity(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=calendarEvents`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      return { nearEarnings: false, earningsDate: null, daysUntilEarnings: null, earningsWarning: null }
    }

    const data = await response.json()
    const earnings = data.quoteSummary?.result?.[0]?.calendarEvents?.earnings

    if (!earnings?.earningsDate?.[0]?.raw) {
      return { nearEarnings: false, earningsDate: null, daysUntilEarnings: null, earningsWarning: null }
    }

    // Get earnings timestamp and convert to date
    const earningsTimestamp = earnings.earningsDate[0].raw * 1000
    const earningsDate = new Date(earningsTimestamp)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    earningsDate.setHours(0, 0, 0, 0)

    // Calculate days difference (positive = future, negative = past)
    const diffTime = earningsDate.getTime() - today.getTime()
    const daysUntilEarnings = Math.round(diffTime / (1000 * 60 * 60 * 24))

    // Check if within ±2 days
    const nearEarnings = daysUntilEarnings >= -2 && daysUntilEarnings <= 2

    let earningsWarning = null
    if (nearEarnings) {
      if (daysUntilEarnings > 0) {
        earningsWarning = `Earnings in ${daysUntilEarnings} day${daysUntilEarnings > 1 ? 's' : ''} - avoid new positions`
      } else if (daysUntilEarnings === 0) {
        earningsWarning = 'Earnings TODAY - avoid new positions'
      } else {
        earningsWarning = `Earnings ${Math.abs(daysUntilEarnings)} day${Math.abs(daysUntilEarnings) > 1 ? 's' : ''} ago - wait for dust to settle`
      }
    }

    return {
      nearEarnings,
      earningsDate: earningsDate.toISOString().split('T')[0],
      daysUntilEarnings,
      earningsWarning
    }
  } catch (error) {
    // Don't fail the scan if earnings check fails
    return { nearEarnings: false, earningsDate: null, daysUntilEarnings: null, earningsWarning: null }
  }
}

async function scanTicker(ticker, mode, accountSize = null, riskPercent = null, regimeState = 'YELLOW') {
  try {
    // Fetch 90 days of daily data for short-term momentum analysis
    const days = 90
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

    // Need at least 50 days of data for MA calculations
    if (closes.length < 50) {
      return { ticker, error: 'Insufficient data' }
    }

    // Filter out null values
    const validCloses = closes.filter(c => c !== null)
    if (validCloses.length < 50) {
      return { ticker, error: 'Too many gaps' }
    }

    // Calculate technical indicators
    const indicators = calculateIndicators(closes, highs, lows, volumes)

    // Fetch sector momentum for relative strength calculation
    const sectorMomentum20d = await fetchSectorMomentum(ticker)
    indicators.sectorMomentum20d = sectorMomentum20d
    indicators.sectorRelativeStrength = sectorMomentum20d !== null
      ? indicators.momentum20d - sectorMomentum20d
      : null

    // Calculate pillar scores
    const pillars = calculatePillarScores(indicators)

    // Determine direction and overall score
    const directionResult = determineTradeDirection(pillars, indicators)
    let { direction, score, reasoning } = directionResult

    // =====================================================
    // BOTH → resolve to best single direction for downstream processing
    // Store both scores so Stage 3 (regime filter) can pick the regime-aligned side
    // =====================================================
    let longScore = directionResult.longScore || null
    let shortScore = directionResult.shortScore || null
    let longPassingFromDir = directionResult.longPassing || null
    let shortPassingFromDir = directionResult.shortPassing || null

    // Set backward-compatible .score on each pillar (UI reads p.score)
    for (const [key, pillar] of Object.entries(pillars)) {
      pillar.score = (direction === 'SHORT') ? pillar.shortScore : pillar.longScore
    }

    // Count passing pillars for the determined direction
    const pillarsPassing = (direction === 'SHORT')
      ? Object.values(pillars).filter(p => p.shortScore >= 5).length
      : Object.values(pillars).filter(p => p.longScore >= 5).length

    // Fractal target: furthest swing-type structural level in the trade's direction
    // Used to cap T2 at a level the market has actually shown
    let fractalTarget = null
    if (direction === 'LONG' || direction === 'BOTH') {
      const swingResistances = (indicators.allResistanceLevels || []).filter(r => r.type === 'SwingHigh')
      fractalTarget = swingResistances.length > 0
        ? swingResistances[swingResistances.length - 1].level
        : null
    }
    if (direction === 'SHORT') {
      const swingSupports = (indicators.allSupportLevels || []).filter(s => s.type === 'SwingLow')
      fractalTarget = swingSupports.length > 0
        ? swingSupports[swingSupports.length - 1].level
        : null
    }

    // Check earnings proximity (±2 days)
    let earningsData = { nearEarnings: false, earningsDate: null, daysUntilEarnings: null, earningsWarning: null }
    if (direction === 'LONG' || direction === 'SHORT' || direction === 'BOTH') {
      earningsData = await checkEarningsProximity(ticker)
    }

    // Safety demotions: earnings / volatility spike → WATCH
    let volatilityWarning = null
    let earningsWarning = null

    if (earningsData.nearEarnings && (direction === 'LONG' || direction === 'SHORT' || direction === 'BOTH')) {
      earningsWarning = earningsData.earningsWarning
      reasoning = `📅 ${earningsWarning}. Original signal: ${direction} - ${reasoning}`
      direction = 'WATCH'
    }
    else if (indicators.isVolatilitySpike && (direction === 'LONG' || direction === 'SHORT' || direction === 'BOTH')) {
      volatilityWarning = indicators.volatilityWarning
      reasoning = `⚠️ ${volatilityWarning}. Original signal: ${direction} - ${reasoning}`
      direction = 'WATCH'
    }

    // =====================================================
    // S/R GUARDRAILS + AIR POCKET GATE (Stage 2)
    // Now regime-aware: shorts can break THROUGH support (not just bounce off it)
    // =====================================================
    const riskAmount = indicators.atrRaw
    const airPocketBuffer = riskAmount * 0.15  // 0.15R buffer per expert advice

    // SHORT guardrail: is there support too close below?
    if ((direction === 'SHORT' || direction === 'BOTH') && indicators.nearestSupport) {
      const distToSupport = indicators.distanceToSupport
      const sr = indicators.nearestSupport
      const priceAtOrBelowSupport = indicators.currentPrice <= sr.level * 1.002 // within 0.2%

      // Support break exception: if price is AT or BELOW support AND momentum confirms
      // breakdown, this is a SUPPORT BREAK short — allow it (Livermore pivot / Darvas expansion down)
      const isSupportBreak = priceAtOrBelowSupport && indicators.momentum5d < 0

      if (!isSupportBreak) {
        // Block if support is within 0.5R (shorting into bounce zone)
        if (distToSupport < riskAmount * 0.5) {
          reasoning = `🛡️ Short blocked: ${sr.type} support at ${sr.level.toFixed(2)} only ${(distToSupport / riskAmount).toFixed(2)}R away. Original: ${direction} - ${reasoning}`
          if (direction === 'BOTH') {
            // BOTH → demote short side, keep as LONG only
            direction = 'LONG'
            reasoning = `🛡️ Short side blocked by support → LONG only. ${reasoning}`
          } else {
            direction = 'WATCH'
          }
        }
        // Air pocket gate: can T1 (1R) be reached before hitting support?
        else if (distToSupport < riskAmount - airPocketBuffer) {
          reasoning = `🛡️ No air pocket: ${sr.type} at ${sr.level.toFixed(2)} blocks T1. Original: ${direction} - ${reasoning}`
          if (direction === 'BOTH') {
            direction = 'LONG'
            reasoning = `🛡️ Short T1 blocked by support → LONG only. ${reasoning}`
          } else {
            direction = 'WATCH'
          }
        }
      } else {
        reasoning = `📉 Support break: price at/below ${sr.type} ${sr.level.toFixed(2)} with downward momentum. ${reasoning}`
      }
    }

    // LONG guardrail: is there resistance too close above?
    if ((direction === 'LONG' || direction === 'BOTH') && indicators.nearestResistance) {
      const distToResistance = indicators.distanceToResistance
      const sr = indicators.nearestResistance
      // Block if resistance is within 0.5R (buying into ceiling)
      if (distToResistance < riskAmount * 0.5) {
        reasoning = `🛡️ Long blocked: ${sr.type} resistance at ${sr.level.toFixed(2)} only ${(distToResistance / riskAmount).toFixed(2)}R away. Original: ${direction} - ${reasoning}`
        if (direction === 'BOTH') {
          // BOTH → demote long side, keep as SHORT only
          direction = 'SHORT'
          reasoning = `🛡️ Long side blocked by resistance → SHORT only. ${reasoning}`
        } else {
          direction = 'WATCH'
        }
      }
      // Air pocket gate: can T1 (1R) be reached before hitting resistance?
      else if (distToResistance < riskAmount - airPocketBuffer) {
        reasoning = `🛡️ No air pocket: ${sr.type} at ${sr.level.toFixed(2)} blocks T1. Original: ${direction} - ${reasoning}`
        if (direction === 'BOTH') {
          direction = 'SHORT'
          reasoning = `🛡️ Long T1 blocked by resistance → SHORT only. ${reasoning}`
        } else {
          direction = 'WATCH'
        }
      }
    }

    // Calculate ATR-based trade management (entry, stop, dynamic targets, £/point)
    // regimeSizeMultiplier = 1.0 here; POST handler adjusts £/pt per regime state
    // For BOTH: trade management uses the stronger side's score; Stage 3 will resolve
    const tradeManagement = (direction === 'LONG' || direction === 'SHORT')
      ? calculateTradeManagement({
          currentPrice: indicators.currentPrice,
          atr: indicators.atrRaw,
          direction,
          recentHigh: indicators.recentHigh,
          recentLow: indicators.recentLow,
          accountSize,
          riskPercent,
          regimeSizeMultiplier: 1.0,
          score,
          pillarsPassing,
          regimeState,
          fractalTarget,
          airPocketOk: true,
          nearestResistance: indicators.nearestResistance,
          nearestSupport: indicators.nearestSupport,
        })
      : null  // BOTH / WATCH / NONE — trade management computed after Stage 3 resolves direction

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
      // For BOTH: include both side scores so Stage 3 can pick the regime-aligned side
      longScore: longScore || (direction === 'LONG' ? score : null),
      shortScore: shortScore || (direction === 'SHORT' ? score : null),
      longPassing: longPassingFromDir,
      shortPassing: shortPassingFromDir,
      setupTier: tradeManagement?.setupTier || null,
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
        distanceFrom52Low: indicators.distanceFrom52Low,
        // S/R ladder summary
        nearestSupport: indicators.nearestSupport ? {
          level: indicators.nearestSupport.level,
          type: indicators.nearestSupport.type,
          distanceR: indicators.atrRaw > 0 ? (indicators.distanceToSupport / indicators.atrRaw).toFixed(2) : null
        } : null,
        nearestResistance: indicators.nearestResistance ? {
          level: indicators.nearestResistance.level,
          type: indicators.nearestResistance.type,
          distanceR: indicators.atrRaw > 0 ? (indicators.distanceToResistance / indicators.atrRaw).toFixed(2) : null
        } : null
      },
      // ATR-based trade management
      tradeManagement,
      entryTiming,
      // Raw indicators for deferred trade management (BOTH → resolved in POST handler)
      rawIndicators: direction === 'BOTH' ? {
        currentPrice: indicators.currentPrice,
        atrRaw: indicators.atrRaw,
        recentHigh: indicators.recentHigh,
        recentLow: indicators.recentLow,
        nearestResistance: indicators.nearestResistance,
        nearestSupport: indicators.nearestSupport,
      } : null,
      fractalTarget,
      // Warnings
      volatilityWarning,
      earningsWarning,
      earningsDate: earningsData.earningsDate,
      daysUntilEarnings: earningsData.daysUntilEarnings,
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

  // Momentum (% returns) - multiple timeframes for 1-3 day trading
  const momentum3d = n >= 4 ? ((currentPrice - closes[n - 4]) / closes[n - 4] * 100) : 0
  const momentum5d = ((currentPrice - closes[n - 6]) / closes[n - 6] * 100)
  const momentum10d = n >= 11 ? ((currentPrice - closes[n - 11]) / closes[n - 11] * 100) : 0
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

  // Price vs fast MAs (critical for 1-3 day trading)
  const priceVsMa10 = ((currentPrice - ma10) / ma10 * 100)
  const priceVsMa20 = ((currentPrice - ma20) / ma20 * 100)

  // ATR rate of change: is volatility expanding or contracting?
  // Compare recent 5-day ATR vs 14-day ATR
  const atr5 = n >= 6 ? calculateATR(highs.slice(-6), lows.slice(-6), closes.slice(-6), 5) : atrRaw
  const atrExpansion = atrRaw > 0 ? (atr5 / atrRaw) : 1  // >1 = expanding, <1 = contracting

  // Up-volume vs down-volume ratio (participation quality)
  let upVolume = 0, downVolume = 0
  for (let i = Math.max(0, n - 10); i < n; i++) {
    if (closes[i] > closes[i - 1]) {
      upVolume += (volumes[i] || 0)
    } else {
      downVolume += (volumes[i] || 0)
    }
  }
  const upDownVolumeRatio = downVolume > 0 ? upVolume / downVolume : 1

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

  // =====================================================
  // S/R LADDER — Previous Day, Period, Fractal, Round Numbers
  // =====================================================

  // 1) Previous Day Levels (PDH, PDL, PDC)
  // Most-watched S/R for 1-3 day timeframes
  const pdh = n >= 2 ? highs[n - 2] : null    // Previous day high (bar before last)
  const pdl = n >= 2 ? lows[n - 2] : null      // Previous day low
  const pdc = n >= 2 ? closes[n - 2] : null    // Previous day close

  // 2) Period Highs/Lows (5, 10, 20 day)
  const h5 = Math.max(...highs.slice(-5).filter(h => h !== null))
  const l5 = Math.min(...lows.slice(-5).filter(l => l !== null))
  // recentHigh = H10, recentLow = L10 (already computed above)
  const h20 = Math.max(...highs.slice(-20).filter(h => h !== null))
  const l20 = Math.min(...lows.slice(-20).filter(l => l !== null))

  // 3) Fractal Swing High/Low Detector (3-bar pattern)
  // Swing High at i: High[i] > High[i-1] AND High[i] > High[i+1]
  // Swing Low at i: Low[i] < Low[i-1] AND Low[i] < Low[i+1]
  const swingHighs = []
  const swingLows = []
  const fractalLookback = Math.min(40, n - 2)  // Last 40 bars
  for (let i = n - fractalLookback; i < n - 1; i++) {
    if (i > 0 && highs[i] !== null && highs[i - 1] !== null && highs[i + 1] !== null) {
      if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
        swingHighs.push(highs[i])
      }
    }
    if (i > 0 && lows[i] !== null && lows[i - 1] !== null && lows[i + 1] !== null) {
      if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
        swingLows.push(lows[i])
      }
    }
  }

  // 4) Round Number Levels
  // Choose step size based on price magnitude
  let roundStep
  if (currentPrice < 5) roundStep = 0.5
  else if (currentPrice < 20) roundStep = 1
  else if (currentPrice < 100) roundStep = 5
  else if (currentPrice < 500) roundStep = 10
  else if (currentPrice < 2000) roundStep = 50
  else if (currentPrice < 10000) roundStep = 100
  else roundStep = 500

  const roundBelow = Math.floor(currentPrice / roundStep) * roundStep
  const roundAbove = Math.ceil(currentPrice / roundStep) * roundStep
  // Avoid if it's essentially at the current price
  const roundLevelBelow = (currentPrice - roundBelow) > atrRaw * 0.05 ? roundBelow : roundBelow - roundStep
  const roundLevelAbove = (roundAbove - currentPrice) > atrRaw * 0.05 ? roundAbove : roundAbove + roundStep

  // 5) Build full S/R ladders
  // SUPPORT: all levels below current price
  const allSupportLevels = [
    ...(pdl && pdl < currentPrice ? [{ level: pdl, type: 'PDL', weight: 2 }] : []),
    ...(pdc && pdc < currentPrice ? [{ level: pdc, type: 'PDC', weight: 2 }] : []),
    ...(l5 < currentPrice ? [{ level: l5, type: 'L5', weight: 2 }] : []),
    ...(recentLow < currentPrice ? [{ level: recentLow, type: 'L10', weight: 2 }] : []),
    ...(l20 < currentPrice ? [{ level: l20, type: 'L20', weight: 2 }] : []),
    ...(ma50 < currentPrice ? [{ level: ma50, type: 'MA50', weight: 1.5 }] : []),
    ...swingLows.filter(s => s < currentPrice).map(s => ({ level: s, type: 'SwingLow', weight: 3 })),
    ...(roundLevelBelow > 0 && roundLevelBelow < currentPrice ? [{ level: roundLevelBelow, type: 'Round', weight: 1 }] : [])
  ].sort((a, b) => b.level - a.level)  // Closest to price first

  // RESISTANCE: all levels above current price
  const allResistanceLevels = [
    ...(pdh && pdh > currentPrice ? [{ level: pdh, type: 'PDH', weight: 2 }] : []),
    ...(pdc && pdc > currentPrice ? [{ level: pdc, type: 'PDC', weight: 2 }] : []),
    ...(h5 > currentPrice ? [{ level: h5, type: 'H5', weight: 2 }] : []),
    ...(recentHigh > currentPrice ? [{ level: recentHigh, type: 'H10', weight: 2 }] : []),
    ...(h20 > currentPrice ? [{ level: h20, type: 'H20', weight: 2 }] : []),
    ...(ma50 > currentPrice ? [{ level: ma50, type: 'MA50', weight: 1.5 }] : []),
    ...swingHighs.filter(s => s > currentPrice).map(s => ({ level: s, type: 'SwingHigh', weight: 3 })),
    ...(roundLevelAbove > 0 && roundLevelAbove > currentPrice ? [{ level: roundLevelAbove, type: 'Round', weight: 1 }] : [])
  ].sort((a, b) => a.level - b.level)  // Closest to price first

  // Nearest meaningful support/resistance
  const nearestSupport = allSupportLevels.length > 0 ? allSupportLevels[0] : null
  const nearestResistance = allResistanceLevels.length > 0 ? allResistanceLevels[0] : null

  // Distance calculations (as price, not %)
  const distanceToSupport = nearestSupport ? currentPrice - nearestSupport.level : atrRaw * 100
  const distanceToResistance = nearestResistance ? nearestResistance.level - currentPrice : atrRaw * 100

  // Legacy compat
  const distanceToNearestSupport = nearestSupport
    ? ((currentPrice - nearestSupport.level) / currentPrice) * 100
    : 999

  return {
    currentPrice,
    ma10, ma20, ma50, ma200,
    momentum3d, momentum5d, momentum10d, momentum20d, momentum63d,
    rsi,
    volumeRatio,
    upDownVolumeRatio,
    atr: atrPercent,
    atrRaw,           // Raw ATR value for stop/target calculations
    atrExpansion,      // >1 = vol expanding, <1 = contracting
    recentHigh,       // 10-day high for entry zone
    recentLow,        // 10-day low for entry zone
    distanceFrom52High,
    distanceFrom52Low,
    priceVsMa10,
    priceVsMa20,
    priceVsMa50,
    priceVsMa200,
    ma50VsMa200,
    vcpScore,
    trendStrength,
    // Volatility spike detection
    isVolatilitySpike,
    volatilityWarning,
    rangeVsAtr,
    // Previous day levels
    pdh, pdl, pdc,
    // Period highs/lows
    h5, l5, h20, l20,
    // S/R ladder
    nearestSupport,       // { level, type, weight } or null
    nearestResistance,    // { level, type, weight } or null
    allSupportLevels,     // Full sorted ladder
    allResistanceLevels,  // Full sorted ladder
    distanceToSupport,    // In price units
    distanceToResistance, // In price units
    distanceToNearestSupport  // Legacy compat (%)
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
 * Calculate ATR-based trade management levels with dynamic two-stage targets
 *
 * Two-stage exit strategy:
 * - T1 (partial): 1.0R default, 1.5R for elite setups → take 50%, move stop to breakeven
 * - T2 (runner):  1.618R default, 2.618R for elite → capped by fractal target & S/R buffer
 *
 * Elite upgrade requires ALL of: A+ tier, STRONGLY_ALIGNED regime, clean air pocket
 *
 * ATR Clamp: Stop distance clamped to 0.618-1.618x ATR
 * S/R Buffer: T2 pulled back 0.15R from nearest S/R to avoid targeting into walls
 */
function calculateTradeManagement(opts) {
  const {
    currentPrice, atr, direction, recentHigh, recentLow,
    accountSize, riskPercent, regimeSizeMultiplier,
    score = 0, pillarsPassing = 0, regimeState = 'YELLOW',
    fractalTarget = null, airPocketOk = false,
    nearestResistance = null, nearestSupport = null,
  } = opts

  if (!atr || atr <= 0) {
    return null
  }

  // ── SETUP TIER (derived from score + pillarsPassing) ──
  let setupTier
  if (score >= 90 && pillarsPassing >= 6) {
    setupTier = 'A+'
  } else if (score >= 80 && pillarsPassing >= 5) {
    setupTier = 'A'
  } else if (score >= 70 && pillarsPassing >= 4) {
    setupTier = 'B'
  } else {
    setupTier = 'C'
  }

  // ── REGIME ALIGNMENT ──
  const isAlignedDirection =
    (regimeState === 'GREEN' && direction === 'LONG') ||
    (regimeState === 'RED' && direction === 'SHORT')

  let regimeAlignment
  if (isAlignedDirection && score >= 85) {
    regimeAlignment = 'STRONGLY_ALIGNED'
  } else if (isAlignedDirection) {
    regimeAlignment = 'ALIGNED'
  } else {
    regimeAlignment = 'NOT_ALIGNED'
  }

  // ── ELITE UPGRADE CONDITION ──
  // Same condition gates both T1 (1.0→1.5R) and T2 (1.618→2.618R)
  const isEliteSetup = setupTier === 'A+' && regimeAlignment === 'STRONGLY_ALIGNED' && airPocketOk

  // ── DYNAMIC MULTIPLIERS ──
  const t1Mult = isEliteSetup ? 1.5 : 1.0
  const fibMult = isEliteSetup ? 2.618 : 1.618

  // Entry zone: current price +/- 0.2 ATR for limit orders
  const entryBuffer = atr * 0.2

  // ATR clamp bounds (Fibonacci-derived)
  const atrFloor = atr * 0.618
  const atrCap = atr * 1.618

  // S/R buffer: 0.15R to avoid targeting directly into walls
  const srBufferMult = 0.15

  if (direction === 'LONG') {
    // ── ENTRY & STOP (unchanged) ──
    const entryHigh = currentPrice
    const entryLow = Math.max(currentPrice - entryBuffer, recentLow)
    const entryMid = (entryHigh + entryLow) / 2

    const rawStopDistance = atr
    const clampedStopDistance = Math.max(atrFloor, Math.min(atrCap, rawStopDistance))
    const stopLoss = entryLow - clampedStopDistance

    // R = risk per share
    const risk = entryMid - stopLoss
    if (risk <= 0) return null

    // ── DYNAMIC T1 ──
    const target1 = entryMid + (risk * t1Mult)

    // ── DYNAMIC T2 ──
    // Step 1: Fib-based candidate
    const t2Fib = entryMid + (risk * fibMult)

    // Step 2: Cap at fractal target if it exists and is closer
    let t2PreSR = t2Fib
    let t2Basis = isEliteSetup ? 'FIB_2.618' : 'FIB_1.618'
    if (fractalTarget !== null && fractalTarget > entryMid) {
      if (fractalTarget < t2Fib) {
        t2PreSR = fractalTarget
        t2Basis = 'FRACTAL'
      }
    }

    // Step 3: S/R buffer — pull back if nearest resistance is near T2
    const srBuffer = risk * srBufferMult
    let t2Final = t2PreSR
    if (nearestResistance && nearestResistance.level > target1) {
      const srCap = nearestResistance.level - srBuffer
      if (srCap < t2Final) {
        t2Final = srCap
        t2Basis += ' + SR_ADJUSTED'
      }
    }

    // Step 4: Validation — T2 must be beyond T1
    const notes = []
    if (t2Final <= target1) {
      t2Final = target1
      notes.push('T2_CLAMPED_TO_T1')
    }

    // Step 5: Validation — T2 must be beyond entry
    if (t2Final <= entryMid) return null

    // R:R ratio (using T2 runner target)
    const reward = t2Final - entryMid
    const riskRewardRatio = reward / risk

    // £ per point calculation
    const stopDistancePoints = Math.abs(entryMid - stopLoss)
    const positionSizing = calculatePositionSizing(accountSize, riskPercent, stopDistancePoints, regimeSizeMultiplier)

    return {
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss,
      target1,
      target2: t2Final,
      risk,
      riskRewardRatio: riskRewardRatio.toFixed(1),
      // Dynamic target context
      setupTier,
      regimeAlignment,
      t1Mult,
      t2Basis,
      fractalTarget,
      runnerStopAfterT1: entryMid,  // breakeven
      t1SizePct: 50,
      runnerSizePct: 50,
      notes,
      ...positionSizing
    }
  } else if (direction === 'SHORT') {
    // ── ENTRY & STOP (unchanged) ──
    const entryLow = currentPrice
    const entryHigh = Math.min(currentPrice + entryBuffer, recentHigh)
    const entryMid = (entryHigh + entryLow) / 2

    const rawStopDistance = atr
    const clampedStopDistance = Math.max(atrFloor, Math.min(atrCap, rawStopDistance))
    const stopLoss = entryHigh + clampedStopDistance

    // R = risk per share
    const risk = stopLoss - entryMid
    if (risk <= 0) return null

    // ── DYNAMIC T1 ──
    const target1 = entryMid - (risk * t1Mult)

    // ── DYNAMIC T2 ──
    // Step 1: Fib-based candidate
    const t2Fib = entryMid - (risk * fibMult)

    // Step 2: Cap at fractal target if it exists and is closer (for shorts, closer = higher)
    let t2PreSR = t2Fib
    let t2Basis = isEliteSetup ? 'FIB_2.618' : 'FIB_1.618'
    if (fractalTarget !== null && fractalTarget < entryMid) {
      if (fractalTarget > t2Fib) {
        t2PreSR = fractalTarget
        t2Basis = 'FRACTAL'
      }
    }

    // Step 3: S/R buffer — pull back if nearest support is near T2
    const srBuffer = risk * srBufferMult
    let t2Final = t2PreSR
    if (nearestSupport && nearestSupport.level < target1) {
      const srFloor = nearestSupport.level + srBuffer
      if (srFloor > t2Final) {
        t2Final = srFloor
        t2Basis += ' + SR_ADJUSTED'
      }
    }

    // Step 4: Validation — T2 must be beyond T1 (lower for shorts)
    const notes = []
    if (t2Final >= target1) {
      t2Final = target1
      notes.push('T2_CLAMPED_TO_T1')
    }

    // Step 5: Validation — T2 must be beyond entry (lower for shorts)
    if (t2Final >= entryMid) return null

    // R:R ratio (using T2 runner target)
    const reward = entryMid - t2Final
    const riskRewardRatio = reward / risk

    // £ per point calculation
    const stopDistancePoints = Math.abs(stopLoss - entryMid)
    const positionSizing = calculatePositionSizing(accountSize, riskPercent, stopDistancePoints, regimeSizeMultiplier)

    return {
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss,
      target1,
      target2: t2Final,
      risk,
      riskRewardRatio: riskRewardRatio.toFixed(1),
      // Dynamic target context
      setupTier,
      regimeAlignment,
      t1Mult,
      t2Basis,
      fractalTarget,
      runnerStopAfterT1: entryMid,  // breakeven
      t1SizePct: 50,
      runnerSizePct: 50,
      notes,
      ...positionSizing
    }
  }

  return null
}

/**
 * Calculate £ per point position sizing for spread bets
 * Returns poundsPerPoint, effectiveRisk, notionalExposure, marginRequired
 */
function calculatePositionSizing(accountSize, riskPercent, stopDistancePoints, regimeSizeMultiplier = 1.0) {
  if (!accountSize || !riskPercent || !stopDistancePoints || stopDistancePoints <= 0) {
    return {}
  }

  const baseRisk = accountSize * (riskPercent / 100)
  const effectiveRisk = baseRisk * (regimeSizeMultiplier || 1.0)
  const poundsPerPoint = effectiveRisk / stopDistancePoints

  return {
    poundsPerPoint: parseFloat(poundsPerPoint.toFixed(4)),
    effectiveRisk: parseFloat(effectiveRisk.toFixed(2)),
    baseRisk: parseFloat(baseRisk.toFixed(2)),
    regimeMultiplier: regimeSizeMultiplier || 1.0
  }
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

// Sector ETF mapping for relative strength calculation
const SECTOR_ETFS = {
  // US sectors
  'AAPL': 'XLK', 'MSFT': 'XLK', 'GOOGL': 'XLK', 'META': 'XLK', 'NVDA': 'XLK',
  'AVGO': 'XLK', 'ADBE': 'XLK', 'CRM': 'XLK', 'CSCO': 'XLK', 'INTC': 'XLK',
  'AMD': 'XLK', 'QCOM': 'XLK', 'TXN': 'XLK', 'ACN': 'XLK', 'NFLX': 'XLK',
  'AMZN': 'XLY', 'TSLA': 'XLY', 'HD': 'XLY', 'MCD': 'XLY', 'NKE': 'XLY', 'LOW': 'XLY',
  'JPM': 'XLF', 'V': 'XLF', 'MA': 'XLF', 'SPGI': 'XLF', 'BRK-B': 'XLF',
  'UNH': 'XLV', 'JNJ': 'XLV', 'MRK': 'XLV', 'ABBV': 'XLV', 'LLY': 'XLV',
  'TMO': 'XLV', 'ABT': 'XLV', 'DHR': 'XLV', 'PFE': 'XLV',
  'XOM': 'XLE', 'CVX': 'XLE',
  'PG': 'XLP', 'KO': 'XLP', 'PEP': 'XLP', 'COST': 'XLP', 'WMT': 'XLP', 'PM': 'XLP',
  'NEE': 'XLU', 'VZ': 'XLC', 'CMCSA': 'XLC',
  'RTX': 'XLI', 'HON': 'XLI', 'BA': 'XLI', 'UNP': 'XLI', 'CAT': 'XLI',
  // UK stocks - use FTSE 100 as sector proxy
  'SHEL.L': '^FTSE', 'BP.L': '^FTSE', 'AZN.L': '^FTSE', 'HSBA.L': '^FTSE',
  'ULVR.L': '^FTSE', 'GSK.L': '^FTSE', 'RIO.L': '^FTSE', 'REL.L': '^FTSE',
  'DGE.L': '^FTSE', 'BATS.L': '^FTSE', 'LSEG.L': '^FTSE', 'NG.L': '^FTSE',
  'AAL.L': '^FTSE', 'GLEN.L': '^FTSE', 'VOD.L': '^FTSE', 'BHP.L': '^FTSE',
  'PRU.L': '^FTSE', 'LLOY.L': '^FTSE', 'BARC.L': '^FTSE', 'RKT.L': '^FTSE',
  'IMB.L': '^FTSE', 'SSE.L': '^FTSE', 'AHT.L': '^FTSE', 'BA.L': '^FTSE',
  'CPG.L': '^FTSE', 'EXPN.L': '^FTSE', 'STAN.L': '^FTSE', 'ABF.L': '^FTSE',
  'ANTO.L': '^FTSE', 'CRH.L': '^FTSE', 'FERG.L': '^FTSE', 'IAG.L': '^FTSE',
  'IHG.L': '^FTSE', 'KGF.L': '^FTSE', 'LAND.L': '^FTSE', 'LGEN.L': '^FTSE',
  'MNG.L': '^FTSE', 'NWG.L': '^FTSE', 'PSON.L': '^FTSE', 'RR.L': '^FTSE',
  'SBRY.L': '^FTSE', 'SGE.L': '^FTSE', 'SMDS.L': '^FTSE', 'SMT.L': '^FTSE',
  'SN.L': '^FTSE', 'SPX.L': '^FTSE', 'SVT.L': '^FTSE', 'TSCO.L': '^FTSE',
  'WPP.L': '^FTSE', 'WTB.L': '^FTSE'
}

// Cache for sector ETF data to avoid repeated fetches
const sectorCache = {}

async function fetchSectorMomentum(ticker) {
  const sectorETF = SECTOR_ETFS[ticker]
  if (!sectorETF) return null

  // Check cache (valid for 1 hour)
  if (sectorCache[sectorETF] && (Date.now() - sectorCache[sectorETF].timestamp < 3600000)) {
    return sectorCache[sectorETF].momentum20d
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sectorETF}?interval=1d&range=30d`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    if (!response.ok) return null

    const data = await response.json()
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
    const validCloses = closes.filter(c => c !== null)
    if (validCloses.length < 20) return null

    const n = validCloses.length
    const sectorMomentum20d = ((validCloses[n - 1] - validCloses[n - 21]) / validCloses[n - 21] * 100)

    sectorCache[sectorETF] = { momentum20d: sectorMomentum20d, timestamp: Date.now() }
    return sectorMomentum20d
  } catch {
    return null
  }
}

function average(arr) {
  const valid = arr.filter(v => v !== null && !isNaN(v))
  if (valid.length === 0) return 0
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function calculatePillarScores(indicators) {
  // =====================================================
  // SIX PILLARS - Bidirectional Momentum System
  // Each pillar scores BOTH long and short quality independently
  // Direction-agnostic signals (VCP, ATR) score both sides
  // Directional signals (MA stack, momentum) score their side only
  // Designed for 1-3 day spread bet swing trades
  // =====================================================
  const pillars = {
    livermore: { longScore: 0, shortScore: 0, max: 10, notes: [] },
    oneil: { longScore: 0, shortScore: 0, max: 10, notes: [] },
    minervini: { longScore: 0, shortScore: 0, max: 10, notes: [] },
    darvas: { longScore: 0, shortScore: 0, max: 10, notes: [] },
    raschke: { longScore: 0, shortScore: 0, max: 10, notes: [] },
    sectorRS: { longScore: 0, shortScore: 0, max: 10, notes: [] }
  }

  // ── LIVERMORE: Pivotal Point Timing ──
  // VCP is direction-agnostic (contracting ranges = coiled spring either way)
  if (indicators.vcpScore > 0) {
    pillars.livermore.longScore += 5
    pillars.livermore.shortScore += 5
    pillars.livermore.notes.push('VCP: contracting ranges')
  }
  // LONG: Near 52w high = breakout zone
  if (indicators.distanceFrom52High > -5) {
    pillars.livermore.longScore += 3
    pillars.livermore.notes.push('At 52w high (long pivot)')
  } else if (indicators.distanceFrom52High > -15) {
    pillars.livermore.longScore += 2
    pillars.livermore.notes.push('Approaching high pivot')
  }
  // SHORT: Near 52w low = breakdown zone
  if (indicators.distanceFrom52Low < 5) {
    pillars.livermore.shortScore += 3
    pillars.livermore.notes.push('At 52w low (short pivot)')
  } else if (indicators.distanceFrom52Low < 15) {
    pillars.livermore.shortScore += 2
    pillars.livermore.notes.push('Approaching low pivot')
  }
  // LONG: Early upward move (not chasing)
  if (indicators.momentum3d > 0.5 && indicators.momentum3d < 5) {
    pillars.livermore.longScore += 2
    pillars.livermore.notes.push('Early move up')
  }
  // SHORT: Early downward move (not chasing)
  if (indicators.momentum3d < -0.5 && indicators.momentum3d > -5) {
    pillars.livermore.shortScore += 2
    pillars.livermore.notes.push('Early move down')
  }

  // ── O'NEIL: Participation Quality (Demand vs Supply) ──
  // LONG: Accumulation (up volume dominates)
  if (indicators.upDownVolumeRatio > 1.5) {
    pillars.oneil.longScore += 4
    pillars.oneil.notes.push('Strong accumulation')
  } else if (indicators.upDownVolumeRatio > 1.2) {
    pillars.oneil.longScore += 2
    pillars.oneil.notes.push('Mild accumulation')
  }
  // SHORT: Distribution (down volume dominates)
  if (indicators.upDownVolumeRatio < 0.67) {
    pillars.oneil.shortScore += 4
    pillars.oneil.notes.push('Strong distribution')
  } else if (indicators.upDownVolumeRatio < 0.83) {
    pillars.oneil.shortScore += 2
    pillars.oneil.notes.push('Mild distribution')
  }
  // Volume surge — direction-agnostic (confirms conviction either way)
  if (indicators.volumeRatio > 1.5) {
    pillars.oneil.longScore += 4
    pillars.oneil.shortScore += 4
    pillars.oneil.notes.push('Volume surge (1.5x avg)')
  } else if (indicators.volumeRatio > 1.2) {
    pillars.oneil.longScore += 2
    pillars.oneil.shortScore += 2
    pillars.oneil.notes.push('Above-average volume')
  }
  // LONG: Volume dry-up in base (bullish for breakout)
  if (indicators.vcpScore > 0 && indicators.volumeRatio < 0.8) {
    pillars.oneil.longScore += 2
    pillars.oneil.notes.push('Volume dry-up in base')
  }
  // SHORT: Failed rally on low volume (bearish for breakdown)
  if (indicators.vcpScore > 0 && indicators.volumeRatio < 0.8 && indicators.momentum3d < 0) {
    pillars.oneil.shortScore += 2
    pillars.oneil.notes.push('Failed rally on low volume')
  }

  // ── MINERVINI: Trend Template (MA Alignment) ──
  // LONG: Price > 10 > 20 > 50 stacking
  let longTrendChecks = 0
  if (indicators.priceVsMa10 > 0) longTrendChecks++
  if (indicators.priceVsMa20 > 0) longTrendChecks++
  if (indicators.priceVsMa50 > 0) longTrendChecks++
  if (indicators.ma10 > indicators.ma20) longTrendChecks++
  if (indicators.ma20 > indicators.ma50) longTrendChecks++
  pillars.minervini.longScore = Math.min(10, longTrendChecks * 2)
  if (longTrendChecks >= 4) pillars.minervini.notes.push(`Long MA stack: ${longTrendChecks}/5`)

  // SHORT: Price < 10 < 20 < 50 inverse stacking
  let shortTrendChecks = 0
  if (indicators.priceVsMa10 < 0) shortTrendChecks++
  if (indicators.priceVsMa20 < 0) shortTrendChecks++
  if (indicators.priceVsMa50 < 0) shortTrendChecks++
  if (indicators.ma10 < indicators.ma20) shortTrendChecks++
  if (indicators.ma20 < indicators.ma50) shortTrendChecks++
  pillars.minervini.shortScore = Math.min(10, shortTrendChecks * 2)
  if (shortTrendChecks >= 4) pillars.minervini.notes.push(`Short MA stack: ${shortTrendChecks}/5`)

  // ── DARVAS: Volatility Contraction → Expansion ──
  // Tight range — direction-agnostic (coiled spring)
  if (indicators.atr < 2.5) {
    pillars.darvas.longScore += 3
    pillars.darvas.shortScore += 3
    pillars.darvas.notes.push('Tight range (low ATR%)')
  } else if (indicators.atr < 4) {
    pillars.darvas.longScore += 1
    pillars.darvas.shortScore += 1
    pillars.darvas.notes.push('Moderate range')
  }
  // ATR expansion — direction-agnostic (breakout happening)
  if (indicators.atrExpansion > 1.3) {
    pillars.darvas.longScore += 4
    pillars.darvas.shortScore += 4
    pillars.darvas.notes.push('ATR expanding (breakout trigger!)')
  } else if (indicators.atrExpansion > 1.1) {
    pillars.darvas.longScore += 2
    pillars.darvas.shortScore += 2
    pillars.darvas.notes.push('ATR starting to expand')
  }
  // Squeeze release — DIRECTIONAL (uses momentum3d to assign side)
  if (indicators.vcpScore > 0 && indicators.atrExpansion > 1.2) {
    if (indicators.momentum3d > 0) {
      pillars.darvas.longScore += 3
      pillars.darvas.notes.push('Squeeze release UP!')
    }
    if (indicators.momentum3d < 0) {
      pillars.darvas.shortScore += 3
      pillars.darvas.notes.push('Squeeze release DOWN!')
    }
  }

  // ── RASCHKE: Momentum Speed & Acceleration ──
  // LONG momentum
  if (indicators.momentum3d > 2) {
    pillars.raschke.longScore += 3
    pillars.raschke.notes.push('3d momentum strong (up)')
  } else if (indicators.momentum3d > 0.5) {
    pillars.raschke.longScore += 1
  }
  // SHORT momentum
  if (indicators.momentum3d < -2) {
    pillars.raschke.shortScore += 3
    pillars.raschke.notes.push('3d momentum strong (down)')
  } else if (indicators.momentum3d < -0.5) {
    pillars.raschke.shortScore += 1
  }
  // LONG acceleration: 3d rate > 5d rate (speeding up)
  if (indicators.momentum3d > 0 && indicators.momentum5d > 0 &&
      (indicators.momentum3d / 3) > (indicators.momentum5d / 5)) {
    pillars.raschke.longScore += 3
    pillars.raschke.notes.push('Momentum accelerating up')
  }
  // SHORT acceleration: downward momentum speeding up
  if (indicators.momentum3d < 0 && indicators.momentum5d < 0 &&
      (Math.abs(indicators.momentum3d) / 3) > (Math.abs(indicators.momentum5d) / 5)) {
    pillars.raschke.shortScore += 3
    pillars.raschke.notes.push('Momentum accelerating down')
  }
  // LONG RSI: confirms bullish momentum (not overbought)
  if (indicators.rsi > 55 && indicators.rsi < 75) {
    pillars.raschke.longScore += 2
    pillars.raschke.notes.push('RSI confirming momentum')
  }
  // SHORT RSI: confirms bearish momentum (not oversold — no mean reversion)
  if (indicators.rsi > 25 && indicators.rsi < 45) {
    pillars.raschke.shortScore += 2
    pillars.raschke.notes.push('RSI confirming weakness')
  }
  // LONG: All timeframes aligned up
  if (indicators.momentum5d > 0 && indicators.momentum10d > 0 && indicators.momentum20d > 0) {
    pillars.raschke.longScore += 2
    pillars.raschke.notes.push('All timeframes aligned up')
  }
  // SHORT: All timeframes aligned down
  if (indicators.momentum5d < 0 && indicators.momentum10d < 0 && indicators.momentum20d < 0) {
    pillars.raschke.shortScore += 2
    pillars.raschke.notes.push('All timeframes aligned down')
  }

  // ── SECTOR RS: Relative Strength vs Sector ──
  if (indicators.sectorRelativeStrength !== null) {
    // LONG: Outperforming sector
    if (indicators.sectorRelativeStrength > 5) {
      pillars.sectorRS.longScore += 5
      pillars.sectorRS.notes.push(`Beating sector by ${indicators.sectorRelativeStrength.toFixed(1)}%`)
    } else if (indicators.sectorRelativeStrength > 2) {
      pillars.sectorRS.longScore += 3
    } else if (indicators.sectorRelativeStrength > 0) {
      pillars.sectorRS.longScore += 1
    }
    // SHORT: Underperforming sector
    if (indicators.sectorRelativeStrength < -5) {
      pillars.sectorRS.shortScore += 5
      pillars.sectorRS.notes.push(`Lagging sector by ${Math.abs(indicators.sectorRelativeStrength).toFixed(1)}%`)
    } else if (indicators.sectorRelativeStrength < -2) {
      pillars.sectorRS.shortScore += 3
    } else if (indicators.sectorRelativeStrength < 0) {
      pillars.sectorRS.shortScore += 1
    }
    // LONG: Short-term sector leader
    if (indicators.momentum10d > 0 && indicators.sectorRelativeStrength > 0) {
      pillars.sectorRS.longScore += 3
      pillars.sectorRS.notes.push('Short-term sector leader')
    }
    // SHORT: Short-term sector laggard
    if (indicators.momentum10d < 0 && indicators.sectorRelativeStrength < 0) {
      pillars.sectorRS.shortScore += 3
      pillars.sectorRS.notes.push('Short-term sector laggard')
    }
    // LONG: Sector tailwind (sector itself trending up)
    if (indicators.sectorMomentum20d > 2) {
      pillars.sectorRS.longScore += 2
      pillars.sectorRS.notes.push('Sector has tailwind')
    }
    // SHORT: Sector headwind (sector itself trending down)
    if (indicators.sectorMomentum20d < -2) {
      pillars.sectorRS.shortScore += 2
      pillars.sectorRS.notes.push('Sector has headwind')
    }
  } else {
    // No sector data - neutral score so it doesn't penalise either side
    pillars.sectorRS.longScore = 5
    pillars.sectorRS.shortScore = 5
    pillars.sectorRS.notes.push('No sector data (neutral)')
  }

  // Cap all scores to max 10
  for (const key of Object.keys(pillars)) {
    pillars[key].longScore = Math.min(pillars[key].max, pillars[key].longScore)
    pillars[key].shortScore = Math.min(pillars[key].max, pillars[key].shortScore)
  }

  return pillars
}

function determineTradeDirection(pillars, indicators) {
  // =====================================================
  // BIDIRECTIONAL DIRECTION GATE
  // Uses dedicated long/short pillar scores for genuine
  // quality assessment on both sides
  // =====================================================
  const maxScore = Object.values(pillars).reduce((sum, p) => sum + p.max, 0) // 60

  // Calculate long totals
  const longTotal = Object.values(pillars).reduce((sum, p) => sum + p.longScore, 0)
  const longScorePercent = (longTotal / maxScore) * 100
  const longPassing = Object.values(pillars).filter(p => p.longScore >= 5).length

  // Calculate short totals
  const shortTotal = Object.values(pillars).reduce((sum, p) => sum + p.shortScore, 0)
  const shortScorePercent = (shortTotal / maxScore) * 100
  const shortPassing = Object.values(pillars).filter(p => p.shortScore >= 5).length

  const reasoning = []

  // =====================================================
  // SYMMETRIC DIRECTION ASSIGNMENT (Stage 1)
  // Stage 1 is PERMISSIVE — "is there a plausible thesis?"
  // Stage 3 (regime thresholds) is the STRICT gate
  // =====================================================

  // Directional signals — symmetric thresholds for both sides
  const hasLongSignal = indicators.priceVsMa20 > 0 || indicators.momentum5d > 0
  const hasShortSignal = indicators.priceVsMa20 < 0 || indicators.momentum5d < 0

  // Minimum quality: pillars confirm the thesis
  const longQualifies = longPassing >= 3 && longScorePercent >= 45 && hasLongSignal
  const shortQualifies = shortPassing >= 3 && shortScorePercent >= 45 && hasShortSignal

  // ── BOTH: stock is transitioning, let Stage 3 (regime) pick the side ──
  if (longQualifies && shortQualifies) {
    // Determine which side is stronger for scoring
    const strongerSide = longScorePercent >= shortScorePercent ? 'long' : 'short'
    reasoning.push(`BOTH sides viable: L ${longPassing}/6 (${longScorePercent.toFixed(0)}%), S ${shortPassing}/6 (${shortScorePercent.toFixed(0)}%)`)
    if (indicators.vcpScore > 0) reasoning.push('VCP forming')
    if (indicators.atrExpansion > 1.2) reasoning.push('Volatility expanding')

    return {
      direction: 'BOTH',
      score: Math.max(longScorePercent, shortScorePercent),
      longScore: longScorePercent,
      shortScore: shortScorePercent,
      longPassing,
      shortPassing,
      reasoning: reasoning.join(', ')
    }
  }

  // ── LONG: clear long thesis ──
  if (longQualifies && longPassing >= 4 && longScorePercent >= 50) {
    reasoning.push(`${longPassing}/6 long pillars passing`)
    reasoning.push(`Long score: ${longScorePercent.toFixed(0)}%`)
    if (indicators.distanceFrom52High > -5) reasoning.push('At 52w high')
    if (indicators.volumeRatio > 1.2) reasoning.push('Volume confirming')
    if (indicators.atrExpansion > 1.2) reasoning.push('Volatility expanding')

    return {
      direction: 'LONG',
      score: longScorePercent,
      reasoning: reasoning.join(', ')
    }
  }

  // ── SHORT: clear short thesis (symmetric with longs — no -2% hard gates) ──
  if (shortQualifies && shortPassing >= 4 && shortScorePercent >= 50) {
    reasoning.push(`${shortPassing}/6 short pillars passing`)
    reasoning.push(`Short score: ${shortScorePercent.toFixed(0)}%`)
    if (indicators.distanceFrom52High < -20) reasoning.push('Far from 52w high')
    if (indicators.momentum10d < -5) reasoning.push('Accelerating down')

    return {
      direction: 'SHORT',
      score: shortScorePercent,
      reasoning: reasoning.join(', ')
    }
  }

  // ── WATCHLIST: some interest but neither side strong enough ──
  if (longPassing >= 2 || shortPassing >= 2 || indicators.vcpScore > 0) {
    reasoning.push(`${longPassing}/6 long, ${shortPassing}/6 short pillars`)
    if (indicators.vcpScore > 0) reasoning.push('VCP forming - watch for breakout')
    if (indicators.atrExpansion > 1.2) reasoning.push('Volatility expanding')

    return {
      direction: 'WATCH',
      score: Math.max(longScorePercent, shortScorePercent),
      reasoning: reasoning.join(', ')
    }
  }

  // No trade
  return {
    direction: 'NONE',
    score: Math.max(longScorePercent, shortScorePercent),
    reasoning: 'Does not meet criteria'
  }
}
