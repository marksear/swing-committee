import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request) {
  try {
    const { formData, marketPulse } = await request.json()

    // Build the full Swing Committee prompt
    const prompt = buildFullPrompt(formData, marketPulse)

    // Call Claude API with extended token limit for comprehensive analysis
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    // Parse the response
    const responseText = message.content[0].text
    const result = parseResponse(responseText)

    return Response.json(result)
  } catch (error) {
    console.error('Analysis error:', error)
    return Response.json(
      { error: 'Analysis failed', details: error.message },
      { status: 500 }
    )
  }
}

function buildFullPrompt(formData, marketPulse) {
  const hasWatchlist = formData.watchlist && formData.watchlist.trim().length > 0
  const hasPositions = formData.openPositions && formData.openPositions.trim().length > 0

  return `# TheMoneyProgram — Swing Committee Analysis
## UK/US Swing Trading Mode
### Livermore • O'Neil • Minervini • Darvas • Raschke • Weinstein

You are an AI Swing Committee applying the Six Pillars framework to make disciplined swing trading decisions.

**Design goal:** Every swing trade must have *defined risk, clear entry/exit, and alignment with at least 3 of 6 masters*.

---

# EDUCATION-ONLY DISCLAIMER
This is educational decision-support for swing trading, not regulated advice. Swing trading involves substantial risk of loss. The user makes the final decision and bears all risk.

---

# THE SIX PILLARS OF SWING TRADING

## PILLAR 1: LIVERMORE — Pivotal Points & Timing
- Is this a natural reaction point? (breakout level, key support/resistance)
- Has the stock "proven itself" by breaking through resistance on volume?
- Is this the LINE OF LEAST RESISTANCE direction?
- Has consolidation been long enough?
- Are we chasing or catching?

## PILLAR 2: O'NEIL — CANSLIM & Leadership
- C: Current quarterly earnings (EPS acceleration or beat?)
- A: Annual earnings growth (3-year trend positive?)
- N: New product/management/high (Is there a catalyst? Breaking to new highs?)
- S: Supply & demand (Tight float? Volume on breakout?)
- L: Leader or laggard? (RS Rating 80+? Sector leader?)
- I: Institutional sponsorship (Smart money accumulating?)
- M: Market direction (Is the general market in uptrend?)
- Cut losses at 7-8% maximum, take partial profits at 20-25% gains
- Volume on breakout should be 50%+ above average

## PILLAR 3: MINERVINI — SEPA & Volatility Contraction
**Stage Analysis:**
- Stage 1: Basing/Accumulation — Watch, don't buy
- Stage 2: Advancing/Markup — BUY ZONE
- Stage 3: Topping/Distribution — Take profits, don't initiate
- Stage 4: Declining/Markdown — Avoid or short

**Trend Template (must pass 7/8):**
1. Stock price above 150-day MA
2. 150-day MA above 200-day MA
3. 200-day MA trending up for at least 1 month
4. 50-day MA above 150-day and 200-day MA
5. Stock price above 50-day MA
6. Stock price at least 25% above 52-week low
7. Stock price within 25% of 52-week high
8. Relative Strength rating 70+

**VCP:** Look for successive tightening of price ranges, volume contraction during consolidation, expansion on breakout

## PILLAR 4: DARVAS — Box Theory & Mechanical Discipline
- Identify the recent trading range (the "box")
- Buy ONLY when price breaks ABOVE the box top on increased volume
- Initial stop: just below the bottom of the box
- As price rises, raise stop to bottom of each new box
- NEVER move stop down, NEVER override the stop

## PILLAR 5: RASCHKE — Mean Reversion & Momentum
**Mean Reversion:** Look for overextended moves (2+ ATR from MA), wait for exhaustion, enter counter-trend with tight stop
**Momentum:** Look for strong directional thrust, buy the first pullback
**Market Mode:**
- Trending: Higher highs/lows, MA stacked — Momentum / buy pullbacks
- Choppy: Overlapping bars, no direction — Mean reversion / fade extremes
- Volatile: Wide ranges, gaps — Reduce size, wider stops

## PILLAR 6: WEINSTEIN — Stage Analysis & Weekly Charts
**Four Stages (Weekly Chart):**
- Stage 1: 30-week MA flattening, base forming — Watch for accumulation
- Stage 2: 30-week MA rising, higher highs/lows — BUY AND HOLD
- Stage 3: 30-week MA flattening/rolling — Take profits
- Stage 4: 30-week MA declining — AVOID or SHORT

**Buy Checklist:** Stock breaking out from Stage 1 base, 30-week MA turning UP, price ABOVE 30-week MA, RS line rising, volume surge on breakout week

---

# RISK MANAGEMENT (NON-NEGOTIABLE)

## Position Sizing
${formData.executionMode === 'spread_bet' ? `
**SPREAD BET MODE (UK Tax-Free):**
- Position sized in £ per point (not shares)
- 1 point = 1 penny movement for UK stocks, 1 cent for US stocks
- US stocks quoted in points (e.g., NVDA at 13800 = $138.00)
- £ per Point = Risk Amount / Stop Distance in Points
- Tax-free gains (classified as gambling)
- Broker: ${formData.spreadBetBroker}
` : `
**STANDARD MODE (Shares/CFDs):**
- Position Size = (Account × Risk %) / (Entry Price - Stop Price)
`}

## Key Limits
- Account Size: £${formData.accountSize}
- Risk per trade: ${formData.riskPerTrade}%
- Max risk per trade: £${(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)}
- Max positions: ${formData.maxPositions}
- Max portfolio heat: ${formData.maxHeat}%
- Leverage allowed: ${formData.leverageAllowed ? 'Yes (max ' + formData.maxLeverage + 'x)' : 'No'}
- Short selling allowed: ${formData.shortSellingAllowed ? 'Yes' : 'No'}
- Instruments: ${[formData.ukStocks && 'UK Stocks', formData.usStocks && 'US Stocks', formData.indices && 'Indices', formData.forex && 'Forex', formData.crypto && 'Crypto'].filter(Boolean).join(', ')}

---

# INPUTS FOR THIS SESSION

| Input | Value |
|-------|-------|
| Trade Mode | ${formData.tradeMode === 'position' ? 'Position Swing (1-4 weeks)' : 'Short-Term Swing (2-7 days)'} |
| Session Type | ${formData.sessionType} |
| User Sentiment | ${formData.marketSentiment}/10 |
| User Regime View | ${formData.regimeView} |
| Execution Mode | ${formData.executionMode === 'spread_bet' ? 'Spread Bet (UK Tax-Free)' : 'Standard (Shares/CFDs)'} |

**Market Pulse:**
- UK: ${marketPulse.uk.score}/10 (${marketPulse.uk.label}) — Regime: ${marketPulse.uk.regime}
- US: ${marketPulse.us.score}/10 (${marketPulse.us.label}) — Regime: ${marketPulse.us.regime}

---

${hasPositions ? `# CURRENT OPEN POSITIONS

${formData.openPositions}

**Format:** Ticker, Entry_Date, Entry_Price, Shares/£pp, Current_Stop

For each open position, provide:
- Current P&L assessment
- Pillar alignment status (still valid?)
- Recommended action: HOLD / TRAIL (new stop level) / PARTIAL (take %) / CLOSE / ADD

---` : '# CURRENT OPEN POSITIONS\n\nNo open positions.\n\n---'}

${hasWatchlist ? `# WATCHLIST TO ANALYZE

${formData.watchlist}

For each watchlist ticker, run the SWING SIGNAL PROTOCOL:
1. Company Snapshot (sector, market cap, avg volume)
2. Setup Identification (direction, setup type, timeframe, confidence)
3. Levels (entry zone, stop loss, targets)
4. Position Sizing (both Standard AND Spread Bet formats)
5. Six Pillars Alignment (check each pillar, need 3+ to pass)
6. Signal Quality Score and Grade (A+/A/B/C)
7. Risk Factors
8. Trade Management Plan

---` : ''}

# REQUIRED OUTPUT

## PART A — MARKET REGIME & MODE SELECTION

**UK Market Regime:** [Trending Up / Choppy / Volatile / Trending Down]
**US Market Regime:** [Trending Up / Choppy / Volatile / Trending Down]
**Overall Assessment:** [Brief market conditions summary]

**Committee Stance this session:** [Aggressive / Balanced / Defensive]
**Justification:** [Based on regime + user sentiment]

---

${hasPositions ? `## PART B — OPEN POSITIONS REVIEW

For each position:
| Ticker | Entry | Current | P&L | Days | Pillar Status | Action | New Stop |
|--------|-------|---------|-----|------|---------------|--------|----------|

**Position Summary:** [X positions reviewed, Y on track, Z flagged]
**Current Portfolio Heat:** [X]%
**Capacity for new trades:** [X more positions]

---` : ''}

${hasWatchlist ? `## PART C — WATCHLIST SIGNALS

For each watchlist stock:

### [TICKER] — [Company Name]

**Setup:** [Direction] — [Setup Type] — [Confidence: High/Medium/Low]

**Levels:**
| Level | Price | Points (Spread Bet) |
|-------|-------|---------------------|
| Entry Zone | £XX.XX - £XX.XX | XXXXX - XXXXX |
| Stop Loss | £XX.XX | XXXXX |
| Target 1 | £XX.XX (R:R X:1) | XXXXX |
| Target 2 | £XX.XX (R:R X:1) | XXXXX |

**Position Sizing:**
- Standard: [X shares at £XX, risk £XX]
- Spread Bet: [£X.XX per point at XXXXX, stop XXX points, risk £XX]

**Six Pillars Alignment:**
| Pillar | Pass/Fail | Assessment |
|--------|-----------|------------|
| Livermore | ✓/✗ | [Brief note] |
| O'Neil | ✓/✗ | [Brief note] |
| Minervini | ✓/✗ | [Brief note] |
| Darvas | ✓/✗ | [Brief note] |
| Raschke | ✓/✗ | [Brief note] |
| Weinstein | ✓/✗ | [Brief note] |

**Pillar Count:** [X]/6 — [PASS (≥3) / FAIL (<3)]
**Signal Grade:** [A+ / A / B / C]

**Verdict:** [TAKE TRADE / WATCHLIST / NO TRADE]

---` : ''}

## PART D — THREE COMMITTEE POSITIONS

### AGGRESSIVE POSITION
**Stance:** Take more signals, maximum exposure
**Trades:** [List with full details]
**Total Heat:** [X]%

### BALANCED POSITION
**Stance:** Only A/A+ setups, standard sizing
**Trades:** [List with full details]
**Total Heat:** [X]%

### DEFENSIVE POSITION
**Stance:** Only highest conviction, reduced size
**Trades:** [List with full details]
**Total Heat:** [X]%

---

## PART E — CHAIR'S DECISION

**Selected Committee:** [Aggressive / Balanced / Defensive]
**Rationale:** [Why this stance given current conditions]

**ACTION SUMMARY — "This session we will:"**

| Action | Ticker | Direction | Entry | Stop | Size | Risk |
|--------|--------|-----------|-------|------|------|------|
${formData.executionMode === 'spread_bet' ? '| [Format for spread bet: £/pt, points] |' : '| [Format for shares: qty, price] |'}

**Total New Risk:** £XX
**Portfolio Heat After:** X%

**Watchlist for next session:**
1. [Ticker] — [Brief setup note]
2. [Ticker] — [Brief setup note]

**Key Levels to Monitor:**
- [Index/stock level that changes stance]

---

## PART F — DECISION JOURNAL

| Field | Entry |
|-------|-------|
| Date | ${new Date().toISOString().split('T')[0]} |
| Session Type | ${formData.sessionType} |
| Committee Stance | [Selected] |
| Trades | [List] |
| Portfolio Heat | [X]% |
| Market Regime | [UK: X / US: X] |
| 1-sentence thesis | "..." |
| Key risk | ... |
| What changes my mind | ... |
| Confidence | Low / Medium / High |

---

## PILLAR REMINDER

[Include one relevant quote from the Six Masters based on current market conditions]

---

Be specific and practical. For each trade signal, provide BOTH Standard (shares) AND Spread Bet (£/point) sizing. Mark any data that needs verification as **NEEDS CHECK**.`
}

function parseResponse(responseText) {
  const result = {
    mode: extractCommitteeStance(responseText),
    summary: extractSummary(responseText),
    signals: extractSignals(responseText),
    marketRegime: extractSection(responseText, 'PART A', 'PART B') || extractSection(responseText, 'MARKET REGIME', 'PART B'),
    positionsReview: extractSection(responseText, 'PART B', 'PART C') || extractSection(responseText, 'OPEN POSITIONS REVIEW', 'PART C'),
    watchlistSignals: extractSection(responseText, 'PART C', 'PART D') || extractSection(responseText, 'WATCHLIST SIGNALS', 'PART D'),
    committeePositions: extractSection(responseText, 'PART D', 'PART E') || extractSection(responseText, 'THREE COMMITTEE POSITIONS', 'PART E'),
    chairDecision: extractSection(responseText, 'PART E', 'PART F') || extractSection(responseText, "CHAIR'S DECISION", 'PART F'),
    decisionJournal: extractSection(responseText, 'PART F', 'PILLAR REMINDER') || extractSection(responseText, 'DECISION JOURNAL', null),
    pillarReminder: extractSection(responseText, 'PILLAR REMINDER', null),
    fullAnalysis: responseText
  }

  return result
}

function extractCommitteeStance(text) {
  const stancePatterns = [
    /Committee Stance[:\s]*(Aggressive|Balanced|Defensive)/i,
    /Selected Committee[:\s]*(Aggressive|Balanced|Defensive)/i,
    /\*\*Stance\*\*[:\s]*(Aggressive|Balanced|Defensive)/i,
    /(AGGRESSIVE|BALANCED|DEFENSIVE)\s*(?:POSITION|COMMITTEE)/i
  ]

  for (const pattern of stancePatterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
    }
  }
  return 'Balanced'
}

function extractSummary(responseText) {
  // Try to get the chair's action summary
  const chairMatch = responseText.match(/This session we will:[\s\S]*?(?=\*\*Total|\*\*Watchlist|---|\n\n\*\*)/i)
  if (chairMatch) {
    return chairMatch[0].trim()
  }

  // Fallback to first substantial paragraph
  const paragraphs = responseText.split('\n\n').filter(p => p.length > 100)
  return paragraphs[0]?.substring(0, 500) || 'Analysis complete. Review full report below.'
}

function extractSection(text, startMarker, endMarker) {
  const startPatterns = [
    new RegExp(`## ${startMarker}[\\s\\S]*?(?=## ${endMarker}|$)`, 'i'),
    new RegExp(`### ${startMarker}[\\s\\S]*?(?=### ${endMarker}|## ${endMarker}|$)`, 'i'),
    new RegExp(`${startMarker}[\\s\\S]*?(?=${endMarker}|$)`, 'i')
  ]

  for (const pattern of startPatterns) {
    const match = text.match(pattern)
    if (match) {
      return match[0].trim()
    }
  }
  return null
}

function extractSignals(text) {
  const signals = []

  // Look for signal sections with ticker headers
  const tickerMatches = text.matchAll(/###\s*\[?([A-Z0-9]{2,6})\]?\s*[-—]\s*([^\n]+)/g)
  for (const match of tickerMatches) {
    const ticker = match[1]
    const name = match[2].trim()

    // Find the section for this ticker
    const sectionStart = match.index
    const sectionEnd = text.indexOf('###', sectionStart + 1)
    const section = text.substring(sectionStart, sectionEnd > 0 ? sectionEnd : sectionStart + 2000)

    // Extract grade
    const gradeMatch = section.match(/Signal Grade[:\s]*\*?\*?([A-C]\+?)/i)
    const grade = gradeMatch ? gradeMatch[1] : null

    // Extract verdict
    const verdictMatch = section.match(/Verdict[:\s]*\*?\*?(TAKE TRADE|WATCHLIST|NO TRADE)/i)
    const verdict = verdictMatch ? verdictMatch[1] : null

    // Extract pillar count
    const pillarMatch = section.match(/Pillar Count[:\s]*\*?\*?(\d)\/6/i)
    const pillarCount = pillarMatch ? parseInt(pillarMatch[1]) : null

    // Extract entry zone
    const entryMatch = section.match(/Entry Zone[:\s|]*£?([\d.]+)\s*[-–]\s*£?([\d.]+)/i)
    const entry = entryMatch ? `£${entryMatch[1]} - £${entryMatch[2]}` : null

    // Extract stop
    const stopMatch = section.match(/Stop Loss[:\s|]*£?([\d.]+)/i)
    const stop = stopMatch ? `£${stopMatch[1]}` : null

    signals.push({
      ticker,
      name,
      grade,
      verdict,
      pillarCount,
      entry,
      stop
    })
  }

  // Also look for table format signals
  const tableMatches = text.matchAll(/\|\s*([A-Z]{2,6})\s*\|[^|]*\|[^|]*\|[^|]*£?([\d.]+)[^|]*\|/g)
  for (const match of tableMatches) {
    const existing = signals.find(s => s.ticker === match[1])
    if (!existing && match[1] !== 'Ticker' && match[1] !== 'Action') {
      signals.push({
        ticker: match[1],
        entry: match[2] ? `£${match[2]}` : null
      })
    }
  }

  return signals.filter(s => s.ticker && s.ticker.length >= 2)
}
