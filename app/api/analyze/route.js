import Anthropic from '@anthropic-ai/sdk'
import { LOG_SCHEMA_VERSION, buildScanPayload } from '../../../lib/scanEmission.js'

// Allow up to 120s on Vercel Pro (default is 10s on Hobby)
export const maxDuration = 300

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request) {
  try {
    const { formData, marketPulse, livePrices, scannerResults } = await request.json()

    // Build the full Swing Committee prompt
    const prompt = buildFullPrompt(formData, marketPulse, livePrices, scannerResults)

    // Call Claude API with retry on transient errors.
    // Sonnet only — at 2k tokens the Opus fallback added latency without value.
    const models = [
      { id: 'claude-sonnet-4-20250514', retries: 2 },
    ]

    let message
    for (const model of models) {
      let succeeded = false
      for (let attempt = 1; attempt <= model.retries; attempt++) {
        try {
          console.log(`[Analyze] Calling ${model.id} (attempt ${attempt}/${model.retries})`)
          message = await client.messages.create({
            model: model.id,
            max_tokens: 2048,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ]
          })
          console.log(`[Analyze] Success with ${model.id}`)
          succeeded = true
          break // Success — exit retry loop
        } catch (apiError) {
          const status = apiError?.status || apiError?.statusCode || 0
          const isRetryable = status === 429 || status === 529 || status === 503
          if (isRetryable && attempt < model.retries) {
            const delay = attempt * 5000
            console.log(`[Analyze] ${model.id} returned ${status} on attempt ${attempt}, retrying in ${delay / 1000}s...`)
            await new Promise(r => setTimeout(r, delay))
          } else if (isRetryable) {
            console.log(`[Analyze] ${model.id} failed after ${model.retries} attempts (${status}), trying next model...`)
            break // Try next model
          } else {
            throw apiError // Non-retryable error — propagate immediately
          }
        }
      }
      if (succeeded) break
    }

    if (!message) {
      throw new Error('All models unavailable — Anthropic API is overloaded. Please try again in a few minutes.')
    }

    // Parse the response
    const responseText = message.content[0].text
    const result = parseResponse(responseText, scannerResults)

    // ------------------------------------------------------------------
    // Build the scan handoff payload and return it IN THE RESPONSE.
    //
    // Vercel's serverless filesystem is ephemeral + mostly read-only, so we
    // don't try to write to disk server-side. Instead the client receives
    // `result.scan` and renders a "Download scan JSON" button — the user
    // saves it to entry-rules/money-program-trading/data/scans/ manually.
    //
    // `buildScanPayload` is a pure transform (no I/O), so it is safe to call
    // in any runtime. Errors here are reported as `result.scan.error` and do
    // not fail the analysis response.
    // ------------------------------------------------------------------
    try {
      const now = new Date()
      const { scanRecord, shortlistEntries, bypassCandidateEntries } = await buildScanPayload({
        formData,
        scannerResults,
        analysisResult: result,
        ruleSetVersion: process.env.RULE_SET_VERSION || '',
        now,
      })
      const ymd = now.toISOString().slice(0, 10).replace(/-/g, '')
      result.scan = {
        ok: true,
        schema_version: LOG_SCHEMA_VERSION,
        filename: `scan_${ymd}.json`,
        scan_id: scanRecord.scan_id,
        shortlist_count: shortlistEntries.length,
        // The two top-level fields that make up the handoff file exactly as
        // entry-rules' session_init.py will read it back:
        scan_record: scanRecord,
        shortlist_entries: shortlistEntries,
        // Parallel bypass-eligible entries. Includes every gradable (A+/A/B)
        // signal regardless of verdict — WATCHLIST + TAKE-TRADE + DAY-TRADE.
        // Frontend filters this down to the user's 1–3 hand-picked bypass
        // tickers, then stamps gate_bypass:true + bypass_until on the scan
        // record before downloading. Not used on non-bypass runs.
        bypass_candidate_entries: bypassCandidateEntries ?? [],
        bypass_candidate_count: (bypassCandidateEntries ?? []).length,
      }
      console.log(
        `[Analyze] Built scan ${result.scan.filename} — ${shortlistEntries.length} shortlist entries, ${(bypassCandidateEntries ?? []).length} bypass-eligible`
      )
    } catch (scanError) {
      console.error('[Analyze] Scan payload build failed:', scanError)
      result.scan = { ok: false, error: scanError.message }
    }

    return Response.json(result)
  } catch (error) {
    console.error('Analysis error:', error)
    return Response.json(
      { error: 'Analysis failed', details: error.message },
      { status: 500 }
    )
  }
}

function buildFullPrompt(formData, marketPulse, livePrices = {}, scannerResults = null) {
  const hasUserWatchlist = formData.watchlist && formData.watchlist.trim().length > 0
  const scannerWatchlist = scannerResults?.results?.watchlist || []
  const scannerDevelopingTickers = scannerWatchlist.slice(0, 5).map(s => s.ticker).join('\n')
  const hasScannerDeveloping = scannerDevelopingTickers.length > 0
  const hasPositions = formData.openPositions && formData.openPositions.trim().length > 0
  const dayTradeData = scannerResults?.results?.dayTrades || { candidates: [], excluded: [], summary: {} }
  const hasLivePrices = livePrices && Object.keys(livePrices).length > 0

  // Compact live-prices table (context only — the new JSON contract uses
  // numeric trigger_low/trigger_high, so no long prose rules are needed).
  let livePricesSection = ''
  if (hasLivePrices) {
    const fmtPrice = (p) => {
      const ccy = p.currency || 'USD'
      const px = ccy === 'GBp' ? `${p.price?.toFixed(0)}p`
        : ccy === 'GBP' ? `£${p.price?.toFixed(2)}`
        : `$${p.price?.toFixed(2)}`
      return `| ${p.ticker} | ${px} | ${p.change} (${p.changePercent}) | ${ccy} |`
    }
    livePricesSection = `
## LIVE PRICES (Yahoo Finance — use these exact values for trigger zones)

| Ticker | Price | Change | Currency |
|--------|-------|--------|----------|
${Object.values(livePrices).map(fmtPrice).join('\n')}

Rule: trigger_low/trigger_high must be within ±3% of the current price above.
If a ticker has already moved significantly, return verdict "WATCHLIST".

`
  }

  return `# Swing Committee — Lean Scan Prompt

You are the Swing Committee for TheMoneyProgram (UK/US swing trading). You assess
pre-scored scanner candidates against six-pillar discipline (Livermore, O'Neil,
Minervini, Darvas, Raschke, Sector RS) and return a structured JSON verdict.

- Education-only decision support. The user makes the final call.
- Risk per trade: ${formData.riskPerTrade}% of £${formData.accountSize} account
  (max £${(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)} per position).
- Max ${formData.maxPositions} concurrent positions, portfolio heat ceiling ${formData.maxHeat}%.
- Short selling: ${formData.shortSellingAllowed ? 'allowed' : 'DISALLOWED — do not emit SHORT trades'}.
- Trade mode: Short-Term Momentum Swing (1–3 days).
- Grade ladder: A+ (85%+), A (75–84%), B (65–74%), C (<65%), D (gate-blocked).
  Pillars required to pass: 3 of 6.

---

## Session context

| Field | Value |
|-------|-------|
| Session Type | ${formData.sessionType} |
| UK Regime | ${scannerResults?.regimeGate?.ukRegimeState || 'YELLOW'} (MCL) |
| US Regime | ${scannerResults?.regimeGate?.usRegimeState || 'YELLOW'} (MCL) |
| Regime Source | ${scannerResults?.regimeGate?.source || 'LEGACY'} |
| UK Market | FTSE 100 @ ${marketPulse.uk.price?.toLocaleString() || 'N/A'} — MA50 ${marketPulse.uk.ma50?.toFixed(0) || 'N/A'} / MA200 ${marketPulse.uk.ma200?.toFixed(0) || 'N/A'} — score ${marketPulse.uk.score}/10 — ${marketPulse.uk.regime} |
| US Market | S&P 500 @ ${marketPulse.us.price?.toLocaleString() || 'N/A'} — MA50 ${marketPulse.us.ma50?.toFixed(0) || 'N/A'} / MA200 ${marketPulse.us.ma200?.toFixed(0) || 'N/A'} — score ${marketPulse.us.score}/10 — ${marketPulse.us.regime} |

## Instruments in play
${[formData.ukStocks && '- UK Stocks', formData.usStocks && '- US Stocks', formData.indices && '- Indices', formData.forex && '- Forex', formData.crypto && '- Crypto'].filter(Boolean).join('\n')}

---

${hasPositions ? `## Current open positions

${formData.openPositions}

Format per line: Ticker, Entry_Date, Entry_Price, Shares/£pp, Current_Stop.
Include these in \`positionReviews\` below with a HOLD / TRAIL / PARTIAL / CLOSE / ADD action.` : '## Current open positions\n\nNone.'}

---

${buildScannerGateSection(scannerResults)}

${hasUserWatchlist ? `## User watchlist (evaluate each)

${formData.watchlist}

${livePricesSection}` : ''}

${hasScannerDeveloping ? `## Scanner developing stocks (brief)

${scannerDevelopingTickers}

Mention only the strongest — developing setups are typically WATCHLIST verdicts.` : ''}

---

## Day-1 intraday candidates (pre-scored, HARD CONSTRAINTS)

${buildDayTradeCandidatesSection(dayTradeData)}

Day-trade rules:
- A-GRADE: stop = 0.3 iATR, target = 0.5 iATR. B-GRADE: 0.4 / 0.5.
- You MUST copy these distances exactly. Do not recalculate stops/targets.
- Only stocks scoring ≥10/16 qualify. Never upgrade a sub-10 stock to a day trade.
- Committee acceptance: Aggressive takes A+B; Balanced/Defensive take A only.

---

# OUTPUT CONTRACT

Respond with a **single JSON object** matching the schema below. No preamble,
no narrative parts, no PART sections, no commentary outside the JSON. Plain
JSON or wrapped in a \`\`\`json fence — both are accepted. Any other output
format is a hard failure.

Every trade MUST include:
- \`rationale_one_liner\` ≤140 chars (the ONLY prose field) explaining the grade.
- \`trigger_low\` / \`trigger_high\` as numbers (not strings, no currency symbol).
- \`stop\` and \`target\` as numbers.
- \`verdict\` from the enum below.

## Schema

\`\`\`json
{
  "committee": "WATCH" | "TAKE" | "STAND_ASIDE",
  "summary": "≤200 char one-liner of the overall committee stance",
  "trades": [
    {
      "ticker": "AMD",
      "direction": "LONG",
      "grade": "A+",
      "verdict": "TAKE-TRADE",
      "trigger_low": 155.20,
      "trigger_high": 158.40,
      "stop": 150.00,
      "target": 170.00,
      "rationale_one_liner": "5/6 pillars, VCP breakout on 1.8x volume, sector RS top decile"
    }
  ],
  "positionReviews": [],
  "positionSummary": null
}
\`\`\`

- \`committee\` — WATCH (hold fire), TAKE (execute the listed trades), STAND_ASIDE (no action).
- \`summary\` — one plain sentence ≤200 chars. No markdown.
- \`trades[]\` — every scanner-approved candidate plus any developing-stock ticker
  you rate. Include WATCHLIST entries with \`verdict: "WATCHLIST"\` so the UI can
  show them. Grade D = gate-blocked (earnings, regime, liquidity) — include with
  \`verdict: "SKIP"\`.
- \`verdict\` enum: "TAKE-TRADE" | "WATCHLIST" | "DAY-TRADE" | "SKIP".
- \`direction\` enum: "LONG" | "SHORT".
- \`grade\` enum: "A+" | "A" | "B" | "C" | "D".
- \`positionReviews\` — empty array when no open positions. When populated, each
  entry is { ticker, direction, entry, currentPrice, pnlPercent, daysHeld,
  pillarStatus, action (HOLD/TRAIL/EXIT/PARTIAL/ADD), stop, newStop, target,
  assessment } and \`positionSummary\` is a one-line roll-up.
`
}

/**
 * Build Day-1 Capture Module section for the AI prompt.
 * Shows pre-scored day trade candidates with their 9-factor scores and trade levels.
 */
function buildDayTradeCandidatesSection(dayTradeData) {
  if (!dayTradeData || !dayTradeData.candidates || dayTradeData.candidates.length === 0) {
    const summary = dayTradeData?.summary || {}
    const assessed = summary.total_candidates_assessed || 0
    if (assessed === 0) return 'No day trade candidates assessed (scanner may not have run).\n'
    return `Day-1 Scoring: ${assessed} stocks assessed — none qualified (min score: 10/16).\n`
  }

  const { candidates, excluded, summary, vix } = dayTradeData
  let section = ''

  // Summary line
  section += `**Day-1 Scoring Summary:** ${summary.total_candidates_assessed} assessed → `
  section += `${summary.a_grade} A-GRADE, ${summary.b_grade} B-GRADE`
  if (summary.excluded_low_score) section += `, ${summary.excluded_low_score} below threshold`
  if (summary.excluded_liquidity) section += `, ${summary.excluded_liquidity} liquidity fails`
  if (summary.excluded_air_pocket) section += `, ${summary.excluded_air_pocket} air pocket blocks`
  section += `\n**VIX:** ${vix || '?'}\n\n`

  // Each candidate
  for (const c of candidates) {
    const fs = c.factor_scores || {}
    const sn = c.scoring_notes || {}
    const tm = c.trade_management || {}
    const ps = c.position_sizing || {}
    const sp = tm.stop_progression || {}

    section += `### ${c.ticker} — ${c.direction} — ${c.tier} (${c.total_score}/16)\n`
    section += `**Sector:** ${c.sector} | **Source:** ${c.source} | **Market:** ${c.market}\n`
    section += `**Factor Breakdown:**\n`
    section += `  1. Gap Alignment: ${fs.gap_alignment}/2 — ${sn.gap_note || ''}\n`
    section += `  2. Pre-Market Volume: ${fs.premarket_volume}/2 — ${sn.volume_note || ''}\n`
    section += `  3. Catalyst Presence: ${fs.catalyst_presence}/2 — ${sn.catalyst_detail || ''}\n`
    section += `  4. Technical Level: ${fs.technical_level}/2 — ${sn.technical_note || ''}\n`
    section += `  5. Momentum Consistency: ${fs.momentum_consistency}/2 — ${sn.momentum_note || ''}\n`
    section += `  6. Spread & Liquidity: ${fs.spread_liquidity}/2 — ${sn.liquidity_note || ''}\n`
    section += `  7. Relative Strength: ${fs.relative_strength}/2 — ${sn.rs_note || ''}\n`
    section += `  8. VWAP Alignment: ${fs.vwap_alignment}/1 — ${sn.vwap_note || ''}\n`
    section += `  9. Sector Momentum: ${fs.sector_momentum}/1 — ${sn.sector_note || ''}\n`
    section += `**iATR:** ${c.atr?.intraday_5min_14?.toFixed(2) || '?'} (daily ATR: ${c.atr?.daily_14?.toFixed(2) || '?'}) ${c.atr?.iatr_is_estimate ? '(estimated 0.65x fallback)' : ''}\n`
    section += `**Entry Type:** ${c.entry_zone?.type?.replace(/_/g, ' ') || 'OR breakout'}\n`
    section += `**Stop:** ${tm.stop?.toFixed(2) || '?'} (${tm.stop_distance_iatr} iATR = ${tm.stop_distance_price?.toFixed(2) || '?'} pts)\n`
    section += `**Target:** ${tm.target?.toFixed(2) || '?'} (${tm.target_distance_iatr} iATR = ${tm.target_distance_price?.toFixed(2) || '?'} pts)\n`
    section += `**R:R:** ${tm.target_rr_headline}:1\n`
    if (tm.target_capped_by) {
      section += `**Target capped by:** ${tm.target_capped_by.source} at ${tm.target_capped_by.level?.toFixed(2)}\n`
    }
    section += `**Stop Progression:** BREAKEVEN at +0.25 iATR → LOCK +0.15 at +0.35 → CLOSE +0.30 at +0.45 → TARGET at +0.50\n`
    section += `**Friction:** ${tm.friction?.friction_offset?.toFixed(2) || '?'} (${tm.friction?.note || ''})\n`
    section += `**Position:** Risk ${ps.effective_risk_pct}% = £${ps.effective_risk?.toFixed(0) || '?'} → £${ps.pounds_per_point?.toFixed(2) || '?'}/point\n`
    if (c.sr_ladder?.vwap_bias) {
      section += `**VWAP:** ${c.sr_ladder.vwap_prior_session?.toFixed(2) || 'N/A'} (${c.sr_ladder.vwap_bias})\n`
    }
    if (c.crabel_early_entry?.eligible) {
      section += `**Crabel Early Entry:** ELIGIBLE — ${c.crabel_early_entry.reason}\n`
    }
    section += '\n'
  }

  return section
}

/**
 * Build scanner gate section for the AI prompt.
 * When the scanner has already run, this tells Claude which tickers passed/failed
 * the quantitative pillar scoring so the AI doesn't override the scanner's gating.
 */
function buildScannerGateSection(scannerResults) {
  if (!scannerResults || !scannerResults.results) {
    return ''
  }

  const { results, regimeGate, thresholds } = scannerResults
  const longs = results.long || []
  const shorts = results.short || []
  const watchlist = results.watchlist || []

  const regimeState = regimeGate?.regimeState || 'UNKNOWN'

  let section = `# ⚠️ SCANNER GATE — QUANTITATIVE PRE-SCREENING RESULTS
# These results are from our automated Six Pillars scanner that ran on live market data.
# The scanner uses coded pillar scoring (not qualitative assessment) and regime gating.
# YOU MUST RESPECT THESE RESULTS. Do not upgrade a WATCHLIST ticker to TAKE TRADE.

**Regime State:** ${regimeState}
**Long threshold:** ${thresholds?.long?.score || '?'}%+ score, ${thresholds?.long?.pillars || '?'}+ pillars
**Short threshold:** ${thresholds?.short?.score || '?'}%+ score, ${thresholds?.short?.pillars || '?'}+ pillars

`

  if (longs.length > 0) {
    section += `## SCANNER-APPROVED LONGS (these CAN be TAKE TRADE)\n`
    longs.forEach(s => {
      const nameStr = s.name && s.name !== s.ticker ? ` (${s.name})` : ''
      section += `- ${s.ticker}${nameStr}: Score ${s.score?.toFixed(0)}%, Tier ${s.setupTier || '?'}, R:R ${s.tradeManagement?.riskRewardRatio || '?'}:1\n`
    })
    section += '\n'
  } else {
    section += `## SCANNER-APPROVED LONGS: NONE\nNo tickers passed the long threshold. Do NOT issue TAKE TRADE for any long.\n\n`
  }

  if (shorts.length > 0) {
    section += `## SCANNER-APPROVED SHORTS (these CAN be TAKE TRADE)\n`
    shorts.forEach(s => {
      const nameStr = s.name && s.name !== s.ticker ? ` (${s.name})` : ''
      section += `- ${s.ticker}${nameStr}: Score ${s.score?.toFixed(0)}%, Tier ${s.setupTier || '?'}, R:R ${s.tradeManagement?.riskRewardRatio || '?'}:1\n`
    })
    section += '\n'
  } else {
    section += `## SCANNER-APPROVED SHORTS: NONE\nNo tickers passed the short threshold. Do NOT issue TAKE TRADE for any short.\n\n`
  }

  if (watchlist.length > 0) {
    section += `## SCANNER WATCHLIST (WATCHLIST for swing — evaluate for DAY TRADE)\n`
    watchlist.forEach(s => {
      const nameStr = s.name && s.name !== s.ticker ? ` (${s.name})` : ''
      section += `- ${s.ticker}${nameStr}: Score ${s.score?.toFixed(0)}%, Price ${s.price || '?'} (${s.currency || '?'})\n`
      if (s.nearestSupport) {
        section += `  Support: ${s.nearestSupport.level} (${s.nearestSupport.type}, ${s.nearestSupport.distanceR}R away)\n`
      }
      if (s.nearestResistance) {
        section += `  Resistance: ${s.nearestResistance.level} (${s.nearestResistance.type}, ${s.nearestResistance.distanceR}R away)\n`
      }
      section += `  ATR: ${s.atr != null ? Number(s.atr).toFixed(2) : '?'}% (${s.atrRaw != null ? Number(s.atrRaw).toFixed(2) : '?'} pts), Vol Ratio: ${s.volumeRatio != null ? Number(s.volumeRatio).toFixed(2) : '?'}, RSI: ${s.rsi != null ? Number(s.rsi).toFixed(0) : '?'}, Mom5d: ${s.momentum5d != null ? Number(s.momentum5d).toFixed(2) : '?'}%\n`
      if (s.earningsDate) {
        const d = s.daysUntilEarnings
        const label = d > 0 ? `in ${d} day${d > 1 ? 's' : ''}` : d === 0 ? 'TODAY' : `${Math.abs(d)} day${Math.abs(d) > 1 ? 's' : ''} ago`
        section += `  ⚠️ EARNINGS: ${s.earningsDate} (${label}) — DO NOT TRADE\n`
      }

      // ── TRADE STAGE SCORING ──
      const market = s.ticker?.endsWith('.L') ? 'uk' : 'us'
      const mktThresh = thresholds?.[market] || thresholds
      const longThresh = mktThresh?.long || thresholds?.long || {}
      const shortThresh = mktThresh?.short || thresholds?.short || {}

      // Determine the best-side scores for this stock
      const bestScore = s.score ?? 0
      const longPassing = s.longPassing ?? 0
      const shortPassing = s.shortPassing ?? 0
      const hasLongSignal = (s.priceVsMa20 > 0) || (s.momentum5d > 0)
      const hasShortSignal = (s.priceVsMa20 < 0) || (s.momentum5d < 0)

      section += `  TRADE STAGE SCORING:\n`

      // Stage 1: Direction — needs >= 4 pillars, >= 50% score, directional signal
      const longS1 = longPassing >= 4 && (s.longScore ?? 0) >= 50 && hasLongSignal
      const shortS1 = shortPassing >= 4 && (s.shortScore ?? 0) >= 50 && hasShortSignal
      if (longS1 || shortS1) {
        section += `    Stage 1 (Direction): PASS — ${longS1 ? 'LONG' : ''}${longS1 && shortS1 ? '/' : ''}${shortS1 ? 'SHORT' : ''} signal assigned\n`
      } else {
        const reasons = []
        if (!hasLongSignal && !hasShortSignal) reasons.push('no directional signal')
        if (longPassing < 4 && shortPassing < 4) reasons.push(`pillars: ${Math.max(longPassing, shortPassing)}/4`)
        const bestSideScore = Math.max(s.longScore ?? 0, s.shortScore ?? 0)
        if (bestSideScore < 50) reasons.push(`score: ${bestSideScore.toFixed(0)}%/50%`)
        section += `    Stage 1 (Direction): FAIL — ${reasons.join(', ')}\n`
      }

      // Stage 2: S/R Air Pocket Gate
      if (s.srDemotion) {
        section += `    Stage 2 (S/R Gate): FAIL — ${s.originalDirection || '?'} blocked by S/R air pocket (insufficient room to target)\n`
      } else if (longS1 || shortS1) {
        section += `    Stage 2 (S/R Gate): PASS\n`
      } else {
        section += `    Stage 2 (S/R Gate): N/A (did not reach Stage 2)\n`
      }

      // Stage 3: Regime Gate — score and pillar thresholds
      if (s.earningsWarning) {
        section += `    Stage 3 (Regime Gate): N/A (blocked by earnings proximity)\n`
      } else if (s.volatilityWarning) {
        section += `    Stage 3 (Regime Gate): N/A (blocked by volatility spike)\n`
      } else if (!longS1 && !shortS1) {
        section += `    Stage 3 (Regime Gate): N/A (did not reach Stage 3)\n`
      } else {
        const s3Reasons = []
        if (longS1) {
          const scoreOk = bestScore >= (longThresh.score || 70)
          const pillarOk = longPassing >= (longThresh.pillars || 4)
          if (!scoreOk) s3Reasons.push(`long score ${bestScore.toFixed(0)}% < ${longThresh.score || 70}%`)
          if (!pillarOk) s3Reasons.push(`long pillars ${longPassing} < ${longThresh.pillars || 4}`)
        }
        if (shortS1) {
          const scoreOk = bestScore >= (shortThresh.score || 70)
          const pillarOk = shortPassing >= (shortThresh.pillars || 4)
          if (!scoreOk) s3Reasons.push(`short score ${bestScore.toFixed(0)}% < ${shortThresh.score || 70}%`)
          if (!pillarOk) s3Reasons.push(`short pillars ${shortPassing} < ${shortThresh.pillars || 4}`)
        }
        if (s3Reasons.length > 0) {
          section += `    Stage 3 (Regime Gate): FAIL — ${s3Reasons.join(', ')}\n`
        } else if (s.srDemotion) {
          section += `    Stage 3 (Regime Gate): N/A (blocked at Stage 2)\n`
        } else {
          section += `    Stage 3 (Regime Gate): PASS (watchlisted for other reasons)\n`
        }
      }
    })
    section += `\n**IMPORTANT:** These watchlist tickers did NOT pass the scanner threshold for swing trades. `
    section += `Your swing verdict MUST be WATCHLIST, not TAKE TRADE.\n`
    section += `**ATR-BASED LEVELS:** When suggesting entry/stop/target for WATCHLIST signals, you MUST use the ATR (pts) value above:\n`
    section += `- Stop distance = 1.0 × ATR (pts) from entry. Do NOT use round numbers or arbitrary levels.\n`
    section += `- Target = 1.5–2.0 × ATR (pts) from entry.\n`
    section += `- Example: Price 9000p, ATR 150 pts → Stop ~8850p, Target ~9225-9300p.\n`
    section += `**However**, evaluate each for a DAY TRADE setup using the S/R and ATR data above.\n`
    section += `**EARNINGS EXCLUSION:** Do NOT suggest ANY trades (swing or day) for stocks with an earnings warning above.\n\n`
  }

  section += `---\n`
  return section
}

export function parseResponse(responseText, scannerResults = null) {
  const jsonData = extractJsonData(responseText)
  if (!jsonData) {
    throw new Error('LLM did not return valid JSON — scan aborted')
  }
  return {
    mode: jsonData.committee || 'STAND_ASIDE',
    summary: jsonData.summary || '',
    signals: convertJsonToSignals(jsonData, scannerResults),
    parsedPositions: jsonData.positionReviews || [],
    positionSummary: jsonData.positionSummary || null,
  }
}

// Extract JSON data block from response
function extractJsonData(text) {
  // Try 1: Standard ```json code block
  try {
    const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/i)
    if (jsonMatch && jsonMatch[1]) {
      const data = JSON.parse(jsonMatch[1].trim())
      console.log('[Analyze] Parsed JSON from ```json block')
      return data
    }
  } catch (error) {
    console.error('[Analyze] ```json block found but failed to parse:', error.message)
  }

  // Try 2: Any ``` code block that starts with {
  try {
    const codeMatch = text.match(/```\s*\n?(\{[\s\S]*?\})\n?```/)
    if (codeMatch && codeMatch[1]) {
      const data = JSON.parse(codeMatch[1].trim())
      console.log('[Analyze] Parsed JSON from generic ``` block')
      return data
    }
  } catch (error) {
    console.error('[Analyze] Generic code block parse failed:', error.message)
  }

  // Try 3: Bare JSON object containing "trades" key (no code fences)
  try {
    const bareMatch = text.match(/(\{[\s\S]*"trades"[\s\S]*\})/)
    if (bareMatch && bareMatch[1]) {
      // Clean common AI JSON errors: trailing commas before } or ]
      const cleaned = bareMatch[1].replace(/,\s*([}\]])/g, '$1')
      const data = JSON.parse(cleaned)
      console.log('[Analyze] Parsed JSON from bare object (no code fences)')
      return data
    }
  } catch (error) {
    console.error('[Analyze] Bare JSON parse failed:', error.message)
  }

  return null
}

// Convert JSON data to signals array format
// Legacy scanEmission filters on space-separated verdicts; the new LLM schema
// emits hyphenated tokens. Normalise on the way in so scanEmission stays
// untouched and downstream consumers see the canonical form.
function normaliseVerdict(v) {
  return (v || '').toUpperCase().replace(/-/g, ' ').trim()
}

export function convertJsonToSignals(jsonData, scannerResults = null) {
  const signals = []

  // Build authoritative ticker → company name lookup from scanner (Yahoo Finance data).
  // This overrides any hallucinated company names the AI may have produced.
  const tickerToName = new Map()
  if (scannerResults?.results) {
    const pools = [
      scannerResults.results.long || [],
      scannerResults.results.short || [],
      scannerResults.results.watchlist || [],
    ]
    for (const pool of pools) {
      for (const s of pool) {
        if (!s?.ticker || !s?.name || s.name === s.ticker) continue
        // Store under both full ticker (SMT.L) and stripped (SMT) for safe lookup
        tickerToName.set(s.ticker, s.name)
        tickerToName.set(s.ticker.replace('.L', ''), s.name)
      }
    }
  }
  const canonicalName = (ticker) => tickerToName.get(ticker) || tickerToName.get(ticker?.replace('.L', '')) || null

  // Convert trades to signals
  if (jsonData.trades && Array.isArray(jsonData.trades)) {
    for (const trade of jsonData.trades) {
      // Override AI's company field with canonical scanner name (defense against hallucination)
      const canonical = canonicalName(trade.ticker)
      if (canonical && trade.tradeAnalysis) {
        trade.tradeAnalysis.company = canonical
      }
      // Build comprehensive rawSection from tradeAnalysis
      let rawSection = buildTradeAnalysisText(trade)

      const tLow = typeof trade.trigger_low === 'number' ? trade.trigger_low : null
      const tHigh = typeof trade.trigger_high === 'number' ? trade.trigger_high : null
      const entry = (tLow != null && tHigh != null) ? { low: tLow, high: tHigh } : trade.entry
      signals.push({
        ticker: trade.ticker?.replace('.L', ''),
        name: canonical || trade.ticker,
        direction: trade.direction?.toUpperCase() || 'LONG',
        verdict: normaliseVerdict(trade.verdict) || 'TAKE TRADE',
        entry,
        trigger_low: tLow,
        trigger_high: tHigh,
        stop: trade.stop,
        target: trade.target,
        grade: trade.grade,
        pillarCount: trade.pillarCount,
        setupType: trade.setupType || `${trade.direction?.toUpperCase() || 'BUY'} ${trade.direction?.toUpperCase() || 'LONG'}`,
        riskReward: trade.tradeAnalysis?.riskReward1 || null,
        rationale_one_liner: trade.rationale_one_liner || trade.tradeAnalysis?.rationale_one_liner || null,
        rawSection,
      })
    }
  }

  // Convert watchlist items to signals
  if (jsonData.watchlist && Array.isArray(jsonData.watchlist)) {
    for (const item of jsonData.watchlist) {
      // Override AI's company field with canonical scanner name
      const canonical = canonicalName(item.ticker)
      if (canonical) {
        item.company = canonical
      }
      // Build comprehensive rawSection for watchlist items
      let rawSection = buildWatchlistAnalysisText(item)

      // Direction: prefer the LLM's explicit field. If absent, infer from
      // the stop vs entry-zone relationship (stop below = LONG, stop above =
      // SHORT). This keeps bypass downloads working — the emitter in
      // lib/scanEmission.js rejects any signal whose direction isn't LONG or
      // SHORT, and a hardcoded 'WATCHLIST ONLY' string used to drain the
      // bypass pool on days when only WATCHLIST verdicts were produced.
      const inferDirection = () => {
        if (typeof item.direction === 'string') {
          const d = item.direction.toUpperCase()
          if (d === 'LONG' || d === 'SHORT') return d
        }
        const entry = item.potentialEntry
        const stop = typeof item.potentialStop === 'number'
          ? item.potentialStop
          : parseFloat(String(item.potentialStop ?? '').replace(/[£$,]/g, ''))
        if (!Number.isFinite(stop) || entry == null) return 'LONG'
        const nums = String(entry).replace(/[£$,]/g, '').match(/-?\d+\.?\d*/g) || []
        const zoneVals = nums.map(Number).filter(Number.isFinite)
        if (zoneVals.length === 0) return 'LONG'
        const zoneLow = Math.min(...zoneVals)
        const zoneHigh = Math.max(...zoneVals)
        if (stop < zoneLow) return 'LONG'
        if (stop > zoneHigh) return 'SHORT'
        return 'LONG'
      }

      const wLow = typeof item.trigger_low === 'number' ? item.trigger_low : null
      const wHigh = typeof item.trigger_high === 'number' ? item.trigger_high : null
      const wEntry = (wLow != null && wHigh != null)
        ? { low: wLow, high: wHigh }
        : (item.potentialEntry || null)
      signals.push({
        ticker: item.ticker?.replace('.L', ''),
        name: canonical || item.ticker,
        direction: inferDirection(),
        verdict: 'WATCHLIST',
        entry: wEntry,
        trigger_low: wLow,
        trigger_high: wHigh,
        stop: item.potentialStop || item.stop || null,
        target: item.potentialTarget || item.target || null,
        grade: item.grade || null,
        pillarCount: item.pillarCount || null,
        setupType: item.note?.substring(0, 50) || 'Watchlist',
        riskReward: null,
        rationale_one_liner: item.rationale_one_liner || null,
        rawSection,
      })
    }
  }

  // Convert day trades to signals (Day-1 Capture Module format)
  if (jsonData.dayTrades && Array.isArray(jsonData.dayTrades)) {
    for (const dt of jsonData.dayTrades) {
      const canonical = canonicalName(dt.ticker)
      if (canonical) {
        dt.company = canonical
      }
      let rawSection = buildDayTradeAnalysisText(dt)

      const dLow = typeof dt.trigger_low === 'number' ? dt.trigger_low : null
      const dHigh = typeof dt.trigger_high === 'number' ? dt.trigger_high : null
      const dEntry = (dLow != null && dHigh != null) ? { low: dLow, high: dHigh } : dt.entry
      signals.push({
        ticker: dt.ticker?.replace('.L', ''),
        name: canonical || dt.ticker,
        direction: dt.direction?.toUpperCase() || 'LONG',
        verdict: normaliseVerdict(dt.verdict) || 'DAY TRADE',
        entry: dEntry,
        trigger_low: dLow,
        trigger_high: dHigh,
        stop: dt.stop,
        target: dt.target,
        grade: dt.tier || null,
        pillarCount: dt.totalScore || null,
        setupType: `Day Trade: ${dt.entryType?.replace(/_/g, ' ') || dt.setup || 'Intraday'}`,
        riskReward: dt.riskReward || null,
        // Day-1 specific fields
        tier: dt.tier || null,
        totalScore: dt.totalScore || null,
        iATR: dt.iATR || null,
        entryType: dt.entryType || null,
        vwapBias: dt.vwapBias || null,
        crabelEligible: dt.crabelEligible || false,
        rationale_one_liner: dt.rationale_one_liner || null,
        rawSection,
      })
    }
  }

  return signals
}

// Build formatted day trade analysis text from JSON data (Day-1 Capture Module format)
function buildDayTradeAnalysisText(dt) {
  const sb = dt.spreadBetSizing || {}

  let text = `### DAY TRADE: ${dt.ticker} — ${dt.direction || 'LONG'}\n\n`

  // Tier badge
  if (dt.tier) {
    text += `**${dt.tier}** — Day-1 Score: ${dt.totalScore || '?'}/16\n\n`
  }

  text += `**TYPE:** Intraday Only — CLOSE BY END OF DAY\n\n`
  text += `**SETUP:** ${dt.setup || 'Day-1 scored intraday setup'}\n\n`

  // Qualitative assessment from AI
  if (dt.qualitativeAssessment) {
    text += `**ASSESSMENT:** ${dt.qualitativeAssessment}\n\n`
  }

  // Entry type
  if (dt.entryType) {
    text += `**ENTRY TYPE:** ${dt.entryType.replace(/_/g, ' ').toUpperCase()}\n\n`
  }

  text += `**LEVELS:**\n`
  text += `- Entry: ${dt.entry || 'N/A'}\n`
  text += `- Stop: ${dt.stop || 'N/A'}\n`
  text += `- Target: ${dt.target || 'N/A'} (single target — close 100%)\n`
  text += `- Risk:Reward: ${dt.riskReward || 'N/A'}\n\n`

  // iATR and VWAP
  if (dt.iATR) {
    text += `**iATR:** ${dt.iATR}\n`
  }
  if (dt.vwapBias) {
    text += `**VWAP Bias:** ${dt.vwapBias}\n`
  }
  text += '\n'

  // Stop Progression
  text += `**STOP PROGRESSION (Aggressive Ladder):**\n`
  text += `- BREAKEVEN: Move to entry + friction when +0.25 iATR (50% of target)\n`
  text += `- LOCK: Lock 0.15 iATR profit when +0.35 iATR (70%)\n`
  text += `- CLOSE: Lock 0.30 iATR profit when +0.45 iATR (90%)\n`
  text += `- TARGET: Close 100% at +0.50 iATR\n\n`

  // Crabel
  if (dt.crabelEligible) {
    text += `**CRABEL EARLY ENTRY:** ELIGIBLE — can enter before OR established\n\n`
  }

  // Spread bet sizing
  if (sb.poundsPerPoint) {
    text += `**SPREAD BET SIZING:**\n`
    text += `- £ per Point: ${sb.poundsPerPoint}\n`
    text += `- Stop Distance: ${sb.stopDistance || 'N/A'}\n`
    text += `- Risk Amount: ${sb.riskAmount || 'N/A'}\n\n`
  }

  // Risk factors
  if (dt.riskFactors && dt.riskFactors.length > 0) {
    text += `**RISK FACTORS:**\n`
    for (const risk of dt.riskFactors) {
      text += `- ${risk}\n`
    }
    text += '\n'
  }

  return text
}

// Build formatted trade analysis text from JSON data
function buildTradeAnalysisText(trade) {
  const a = trade.tradeAnalysis || {}
  const p = a.pillars || {}
  const std = a.standardSizing || {}
  const sb = a.spreadBetSizing || {}

  let text = `### TRADE SIGNAL: ${trade.ticker}\n\n`

  // Company info
  if (a.company) {
    text += `COMPANY: ${a.company}\n`
    text += `SECTOR: ${a.sector || 'N/A'}\n`
    text += `MARKET CAP: ${a.marketCap || 'N/A'}\n`
    text += `AVG VOLUME: ${a.avgVolume || 'N/A'}\n\n`
  }

  // Setup identification
  text += `**SETUP IDENTIFICATION:**\n`
  text += `- Direction: ${trade.direction || 'LONG'}\n`
  text += `- Setup Type: ${trade.setupType || 'N/A'}\n`
  text += `- Timeframe: ${a.timeframe || 'Short-Term Swing'}\n`
  text += `- Confidence: ${a.confidence || 'Medium'}\n\n`

  // Levels
  text += `**LEVELS:**\n`
  text += `- Current Price: ${a.currentPrice || 'N/A'}\n`
  text += `- Entry Zone: ${trade.entry || 'N/A'}\n`
  text += `- Stop Loss: ${trade.stop || 'N/A'} (${a.stopPercent || 'N/A'} risk)\n`
  text += `- Target 1: ${trade.target || 'N/A'} (R:R ${a.riskReward1 || 'N/A'}) — take 50%\n`
  if (a.target2) {
    text += `- Target 2: ${a.target2} (R:R ${a.riskReward2 || 'N/A'}) — trail remainder\n`
  }
  text += `\n`

  // Standard position sizing
  if (std.accountRisk) {
    text += `**POSITION SIZING — STANDARD:**\n`
    text += `- Account Risk: ${std.accountRisk}\n`
    text += `- Risk per Share: ${std.dollarRiskPerShare || 'N/A'}\n`
    text += `- Position Size: ${std.positionSize || 'N/A'}\n`
    text += `- Position Value: ${std.positionValue || 'N/A'}\n`
    text += `- Portfolio Allocation: ${std.portfolioAllocation || 'N/A'}\n\n`
  }

  // Spread bet sizing
  if (sb.entryPoints) {
    text += `**POSITION SIZING — SPREAD BET:**\n`
    text += `- Entry: ${sb.entryPoints}\n`
    text += `- Stop: ${sb.stopPoints || 'N/A'}\n`
    text += `- Stop Distance: ${sb.stopDistance || 'N/A'}\n`
    text += `- £ per Point: ${sb.poundsPerPoint || 'N/A'}\n`
    text += `- Notional Exposure: ${sb.notionalExposure || 'N/A'}\n`
    text += `- Margin Required (~20%): ${sb.marginRequired || 'N/A'}\n\n`
  }

  // Six Pillars
  text += `**SIX PILLARS ALIGNMENT:**\n`
  const pillarNames = {
    livermore: 'LIVERMORE — Pivotal Point Timing',
    oneil: "O'NEIL — Participation Quality",
    minervini: 'MINERVINI — Trend Template',
    darvas: 'DARVAS — Volatility Expansion',
    raschke: 'RASCHKE — Momentum Speed',
    sectorRS: 'SECTOR RS — Relative Strength'
  }

  for (const [key, label] of Object.entries(pillarNames)) {
    const pillar = p[key]
    if (pillar) {
      const mark = pillar.pass ? '✓' : '✗'
      text += `[${mark}] ${label}: ${pillar.note || 'N/A'}\n`
    }
  }
  text += `\n**PILLAR COUNT:** ${trade.pillarCount || 0}/6 — ${(trade.pillarCount || 0) >= 3 ? 'PASS' : 'FAIL'}\n\n`

  // Catalyst and risks
  if (a.catalyst) {
    text += `**CATALYST:** ${a.catalyst}\n\n`
  }

  if (a.risks && a.risks.length > 0) {
    text += `**RISK FACTORS:**\n`
    a.risks.forEach((risk, i) => {
      text += `${i + 1}. ${risk}\n`
    })
    text += `\n`
  }

  // Grade and verdict
  text += `**GRADE:** ${trade.grade || 'N/A'}\n\n`
  text += `**VERDICT:** TAKE TRADE\n`

  return text
}

// Build formatted watchlist analysis text from JSON data
function buildWatchlistAnalysisText(item) {
  const p = item.pillars || {}

  let text = `### WATCHLIST: ${item.ticker}\n\n`

  // Company info if available
  if (item.company) {
    text += `COMPANY: ${item.company}\n`
  }
  if (item.sector) {
    text += `SECTOR: ${item.sector}\n`
  }
  text += `\n`

  // Status
  text += `**STATUS:** Watching for entry trigger\n\n`

  // Setup identification
  if (item.note || item.setupType) {
    text += `**SETUP:** ${item.setupType || ''} ${item.note ? `— ${item.note}` : ''}\n\n`
  }

  // Current situation
  text += `**CURRENT SITUATION:**\n`
  if (item.currentPrice) {
    text += `- Current Price: ${item.currentPrice}\n`
  }
  if (item.triggerLevel) {
    text += `- Trigger Level: ${item.triggerLevel}\n`
  }
  if (item.direction) {
    text += `- Direction Bias: ${item.direction}\n`
  }
  text += `\n`

  // Potential trade levels
  text += `**POTENTIAL TRADE LEVELS (if triggered):**\n`
  text += `- Entry Zone: ${item.potentialEntry || 'TBD on trigger'}\n`
  text += `- Stop Loss: ${item.potentialStop || 'TBD on trigger'}\n`
  text += `- Target: ${item.potentialTarget || 'TBD on trigger'}\n`
  text += `\n`

  // Six Pillars (if available)
  if (Object.keys(p).length > 0) {
    text += `**SIX PILLARS ASSESSMENT:**\n`
    const pillarNames = {
      livermore: 'LIVERMORE — Pivotal Point Timing',
      oneil: "O'NEIL — Participation Quality",
      minervini: 'MINERVINI — Trend Template',
      darvas: 'DARVAS — Volatility Expansion',
      raschke: 'RASCHKE — Momentum Speed',
      sectorRS: 'SECTOR RS — Relative Strength'
    }

    for (const [key, label] of Object.entries(pillarNames)) {
      const pillar = p[key]
      if (pillar) {
        const mark = pillar.pass ? '✓' : '✗'
        text += `[${mark}] ${label}: ${pillar.note || 'N/A'}\n`
      }
    }
    text += `\n`
  }

  // Pillar count
  if (item.pillarCount !== undefined) {
    text += `**PILLAR COUNT:** ${item.pillarCount}/6 — ${item.pillarCount >= 3 ? 'Would PASS on trigger' : 'Needs improvement'}\n\n`
  }

  // Grade
  if (item.grade) {
    text += `**POTENTIAL GRADE:** ${item.grade}\n\n`
  }

  // Reasoning
  if (item.reasoning) {
    text += `**REASONING:**\n${item.reasoning}\n\n`
  }

  // Catalyst / Waiting For
  if (item.waitingFor || item.catalyst) {
    text += `**WAITING FOR:** ${item.waitingFor || item.catalyst}\n\n`
  }

  // Trade Stage Scoring
  if (item.stageScoring) {
    text += `**TRADE STAGE SCORING:**\n`
    const stages = item.stageScoring.split('|').map(s => s.trim())
    stages.forEach(stage => {
      text += `  ${stage}\n`
    })
    text += `\n`
  }

  // Risks
  if (item.risks && item.risks.length > 0) {
    text += `**RISK FACTORS:**\n`
    item.risks.forEach((risk, i) => {
      text += `${i + 1}. ${risk}\n`
    })
    text += `\n`
  }

  text += `**VERDICT:** WATCHLIST — Monitor for entry trigger\n`

  return text
}

