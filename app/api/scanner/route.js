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

// =====================================================
// RELATIVE STRENGTH SLOPE CONFIG
// RS bonus is a post-pillar score modifier (Stage 1B)
// Leaders get boosted for longs, laggards for shorts
// =====================================================
const RS_CONFIG = {
  us_benchmark: 'SPY',
  uk_benchmark: '^FTSE',     // ISF.L has low volume; ^FTSE is more reliable
  lookback_bars: 20,
  leader_pct: 70,
  strong_leader_pct: 85,
  laggard_pct: 30,
  strong_laggard_pct: 15,
  bonus_leader: 3,
  bonus_strong_leader: 5,
  bonus_laggard: 3,
  bonus_strong_laggard: 5,
  bonus_cap: 5,
  base_score_floor_for_bonus: 65,
}

export async function POST(request) {
  try {
    const {
      mode = 'short_term',
      marketTrend = 'neutral',
      shortSellingAllowed = true,
      // Instrument filters - default to US and UK stocks for backwards compatibility
      instruments = { ukStocks: true, usStocks: true, indices: false, forex: false, crypto: false },
      // Regime Gate data - benchmark status and distribution days (legacy fallback)
      regimeGate = { riskOn: true, benchmarkAbove50MA: true, distributionDays: 0 },
      // MCL Policy — auto-computed from Market Context Layer (replaces manual regime when present)
      mclPolicy = null,
      // User watchlist tickers — scanned alongside the universe (may be outside S&P 100/NQ 25/FTSE 50)
      watchlistTickers = [],
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

    // Merge user watchlist tickers (deduplicate, may be outside universe)
    if (watchlistTickers && watchlistTickers.length > 0) {
      const existingSet = new Set(tickersToScan.map(t => t.toUpperCase()))
      const newTickers = watchlistTickers.filter(t => !existingSet.has(t.toUpperCase()))
      if (newTickers.length > 0) {
        console.log(`Adding ${newTickers.length} user watchlist tickers to scan: ${newTickers.join(', ')}`)
        tickersToScan = tickersToScan.concat(newTickers)
      }
    }

    // Parse account data for position sizing
    const acctSize = accountSize ? parseFloat(accountSize) : null
    const riskPct = riskPerTrade ? parseFloat(riskPerTrade) : null

    // ========================================
    // REGIME GATE — MCL Policy or Legacy Fallback
    // ========================================
    // When MCL policy is provided (auto-computed from Market Context Layer),
    // it drives regime, thresholds, and sizing. Otherwise falls back to
    // Market Pulse-based riskOn/marketTrend logic.
    let ukRegimeState, usRegimeState, ukThresholds, usThresholds
    let ukMclPolicy = null, usMclPolicy = null
    const isRiskOn = regimeGate.riskOn

    if (mclPolicy?.uk && mclPolicy?.us) {
      // ── MCL-driven regime ──
      ukMclPolicy = mclPolicy.uk
      usMclPolicy = mclPolicy.us
      ukRegimeState = ukMclPolicy.regime
      usRegimeState = usMclPolicy.regime
      // Merge longSize/shortSize into thresholds to preserve finaliseCandidates pattern
      ukThresholds = { ...ukMclPolicy.thresholds, longSize: ukMclPolicy.longSize, shortSize: ukMclPolicy.shortSize }
      usThresholds = { ...usMclPolicy.thresholds, longSize: usMclPolicy.longSize, shortSize: usMclPolicy.shortSize }

      console.log(`UK: ${ukMclPolicy.explain}`)
      console.log(`US: ${usMclPolicy.explain}`)
    } else {
      // ── Legacy fallback — Market Pulse riskOn + marketTrend ──
      const ukRiskOn = regimeGate.uk?.riskOn ?? isRiskOn
      const usRiskOn = regimeGate.us?.riskOn ?? isRiskOn

      function deriveRegimeState(marketRiskOn) {
        if (marketRiskOn && (marketTrend === 'up' || marketTrend === 'neutral')) return 'GREEN'
        if (!marketRiskOn || marketTrend === 'down') return 'RED'
        return 'YELLOW'
      }

      ukRegimeState = deriveRegimeState(ukRiskOn)
      usRegimeState = deriveRegimeState(usRiskOn)

      function getRegimeThresholds(state) {
        switch (state) {
          case 'GREEN': return { longScore: 70, longPillars: 4, longSize: 1.0, shortScore: 85, shortPillars: 5, shortSize: 0.5 }
          case 'RED': return { longScore: 85, longPillars: 5, longSize: 0.5, shortScore: 70, shortPillars: 4, shortSize: 1.0 }
          case 'YELLOW': default: return { longScore: 75, longPillars: 4, longSize: 0.5, shortScore: 75, shortPillars: 4, shortSize: 0.5 }
        }
      }

      ukThresholds = getRegimeThresholds(ukRegimeState)
      usThresholds = getRegimeThresholds(usRegimeState)

      console.log(`Legacy Regime: UK=${ukRegimeState}, US=${usRegimeState}`)
    }

    // Combined regime for display purposes (conservative: worst of both)
    const regimeState = (ukRegimeState === 'RED' || usRegimeState === 'RED') ? 'RED'
      : (ukRegimeState === 'YELLOW' || usRegimeState === 'YELLOW') ? 'YELLOW'
      : 'GREEN'

    // Fetch benchmark data for RS Slope computation (before individual ticker scans)
    const [usBenchmarkCloses, ukBenchmarkCloses] = await Promise.all([
      instruments.usStocks ? fetchBenchmarkCloses(RS_CONFIG.us_benchmark) : null,
      instruments.ukStocks ? fetchBenchmarkCloses(RS_CONFIG.uk_benchmark) : null,
    ])

    // Fetch historical data — each ticker gets its OWN market's regime state + benchmark
    const scanResults = await Promise.all(
      tickersToScan.map(ticker => {
        const tickerRegime = ticker.endsWith('.L') ? ukRegimeState : usRegimeState
        const bmCloses = ticker.endsWith('.L') ? ukBenchmarkCloses : usBenchmarkCloses
        return scanTicker(ticker, mode, acctSize, riskPct, tickerRegime, bmCloses)
      })
    )

    // =====================================================
    // PIPELINE FUNNEL — track rejections at each stage
    // =====================================================
    const funnel = {
      universe: tickersToScan.length,
      stage1: { passed: 0, failed: 0, reasons: {} },  // Direction assignment
      stage2: { passed: 0, failed: 0, reasons: {} },  // S/R filtering
      stage3: { passed: 0, failed: 0, reasons: {} },  // Regime gate
    }
    const addRejection = (stage, reason) => {
      funnel[stage].failed++
      funnel[stage].reasons[reason] = (funnel[stage].reasons[reason] || 0) + 1
    }

    // Filter out errors and sort by score
    const allResults = scanResults.filter(r => r && !r.error)
    const fetchErrors = scanResults.filter(r => !r || r.error).length

    // =====================================================
    // STAGE 1B: RS SLOPE BONUS
    // Apply percentile-ranked RS slope bonus to scores,
    // then re-evaluate direction for boosted WATCH stocks
    // =====================================================
    applyRsSlope(allResults, shortSellingAllowed)

    // Re-evaluate direction for WATCH/NONE stocks where RS bonus may push them past the gate
    allResults.forEach(r => {
      if (r.direction !== 'WATCH' && r.direction !== 'NONE') return
      if (!r.relativeStrength || (r.relativeStrength.longBonus === 0 && r.relativeStrength.shortBonus === 0)) return
      if (r.srDemotion) return  // S/R demotions stay demoted regardless of RS

      // Re-check direction gates with RS-boosted scores
      const hasLongSignal = (r.indicators?.priceVsMa20 > 0) || (r.indicators?.momentum5d > 0)
      const hasShortSignal = (r.indicators?.priceVsMa20 < 0) || (r.indicators?.momentum5d < 0)

      const longPasses = r.longPassing >= 4 && r.longScore >= 50 && hasLongSignal
      const shortPasses = shortSellingAllowed && r.shortPassing >= 4 && r.shortScore >= 50 && hasShortSignal

      if (longPasses && shortPasses) {
        r.direction = 'BOTH'
        r.score = Math.max(r.longScore, r.shortScore)
        r.reasoning = `📈 RS boost → BOTH (L ${r.longScore.toFixed(0)}%, S ${r.shortScore.toFixed(0)}%). ${r.reasoning}`
      } else if (longPasses) {
        r.direction = 'LONG'
        r.score = r.longScore
        r.reasoning = `📈 RS boost → LONG (${r.longScore.toFixed(0)}%). ${r.reasoning}`
      } else if (shortPasses) {
        r.direction = 'SHORT'
        r.score = r.shortScore
        r.reasoning = `📉 RS boost → SHORT (${r.shortScore.toFixed(0)}%). ${r.reasoning}`
      }
    })

    // Stage 1: Direction assignment (happened inside scanTicker + RS boost re-evaluation)
    // Count by direction outcomes
    allResults.forEach(r => {
      if (r.direction === 'LONG' || r.direction === 'SHORT' || r.direction === 'BOTH') {
        funnel.stage1.passed++
      } else if (r.direction === 'WATCH') {
        addRejection('stage1', r.reasoning?.includes('Earnings') ? 'near_earnings'
          : r.reasoning?.includes('spike') ? 'volatility_spike'
          : r.reasoning?.includes('S/R') || r.reasoning?.includes('support') || r.reasoning?.includes('resistance') ? 'sr_demotion'
          : 'insufficient_pillars')
      } else {
        addRejection('stage1', 'no_direction')
      }
    })

    const validResults = allResults
      .filter(r => r.score !== null)
      .sort((a, b) => b.score - a.score)

    // Stage 2: S/R filtering (also happened inside scanTicker — demotions to WATCH)
    // We approximate by counting how many with direction got demoted to WATCH due to S/R
    const stage2Passed = validResults.filter(r => r.direction === 'LONG' || r.direction === 'SHORT' || r.direction === 'BOTH')
    funnel.stage2.passed = stage2Passed.length
    // S/R demotions show up as WATCH with S/R-related reasoning (already counted in stage1)

    // =====================================================
    // STAGE 3: PER-MARKET REGIME FILTER — the strict gate
    // UK and US stocks get their OWN regime thresholds
    // (MCL-computed or legacy, set above)
    // =====================================================

    // Per-ticker threshold lookup
    function getThresholds(ticker) {
      return ticker.endsWith('.L') ? ukThresholds : usThresholds
    }
    function getTickerRegime(ticker) {
      return ticker.endsWith('.L') ? ukRegimeState : usRegimeState
    }

    const countLongPassing = (r) => Object.values(r.pillars).filter(p => p.longScore >= 5).length
    const countShortPassing = (r) => Object.values(r.pillars).filter(p => p.shortScore >= 5).length

    // Resolve BOTH → LONG or SHORT based on each ticker's OWN market regime
    const resolvedResults = validResults.map(r => {
      if (r.direction !== 'BOTH') return r

      const tickerRegime = getTickerRegime(r.ticker)

      let resolvedDir
      if (tickerRegime === 'GREEN') {
        resolvedDir = 'LONG'
      } else if (tickerRegime === 'RED') {
        resolvedDir = shortSellingAllowed ? 'SHORT' : 'LONG'
      } else {
        resolvedDir = (r.longScore || 0) >= (r.shortScore || 0) ? 'LONG' : 'SHORT'
      }

      const resolvedScore = resolvedDir === 'LONG' ? (r.longScore || r.score) : (r.shortScore || r.score)

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
        reasoning: `${r.ticker.endsWith('.L') ? 'UK' : 'US'} regime ${tickerRegime} → ${resolvedDir}. ${r.reasoning}`
      }
    })

    // Filter longs: per-ticker thresholds based on market regime — with rejection tracking
    const longCandidates = []
    resolvedResults.filter(r => r.direction === 'LONG').forEach(r => {
      const t = getThresholds(r.ticker)
      const pillars = countLongPassing(r)
      if (r.score < t.longScore && pillars < t.longPillars) {
        addRejection('stage3', 'score_and_pillars_below')
      } else if (r.score < t.longScore) {
        addRejection('stage3', `score_below_${t.longScore}`)
      } else if (pillars < t.longPillars) {
        addRejection('stage3', `pillars_below_${t.longPillars}`)
      } else {
        longCandidates.push(r)
      }
    })

    // Filter shorts: per-ticker thresholds based on market regime — with rejection tracking
    const shortCandidates = []
    if (shortSellingAllowed) {
      resolvedResults.filter(r => r.direction === 'SHORT').forEach(r => {
        const t = getThresholds(r.ticker)
        const pillars = countShortPassing(r)
        if (r.score < t.shortScore && pillars < t.shortPillars) {
          addRejection('stage3', 'score_and_pillars_below')
        } else if (r.score < t.shortScore) {
          addRejection('stage3', `score_below_${t.shortScore}`)
        } else if (pillars < t.shortPillars) {
          addRejection('stage3', `pillars_below_${t.shortPillars}`)
        } else {
          shortCandidates.push(r)
        }
      })
    }

    funnel.stage3.passed = longCandidates.length + shortCandidates.length

    // Watchlist: anything that didn't make the cut
    const tradeTickers = new Set([
      ...longCandidates.map(r => r.ticker),
      ...shortCandidates.map(r => r.ticker)
    ])
    const watchlistCandidates = resolvedResults
      .filter(r => r.direction === 'WATCH' || (r.direction !== 'NONE' && !tradeTickers.has(r.ticker)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)

    // ── NEAR MISS DETECTION ──
    const nearMisses = detectNearMisses({
      allResults,
      resolvedResults,
      tradeTickers,
      getThresholds,
      getTickerRegime,
      ukMclPolicy,
      usMclPolicy,
      shortSellingAllowed,
      countLongPassing,
      countShortPassing,
    })

    // For display: use per-market thresholds
    const longScoreThreshold = Math.min(ukThresholds.longScore, usThresholds.longScore)
    const shortScoreThreshold = Math.min(ukThresholds.shortScore, usThresholds.shortScore)
    const longPillarMin = Math.min(ukThresholds.longPillars, usThresholds.longPillars)
    const shortPillarMin = Math.min(ukThresholds.shortPillars, usThresholds.shortPillars)

    // Compute trade management for resolved BOTH candidates (was deferred from scanTicker)
    // Then apply per-ticker regime size multiplier to £ per point
    const finaliseCandidates = (candidates, sideKey) => {
      return candidates.map(c => {
        let tm = c.tradeManagement
        const tickerRegime = getTickerRegime(c.ticker)
        const t = getThresholds(c.ticker)
        const multiplier = sideKey === 'long' ? t.longSize : t.shortSize

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
            regimeState: tickerRegime,
            fractalTarget: c.fractalTarget || null,
            airPocketOk: true,
            nearestResistance: ri.nearestResistance,
            nearestSupport: ri.nearestSupport,
          })
        }

        // Apply per-ticker regime size multiplier to £/pt
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

    const longResults = finaliseCandidates(longCandidates, 'long')
    const shortResults = finaliseCandidates(shortCandidates, 'short')

    return Response.json({
      timestamp: new Date().toISOString(),
      mode,
      instruments,
      shortSellingAllowed,
      marketTrend,
      // Regime Gate status — MCL-driven or legacy
      regimeGate: {
        source: (ukMclPolicy && usMclPolicy) ? 'MCL' : 'LEGACY',
        riskOn: isRiskOn,
        regimeState,  // Combined (conservative)
        ukRegimeState,
        usRegimeState,
        uk: { ...(regimeGate.uk || { riskOn: true, aboveMa50: true, distributionDays: 0 }), regimeState: ukRegimeState },
        us: { ...(regimeGate.us || { riskOn: true, aboveMa50: true, distributionDays: 0 }), regimeState: usRegimeState },
        positionSizeMultiplier: {
          ukLong: ukThresholds.longSize, ukShort: ukThresholds.shortSize,
          usLong: usThresholds.longSize, usShort: usThresholds.shortSize,
        },
        // MCL diagnostics (null if legacy fallback)
        mclPolicy: (ukMclPolicy && usMclPolicy) ? { uk: ukMclPolicy, us: usMclPolicy } : null,
      },
      thresholds: {
        // Per-market thresholds
        uk: { long: { score: ukThresholds.longScore, pillars: ukThresholds.longPillars }, short: { score: ukThresholds.shortScore, pillars: ukThresholds.shortPillars } },
        us: { long: { score: usThresholds.longScore, pillars: usThresholds.longPillars }, short: { score: usThresholds.shortScore, pillars: usThresholds.shortPillars } },
        // Combined (for backward compat / simple display)
        long: { score: longScoreThreshold, pillars: longPillarMin },
        short: { score: shortScoreThreshold, pillars: shortPillarMin }
      },
      totalScanned: tickersToScan.length,
      results: {
        long: longResults,
        short: shortResults,
        watchlist: watchlistCandidates
      },
      nearMisses,
      summary: {
        longCount: longResults.length,
        shortCount: shortResults.length,
        watchlistCount: watchlistCandidates.length,
        topLong: longResults[0]?.ticker || null,
        topShort: shortResults[0]?.ticker || null
      },
      // Pipeline funnel — shows where candidates are lost and why
      funnel: {
        universe: funnel.universe,
        fetchErrors,
        stage1: {
          label: 'Direction + Pillars',
          passed: funnel.stage1.passed,
          failed: funnel.stage1.failed,
          passRate: funnel.universe > 0 ? `${((funnel.stage1.passed / funnel.universe) * 100).toFixed(1)}%` : '0%',
          topReasons: Object.entries(funnel.stage1.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
        },
        stage2: {
          label: 'S/R Filter',
          passed: funnel.stage2.passed,
          passRate: funnel.stage1.passed > 0 ? `${((funnel.stage2.passed / funnel.stage1.passed) * 100).toFixed(1)}%` : '0%',
        },
        stage3: {
          label: 'Regime Gate',
          passed: funnel.stage3.passed,
          failed: funnel.stage3.failed,
          passRate: funnel.stage2.passed > 0 ? `${((funnel.stage3.passed / funnel.stage2.passed) * 100).toFixed(1)}%` : '0%',
          topReasons: Object.entries(funnel.stage3.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
        },
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

// =====================================================
// DAILY BAR FRESHNESS
// Determines whether the last daily bar from Yahoo is the expected
// completed session bar, based on market close times in Europe/London.
// =====================================================
function computeBarFreshness(timestamps, ticker) {
  if (!timestamps || timestamps.length === 0) {
    return { barFresh: false, lastBarDate: null, expectedBarDate: null, barFreshDiag: 'BarFresh=UNKNOWN (no timestamps)' }
  }

  const isUK = ticker.endsWith('.L')

  // Market close times in Europe/London local time
  // UK: 16:30 London | US: 21:00 London (covers EST→London conversion)
  const closeHour = isUK ? 16 : 21
  const closeMinute = isUK ? 30 : 0

  // Current time in Europe/London
  const nowUTC = new Date()
  const nowLondonStr = nowUTC.toLocaleString('en-GB', { timeZone: 'Europe/London' })
  // Parse "DD/MM/YYYY, HH:MM:SS" format
  const [datePart, timePart] = nowLondonStr.split(', ')
  const [day, month, year] = datePart.split('/')
  const [hour, minute] = timePart.split(':').map(Number)
  const nowLondonDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const nowMinutes = hour * 60 + minute
  const closeMinutes = closeHour * 60 + closeMinute

  // Helper: previous weekday (skip Sat/Sun)
  function previousWeekday(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z') // noon UTC to avoid DST edge
    d.setDate(d.getDate() - 1)
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1)
    }
    return d.toISOString().split('T')[0]
  }

  // Compute expectedBarDate (most recent weekday with a completed session)
  let expectedBarDate
  if (nowMinutes >= closeMinutes) {
    // After market close today
    const todayDow = new Date(nowLondonDate + 'T12:00:00Z').getDay()
    if (todayDow === 0 || todayDow === 6) {
      // Weekend after close time → expect Friday's bar
      expectedBarDate = previousWeekday(nowLondonDate)
    } else {
      expectedBarDate = nowLondonDate
    }
  } else {
    // Before market close → expect previous weekday's bar
    expectedBarDate = previousWeekday(nowLondonDate)
  }

  // Last bar date from Yahoo timestamps (Unix epoch seconds → London date)
  const lastTimestamp = timestamps[timestamps.length - 1]
  const lastBarUTC = new Date(lastTimestamp * 1000)
  const lastBarLondonStr = lastBarUTC.toLocaleString('en-GB', { timeZone: 'Europe/London' })
  const [lbDatePart] = lastBarLondonStr.split(', ')
  const [lbDay, lbMonth, lbYear] = lbDatePart.split('/')
  const lastBarDate = `${lbYear}-${lbMonth.padStart(2, '0')}-${lbDay.padStart(2, '0')}`

  // Freshness check: exact match = fresh.
  // But allow 1-2 weekday tolerance for public holidays (no holiday calendar in v1).
  // Count weekdays between lastBarDate and expectedBarDate.
  function weekdaysBetween(dateA, dateB) {
    const a = new Date(dateA + 'T12:00:00Z')
    const b = new Date(dateB + 'T12:00:00Z')
    if (a >= b) return 0
    let count = 0
    const d = new Date(a)
    d.setDate(d.getDate() + 1)
    while (d <= b) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count++
      d.setDate(d.getDate() + 1)
    }
    return count
  }

  const exactMatch = lastBarDate === expectedBarDate
  const weekdayGap = weekdaysBetween(lastBarDate, expectedBarDate)
  // Fresh if exact match OR within 2 weekdays (covers public holidays)
  const barFresh = exactMatch || weekdayGap <= 2
  const freshLabel = exactMatch ? 'TRUE' : weekdayGap <= 2 ? `TRUE (${weekdayGap}d holiday gap)` : 'FALSE'
  const barFreshDiag = `BarDate=${lastBarDate} ExpectedBarDate=${expectedBarDate} BarFresh=${freshLabel}`

  return { barFresh, lastBarDate, expectedBarDate, barFreshDiag }
}

// =====================================================
// RS SLOPE BONUS APPLICATION (Stage 1B)
// Computes per-universe percentile ranks, classifies
// leaders/laggards, and applies score bonus in-place
// =====================================================
function applyRsSlope(allResults, shortSellingAllowed) {
  const usResults = allResults.filter(r => !r.ticker.endsWith('.L') && r.indicators?.rsSlope20 != null)
  const ukResults = allResults.filter(r => r.ticker.endsWith('.L') && r.indicators?.rsSlope20 != null)

  function computePercentilesAndApply(results) {
    if (results.length < 3) return  // Too few to rank meaningfully

    // Sort by rsSlope ascending for percentile ranking
    const sorted = [...results].sort((a, b) => a.indicators.rsSlope20 - b.indicators.rsSlope20)
    const n = sorted.length

    // Assign midpoint percentile rank
    sorted.forEach((r, i) => {
      r._rsPct = ((i + 0.5) / n) * 100
    })

    // Classify and compute bonus
    results.forEach(r => {
      const pct = r._rsPct
      if (pct == null) return

      let classification, longBonus = 0, shortBonus = 0

      if (pct >= RS_CONFIG.strong_leader_pct) {
        classification = 'RS_STRONG_LEADER'
        longBonus = RS_CONFIG.bonus_strong_leader
      } else if (pct >= RS_CONFIG.leader_pct) {
        classification = 'RS_LEADER'
        longBonus = RS_CONFIG.bonus_leader
      } else if (pct <= RS_CONFIG.strong_laggard_pct) {
        classification = 'RS_STRONG_LAGGARD'
        shortBonus = RS_CONFIG.bonus_strong_laggard
      } else if (pct <= RS_CONFIG.laggard_pct) {
        classification = 'RS_LAGGARD'
        shortBonus = RS_CONFIG.bonus_laggard
      } else {
        classification = 'RS_NEUTRAL'
      }

      // Safety: only apply if base score is not junk
      const longBase = r.longScore || 0
      const shortBase = r.shortScore || 0
      const effectiveLongBonus = longBase >= RS_CONFIG.base_score_floor_for_bonus
        ? Math.min(longBonus, RS_CONFIG.bonus_cap) : 0
      const effectiveShortBonus = shortBase >= RS_CONFIG.base_score_floor_for_bonus
        ? Math.min(shortBonus, RS_CONFIG.bonus_cap) : 0

      // Apply bonus to scores
      if (effectiveLongBonus > 0) {
        r.longScore = (r.longScore || 0) + effectiveLongBonus
      }
      if (effectiveShortBonus > 0) {
        r.shortScore = (r.shortScore || 0) + effectiveShortBonus
      }

      // Update main score for the determined direction
      if (effectiveLongBonus > 0 || effectiveShortBonus > 0) {
        if (r.direction === 'LONG' || r.direction === 'BOTH') {
          r.score = Math.max(r.score || 0, r.longScore)
        } else if (r.direction === 'SHORT') {
          r.score = r.shortScore
        } else {
          // WATCH or NONE — use best side
          r.score = Math.max(r.longScore || 0, r.shortScore || 0)
        }
      }

      // Attach RS data to result for downstream use
      r.relativeStrength = {
        rsPct: Math.round(pct * 10) / 10,
        rsSlope: r.indicators.rsSlope20,
        classification,
        longBonus: effectiveLongBonus,
        shortBonus: effectiveShortBonus,
      }

      // Clean up temp field
      delete r._rsPct

      if (classification !== 'RS_NEUTRAL') {
        console.log(`[RS] ${r.ticker}: pct=${pct.toFixed(1)}, ${classification}, longBonus=${effectiveLongBonus}, shortBonus=${effectiveShortBonus}`)
      }
    })
  }

  computePercentilesAndApply(usResults)
  computePercentilesAndApply(ukResults)

  const totalBoosted = allResults.filter(r => r.relativeStrength && (r.relativeStrength.longBonus > 0 || r.relativeStrength.shortBonus > 0)).length
  console.log(`[RS] Applied RS slope bonus to ${totalBoosted} stocks`)
}

// =====================================================
// NEAR MISS DETECTION
// Finds stocks that failed by exactly one narrow margin
// Types: A (score), B (pillars), C (S/R), D (regime)
// =====================================================
function detectNearMisses({
  allResults,
  resolvedResults,
  tradeTickers,
  getThresholds,
  getTickerRegime,
  ukMclPolicy,
  usMclPolicy,
  shortSellingAllowed,
  countLongPassing,
  countShortPassing,
}) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const nearMissMap = new Map() // key: `${ticker}_${direction}` → array of failure types

  function addNearMiss(ticker, market, direction, stageFailed, failureType, required, actual, deltas, indicators, relativeStrength) {
    const key = `${ticker}_${direction}`
    if (!nearMissMap.has(key)) nearMissMap.set(key, [])
    nearMissMap.get(key).push({
      ticker, market, direction, stageFailed, failureType, required, actual, deltas, indicators, relativeStrength
    })
  }

  // ── STAGE 1 NEAR MISSES (from WATCH/NONE stocks) ──
  // These are stocks that didn't get a LONG/SHORT/BOTH direction
  allResults.forEach(r => {
    if (!r || r.error || !r.pillars) return
    if (r.direction !== 'WATCH' && r.direction !== 'NONE') return
    if (r.srDemotion) return // S/R demotions are Stage 2, not Stage 1
    if (tradeTickers.has(r.ticker)) return

    const market = r.ticker.endsWith('.L') ? 'UK' : 'US'

    // Check long side near miss
    const longPassing = r.longPassing ?? Object.values(r.pillars).filter(p => p.longScore >= 5).length
    const longScorePct = r.longScore ?? 0
    const hasLongSignal = (r.indicators?.priceVsMa20 > 0) || (r.indicators?.momentum5d > 0)

    // Stage 1 LONG gate: longPassing >= 4 AND longScorePercent >= 50 AND hasLongSignal
    // (actually Stage 1 permissive is >= 3 pillars, >= 45%, but for LONG direction it's >= 4, >= 50%)
    if (hasLongSignal) {
      const scoreFails = longScorePct < 50
      const pillarFails = longPassing < 4
      const scoreDelta = scoreFails ? (50 - longScorePct) : 0
      const pillarDelta = pillarFails ? (4 - longPassing) : 0

      // Type A: score < 50 but gap ≤ 5pts, pillars OK
      if (scoreFails && !pillarFails && scoreDelta <= 5) {
        addNearMiss(r.ticker, market, 'LONG', 1, 'A',
          { scorePct: 50, pillarsMin: 4 },
          { scorePct: Math.round(longScorePct * 10) / 10, pillarsPassed: longPassing },
          { scorePts: Math.round(scoreDelta * 10) / 10, pillars: 0, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
      // Type B: pillars == 3 (exactly 1 short of 4), score OK
      if (pillarFails && !scoreFails && pillarDelta === 1) {
        addNearMiss(r.ticker, market, 'LONG', 1, 'B',
          { scorePct: 50, pillarsMin: 4 },
          { scorePct: Math.round(longScorePct * 10) / 10, pillarsPassed: longPassing },
          { scorePts: 0, pillars: 1, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
    }

    // Check short side near miss
    if (shortSellingAllowed) {
      const shortPassing = r.shortPassing ?? Object.values(r.pillars).filter(p => p.shortScore >= 5).length
      const shortScorePct = r.shortScore ?? 0
      const hasShortSignal = (r.indicators?.priceVsMa20 < 0) || (r.indicators?.momentum5d < 0)

      if (hasShortSignal) {
        const scoreFails = shortScorePct < 50
        const pillarFails = shortPassing < 4
        const scoreDelta = scoreFails ? (50 - shortScorePct) : 0
        const pillarDelta = pillarFails ? (4 - shortPassing) : 0

        if (scoreFails && !pillarFails && scoreDelta <= 5) {
          addNearMiss(r.ticker, market, 'SHORT', 1, 'A',
            { scorePct: 50, pillarsMin: 4 },
            { scorePct: Math.round(shortScorePct * 10) / 10, pillarsPassed: shortPassing },
            { scorePts: Math.round(scoreDelta * 10) / 10, pillars: 0, airPocketShortfallRatio: 0 },
            r.indicators, r.relativeStrength)
        }
        if (pillarFails && !scoreFails && pillarDelta === 1) {
          addNearMiss(r.ticker, market, 'SHORT', 1, 'B',
            { scorePct: 50, pillarsMin: 4 },
            { scorePct: Math.round(shortScorePct * 10) / 10, pillarsPassed: shortPassing },
            { scorePts: 0, pillars: 1, airPocketShortfallRatio: 0 },
            r.indicators, r.relativeStrength)
        }
      }
    }
  })

  // ── STAGE 2 NEAR MISSES (from S/R-demoted stocks) ──
  allResults.forEach(r => {
    if (!r || r.error || !r.srDemotion) return
    if (tradeTickers.has(r.ticker)) return

    const market = r.ticker.endsWith('.L') ? 'UK' : 'US'
    const origDir = r.originalDirection

    // For longs: check resistance distance
    if ((origDir === 'LONG' || origDir === 'BOTH') && r.indicators?.nearestResistance?.distanceR) {
      const distR = parseFloat(r.indicators.nearestResistance.distanceR)
      const threshold = 0.85 // 1R - 0.15R buffer
      if (distR < threshold && distR > 0) {
        const shortfallRatio = (threshold - distR) / threshold
        if (shortfallRatio <= 0.10) {
          addNearMiss(r.ticker, market, 'LONG', 2, 'C',
            { scorePct: null, pillarsMin: null },
            { scorePct: null, pillarsPassed: null },
            { scorePts: 0, pillars: 0, airPocketShortfallRatio: Math.round(shortfallRatio * 1000) / 1000 },
            r.indicators, r.relativeStrength)
        }
      }
    }

    // For shorts: check support distance
    if ((origDir === 'SHORT' || origDir === 'BOTH') && shortSellingAllowed && r.indicators?.nearestSupport?.distanceR) {
      const distR = parseFloat(r.indicators.nearestSupport.distanceR)
      const threshold = 0.85
      if (distR < threshold && distR > 0) {
        const shortfallRatio = (threshold - distR) / threshold
        if (shortfallRatio <= 0.10) {
          addNearMiss(r.ticker, market, 'SHORT', 2, 'C',
            { scorePct: null, pillarsMin: null },
            { scorePct: null, pillarsPassed: null },
            { scorePts: 0, pillars: 0, airPocketShortfallRatio: Math.round(shortfallRatio * 1000) / 1000 },
            r.indicators, r.relativeStrength)
        }
      }
    }
  })

  // ── STAGE 3 NEAR MISSES (from resolved LONG/SHORT that failed regime gate) ──
  resolvedResults.forEach(r => {
    if (!r || r.error || !r.pillars) return
    if (r.direction !== 'LONG' && r.direction !== 'SHORT') return
    if (tradeTickers.has(r.ticker)) return // Already a trade candidate

    const market = r.ticker.endsWith('.L') ? 'UK' : 'US'
    const tickerRegime = getTickerRegime(r.ticker)
    const t = getThresholds(r.ticker)
    const mclPolicy = market === 'UK' ? ukMclPolicy : usMclPolicy

    // Type D: Only for YELLOW regime — RED is too far gone
    if (tickerRegime === 'RED' && mclPolicy?.volatilityCapApplied) return
    const isRegimeNearMiss = tickerRegime === 'YELLOW'

    if (r.direction === 'LONG') {
      const pillars = countLongPassing(r)
      const scorePct = r.score
      const requiredScore = t.longScore
      const requiredPillars = t.longPillars
      const scoreDelta = scorePct < requiredScore ? (requiredScore - scorePct) : 0
      const pillarDelta = pillars < requiredPillars ? (requiredPillars - pillars) : 0

      // Only if it actually failed Stage 3
      if (scorePct >= requiredScore && pillars >= requiredPillars) return

      // Type A: score within 5pts, pillars OK
      if (scoreDelta > 0 && scoreDelta <= 5 && pillarDelta === 0) {
        addNearMiss(r.ticker, market, 'LONG', 3, isRegimeNearMiss ? 'D' : 'A',
          { scorePct: requiredScore, pillarsMin: requiredPillars },
          { scorePct: Math.round(scorePct * 10) / 10, pillarsPassed: pillars },
          { scorePts: Math.round(scoreDelta * 10) / 10, pillars: 0, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
      // Type B: pillars exactly 1 short, score OK
      if (pillarDelta === 1 && scoreDelta === 0) {
        addNearMiss(r.ticker, market, 'LONG', 3, isRegimeNearMiss ? 'D' : 'B',
          { scorePct: requiredScore, pillarsMin: requiredPillars },
          { scorePct: Math.round(scorePct * 10) / 10, pillarsPassed: pillars },
          { scorePts: 0, pillars: 1, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
    }

    if (r.direction === 'SHORT' && shortSellingAllowed) {
      const pillars = countShortPassing(r)
      const scorePct = r.score
      const requiredScore = t.shortScore
      const requiredPillars = t.shortPillars
      const scoreDelta = scorePct < requiredScore ? (requiredScore - scorePct) : 0
      const pillarDelta = pillars < requiredPillars ? (requiredPillars - pillars) : 0

      if (scorePct >= requiredScore && pillars >= requiredPillars) return

      if (scoreDelta > 0 && scoreDelta <= 5 && pillarDelta === 0) {
        addNearMiss(r.ticker, market, 'SHORT', 3, isRegimeNearMiss ? 'D' : 'A',
          { scorePct: requiredScore, pillarsMin: requiredPillars },
          { scorePct: Math.round(scorePct * 10) / 10, pillarsPassed: pillars },
          { scorePts: Math.round(scoreDelta * 10) / 10, pillars: 0, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
      if (pillarDelta === 1 && scoreDelta === 0) {
        addNearMiss(r.ticker, market, 'SHORT', 3, isRegimeNearMiss ? 'D' : 'B',
          { scorePct: requiredScore, pillarsMin: requiredPillars },
          { scorePct: Math.round(scorePct * 10) / 10, pillarsPassed: pillars },
          { scorePts: 0, pillars: 1, airPocketShortfallRatio: 0 },
          r.indicators, r.relativeStrength)
      }
    }
  })

  // ── SINGLE-FAILURE RULE: only keep ticker+direction with exactly 1 failure type ──
  const validNearMisses = []
  for (const [key, failures] of nearMissMap.entries()) {
    if (failures.length === 1) {
      validNearMisses.push(failures[0])
    }
    // 2+ failure types for same ticker+direction = discard (too far away)
  }

  // ── RANKING ──
  const ranked = validNearMisses.map(nm => {
    const ind = nm.indicators || {}
    const avgVol = ind.avgVolume20 || 0
    const liqTier = avgVol >= 1000000 ? 'A' : avgVol >= 250000 ? 'B' : 'C'
    const volMult = ind.volumeRatio || 1.0
    const atrPct = ind.atr || 0
    const atrSoftCap = nm.market === 'UK' ? 7 : 6

    const rankScore = 100
      - 10 * (nm.deltas.scorePts || 0)
      - 25 * (nm.deltas.pillars || 0)
      - 200 * (nm.deltas.airPocketShortfallRatio || 0)
      + (liqTier === 'A' ? 20 : liqTier === 'B' ? 10 : 0)
      + 10 * clamp(volMult - 1.0, 0, 2)
      - 5 * clamp((atrPct - atrSoftCap) / 2, 0, 5)

    // Build badges and explain strings
    const badges = []
    let explain = 'Near miss: '

    if (nm.failureType === 'A') {
      badges.push(`-${nm.deltas.scorePts} score`)
      explain += `score -${nm.deltas.scorePts}pts (${nm.actual.scorePct}% vs ${nm.required.scorePct}%). Passed pillars.`
    } else if (nm.failureType === 'B') {
      badges.push(`-1 pillar`)
      explain += `${nm.actual.pillarsPassed}/${nm.required.pillarsMin} pillars (1 short). Score OK (${nm.actual.scorePct}%).`
    } else if (nm.failureType === 'C') {
      badges.push(`S/R ${(nm.deltas.airPocketShortfallRatio * 100).toFixed(0)}%`)
      explain += `S/R air pocket shortfall ${(nm.deltas.airPocketShortfallRatio * 100).toFixed(1)}% from threshold.`
    } else if (nm.failureType === 'D') {
      if (nm.deltas.scorePts > 0) {
        badges.push(`-${nm.deltas.scorePts} regime`)
        explain += `regime gate: score -${nm.deltas.scorePts}pts (${nm.actual.scorePct}% vs ${nm.required.scorePct}%).`
      } else {
        badges.push(`-1 pillar regime`)
        explain += `regime gate: ${nm.actual.pillarsPassed}/${nm.required.pillarsMin} pillars.`
      }
    }

    explain += ` Liquidity ${liqTier}.`

    return {
      ticker: nm.ticker,
      market: nm.market,
      direction: nm.direction,
      stageFailed: nm.stageFailed,
      failureType: nm.failureType,
      required: nm.required,
      actual: nm.actual,
      deltas: nm.deltas,
      rankScore: Math.round(rankScore * 10) / 10,
      badges,
      explain,
      // Include score for watchlist compatibility
      score: nm.actual.scorePct || 0,
      // Pass through RS data for UI badges
      relativeStrength: nm.relativeStrength || null,
    }
  })

  // Sort descending by rankScore, split into long/short, return top 10 each
  ranked.sort((a, b) => b.rankScore - a.rankScore)

  const longNearMisses = ranked.filter(nm => nm.direction === 'LONG').slice(0, 10)
  const shortNearMisses = ranked.filter(nm => nm.direction === 'SHORT').slice(0, 10)

  console.log(`[NearMisses] ${longNearMisses.length} long, ${shortNearMisses.length} short near misses detected`)
  longNearMisses.forEach(nm => console.log(`  LONG: ${nm.ticker} type=${nm.failureType} rank=${nm.rankScore} ${nm.explain}`))
  shortNearMisses.forEach(nm => console.log(`  SHORT: ${nm.ticker} type=${nm.failureType} rank=${nm.rankScore} ${nm.explain}`))

  return { long: longNearMisses, short: shortNearMisses }
}

async function scanTicker(ticker, mode, accountSize = null, riskPercent = null, regimeState = 'YELLOW', benchmarkCloses = null) {
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

    // Daily bar freshness check
    const barFreshness = computeBarFreshness(timestamps, ticker)
    console.log(`[${ticker}] ${barFreshness.barFreshDiag}`)

    // Calculate technical indicators
    const indicators = calculateIndicators(closes, highs, lows, volumes)

    // Fetch sector momentum for relative strength calculation
    const sectorMomentum20d = await fetchSectorMomentum(ticker)
    indicators.sectorMomentum20d = sectorMomentum20d
    indicators.sectorRelativeStrength = sectorMomentum20d !== null
      ? indicators.momentum20d - sectorMomentum20d
      : null

    // RS Slope vs market benchmark (raw value — percentile ranking done in POST handler)
    const validClosesForRS = closes.filter(c => c !== null)
    indicators.rsSlope20 = benchmarkCloses
      ? computeRsSlope(validClosesForRS, benchmarkCloses, RS_CONFIG.lookback_bars)
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
    // Always compute both-side scores from pillars (needed for near miss detection)
    const maxPillarScore = Object.values(pillars).reduce((sum, p) => sum + p.max, 0) // 60
    const longTotalFromPillars = Object.values(pillars).reduce((sum, p) => sum + p.longScore, 0)
    const shortTotalFromPillars = Object.values(pillars).reduce((sum, p) => sum + p.shortScore, 0)
    const longScorePercent = (longTotalFromPillars / maxPillarScore) * 100
    const shortScorePercent = (shortTotalFromPillars / maxPillarScore) * 100
    const longPassingCount = Object.values(pillars).filter(p => p.longScore >= 5).length
    const shortPassingCount = Object.values(pillars).filter(p => p.shortScore >= 5).length

    let longScore = directionResult.longScore || longScorePercent
    let shortScore = directionResult.shortScore || shortScorePercent
    let longPassingFromDir = directionResult.longPassing ?? longPassingCount
    let shortPassingFromDir = directionResult.shortPassing ?? shortPassingCount

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
    const directionBeforeSR = direction  // Track for near miss detection
    const riskAmount = indicators.atrRaw
    const airPocketBuffer = riskAmount * 0.15  // 0.15R buffer per expert advice

    // SHORT guardrail: is there support too close below?
    if ((direction === 'SHORT' || direction === 'BOTH') && indicators.nearestSupport) {
      const distToSupport = indicators.distanceToSupport
      const sr = indicators.nearestSupport

      // ── SUPPORT BREAK EXCEPTION v1.1 (final spec) ──
      // A short INTO support is dangerous (bounce zone), but a short THROUGH
      // a broken support level is one of the best setups.
      //
      // Hard gates (MUST pass):
      //   1. Close break: close <= support × (1 - 0.004)
      //   2. Momentum: momentum5d < 0
      //
      // Soft confirms (need 2 of available; if 1 available need 1; if 0 available → pass):
      //   A. Volume:    lastBarVol / avgVol20 >= 1.2
      //   B. Freshness: livePrice <= support × 1.002 (if live quote exists)
      //   C. Candle:    close in bottom 33% of bar range (if range > 0)
      //
      // All OHLCV conditions use the SAME bar index i = closes.length - 1

      const breakPct = 0.004       // 0.4% confirmed close below
      const reclaimPct = 0.002     // 0.2% reclaim tolerance
      const minVolRatio = 1.2      // 1.2× avg = real participation
      const candleBottomFrac = 0.33 // bottom 33% of range

      // ── HARD GATES ──
      const closeBreak = indicators.lastClose <= sr.level * (1 - breakPct)
      const momBreak = indicators.momentum5d < 0
      const hardPass = closeBreak && momBreak

      // ── SOFT CONFIRMS ──
      let softAvailable = 0
      let softPassed = 0

      // A. Volume (counted only if vol and avgVol20 exist and > 0)
      const lastVol = indicators.lastVolume
      const avgVol20 = indicators.avgVolume20
      const volAvailable = lastVol != null && avgVol20 != null && avgVol20 > 0
      let volStatus = 'NOT_COUNTED'
      let lastVolRatio = null
      if (volAvailable) {
        softAvailable++
        lastVolRatio = lastVol / avgVol20
        if (lastVolRatio >= minVolRatio) {
          softPassed++
          volStatus = 'PASS'
        } else {
          volStatus = 'FAIL'
        }
      }

      // B. Freshness (counted only if livePrice exists)
      const livePrice = meta.regularMarketPrice
      const freshAvailable = livePrice != null && Number.isFinite(livePrice)
      let freshStatus = 'NOT_COUNTED'
      if (freshAvailable) {
        softAvailable++
        if (livePrice <= sr.level * (1 + reclaimPct)) {
          softPassed++
          freshStatus = 'PASS'
        } else {
          freshStatus = 'FAIL'
        }
      }

      // C. Candle quality (counted only if bar has range > 0)
      const barRange = indicators.lastHigh - indicators.lastLow
      const candleAvailable = barRange > 0
      let candleStatus = 'NOT_COUNTED'
      let closePos = null
      if (candleAvailable) {
        softAvailable++
        closePos = (indicators.lastClose - indicators.lastLow) / barRange
        if (closePos <= candleBottomFrac) {
          softPassed++
          candleStatus = 'PASS'
        } else {
          candleStatus = 'FAIL'
        }
      }

      // Soft pass rule: 0 available → pass; 1 available → need 1; 2+ → need 2
      const softOK = softAvailable === 0
        ? true
        : softAvailable === 1
          ? softPassed >= 1
          : softPassed >= 2

      const isSupportBreak = hardPass && softOK

      // ── DIAGNOSTIC LOG ──
      const hardLog = `hard: closeBreak=${closeBreak ? 'PASS' : 'FAIL'}, mom=${momBreak ? 'PASS' : 'FAIL'}`
      const softLog = `soft(${softPassed}/${softAvailable}): vol=${volStatus}, fresh=${freshStatus}, candle=${candleStatus}`
      const breakDiag = `SupportBreak: ${isSupportBreak ? 'PASS' : 'FAIL'} (${hardLog}; ${softLog})`
      console.log(`[${ticker}] ${breakDiag}`)

      if (!isSupportBreak) {
        // Block if support is within 0.5R (shorting into bounce zone)
        if (distToSupport < riskAmount * 0.5) {
          reasoning = `🛡️ Short blocked: ${sr.type} support at ${sr.level.toFixed(2)} only ${(distToSupport / riskAmount).toFixed(2)}R away [${breakDiag}]. Original: ${direction} - ${reasoning}`
          if (direction === 'BOTH') {
            direction = 'LONG'
            reasoning = `🛡️ Short side blocked by support → LONG only. ${reasoning}`
          } else {
            direction = 'WATCH'
          }
        }
        // Air pocket gate: can T1 (1R) be reached before hitting support?
        else if (distToSupport < riskAmount - airPocketBuffer) {
          reasoning = `🛡️ No air pocket: ${sr.type} at ${sr.level.toFixed(2)} blocks T1 [${breakDiag}]. Original: ${direction} - ${reasoning}`
          if (direction === 'BOTH') {
            direction = 'LONG'
            reasoning = `🛡️ Short T1 blocked by support → LONG only. ${reasoning}`
          } else {
            direction = 'WATCH'
          }
        }
      } else {
        const volNote = lastVolRatio ? ` vol ${lastVolRatio.toFixed(1)}×` : ''
        reasoning = `📉 ${breakDiag}. Close ${((1 - indicators.lastClose / sr.level) * 100).toFixed(1)}% below ${sr.type} ${sr.level.toFixed(2)}${volNote}. ${reasoning}`
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

    // S/R demotion flag for near miss detection
    // A stock that had direction but got demoted to WATCH by S/R is a Stage 2 near miss candidate
    const srDemotion = directionBeforeSR !== direction && direction === 'WATCH'
    const originalDirection = directionBeforeSR

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
      // Always include both-side scores for near miss detection + Stage 3 regime resolution
      longScore,
      shortScore,
      longPassing: longPassingFromDir,
      shortPassing: shortPassingFromDir,
      // S/R demotion tracking for near miss detection
      srDemotion,
      originalDirection,
      setupTier: tradeManagement?.setupTier || null,
      pillars,
      indicators: {
        rsi: indicators.rsi,
        momentum5d: indicators.momentum5d,
        momentum20d: indicators.momentum20d,
        momentum63d: indicators.momentum63d,
        priceVsMa20: indicators.priceVsMa20,
        priceVsMa50: indicators.priceVsMa50,
        priceVsMa200: indicators.priceVsMa200,
        ma50VsMa200: indicators.ma50VsMa200,
        volumeRatio: indicators.volumeRatio,
        avgVolume20: indicators.avgVolume20,
        rsSlope20: indicators.rsSlope20,
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
      // Bar freshness
      barFresh: barFreshness.barFresh,
      lastBarDate: barFreshness.lastBarDate,
      expectedBarDate: barFreshness.expectedBarDate,
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
    distanceToNearestSupport,  // Legacy compat (%)
    // Last bar OHLCV — for support-break candle quality check
    lastHigh: yesterdayHigh,
    lastLow: yesterdayLow,
    lastClose: yesterdayClose,
    lastVolume: volumes[n - 1],
    avgVolume20: average(volumes.slice(-20)),
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

// =====================================================
// BENCHMARK DATA FETCH (for RS Slope computation)
// Fetches 90d daily closes for SPY / ^FTSE
// =====================================================
const benchmarkCache = {}

async function fetchBenchmarkCloses(symbol) {
  if (benchmarkCache[symbol] && (Date.now() - benchmarkCache[symbol].timestamp < 3600000)) {
    return benchmarkCache[symbol].closes
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=90d`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    if (!response.ok) {
      console.log(`[RS] Failed to fetch benchmark ${symbol}: ${response.status}`)
      return null
    }
    const data = await response.json()
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
    const validCloses = closes.filter(c => c !== null)
    if (validCloses.length < 25) {
      console.log(`[RS] Insufficient benchmark data for ${symbol}: ${validCloses.length} bars`)
      return null
    }
    console.log(`[RS] Fetched ${validCloses.length} benchmark bars for ${symbol}`)
    benchmarkCache[symbol] = { closes: validCloses, timestamp: Date.now() }
    return validCloses
  } catch (err) {
    console.log(`[RS] Error fetching benchmark ${symbol}: ${err.message}`)
    return null
  }
}

// =====================================================
// RS SLOPE COMPUTATION
// Computes log relative strength slope via OLS regression
// slope > 0 = outperforming benchmark, < 0 = underperforming
// =====================================================
function computeRsSlope(stockCloses, benchmarkCloses, lookback = 20) {
  // Align arrays from the end (both sourced from same Yahoo daily bars)
  const n = Math.min(stockCloses.length, benchmarkCloses.length)
  if (n < lookback + 1) return null

  // Build log RS series over last `lookback` bars
  const rsLog = []
  for (let i = n - lookback; i < n; i++) {
    if (benchmarkCloses[i] <= 0 || stockCloses[i] <= 0) return null
    rsLog.push(Math.log(stockCloses[i] / benchmarkCloses[i]))
  }

  // OLS slope: slope = (m*Σxy - Σx*Σy) / (m*Σx² - (Σx)²)
  const m = rsLog.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < m; i++) {
    sumX += i
    sumY += rsLog[i]
    sumXY += i * rsLog[i]
    sumX2 += i * i
  }
  const denom = m * sumX2 - sumX * sumX
  if (denom === 0) return 0
  return (m * sumXY - sumX * sumY) / denom
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
