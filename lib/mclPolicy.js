/**
 * MCL → Regime Gate v1.0 (Swing Trader)
 *
 * Pure function — no I/O, no side effects.
 * Takes the 4 MCL factors and computes:
 *   - regimeState (GREEN / YELLOW / RED)
 *   - continuous sizeMultiplier
 *   - threshold modifiers (score deltas + pillar delta)
 *
 * Spec: Expert trader's 7-step scoring pipeline.
 */

// ── Step 1: Factor score maps ──
const FACTOR_SCORES = {
  riskSentiment: { RISK_ON: +2, NEUTRAL: 0, RISK_OFF: -2 },
  volatilityRegime: { LOW_VOL: +1, NORMAL: 0, HIGH_VOL: -2 },
  macroPressure: { TAILWIND: +1, NEUTRAL: 0, HEADWIND: -1 },
  globalFlow: { FOLLOW_THROUGH: +1, MIXED: 0, REVERSAL_RISK: -1 },
}

// ── Confidence multipliers ──
const CONF_MULT = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 }

// ── Per-market damping ──
const MARKET_DAMPING = { UK: 0.85, US: 1.0 }

// ── Base thresholds per regime (from existing getRegimeThresholds) ──
const BASE_THRESHOLDS = {
  GREEN:  { longScore: 70, longPillars: 4, shortScore: 85, shortPillars: 5 },
  RED:    { longScore: 85, longPillars: 5, shortScore: 70, shortPillars: 4 },
  YELLOW: { longScore: 75, longPillars: 4, shortScore: 75, shortPillars: 4 },
}

const clampScore = (v) => Math.max(60, Math.min(95, v))
const clampPillars = (v) => Math.max(3, Math.min(6, v))

/**
 * Compute MCL policy for a given market.
 *
 * @param {Object} factors — from /api/market-context response.factors
 *   { riskSentiment: { state, confidence }, volatilityRegime: {...}, macroPressure: {...}, globalFlow: {...} }
 * @param {string} market — 'UK' or 'US'
 * @returns {Object|null} — policy object, or null if factors unavailable (triggers legacy fallback)
 */
export function computeMclPolicy(factors, market = 'US') {
  if (!factors) return null

  const factorKeys = ['riskSentiment', 'volatilityRegime', 'macroPressure', 'globalFlow']

  // ── Step 1: Weighted factor scores ──
  const weightedFactors = {}
  const confMultipliers = []

  for (const key of factorKeys) {
    const factor = factors[key]

    if (!factor || factor.state === 'UNKNOWN' || factor.confidence === 'NONE') {
      // Missing/unknown: 0 score, LOW confidence (drags overall confidence down)
      weightedFactors[key] = 0
      confMultipliers.push(CONF_MULT.LOW)
      continue
    }

    const rawScore = FACTOR_SCORES[key]?.[factor.state] ?? 0
    const confMult = CONF_MULT[factor.confidence] ?? CONF_MULT.LOW

    weightedFactors[key] = rawScore * confMult
    confMultipliers.push(confMult)
  }

  // ── Step 2: MCL confidence score + label ──
  const mclConfidenceScore = parseFloat(
    (confMultipliers.reduce((a, b) => a + b, 0) / confMultipliers.length).toFixed(2)
  )
  const mclConfidence = mclConfidenceScore >= 0.80 ? 'HIGH'
    : mclConfidenceScore >= 0.55 ? 'MEDIUM'
    : 'LOW'

  // ── Step 3: Regime score (per-market damping) ──
  const regimeScoreRaw = parseFloat(
    Object.values(weightedFactors).reduce((a, b) => a + b, 0).toFixed(2)
  )
  const damping = MARKET_DAMPING[market] ?? 1.0
  const regimeScore = parseFloat((regimeScoreRaw * damping).toFixed(2))

  // ── Step 4: Volatility cap ──
  const volState = factors.volatilityRegime?.state
  const volConf = factors.volatilityRegime?.confidence
  const volatilityCapApplied = (volState === 'HIGH_VOL' && volConf !== 'LOW')

  // ── Step 5: Map to regime ──
  // Note: using strict < for RED boundary so that HIGH_VOL alone (-2.0) doesn't
  // force RED. Volatility is about tradeability not direction — a score of exactly
  // -2.0 should be YELLOW (uncertain), not RED (bearish). RED requires additional
  // negative signals beyond just volatility.
  let regime
  if (regimeScore >= 2.0) regime = 'GREEN'
  else if (regimeScore < -2.0) regime = 'RED'
  else regime = 'YELLOW'

  // Confidence fallback: LOW confidence forces YELLOW
  if (mclConfidence === 'LOW') regime = 'YELLOW'

  // Volatility cap: GREEN → YELLOW (vol is about tradeability, not direction)
  if (volatilityCapApplied && regime === 'GREEN') regime = 'YELLOW'

  // ── Step 6: Size multiplier ──
  let sizeMultiplier = parseFloat(
    Math.max(0.5, Math.min(1.25, 1.0 + 0.10 * regimeScore)).toFixed(3)
  )

  // Low confidence caps size
  if (mclConfidence === 'LOW') {
    sizeMultiplier = Math.min(sizeMultiplier, 0.5)
  }

  // Direction-specific sizing (applied in Stage 3 finaliseCandidates)
  let longSize, shortSize
  if (regime === 'GREEN') {
    longSize = sizeMultiplier
    shortSize = parseFloat((sizeMultiplier * 0.6).toFixed(3))
  } else if (regime === 'RED') {
    shortSize = sizeMultiplier
    longSize = parseFloat((sizeMultiplier * 0.6).toFixed(3))
  } else {
    // YELLOW: cautious on both sides
    longSize = parseFloat(Math.min(sizeMultiplier, 0.8).toFixed(3))
    shortSize = parseFloat(Math.min(sizeMultiplier, 0.8).toFixed(3))
  }

  // ── Step 7: Threshold modifiers ──
  let longScoreDelta = 0
  let shortScoreDelta = 0
  let pillarDelta = 0

  // Extreme tailwinds: be slightly less strict on favoured side
  if (regimeScore >= 3.0) longScoreDelta = -5
  if (regimeScore <= -3.0) shortScoreDelta = -5

  // HIGH_VOL handling — softened from original spec
  // Original: pillarDelta +1 always in HIGH_VOL (too aggressive, collapses trade count on large caps)
  // New: pillarDelta +1 ONLY in HIGH_VOL + RED (truly dangerous).
  //      In HIGH_VOL + YELLOW: keep candidates, reduce exposure via sizing instead.
  if (volatilityCapApplied && regime === 'RED') {
    pillarDelta = +1  // Hard gate: only when volatility AND direction are both hostile
  }

  // HIGH_VOL sizing reduction (applies regardless of regime)
  // Keeps candidate flow alive but reduces exposure
  if (volatilityCapApplied) {
    longSize = parseFloat((longSize * 0.75).toFixed(3))
    shortSize = parseFloat((shortSize * 0.75).toFixed(3))
    sizeMultiplier = parseFloat((sizeMultiplier * 0.75).toFixed(3))
  }

  // Apply deltas to base thresholds for the mapped regime
  const base = BASE_THRESHOLDS[regime] || BASE_THRESHOLDS.YELLOW

  const thresholds = {
    longScore: clampScore(base.longScore + longScoreDelta),
    longPillars: clampPillars(base.longPillars + pillarDelta),
    shortScore: clampScore(base.shortScore + shortScoreDelta),
    shortPillars: clampPillars(base.shortPillars + pillarDelta),
  }

  return {
    regime,
    regimeScore,
    regimeScoreRaw,
    mclConfidence,
    mclConfidenceScore,
    volatilityCapApplied,
    sizeMultiplier,
    longSize,
    shortSize,
    thresholds,
    thresholdMods: { longScoreDelta, shortScoreDelta, pillarDelta },
    weightedFactors,
    factorBreakdown: {
      riskSentiment: factors.riskSentiment?.state || 'UNKNOWN',
      volatilityRegime: factors.volatilityRegime?.state || 'UNKNOWN',
      macroPressure: factors.macroPressure?.state || 'UNKNOWN',
      globalFlow: factors.globalFlow?.state || 'UNKNOWN',
    },
    market,
  }
}
