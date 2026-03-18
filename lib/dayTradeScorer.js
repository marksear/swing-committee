// Day-1 Capture Module — Deterministic 9-factor scoring for intraday trade evaluation
// Spec: implementation_spec_day1_capture_FINAL.md v2.1.1
//
// This module is called from the scanner pipeline AFTER all scanTicker results are available.
// All scoring is deterministic — the AI receives pre-computed scores and cannot override them.

// =====================================================
// SECTION 1: DATA LAYER
// =====================================================

// S&P 100 tickers (for spread estimation — large-cap US)
const SP100_TICKERS = new Set([
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
])

// FTSE top 30 by market cap (for spread estimation — large-cap UK)
const FTSE30_TICKERS = new Set([
  'SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'BP.L', 'GSK.L', 'RIO.L', 'REL.L', 'DGE.L', 'BATS.L',
  'LSEG.L', 'NG.L', 'AAL.L', 'GLEN.L', 'BHP.L', 'PRU.L', 'LLOY.L', 'BARC.L', 'RKT.L', 'IMB.L',
  'SSE.L', 'AHT.L', 'BA.L', 'CPG.L', 'EXPN.L', 'STAN.L', 'ABF.L', 'ANTO.L', 'CRH.L', 'FERG.L',
])

// Sector mapping for the universe (used for Factor 3 and Factor 9)
const SECTOR_MAP = {
  // US Technology
  NVDA: 'Technology', AAPL: 'Technology', MSFT: 'Technology', GOOGL: 'Technology', META: 'Technology',
  AVGO: 'Technology', AMD: 'Technology', INTC: 'Technology', CSCO: 'Technology', ORCL: 'Technology',
  CRM: 'Technology', NOW: 'Technology', INTU: 'Technology', ADBE: 'Technology', TXN: 'Technology',
  QCOM: 'Technology', IBM: 'Technology', PLTR: 'Technology', ASML: 'Technology', LRCX: 'Technology',
  AMAT: 'Technology', KLAC: 'Technology', ADI: 'Technology', PANW: 'Technology', ARM: 'Technology',
  APP: 'Technology', CRWD: 'Technology', SNPS: 'Technology', CDNS: 'Technology', ACN: 'Technology',
  // US Consumer Discretionary
  AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary', HD: 'Consumer Discretionary',
  LOW: 'Consumer Discretionary', MCD: 'Consumer Discretionary', NKE: 'Consumer Discretionary',
  SBUX: 'Consumer Discretionary', BKNG: 'Consumer Discretionary', TGT: 'Consumer Discretionary',
  GM: 'Consumer Discretionary', ABNB: 'Consumer Discretionary', ORLY: 'Consumer Discretionary',
  SHOP: 'Consumer Discretionary', PDD: 'Consumer Discretionary', MELI: 'Consumer Discretionary',
  MAR: 'Consumer Discretionary',
  // US Financials
  'BRK-B': 'Financials', JPM: 'Financials', V: 'Financials', MA: 'Financials', BAC: 'Financials',
  GS: 'Financials', MS: 'Financials', WFC: 'Financials', SCHW: 'Financials', BLK: 'Financials',
  AXP: 'Financials', C: 'Financials', COF: 'Financials', USB: 'Financials', BK: 'Financials',
  MET: 'Financials', AIG: 'Financials', PYPL: 'Financials', SPG: 'Financials',
  // US Healthcare
  LLY: 'Healthcare', JNJ: 'Healthcare', ABBV: 'Healthcare', MRK: 'Healthcare', UNH: 'Healthcare',
  PFE: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare', ISRG: 'Healthcare', DHR: 'Healthcare',
  AMGN: 'Healthcare', GILD: 'Healthcare', BMY: 'Healthcare', MDT: 'Healthcare', CVS: 'Healthcare',
  REGN: 'Healthcare',
  // US Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', CEG: 'Energy',
  // US Industrials
  CAT: 'Industrials', GE: 'Industrials', RTX: 'Industrials', BA: 'Industrials', DE: 'Industrials',
  UNP: 'Industrials', HON: 'Industrials', LMT: 'Industrials', UBER: 'Industrials', FDX: 'Industrials',
  UPS: 'Industrials', EMR: 'Industrials', GD: 'Industrials', MMM: 'Industrials', CSX: 'Industrials',
  ADP: 'Industrials', CTAS: 'Industrials',
  // US Consumer Staples
  WMT: 'Consumer Staples', COST: 'Consumer Staples', PG: 'Consumer Staples', KO: 'Consumer Staples',
  PEP: 'Consumer Staples', PM: 'Consumer Staples', MO: 'Consumer Staples', CL: 'Consumer Staples',
  MDLZ: 'Consumer Staples', MNST: 'Consumer Staples',
  // US Communication
  NFLX: 'Communication', TMUS: 'Communication', VZ: 'Communication', T: 'Communication',
  CMCSA: 'Communication', DIS: 'Communication',
  // US Utilities
  NEE: 'Utilities', SO: 'Utilities', DUK: 'Utilities',
  // US Real Estate
  AMT: 'Real Estate',
  // US Materials
  LIN: 'Materials',
  // US Storage/Hardware
  WDC: 'Technology', STX: 'Technology',
  // UK Stocks
  'SHEL.L': 'Energy', 'AZN.L': 'Healthcare', 'HSBA.L': 'Financials', 'ULVR.L': 'Consumer Staples',
  'BP.L': 'Energy', 'GSK.L': 'Healthcare', 'RIO.L': 'Materials', 'REL.L': 'Industrials',
  'DGE.L': 'Consumer Staples', 'BATS.L': 'Consumer Staples', 'LSEG.L': 'Financials',
  'NG.L': 'Utilities', 'AAL.L': 'Materials', 'GLEN.L': 'Materials', 'VOD.L': 'Communication',
  'BHP.L': 'Materials', 'PRU.L': 'Financials', 'LLOY.L': 'Financials', 'BARC.L': 'Financials',
  'RKT.L': 'Consumer Staples', 'IMB.L': 'Consumer Staples', 'SSE.L': 'Utilities',
  'AHT.L': 'Consumer Discretionary', 'BA.L': 'Industrials', 'CPG.L': 'Consumer Staples',
  'EXPN.L': 'Industrials', 'STAN.L': 'Financials', 'ABF.L': 'Consumer Staples',
  'ANTO.L': 'Materials', 'CRH.L': 'Materials', 'FERG.L': 'Industrials',
  'IAG.L': 'Industrials', 'IHG.L': 'Consumer Discretionary', 'KGF.L': 'Consumer Discretionary',
  'LAND.L': 'Real Estate', 'LGEN.L': 'Financials', 'MNG.L': 'Consumer Discretionary',
  'NWG.L': 'Financials', 'PSON.L': 'Industrials', 'RR.L': 'Industrials',
  'SBRY.L': 'Consumer Staples', 'SGE.L': 'Industrials', 'SMDS.L': 'Materials',
  'SMT.L': 'Financials', 'SN.L': 'Consumer Staples', 'SPX.L': 'Industrials',
  'SVT.L': 'Utilities', 'TSCO.L': 'Consumer Staples', 'WPP.L': 'Communication',
  'WTB.L': 'Consumer Discretionary',
}

/**
 * Compute intraday ATR from daily ATR using the 0.65 fallback ratio.
 * When 5-minute data becomes available, this will compute from session ranges.
 */
export function computeIATR(dailyATR14) {
  if (!dailyATR14 || dailyATR14 <= 0) return { iATR: 0, isEstimate: true }
  return {
    iATR: dailyATR14 * 0.65,
    isEstimate: true, // Always estimate until 5-min data available
  }
}

/**
 * Compute VWAP from prior session 5-min bars.
 * Currently returns null — stubbed for future data source.
 */
export function computeVWAP(/* fiveMinBars */) {
  return null
}

/**
 * Compute VWAP bias assessment.
 * Returns "ALIGNED", "OPPOSED", or "NEUTRAL".
 */
export function computeVWAPBias(currentPrice, vwap, direction, iATR) {
  if (!vwap || !currentPrice || !iATR || iATR <= 0) return null
  const distance = Math.abs(currentPrice - vwap)
  if (distance < 0.1 * iATR) return 'NEUTRAL'
  if (direction === 'LONG' && currentPrice > vwap) return 'ALIGNED'
  if (direction === 'SHORT' && currentPrice < vwap) return 'ALIGNED'
  return 'OPPOSED'
}

/**
 * Estimate bid-ask spread based on cap size.
 * Spec Section 3.3 fallback.
 */
export function estimateSpread(ticker, avgVolume, market) {
  const isUK = market === 'UK' || ticker.endsWith('.L')

  if (isUK) {
    if (FTSE30_TICKERS.has(ticker)) return { spreadPct: 0.06, source: 'estimate_large_cap_uk' }
    return { spreadPct: 0.12, source: 'estimate_mid_cap_uk' }
  }
  // US
  if (SP100_TICKERS.has(ticker)) return { spreadPct: 0.03, source: 'estimate_large_cap_us' }
  return { spreadPct: 0.08, source: 'estimate_mid_cap_us' }
}

/**
 * Compute friction offset: (spread/2) + slippage_allowance.
 * Clamped to [0.01, 0.05] × iATR.
 */
export function computeFriction(iATR, spreadEstimate) {
  if (!iATR || iATR <= 0) return 0
  const halfSpread = (spreadEstimate || 0) / 2
  const slippage = 0.02 * iATR
  let friction = halfSpread + slippage
  const floor = 0.01 * iATR
  const cap = 0.05 * iATR
  friction = Math.max(floor, Math.min(cap, friction))
  return friction
}

// =====================================================
// SECTION 2: NINE-FACTOR SCORING SYSTEM
// =====================================================

/**
 * Factor 1: Gap Alignment (0-2)
 * Measures whether the pre-market gap supports the expected trade direction.
 */
export function scoreGapAlignment(direction, gapPct, fallbackFuturesPct) {
  // Use pre-market gap if available, otherwise use futures
  const gap = gapPct != null ? gapPct : null
  const futures = fallbackFuturesPct != null ? fallbackFuturesPct : null

  if (gap != null) {
    if (direction === 'LONG') {
      if (gap >= 0.5) return { score: 2, note: `Gap +${gap.toFixed(2)}% in direction` }
      if (gap >= 0) return { score: 1, note: `Flat/small gap +${gap.toFixed(2)}%` }
      return { score: 0, note: `Gap ${gap.toFixed(2)}% against direction` }
    }
    // SHORT
    if (gap <= -0.5) return { score: 2, note: `Gap ${gap.toFixed(2)}% in direction` }
    if (gap <= 0) return { score: 1, note: `Flat/small gap ${gap.toFixed(2)}%` }
    return { score: 0, note: `Gap +${gap.toFixed(2)}% against direction` }
  }

  // Fallback: use futures direction
  if (futures != null) {
    const futuresInDir = direction === 'LONG' ? futures : -futures
    if (futuresInDir >= 0.5) return { score: 2, note: `Futures +${Math.abs(futures).toFixed(2)}% in direction (fallback)` }
    if (futuresInDir >= 0.3) return { score: 1, note: `Futures moderate ${Math.abs(futures).toFixed(2)}% (fallback)` }
    return { score: 0, note: `Futures flat/against (fallback)` }
  }

  // No data at all — default to 1
  return { score: 1, note: 'No gap data — default score' }
}

/**
 * Factor 2: Pre-Market Volume (0-2)
 */
export function scorePreMarketVolume(preMarketVolRatio) {
  if (preMarketVolRatio == null) {
    return { score: 1, note: 'No pre-market volume data — default score' }
  }
  if (preMarketVolRatio > 2.0) return { score: 2, note: `Pre-market vol ${preMarketVolRatio.toFixed(1)}x average` }
  if (preMarketVolRatio >= 1.0) return { score: 1, note: `Pre-market vol ${preMarketVolRatio.toFixed(1)}x average` }
  return { score: 0, note: `Below average pre-market vol ${preMarketVolRatio.toFixed(1)}x` }
}

/**
 * Factor 3: Catalyst Presence (0-2)
 * Uses sector peer moves as a proxy for catalysts.
 */
export function scoreCatalystPresence(sectorPeerData) {
  if (!sectorPeerData) return { score: 0, note: 'No peer data available' }

  const { maxPeerMove, peerHadRecentEarnings } = sectorPeerData

  if (peerHadRecentEarnings && maxPeerMove >= 3.0) {
    return { score: 2, note: `Sector peer earnings move ${maxPeerMove.toFixed(1)}%` }
  }
  if (maxPeerMove >= 2.0) {
    return { score: 1, note: `Sector peer moved ${maxPeerMove.toFixed(1)}%` }
  }
  return { score: 0, note: 'No identifiable catalyst' }
}

/**
 * Factor 4: Technical Level Proximity (0-2)
 * Checks if price is at or breaking through a key S/R level.
 */
export function scoreTechnicalLevel(currentPrice, previousClose, srLevels, iATR) {
  if (!srLevels || srLevels.length === 0 || !iATR || iATR <= 0) {
    return { score: 0, note: 'No S/R levels available' }
  }

  // Find nearest level by absolute distance
  let nearestLevel = null
  let nearestDistance = Infinity
  for (const sr of srLevels) {
    const dist = Math.abs(currentPrice - sr.level)
    if (dist < nearestDistance) {
      nearestDistance = dist
      nearestLevel = sr
    }
  }

  if (!nearestLevel) return { score: 0, note: 'No S/R levels in range' }

  const distanceIATR = nearestDistance / iATR

  // Check if price has CROSSED the level (breakout/breakdown)
  if (previousClose != null) {
    const previousSide = previousClose < nearestLevel.level ? 'below' : 'above'
    const currentSide = currentPrice < nearestLevel.level ? 'below' : 'above'
    if (previousSide !== currentSide) {
      return { score: 2, note: `Breaking through ${nearestLevel.type} at ${nearestLevel.level.toFixed(2)}` }
    }
  }

  // Approaching but not yet at key level
  if (distanceIATR <= 0.5) {
    return { score: 1, note: `${distanceIATR.toFixed(2)} iATR from ${nearestLevel.type} at ${nearestLevel.level.toFixed(2)}` }
  }

  return { score: 0, note: `Nearest S/R (${nearestLevel.type}) at ${distanceIATR.toFixed(2)} iATR away` }
}

/**
 * Factor 5: Momentum Consistency (0-2)
 * Last 3 sessions all closed in the expected direction.
 */
export function scoreMomentumConsistency(direction, last3Sessions) {
  if (!last3Sessions || last3Sessions.length < 3) {
    return { score: 0, note: 'Insufficient session data' }
  }

  let directionCloses = 0
  for (const session of last3Sessions) {
    if (session.close == null || session.open == null) continue
    if (direction === 'LONG' && session.close > session.open) directionCloses++
    if (direction === 'SHORT' && session.close < session.open) directionCloses++
  }

  if (directionCloses === 3) return { score: 2, note: '3/3 sessions closed in direction' }
  if (directionCloses === 2) return { score: 1, note: '2/3 sessions closed in direction' }
  return { score: 0, note: `${directionCloses}/3 sessions — choppy momentum` }
}

/**
 * Factor 6: Spread & Liquidity (0-2) — HARD DISQUALIFIER if 0
 */
export function scoreSpreadLiquidity(spreadPct, avgVolume, market) {
  const isUK = market === 'UK'

  if (isUK) {
    if (spreadPct < 0.08 && avgVolume > 500000) return { score: 2, note: `Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e6).toFixed(1)}M — excellent` }
    if (spreadPct < 0.15 && avgVolume > 200000) return { score: 1, note: `Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e3).toFixed(0)}K — adequate` }
    return { score: 0, note: `DISQUALIFIED — Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e3).toFixed(0)}K`, disqualified: true }
  }

  // US
  if (spreadPct < 0.05 && avgVolume > 2000000) return { score: 2, note: `Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e6).toFixed(1)}M — excellent` }
  if (spreadPct < 0.10 && avgVolume > 500000) return { score: 1, note: `Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e6).toFixed(1)}M — adequate` }
  return { score: 0, note: `DISQUALIFIED — Spread ${spreadPct.toFixed(3)}% vol ${(avgVolume/1e3).toFixed(0)}K`, disqualified: true }
}

/**
 * Factor 7: Relative Strength vs Index (0-2)
 */
export function scoreRelativeStrength(direction, stock5dReturn, index5dReturn) {
  if (stock5dReturn == null || index5dReturn == null) {
    return { score: 0, note: 'No relative strength data' }
  }

  const relativePerf = stock5dReturn - index5dReturn

  if (direction === 'LONG') {
    if (relativePerf > 1.0) return { score: 2, note: `+${relativePerf.toFixed(2)}% vs index — strong outperformance` }
    if (relativePerf > 0.5) return { score: 1, note: `+${relativePerf.toFixed(2)}% vs index — moderate` }
    return { score: 0, note: `${relativePerf.toFixed(2)}% vs index — no edge` }
  }

  // SHORT
  if (relativePerf < -1.0) return { score: 2, note: `${relativePerf.toFixed(2)}% vs index — strong underperformance` }
  if (relativePerf < -0.5) return { score: 1, note: `${relativePerf.toFixed(2)}% vs index — moderate` }
  return { score: 0, note: `${relativePerf.toFixed(2)}% vs index — no edge` }
}

/**
 * Factor 8: VWAP Alignment (0-1)
 */
export function scoreVWAPAlignment(vwapBias) {
  if (vwapBias === 'ALIGNED') return { score: 1, note: 'Price aligned with VWAP' }
  return { score: 0, note: vwapBias ? `VWAP ${vwapBias}` : 'No VWAP data' }
}

/**
 * Factor 9: Sector Momentum (0-1)
 * 3+ stocks from same sector on combined primary + watchlist.
 */
export function scoreSectorMomentum(sectorCounts, candidateSector) {
  if (!sectorCounts || !candidateSector) return { score: 0, note: 'No sector data' }
  const count = sectorCounts[candidateSector] || 0
  if (count >= 3) return { score: 1, note: `${count} ${candidateSector} stocks on list` }
  return { score: 0, note: `Only ${count} ${candidateSector} stock(s) on list` }
}

// =====================================================
// SECTION 3: TIER ASSIGNMENT
// =====================================================

/**
 * Assign tier based on total score. Only A-GRADE and B-GRADE exist.
 */
export function assignTier(totalScore) {
  if (totalScore >= 13) return 'A-GRADE'
  if (totalScore >= 10) return 'B-GRADE'
  return null
}

// =====================================================
// SECTION 4: TRADE MANAGEMENT
// =====================================================

/**
 * Compute day trade management levels.
 * Returns stop, target, R:R, and S/R capping info.
 */
export function computeDayTradeManagement(tier, iATR, currentPrice, direction, srLevels, frictionOffset) {
  if (!tier || !iATR || iATR <= 0) return null

  const stopDistanceIATR = tier === 'A-GRADE' ? 0.3 : 0.4
  const targetDistanceIATR = 0.5
  const stopDistance = stopDistanceIATR * iATR
  const targetDistance = targetDistanceIATR * iATR

  let stop, rawTarget
  if (direction === 'LONG') {
    stop = currentPrice - stopDistance
    rawTarget = currentPrice + targetDistance
  } else {
    stop = currentPrice + stopDistance
    rawTarget = currentPrice - targetDistance
  }

  // Target adjustment: cap at S/R minus 0.1 iATR buffer
  // Only structural S/R (weight >= 2) caps the target. Round numbers (weight 1) do NOT.
  let targetCappedBy = null
  let target = rawTarget
  if (srLevels && srLevels.length > 0) {
    for (const sr of srLevels) {
      if (sr.weight < 2) continue // Round numbers don't cap

      if (direction === 'LONG' && sr.level > currentPrice && sr.level < rawTarget) {
        const cappedTarget = sr.level - 0.1 * iATR
        if (cappedTarget < target) {
          target = cappedTarget
          targetCappedBy = { level: sr.level, source: sr.type, weight: sr.weight }
        }
      }
      if (direction === 'SHORT' && sr.level < currentPrice && sr.level > rawTarget) {
        const cappedTarget = sr.level + 0.1 * iATR
        if (cappedTarget > target) {
          target = cappedTarget
          targetCappedBy = { level: sr.level, source: sr.type, weight: sr.weight }
        }
      }
    }
  }

  // R:R check — if cap reduces target to less than stop distance, exclude
  const actualTargetDistance = Math.abs(target - currentPrice)
  const actualStopDistance = Math.abs(stop - currentPrice)
  const riskReward = actualStopDistance > 0 ? actualTargetDistance / actualStopDistance : 0

  if (riskReward < 1.0) {
    return {
      excluded: true,
      reason: `R:R ${riskReward.toFixed(2)}:1 below 1:1 — insufficient room to profit`,
      targetCappedBy,
    }
  }

  return {
    excluded: false,
    stop,
    target,
    rawTarget,
    stopDistanceIATR,
    stopDistancePrice: stopDistance,
    targetDistanceIATR: targetDistanceIATR,
    targetDistancePrice: actualTargetDistance,
    riskReward: parseFloat(riskReward.toFixed(2)),
    targetCappedBy,
    frictionOffset,
  }
}

/**
 * Build the 4-stage stop progression ladder.
 * All values are computed from iATR — execution is by the Auto Trader.
 */
export function buildStopProgression(tier, iATR, frictionOffset) {
  if (!tier || !iATR || iATR <= 0) return null

  return {
    type: 'aggressive_ladder',
    hfe_method: 'one_minute_candle_close',
    stages: [
      {
        stage: 'INITIAL',
        trigger_iatr: 0.0,
        stop_from_entry_iatr: null,
        includes_friction: false,
        note: `Original stop at -${tier === 'A-GRADE' ? '0.30' : '0.40'} iATR`,
      },
      {
        stage: 'BREAKEVEN',
        trigger_iatr: 0.25,
        stop_from_entry_iatr: 0.0,
        includes_friction: true,
        note: '50% of target — eliminate risk',
      },
      {
        stage: 'LOCK',
        trigger_iatr: 0.35,
        stop_from_entry_iatr: 0.15,
        includes_friction: true,
        note: '70% of target — lock 0.15 iATR',
      },
      {
        stage: 'CLOSE',
        trigger_iatr: 0.45,
        stop_from_entry_iatr: 0.30,
        includes_friction: true,
        note: '90% of target — lock 0.30 iATR',
      },
    ],
    time_rules: {
      stale_trade_minutes: 90,
      stale_trade_action: 'true_breakeven_if_profitable',
      fading_trade_minutes: 120,
      fading_trade_action: 'lock_50pct_of_close_hfe_if_gt_0.15_iatr',
      approaching_close_minutes_before_hard_close: 60,
      approaching_close_action: 'lock_50pct_unrealised_if_profitable',
      viability_guard_buffer_iatr: 0.03,
      viability_guard_action: 'close_at_market_if_stop_unviable',
    },
    vwap_rule: {
      trigger: 'confirmed_vwap_violation',
      breach_buffer_iatr: 0.05,
      confirmation: '1min_candle_close_on_wrong_side',
      action_if_profitable: 'true_breakeven_minimum',
      action_if_losing: 'no_change',
      reliable_after_minutes: 30,
    },
  }
}

/**
 * Compute position sizing with VIX adjustment.
 */
export function computePositionSizing(tier, vix, accountSize, actualStopDistance, currentPrice) {
  if (!tier || !accountSize || !actualStopDistance || actualStopDistance <= 0) return null

  const tierRiskPct = tier === 'A-GRADE' ? 0.005 : 0.0025 // 0.50% or 0.25%

  // VIX filter
  let vixMultiplier = 1.0
  let vixNote = null
  const vixVal = vix || 18 // default assumption
  if (vixVal >= 30) {
    return { excluded: true, reason: 'VIX >= 30 — all day trades suspended' }
  }
  if (vixVal >= 25) {
    if (tier !== 'A-GRADE') return { excluded: true, reason: 'VIX >= 25 — B-GRADE excluded' }
    vixMultiplier = 0.50
    vixNote = 'VIX 25-30: A-GRADE only at 50% size'
  } else if (vixVal >= 20) {
    if (tier !== 'A-GRADE') return { excluded: true, reason: 'VIX >= 20 — B-GRADE excluded' }
    vixMultiplier = 0.75
    vixNote = 'VIX 20-25: A-GRADE only at 75% size'
  }

  const accountRisk = accountSize * tierRiskPct
  const effectiveRisk = accountRisk * vixMultiplier
  const poundsPerPoint = effectiveRisk / actualStopDistance

  return {
    excluded: false,
    tierRiskPct: tierRiskPct * 100,
    vixMultiplier,
    vixNote,
    effectiveRiskPct: (tierRiskPct * vixMultiplier * 100).toFixed(2),
    effectiveRisk: parseFloat(effectiveRisk.toFixed(2)),
    poundsPerPoint: parseFloat(poundsPerPoint.toFixed(2)),
    notionalExposure: parseFloat((poundsPerPoint * currentPrice).toFixed(2)),
  }
}

// =====================================================
// SECTION 5: ENTRY TYPES
// =====================================================

/**
 * Determine entry type for a day trade candidate.
 * Default: Opening Range Breakout. Micro-zone if near S/R. Crabel if eligible.
 */
export function determineEntryType(direction, currentPrice, tier, iATR, srLevels, crabelEligible) {
  const isUK = false // determined by caller, but unused here for now
  const confirmationMinutes = tier === 'A-GRADE' ? 5 : 8

  // Check for micro-zone opportunity: is there a structural S/R level within 0.3 iATR?
  let microZoneLevel = null
  if (srLevels && iATR > 0) {
    for (const sr of srLevels) {
      if (sr.weight < 2) continue // Only structural levels
      const dist = Math.abs(currentPrice - sr.level)
      if (dist <= 0.3 * iATR) {
        // For LONG, we want support below; for SHORT, resistance above
        if (direction === 'LONG' && sr.level <= currentPrice) {
          microZoneLevel = sr
          break
        }
        if (direction === 'SHORT' && sr.level >= currentPrice) {
          microZoneLevel = sr
          break
        }
      }
    }
  }

  // Crabel Early Entry takes priority if eligible (A-GRADE only)
  if (crabelEligible) {
    return {
      type: 'crabel_early_entry',
      confirmation_minutes: confirmationMinutes,
      note: 'Crabel early entry — before OR established',
    }
  }

  // Micro-zone if near S/R
  if (microZoneLevel) {
    const zoneWidth = 0.1 * iATR
    const zoneLow = microZoneLevel.level - zoneWidth / 2
    const zoneHigh = microZoneLevel.level + zoneWidth / 2
    return {
      type: 'micro_zone',
      sr_level: microZoneLevel.level,
      sr_source: microZoneLevel.type,
      sr_weight: microZoneLevel.weight,
      zone_low: parseFloat(zoneLow.toFixed(2)),
      zone_high: parseFloat(zoneHigh.toFixed(2)),
      zone_width_iatr_pct: 0.10,
      stop_reference: 'zone_outer_edge',
      confirmation_minutes: 5,
    }
  }

  // Default: Opening Range Breakout
  return {
    type: 'opening_range_breakout',
    opening_range_window_minutes: 15,
    confirmation_minutes: confirmationMinutes,
    note: 'OR levels determined live by Auto Trader',
  }
}

/**
 * Check Crabel Early Entry eligibility.
 * All 6 conditions must be true, and tier must be A-GRADE.
 */
export function checkCrabelEligibility(tier, factorScores, gapPct, preMarketVolRatio) {
  if (tier !== 'A-GRADE') return { eligible: false, reason: 'Not A-GRADE' }
  if (!factorScores) return { eligible: false, reason: 'No factor scores' }

  const conditions = []
  if (factorScores.gap_alignment < 2) conditions.push('Gap Alignment < 2')
  if (factorScores.premarket_volume < 2) conditions.push('Pre-Market Volume < 2')
  if (factorScores.catalyst_presence < 1) conditions.push('Catalyst Presence < 1')
  if (gapPct == null || Math.abs(gapPct) < 1.0) conditions.push('Gap < 1.0%')
  if (preMarketVolRatio == null || preMarketVolRatio < 3.0) conditions.push('Pre-market vol < 3x')

  if (conditions.length > 0) {
    return { eligible: false, reason: `Failed: ${conditions.join(', ')}` }
  }

  return {
    eligible: true,
    reason: `Gap ${gapPct?.toFixed(1)}% + ${preMarketVolRatio?.toFixed(1)}x pre-market vol + catalyst + score >= 13`,
  }
}

// =====================================================
// SECTION 6: AIR POCKET GATE (iATR-based)
// =====================================================

/**
 * Check air pocket gate using iATR for R-unit calculations.
 * VWAP is excluded from the gate check — only structural S/R (4 sources).
 */
export function checkDayTradeAirPocket(direction, currentPrice, allSupportLevels, allResistanceLevels, iATR) {
  if (!iATR || iATR <= 0) return { clear: true, note: 'No iATR — skipping gate' }

  if (direction === 'LONG') {
    // Check nearest resistance above (excluding VWAP)
    const structuralResistance = (allResistanceLevels || []).filter(r => r.source !== 'vwap_prior_session')
    if (structuralResistance.length === 0) return { clear: true, distanceIATR: null, note: 'No resistance above' }

    const nearest = structuralResistance[0] // Already sorted by distance (closest first)
    const distance = nearest.level - currentPrice
    const distanceR = distance / iATR

    if (distanceR < 0.85) {
      return {
        clear: false,
        distanceIATR: parseFloat(distanceR.toFixed(2)),
        nearestWall: nearest,
        note: `BLOCKED — resistance at ${nearest.level.toFixed(2)} (${nearest.type}) is only ${distanceR.toFixed(2)} iATR away`,
      }
    }
    return {
      clear: true,
      distanceIATR: parseFloat(distanceR.toFixed(2)),
      nearestWall: nearest,
      note: `Clear — ${distanceR.toFixed(2)} iATR to nearest resistance`,
    }
  }

  // SHORT — check nearest support below
  const structuralSupport = (allSupportLevels || []).filter(s => s.source !== 'vwap_prior_session')
  if (structuralSupport.length === 0) return { clear: true, distanceIATR: null, note: 'No support below' }

  const nearest = structuralSupport[0]
  const distance = currentPrice - nearest.level
  const distanceR = distance / iATR

  if (distanceR < 0.85) {
    return {
      clear: false,
      distanceIATR: parseFloat(distanceR.toFixed(2)),
      nearestWall: nearest,
      note: `BLOCKED — support at ${nearest.level.toFixed(2)} (${nearest.type}) is only ${distanceR.toFixed(2)} iATR away`,
    }
  }
  return {
    clear: true,
    distanceIATR: parseFloat(distanceR.toFixed(2)),
    nearestWall: nearest,
    note: `Clear — ${distanceR.toFixed(2)} iATR to nearest support`,
  }
}

// =====================================================
// SECTION 7: ORCHESTRATOR
// =====================================================

/**
 * Main entry point: evaluate all day trade candidates.
 *
 * @param {Object} options
 * @param {Array} options.scanResults - All scanTicker results
 * @param {number} options.vix - Current VIX value
 * @param {number} options.accountSize - Account size in £
 * @param {Object} options.futuresData - { sp500Pct, ftsePct }
 * @param {Object} options.indexReturns - { spy5d, ftse5d } — 5-day index returns
 * @param {Object} options.sectorCounts - { sector: count } from combined lists
 * @returns {Object} { candidates, excluded, summary }
 */
export function evaluateDayTradeCandidates(options) {
  const {
    scanResults = [],
    vix = 18,
    accountSize = 10000,
    futuresData = {},
    indexReturns = {},
    sectorCounts = {},
  } = options

  // VIX >= 30 → all day trades suspended
  if (vix >= 30) {
    return {
      candidates: [],
      excluded: [{ ticker: 'ALL', reason: 'VIX >= 30 — all day trades suspended' }],
      summary: { total_candidates_assessed: 0, a_grade: 0, b_grade: 0, suspended: true },
      vix,
    }
  }

  // Build candidate pool: stocks with Stage 1 direction (LONG/SHORT/BOTH), no earnings warning
  const candidatePool = scanResults.filter(r => {
    const dir = r.stage1Direction
    if (!dir || dir === 'WATCH' || dir === 'NONE') return false
    if (r.earningsWarning) return false
    return true
  })

  const candidates = []
  const excluded = []

  for (const stock of candidatePool) {
    const ticker = stock.ticker
    const market = ticker.endsWith('.L') ? 'UK' : 'US'
    const sector = SECTOR_MAP[ticker] || 'Unknown'
    // Use resolved direction (BOTH should already be resolved by scanner POST handler)
    const direction = stock.resolvedDirection || stock.stage1Direction

    // Skip if direction is still BOTH (shouldn't happen after resolution)
    if (direction === 'BOTH') continue

    const dailyATR = stock.indicators?.atrRaw || stock.rawIndicators?.atrRaw || 0
    const currentPrice = stock.price || stock.indicators?.currentPrice || 0
    const previousClose = stock.previousClose || 0

    // Compute iATR
    const { iATR, isEstimate: iatrIsEstimate } = computeIATR(dailyATR)
    if (iATR <= 0) {
      excluded.push({ ticker, source: stock.source || 'UNKNOWN', total_score: null, reason: 'No ATR data — cannot compute iATR' })
      continue
    }

    // Compute VWAP (currently null — stubbed)
    const vwap = computeVWAP()
    const vwapBias = computeVWAPBias(currentPrice, vwap, direction, iATR)

    // Estimate spread
    const { spreadPct, source: spreadSource } = estimateSpread(ticker, stock.indicators?.avgVolume20 || 0, market)

    // Compute friction
    const spreadInPriceUnits = (spreadPct / 100) * currentPrice
    const frictionOffset = computeFriction(iATR, spreadInPriceUnits)

    // Get S/R levels
    const allSupportLevels = stock.allSupportLevels || []
    const allResistanceLevels = stock.allResistanceLevels || []
    const allSRLevels = [...allSupportLevels, ...allResistanceLevels]

    // Get last 3 sessions for momentum
    const last3Sessions = stock.last3Sessions || []

    // Get 5d returns for relative strength
    const stock5dReturn = stock.indicators?.momentum5d || 0
    const index5dReturn = market === 'UK' ? (indexReturns.ftse5d || 0) : (indexReturns.spy5d || 0)

    // Futures data for gap alignment
    const futuresPct = market === 'UK' ? (futuresData.ftsePct || 0) : (futuresData.sp500Pct || 0)

    // Peer data for catalyst presence
    const sectorPeerData = buildSectorPeerData(stock, scanResults, sector)

    // ── FACTOR 6 FIRST (hard disqualifier) ──
    const avgVolume = stock.indicators?.avgVolume20 || 0
    const f6 = scoreSpreadLiquidity(spreadPct, avgVolume, market)
    if (f6.score === 0) {
      excluded.push({
        ticker,
        source: stock.tradeSource || 'UNKNOWN',
        total_score: null,
        reason: `Disqualified: Factor 6 (Spread & Liquidity) = 0 — ${f6.note}`,
      })
      continue
    }

    // ── SCORE ALL 9 FACTORS ──
    const f1 = scoreGapAlignment(direction, null, futuresPct) // No pre-market price
    const f2 = scorePreMarketVolume(null) // No pre-market volume
    const f3 = scoreCatalystPresence(sectorPeerData)
    const f4 = scoreTechnicalLevel(currentPrice, previousClose, allSRLevels, iATR)
    const f5 = scoreMomentumConsistency(direction, last3Sessions)
    // f6 already computed above
    const f7 = scoreRelativeStrength(direction, stock5dReturn, index5dReturn)
    const f8 = scoreVWAPAlignment(vwapBias)
    const f9 = scoreSectorMomentum(sectorCounts, sector)

    const factorScores = {
      gap_alignment: f1.score,
      premarket_volume: f2.score,
      catalyst_presence: f3.score,
      technical_level: f4.score,
      momentum_consistency: f5.score,
      spread_liquidity: f6.score,
      relative_strength: f7.score,
      vwap_alignment: f8.score,
      sector_momentum: f9.score,
    }

    const scoringNotes = {
      gap_note: f1.note,
      volume_note: f2.note,
      catalyst_detail: f3.note,
      technical_note: f4.note,
      momentum_note: f5.note,
      liquidity_note: f6.note,
      rs_note: f7.note,
      vwap_note: f8.note,
      sector_note: f9.note,
      factor6_spread_pct: spreadPct,
      factor6_avg_volume: avgVolume,
      spread_source: spreadSource,
    }

    const totalScore = Object.values(factorScores).reduce((sum, s) => sum + s, 0)
    const tier = assignTier(totalScore)

    // ── TIER CHECK ──
    if (!tier) {
      excluded.push({
        ticker,
        source: stock.tradeSource || 'UNKNOWN',
        total_score: totalScore,
        reason: `Below minimum score threshold (10) — scored ${totalScore}/16`,
      })
      continue
    }

    // ── VIX FILTER ──
    const sizing = computePositionSizing(tier, vix, accountSize, 0, currentPrice) // placeholder stop distance
    if (sizing?.excluded) {
      excluded.push({ ticker, source: stock.tradeSource || 'UNKNOWN', total_score: totalScore, reason: sizing.reason })
      continue
    }

    // ── AIR POCKET GATE (iATR-based) ──
    const airPocket = checkDayTradeAirPocket(direction, currentPrice, allSupportLevels, allResistanceLevels, iATR)
    if (!airPocket.clear) {
      excluded.push({
        ticker,
        source: stock.tradeSource || 'UNKNOWN',
        total_score: totalScore,
        reason: `Air pocket gate: ${airPocket.note}`,
      })
      continue
    }

    // ── TRADE MANAGEMENT ──
    const mgmt = computeDayTradeManagement(tier, iATR, currentPrice, direction, allSRLevels, frictionOffset)
    if (!mgmt || mgmt.excluded) {
      excluded.push({
        ticker,
        source: stock.tradeSource || 'UNKNOWN',
        total_score: totalScore,
        reason: mgmt?.reason || 'Trade management calculation failed',
      })
      continue
    }

    // Recompute position sizing with actual stop distance
    const actualSizing = computePositionSizing(tier, vix, accountSize, mgmt.stopDistancePrice, currentPrice)
    if (actualSizing?.excluded) {
      excluded.push({ ticker, source: stock.tradeSource || 'UNKNOWN', total_score: totalScore, reason: actualSizing.reason })
      continue
    }

    // ── ENTRY TYPE ──
    const crabel = checkCrabelEligibility(tier, factorScores, null, null) // No pre-market data
    const entryZone = determineEntryType(direction, currentPrice, tier, iATR, allSRLevels, crabel.eligible)

    // ── STOP PROGRESSION ──
    const stopProgression = buildStopProgression(tier, iATR, frictionOffset)

    // ── BUILD CANDIDATE ──
    candidates.push({
      ticker,
      name: stock.name || ticker,
      market,
      sector,
      direction,
      source: stock.tradeSource || (stock.direction === 'WATCH' || stock.srDemotion ? 'WATCHLIST' : 'PRIMARY'),
      tier,
      total_score: totalScore,
      factor_scores: factorScores,
      scoring_notes: scoringNotes,
      atr: {
        daily_14: parseFloat(dailyATR.toFixed(2)),
        intraday_5min_14: parseFloat(iATR.toFixed(2)),
        iatr_is_estimate: iatrIsEstimate,
        atr_ratio: parseFloat((iATR / dailyATR).toFixed(3)),
        atr_ratio_note: `iATR is ${Math.round((iATR / dailyATR) * 100)}% of dATR — ${iatrIsEstimate ? 'estimated (0.65x fallback)' : 'computed from 5-min bars'}`,
      },
      sr_ladder: {
        nearest_support: allSupportLevels[0] || null,
        nearest_resistance: allResistanceLevels[0] || null,
        vwap_prior_session: vwap,
        vwap_bias: vwapBias,
        air_pocket_clear: true,
        air_pocket_distance_iatr: airPocket.distanceIATR,
        air_pocket_note: airPocket.note,
      },
      entry_zone: entryZone,
      trade_management: {
        stop: parseFloat(mgmt.stop.toFixed(2)),
        target: parseFloat(mgmt.target.toFixed(2)),
        stop_distance_iatr: mgmt.stopDistanceIATR,
        stop_distance_price: parseFloat(mgmt.stopDistancePrice.toFixed(2)),
        target_distance_iatr: mgmt.targetDistanceIATR,
        target_distance_price: parseFloat(mgmt.targetDistancePrice.toFixed(2)),
        target_rr_headline: mgmt.riskReward,
        target_capped_by: mgmt.targetCappedBy,
        friction: {
          spread_estimate: parseFloat(spreadInPriceUnits.toFixed(4)),
          slippage_allowance_iatr_pct: 0.02,
          friction_offset: parseFloat(frictionOffset.toFixed(4)),
          note: `True breakeven = entry ${direction === 'LONG' ? '+' : '-'} ${frictionOffset.toFixed(2)}`,
        },
        stop_progression: stopProgression,
      },
      crabel_early_entry: crabel,
      position_sizing: {
        tier_risk_pct: actualSizing.tierRiskPct,
        vix_adjustment: actualSizing.vixMultiplier,
        vix_note: actualSizing.vixNote,
        effective_risk_pct: actualSizing.effectiveRiskPct,
        effective_risk: actualSizing.effectiveRisk,
        pounds_per_point: actualSizing.poundsPerPoint,
        notional_exposure: actualSizing.notionalExposure,
      },
    })
  }

  // Build summary
  const summary = {
    total_candidates_assessed: candidatePool.length,
    a_grade: candidates.filter(c => c.tier === 'A-GRADE').length,
    b_grade: candidates.filter(c => c.tier === 'B-GRADE').length,
    excluded_low_score: excluded.filter(e => e.reason?.includes('minimum score')).length,
    excluded_liquidity: excluded.filter(e => e.reason?.includes('Factor 6')).length,
    excluded_earnings: scanResults.filter(r => r.stage1Direction && r.stage1Direction !== 'WATCH' && r.stage1Direction !== 'NONE' && r.earningsWarning).length,
    excluded_air_pocket: excluded.filter(e => e.reason?.includes('Air pocket')).length,
    excluded_rr: excluded.filter(e => e.reason?.includes('R:R')).length,
    excluded_vix: excluded.filter(e => e.reason?.includes('VIX')).length,
    crabel_early_entry_eligible: candidates.filter(c => c.crabel_early_entry?.eligible).length,
    sector_momentum_sectors: Object.entries(sectorCounts).filter(([, count]) => count >= 3).map(([sector]) => sector),
  }

  return { candidates, excluded, summary, vix }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Build sector peer data for catalyst scoring.
 * Looks at other stocks in the same sector from scan results.
 */
function buildSectorPeerData(stock, allResults, sector) {
  if (!sector || !allResults) return null

  const peers = allResults.filter(r =>
    r.ticker !== stock.ticker &&
    (SECTOR_MAP[r.ticker] || 'Unknown') === sector &&
    !r.error
  )

  if (peers.length === 0) return null

  const peerMoves = peers
    .map(p => Math.abs(p.indicators?.momentum5d || 0))
    .filter(m => m > 0)

  const maxPeerMove = peerMoves.length > 0 ? Math.max(...peerMoves) : 0

  // Check if any peer had earnings within 2 days
  const peerHadRecentEarnings = peers.some(p =>
    p.daysUntilEarnings != null && Math.abs(p.daysUntilEarnings) <= 2
  )

  return { maxPeerMove, peerHadRecentEarnings, peerCount: peers.length }
}

/**
 * Get the sector for a ticker.
 */
export function getSector(ticker) {
  return SECTOR_MAP[ticker] || 'Unknown'
}

/**
 * Build sector counts from combined primary + watchlist stocks.
 */
export function buildSectorCounts(longCandidates, shortCandidates, watchlistCandidates) {
  const counts = {}
  const all = [...(longCandidates || []), ...(shortCandidates || []), ...(watchlistCandidates || [])]
  for (const stock of all) {
    const sector = SECTOR_MAP[stock.ticker] || 'Unknown'
    counts[sector] = (counts[sector] || 0) + 1
  }
  return counts
}

/**
 * Build session rules object (static config per spec Section 14).
 */
export function getSessionRules() {
  return {
    uk: {
      no_entry_before_minutes: 15,
      opening_range_minutes: 15,
      no_entry_after_time: '14:30:00Z',
      time_stop_exit: '14:30:00Z',
      hard_close_time: '16:25:00Z',
    },
    us: {
      no_entry_before_minutes: 15,
      opening_range_minutes: 15,
      no_entry_after_time: '20:00:00Z',
      time_stop_exit: '19:00:00Z',
      hard_close_time: '20:55:00Z',
    },
    risk: {
      max_trades_per_session: 4,
      max_consecutive_losses_halt: 2,
      max_daily_loss_pct: 1.0,
      max_weekly_loss_pct: 2.0,
    },
    vix_filter: {
      normal_below: 20,
      reduced_below: 25,
      minimal_below: 30,
      suspended_at_or_above: 30,
      note: 'VIX 20-25: A-GRADE only at 75% size. VIX 25-30: A-GRADE only at 50% size.',
    },
  }
}
