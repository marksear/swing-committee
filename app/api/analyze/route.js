import Anthropic from '@anthropic-ai/sdk'
import { LOG_SCHEMA_VERSION, buildScanPayload } from '@/lib/scanEmission'

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

    // Call Claude API with retry + model fallback for transient errors
    // Try Sonnet first (faster/cheaper), fall back to Opus if Sonnet is overloaded
    const models = [
      { id: 'claude-sonnet-4-20250514', retries: 2 },
      { id: 'claude-opus-4-20250514', retries: 2 },
    ]

    let message
    for (const model of models) {
      let succeeded = false
      for (let attempt = 1; attempt <= model.retries; attempt++) {
        try {
          console.log(`[Analyze] Calling ${model.id} (attempt ${attempt}/${model.retries})`)
          message = await client.messages.create({
            model: model.id,
            max_tokens: 12288,
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
      const { scanRecord, shortlistEntries, bypassCandidateEntries } = buildScanPayload({
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
  // Scanner developing stocks (always available if scanner ran)
  const scannerWatchlist = scannerResults?.results?.watchlist || []
  const scannerDevelopingTickers = scannerWatchlist.slice(0, 5).map(s => s.ticker).join('\n')
  const hasScannerDeveloping = scannerDevelopingTickers.length > 0
  const hasWatchlist = hasUserWatchlist || hasScannerDeveloping
  const hasPositions = formData.openPositions && formData.openPositions.trim().length > 0
  // Day-1 Capture Module candidates (pre-scored by scanner)
  const dayTradeData = scannerResults?.results?.dayTrades || { candidates: [], excluded: [], summary: {} }
  const hasLivePrices = livePrices && Object.keys(livePrices).length > 0

  // Build live prices section if available
  let livePricesSection = ''
  if (hasLivePrices) {
    // Format prices with proper currency notation
    const formatLivePrice = (p) => {
      const currency = p.currency || 'USD'
      const priceStr = currency === 'GBp'
        ? `${p.price?.toFixed(0)}p`
        : currency === 'GBP'
          ? `£${p.price?.toFixed(2)}`
          : `$${p.price?.toFixed(2)}`
      const lowStr = currency === 'GBp'
        ? `${p.low?.toFixed(0)}p`
        : currency === 'GBP'
          ? `£${p.low?.toFixed(2)}`
          : `$${p.low?.toFixed(2)}`
      const highStr = currency === 'GBp'
        ? `${p.high?.toFixed(0)}p`
        : currency === 'GBP'
          ? `£${p.high?.toFixed(2)}`
          : `$${p.high?.toFixed(2)}`
      return `| ${p.ticker} | ${priceStr} | ${p.change} (${p.changePercent}) | ${lowStr} - ${highStr} | ${currency} |`
    }

    livePricesSection = `
## LIVE MARKET PRICES (fetched from Yahoo Finance just now)

# ⚠️ MANDATORY PRICE VALIDATION ⚠️

**YOU MUST USE THESE EXACT PRICES. DO NOT HALLUCINATE OR ESTIMATE PRICES.**

These prices are from Yahoo Finance and are the ONLY source of truth:

| Ticker | Current Price | Change | Day Range | Currency |
|--------|---------------|--------|-----------|----------|
${Object.values(livePrices).map(formatLivePrice).join('\n')}

**STRICT RULES FOR ENTRY ZONES:**
1. Entry zones MUST be within 1-3% of the CURRENT PRICE above. More than 5% away = trade MISSED.
2. For EACH ticker, state "Current price from Yahoo: $X.XX" before giving entry zone.
3. If a stock has already moved significantly, recommend WATCHLIST instead of forcing a bad entry.

`
  }

  return `# TheMoneyProgram — Swing Committee Prompt
## UK/US Swing Trading Mode (v1)
### Livermore • O'Neil • Minervini • Darvas • Raschke • Sector RS

**Design goal:** Every swing trade must have *defined risk, clear entry/exit, and alignment with at least 3 of 6 masters*.

**Produce:** Account Snapshot → Market Regime Scan → Watchlist Analysis → Trade Signals → Position Sizing → Open Position Review → Weekly Summary.

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 0 — EDUCATION-ONLY DISCLAIMER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is educational decision-support for swing trading, not regulated advice.

**CRITICAL WARNINGS:**
- Swing trading involves substantial risk of loss
- Leverage amplifies both gains AND losses
- Past setups do not guarantee future results
- The user makes the final decision and bears all risk
- Never risk more than you can afford to lose

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 1 — THE SIX PILLARS OF SWING TRADING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This Swing Committee operates on principles from the greatest traders.
**Every trade must align with at least 3 of 6 pillars. Fewer = no trade.**

---

## PILLAR 1: LIVERMORE — Pivotal Points & Timing
> "Don't anticipate — react. Let the market tell you what to do."

**Checklist:** Is this a natural pivotal point (breakout, key S/R)? Has stock proven itself on volume? Line of least resistance direction? Breakout decisive, not tentative?
**Red Flags:** ❌ Buying before breakout | ❌ Fighting the tape | ❌ Trading out of boredom

---

## PILLAR 2: O'NEIL — CANSLIM & Leadership
> "The whole secret is to lose the least amount possible when you're not right."

**CANSLIM:** C=EPS acceleration, A=Annual growth, N=New catalyst/highs, S=Volume on breakout, L=RS 80+/Sector leader, I=Institutional buying, M=Market uptrend
**Rules:** Cut losses 7-8% max. Partial profits at 20-25%. RS rating 70+. Breakout volume 50%+ above avg.
**Red Flags:** ❌ RS < 70 | ❌ Low volume breakout | ❌ Market in correction | ❌ Extended > 5% past buy point

---

## PILLAR 3: MINERVINI — SEPA & Volatility Contraction
> "The goal is not to buy at the lowest price; the goal is to buy at the right price."

**Stage Analysis:** Stage 1=Watch | Stage 2=**BUY ZONE** | Stage 3=Take profits | Stage 4=Avoid/short
**Trend Template (7/8):** Price > 150d MA, 150d > 200d, 200d trending up 1mo+, 50d > 150d & 200d, Price > 50d, 25%+ above 52w low, within 25% of 52w high, RS 70+
**VCP:** Successive tightening ranges, shallower pullbacks, volume contracts then EXPANDS on breakout
**Red Flags:** ❌ Stage 3/4 | ❌ Loose price action | ❌ Below key MAs | ❌ Relative weakness

---

## PILLAR 4: DARVAS — Box Theory & Mechanical Discipline
> "I kept on buying higher and selling higher. It was like climbing a staircase."

**Method:** Identify box (trading range). Buy ONLY on break above box top with volume. Stop below box bottom. Trail stop to each new box bottom. NEVER move stop down or override.
**Red Flags:** ❌ Buying within box | ❌ No clear box structure | ❌ Low volume breakout | ❌ Overriding stops

---

## PILLAR 5: RASCHKE — Mean Reversion & Momentum
> "The market is a rubber band — it can only stretch so far before it snaps back."

**Mean Reversion:** 2+ ATR overextended → exhaustion signal → counter-trend entry → target return to MA. Best in choppy markets.
**Momentum:** Strong thrust → first pullback to support → enter with trend → target new highs. Best in trending markets.
**Market Mode:** Trending (ADX>25)=buy pullbacks | Choppy (ADX<20)=fade extremes | Volatile=reduce size, wider stops
**Red Flags:** ❌ Fading trends | ❌ Trend-following in chop | ❌ Oversized in volatile conditions

---

## PILLAR 6: SECTOR RS — Relative Strength vs Sector
> "Fish where the fish are. The strongest stocks are in the strongest sectors."

**Checklist:** Stock 20d momentum > Sector ETF 20d momentum? Stock 10d positive while outperforming? Sector itself trending up?
**Red Flags:** ❌ Underperforming sector | ❌ Sector in downtrend | ❌ No alpha vs sector

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 2 — RISK MANAGEMENT (NON-NEGOTIABLE)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**These rules override all signals. No exceptions.**

---

## 2.1 POSITION SIZING

**Standard Mode:** Position Size = (Account × Risk %) / (Entry Price - Stop Price)

**Spread Bet Mode (UK Tax-Free):** £ per Point = Risk Amount / Stop Distance in Points
- 1 point = 1p (UK stocks) or 1c (US stocks). US stocks in points (NVDA 13800 = $138). UK in pence (LLOY 5250 = £52.50).
- Tax-free gains (gambling classification). Losses not deductible. Margin typically 10-20% of notional.
- **Always provide BOTH standard (shares) and spread bet (£/point) sizing for every trade.**

**Position Size Limits:** <£10k: 25% max, 4-5 positions, 5% heat | £10k-50k: 20%, 5-6, 6% | £50k-100k: 15%, 6-8, 8% | >£100k: 10%, 8-10, 10%

---

## 2.2 STOP LOSS RULES
- Every trade MUST have a stop defined BEFORE entry at a logical technical level
- Max stop distance: 5-6% for short-term swings. NEVER move stop down.
- Placement: Breakout=below breakout/pivot | Pullback=below pullback low | Mean reversion=extreme+1ATR | Box=below box bottom | VCP=below last contraction

---

## 2.3 PORTFOLIO HEAT
Portfolio Heat = Sum of all open position risks. Normal: max 6% | Volatile: max 4% | Trending: up to 8%. If limit reached: NO NEW TRADES.

---

## 2.4 LEVERAGE & SHORT RULES
- Leverage does NOT change % risk per trade rule. CFDs/Spread Bets max 5:1 effective.
- Shorts: only weak sector RS, stop ABOVE resistance, cover partial at 1:1 R:R, never short new highs, reduced size.

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 3 — TRADE MODES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User selected mode: Short-Term Momentum Swing (1-3 days)

---

## MODE: SHORT-TERM MOMENTUM SWING (1-3 Days)

**Best for:**
- Momentum breakouts/breakdowns
- Volatility expansion plays
- Sector rotation momentum
- Quick directional moves

**Settings:**
| Parameter | Setting |
|-----------|---------|
| Typical hold | 1-3 trading days |
| Stop distance | 3-5% (1 ATR) |
| Target 1 | 1.5R (take 50%) |
| Target 2 | 2.5R (let runner ride) |
| Position size | Standard (1% risk) |
| Charts | Daily + 60-min |
| Key MAs | 10-day, 20-day |

**Momentum Swing Rules:**
- Take at least 50% off at T1 (1.5R)
- Trail remainder to T2 (2.5R)
- Don't hold through earnings
- Respect daily support/resistance levels
- All 6 pillars contribute: Livermore (VCP), O'Neil (volume), Minervini (MA stack), Darvas (ATR expansion), Raschke (momentum), Sector RS (relative strength)

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 4 — MARKET REGIME ANALYSIS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before generating any signals, determine the market regime:

---

## 4.1 REGIME CLASSIFICATION

| Regime | Characteristics | Strategy Bias |
|--------|-----------------|---------------|
| **TRENDING UP** | S&P/FTSE above rising 50-day MA, breadth healthy, new highs expanding | Aggressive long, buy breakouts, momentum |
| **TRENDING DOWN** | Below falling 50-day MA, breadth weak, new lows expanding | Defensive, short-only or cash |
| **CHOPPY/RANGE** | Price oscillating around flat MAs, no clear direction | Mean reversion, reduced size |
| **VOLATILE** | VIX elevated, wide daily ranges, gaps common | Cash heavy, very tight risk |

---

## 4.2 REGIME INDICATORS TO CHECK

| Indicator | Bullish | Bearish | Neutral |
|-----------|---------|---------|---------|
| Index vs 50-day MA | Above & rising | Below & falling | Crossing/flat |
| Index vs 200-day MA | Above | Below | Near |
| 50-day vs 200-day | Golden cross | Death cross | Converging |
| Advance/Decline line | Rising with price | Diverging lower | Flat |
| New Highs - New Lows | Expanding highs | Expanding lows | Mixed |
| VIX level | <15 | >25 | 15-25 |
| Sector breadth | >70% sectors up | <30% sectors up | 30-70% |

---

## 4.3 REGIME-BASED POSITION LIMITS

| Regime | Max Heat | Max Positions | Long/Short Bias |
|--------|----------|---------------|-----------------|
| Trending Up | 8% | 8 | Long only |
| Choppy | 4% | 4 | Neutral/selective |
| Volatile | 3% | 3 | Reduced exposure |
| Trending Down | 6% | 5 | Short bias or cash |

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 5 — TRADE SIGNAL GENERATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each watchlist stock, generate a signal assessment using the template below.

---

## 5.1 SIGNAL TEMPLATE

For each ticker, provide:

**TRADE SIGNAL: [TICKER]**

COMPANY: [Name]
SECTOR: [Sector]
MARKET CAP: [Size]
AVG VOLUME: [Volume]

**SETUP IDENTIFICATION:**
- Direction: [LONG / SHORT / NO TRADE]
- Setup Type: [e.g., VCP Breakout, Pullback to Support, Mean Reversion]
- Timeframe: Short-Term Momentum Swing (1-3 days)
- Confidence: [High / Medium / Low]

**LEVELS:**
- Current Price: £XX.XX / XXXXX points
- Entry Zone: £XX.XX - £XX.XX / XXXXX - XXXXX points
- Stop Loss: £XX.XX / XXXXX points ([X]% risk)
- Target 1: £XX.XX / XXXXX points (R:R [X]:1) — take 50%
- Target 2: £XX.XX / XXXXX points (R:R [X]:1) — trail remainder

**POSITION SIZING — STANDARD (Shares):**
- Account Risk (${formData.riskPerTrade}%): £${(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)}
- Dollar Risk per Share: £X.XX
- Position Size: XXX shares
- Position Value: £X,XXX
- Portfolio Allocation: XX%

**POSITION SIZING — SPREAD BET (UK Tax-Free):**
- Account Risk (${formData.riskPerTrade}%): £${(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)}
- Entry: XXXXX points
- Stop: XXXXX points
- Stop Distance: XXX points
- £ per Point: £X.XX
- Notional Exposure: £X,XXX
- Margin Required (~20%): £XXX

**SIX PILLARS ALIGNMENT:**

[✓/✗] LIVERMORE — Pivotal Points: [Assessment]
[✓/✗] O'NEIL — CANSLIM / RS: [Assessment]
[✓/✗] MINERVINI — Stage & VCP: [Assessment]
[✓/✗] DARVAS — Box & Breakout: [Assessment]
[✓/✗] RASCHKE — Momentum/Mean Reversion: [Assessment]
[✓/✗] SECTOR RS — Relative Strength: [Assessment]

**PILLAR COUNT:** [X]/6 — [PASS: ≥3 / FAIL: <3]

**CATALYST & TIMING:**
- Catalyst: [What's driving the move?]
- Earnings Date: [Date — hold through? Y/N]
- Sector Strength: [Strong/Neutral/Weak]

**RISK FACTORS:**
1. [Risk 1]
2. [Risk 2]
3. [Risk 3]

**TRADE MANAGEMENT PLAN:**
- Day 1-2: [Action if X happens]
- At Target 1: [Take 50%, raise stop to breakeven]
- At Target 2: [Trail with X-day MA / previous day low]
- If stopped: [Accept loss, review setup]

**VERDICT:** [TAKE TRADE / WATCHLIST / NO TRADE]

---

## 5.2 SIGNAL QUALITY SCORING

| Factor | Weight | Criteria |
|--------|--------|----------|
| Pillar Alignment | 30% | ≥4/6 = High, 3/6 = Medium, <3 = Fail |
| Risk/Reward | 25% | ≥3:1 = High, 2:1 = Medium, <2:1 = Low |
| Volume Confirmation | 15% | Breakout on 50%+ volume = High |
| Market Alignment | 15% | Matches regime = High |
| Sector Strength | 15% | Top 3 sector = High |

**Signal Grade:**
- **A+ Setup**: Score 85%+ — Full position
- **A Setup**: Score 75-84% — Standard position
- **B Setup**: Score 65-74% — Half position
- **C Setup**: Score <65% — Watchlist only, no trade

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 6 — COMMITTEE POSITIONS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Three perspectives on every signal set:

---

## 6.1 AGGRESSIVE COMMITTEE

**Bias:** More trades, capture more opportunities

**Characteristics:**
- Takes B+ setups as well as A setups
- Willing to enter slightly extended (up to 3% past buy point)
- Higher portfolio heat tolerance (up to 8%)
- More positions (up to 8)
- Quicker to add to winners

**Voice:** "This setup is good enough — let's not miss the move."

---

## 6.2 BALANCED COMMITTEE (DEFAULT)

**Bias:** Selective, disciplined, textbook

**Characteristics:**
- Only A and A+ setups
- Entry must be within 1-2% of optimal buy point
- Standard portfolio heat (6%)
- 5-6 positions max
- Patient pyramiding

**Voice:** "Only A+ setups. Let's wait for the pitch in our zone."

---

## 6.3 DEFENSIVE COMMITTEE

**Bias:** Capital preservation, fewer trades

**Characteristics:**
- Only A+ setups in confirmed uptrend
- Reduced position sizes (0.5% risk)
- Lower portfolio heat (4%)
- Fewer positions (3-4)
- Quick to take profits

**Voice:** "Markets are uncertain. Let's keep powder dry and wait for the fat pitch."

---

## 6.4 COMMITTEE SELECTION LOGIC

| Condition | Committee |
|-----------|-----------|
| Market regime = Trending Up, VIX < 18 | Aggressive |
| Market regime = Trending Up, VIX 18-25 | Balanced |
| Market regime = Choppy or Volatile | Defensive |
| Market regime = Trending Down | Defensive (or no longs) |
| User sentiment ≤ 3/10 | Defensive |
| User sentiment 4-6/10 | Balanced |
| User sentiment ≥ 7/10 | Aggressive |

**Chair determines final committee based on combination of market + user input.**

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 7 — OPEN POSITION REVIEW
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each open position, provide status update:

**POSITION REVIEW TEMPLATE:**

| Field | Value |
|-------|-------|
| Ticker | [Symbol] |
| Entry Date | [Date] |
| Entry Price | £XX.XX |
| Current Price | £XX.XX |
| P&L | [+/-]XX% (£XXX) |
| Days Held | X |
| Original Stop | £XX.XX |
| Current Stop | £XX.XX |
| Target 1 | £XX.XX [HIT / PENDING] |
| Target 2 | £XX.XX [HIT / PENDING] |
| Status | [ON TRACK / WATCH CLOSELY / EXIT SIGNAL] |

**ASSESSMENT:** [1-2 sentences on current technical position]

**ACTION:**
- [✓] HOLD — Stop remains at £XX.XX
- [✓] TRAIL — Raise stop to £XX.XX
- [✓] PARTIAL — Take XX% profit here
- [✓] CLOSE — Exit position
- [✓] ADD — Setup for pyramid entry at £XX.XX

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# INPUTS FOR THIS SESSION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Account Settings

| Parameter | Value |
|-----------|-------|
| Account Size | £${formData.accountSize} |
| Risk Per Trade | ${formData.riskPerTrade}% |
| Max Risk Per Trade | £${(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)} |
| Max Positions | ${formData.maxPositions} |
| Max Portfolio Heat | ${formData.maxHeat}% |
| Short Selling Allowed | ${formData.shortSellingAllowed ? 'Yes' : 'No'} |
| Execution Mode | Spread Bet (UK Tax-Free) |
| Spread Bet Broker | ${formData.spreadBetBroker || 'IG'} |

## Instruments Allowed
${[formData.ukStocks && '- UK Stocks', formData.usStocks && '- US Stocks', formData.indices && '- Indices', formData.forex && '- Forex', formData.crypto && '- Crypto'].filter(Boolean).join('\n')}

## Session Settings

| Parameter | Value |
|-----------|-------|
| Trade Mode | Short-Term Momentum Swing (1-3 days) |
| Session Type | ${formData.sessionType} |
| UK Regime | ${scannerResults?.regimeGate?.ukRegimeState || 'YELLOW'} (MCL auto) |
| US Regime | ${scannerResults?.regimeGate?.usRegimeState || 'YELLOW'} (MCL auto) |
| Regime Source | ${scannerResults?.regimeGate?.source || 'LEGACY'} |

## Market Pulse (LIVE DATA - USE THESE EXACT LEVELS)

| Market | Index | Current Price | 50-Day MA | 200-Day MA | Score | Regime |
|--------|-------|---------------|-----------|------------|-------|--------|
| UK | FTSE 100 | ${marketPulse.uk.price?.toLocaleString() || 'N/A'} | ${marketPulse.uk.ma50?.toFixed(0) || 'N/A'} | ${marketPulse.uk.ma200?.toFixed(0) || 'N/A'} | ${marketPulse.uk.score}/10 | ${marketPulse.uk.regime} |
| US | S&P 500 | ${marketPulse.us.price?.toLocaleString() || 'N/A'} | ${marketPulse.us.ma50?.toFixed(0) || 'N/A'} | ${marketPulse.us.ma200?.toFixed(0) || 'N/A'} | ${marketPulse.us.score}/10 | ${marketPulse.us.regime} |

**IMPORTANT: For "Key Levels to Monitor" section, use these ACTUAL current prices:**
- S&P 500 is currently at ${marketPulse.us.price?.toLocaleString() || 'N/A'} - monitor support/resistance relative to THIS level
- FTSE 100 is currently at ${marketPulse.uk.price?.toLocaleString() || 'N/A'} - monitor support/resistance relative to THIS level
- Do NOT use outdated levels like "6000" for S&P or "8400" for FTSE - these are from 2024!

---

${hasPositions ? `# CURRENT OPEN POSITIONS

${formData.openPositions}

**Format:** Ticker, Entry_Date, Entry_Price, Shares/£pp, Current_Stop

For each open position, provide:
- Current P&L assessment
- Pillar alignment status (still valid?)
- Recommended action: HOLD / TRAIL (new stop level) / PARTIAL (take %) / CLOSE / ADD

---` : '# CURRENT OPEN POSITIONS\n\nNo open positions.\n\n---'}

${buildScannerGateSection(scannerResults)}

${hasUserWatchlist ? `# USER WATCHLIST — FULL ANALYSIS REQUIRED

${formData.watchlist}

${livePricesSection}
**IMPORTANT:** These tickers were specifically requested by the user. They may be OUTSIDE the scanner universe.
Run the FULL SWING SIGNAL PROTOCOL for each, even if they were not in the scanner results:
1. Company Snapshot (sector, market cap, avg volume)
2. Setup Identification (direction, setup type, timeframe, confidence)
3. Levels (entry zone, stop loss, targets) — include BOTH standard prices AND spread bet points
4. Position Sizing — BOTH Standard (shares) AND Spread Bet (£/point) formats
5. Six Pillars Alignment (check each pillar, need 3+ to pass)
6. Signal Quality Score and Grade (A+/A/B/C)
7. Risk Factors
8. Trade Management Plan
9. Final Verdict

---` : ''}

${hasScannerDeveloping ? `# DEVELOPING STOCKS (from scanner — brief review only)

These are the top developing stocks from the scanner — they did NOT pass the regime gate but are closest to becoming tradeable. Keep analysis BRIEF for each.

${scannerDevelopingTickers}

For each ticker, provide a SHORT summary (3-5 lines max):
1. Current score and what pillar(s) are missing
2. What needs to improve to become tradeable (e.g. "needs RSI to cool" or "waiting for volume confirmation")
3. Key level to watch (entry trigger)
4. Verdict: WATCH / ALMOST READY / NOT YET

Do NOT run the full 9-step protocol — these are developing setups, not trade candidates.

---` : ''}

${!hasWatchlist ? '# WATCHLIST\n\nNo watchlist provided.\n\n---' : ''}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DAY-1 CAPTURE MODULE — PRE-SCORED INTRADAY CANDIDATES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${buildDayTradeCandidatesSection(dayTradeData)}

**DAY TRADE HARD CONSTRAINT:** Day trade stops and targets use iATR-based distances per the Day-1 scoring tier.
A-GRADE: 0.3 iATR stop, 0.5 iATR target. B-GRADE: 0.4 iATR stop, 0.5 iATR target.
You must NOT override these distances. Only stocks scoring >= 10/16 on the Day-1 factors qualify for day trades.
You cannot upgrade a sub-10 stock to a day trade.

**COMMITTEE DAY TRADE ACCEPTANCE:**
- Aggressive: Accepts A-GRADE and B-GRADE day trades
- Balanced: Accepts A-GRADE day trades only
- Defensive: Accepts A-GRADE day trades only, VIX must be < 20

For each day trade candidate, provide:
1. Brief qualitative assessment of the setup
2. Key risk factors for intraday execution
3. Your confidence level and any concerns
4. Copy the pre-computed levels EXACTLY — do NOT recalculate stops/targets

**ADVISORY — Swing Trade Stop Management Update:**
The Day-1 analysis recommends updating swing trade stop management:
- After T1 hit (1.0R): move stop to HALF-BACK (halfway between original stop and entry), NOT to breakeven
- Move to breakeven only after price reaches 1.3R
- Begin trailing at 50% of profit after T2 (1.618R)
This is a recommendation only, not a mandatory change.

---

# REQUIRED OUTPUT STRUCTURE

## PART A — MARKET CONTEXT & COMMITTEE STANCE

The scanner regime gate is auto-driven by MCL (Market Context Layer). Your role here is to ADD QUALITATIVE INSIGHT, not repeat the quantitative data. Focus on:

**Key Market Themes:** [What is driving current conditions? Earnings season, geopolitics, sector rotation, etc.]
**Risk Factors to Watch:** [What could change the regime? Upcoming events, support/resistance levels]
**Committee Stance this session:** [Aggressive / Balanced / Defensive]
**Justification:** [Based on regime gate output + market context + scanner results]

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

For each watchlist stock, provide the FULL signal analysis as per Section 5.

---` : ''}

## PART D — THREE COMMITTEE POSITIONS

### AGGRESSIVE POSITION
**Stance:** Take more signals, maximum exposure
**Trades:** [List with full details including BOTH share and spread bet sizing]
**Total Heat:** [X]%

### BALANCED POSITION
**Stance:** Only A/A+ setups, standard sizing
**Trades:** [List with full details including BOTH share and spread bet sizing]
**Total Heat:** [X]%

### DEFENSIVE POSITION
**Stance:** Only highest conviction, reduced size
**Trades:** [List with full details including BOTH share and spread bet sizing]
**Total Heat:** [X]%

---

## PART E — CHAIR'S DECISION

**Selected Committee:** [Aggressive / Balanced / Defensive]
**Rationale:** [Why this stance given current conditions]

**ACTION SUMMARY — "This session we will:"**
[Write 2-3 sentences summarizing the specific trades and watchlist items. Include ticker symbols and key actions.]

**TRADES TABLE (Entry prices MUST be within 3% of Yahoo live price):**

| Action | Ticker | Direction | Entry | Stop | Size (Shares) | Size (Spread Bet) | Risk |
|--------|--------|-----------|-------|------|---------------|-------------------|------|

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

## PART G — STRUCTURED DATA (REQUIRED)

**IMPORTANT: You MUST include this JSON block at the very end of your response. This is used for parsing.**

\`\`\`json
{
  "committee": "Balanced",
  "trades": [
    {
      "ticker": "NVDA",
      "direction": "LONG",
      "entry": "$138.00-$140.00",
      "stop": "$131.00",
      "target": "$155.00",
      "shares": 20,
      "spreadBetSize": "£0.37/pt",
      "risk": "£100",
      "grade": "A",
      "pillarCount": 4,
      "setupType": "VCP Breakout",
      "tradeAnalysis": {
        "company": "NVIDIA Corporation",
        "sector": "Semiconductors",
        "marketCap": "$4.67T",
        "avgVolume": "301M",
        "currentPrice": "$138.50",
        "stopPercent": "5.4%",
        "target2": "$165.00",
        "riskReward1": "2.4:1",
        "riskReward2": "3.8:1",
        "confidence": "High",
        "timeframe": "Short-Term Swing",
        "standardSizing": {
          "accountRisk": "£100",
          "dollarRiskPerShare": "$7.50",
          "positionSize": "13 shares",
          "positionValue": "£1,800",
          "portfolioAllocation": "18%"
        },
        "spreadBetSizing": {
          "entryPoints": "13850 points",
          "stopPoints": "13100 points",
          "stopDistance": "750 points",
          "poundsPerPoint": "£0.13",
          "notionalExposure": "£1,800",
          "marginRequired": "£360"
        },
        "pillars": {
          "livermore": { "pass": true, "note": "Strong pivotal point, line of least resistance up" },
          "oneil": { "pass": true, "note": "Market leader, RS 95+, breaking from consolidation" },
          "minervini": { "pass": true, "note": "Stage 2, VCP forming, above all key MAs" },
          "darvas": { "pass": true, "note": "Clear box structure, buying at breakout" },
          "raschke": { "pass": false, "note": "Mixed signals, not clearly trending" },
          "sectorRS": { "pass": true, "note": "Outperforming sector by 3%" }
        },
        "catalyst": "Earnings momentum, AI demand",
        "risks": ["Semiconductor cycle risk", "Valuation stretched", "China exposure"]
      }
    }
  ],
  "watchlist": [
    {
      "ticker": "GOOGL",
      "note": "Watch for breakout above $175",
      "direction": "LONG",
      "currentPrice": "$174.50",
      "triggerLevel": "$175.00",
      "potentialEntry": "$175.50-$177.00",
      "potentialStop": "$168.00",
      "potentialTarget": "$190.00",
      "pillarCount": 3,
      "grade": "B",
      "company": "Alphabet Inc.",
      "sector": "Technology",
      "setupType": "Breakout Watch",
      "reasoning": "Consolidating below resistance. Need volume confirmation on breakout. 3/6 pillars currently aligned - would improve to 4/6 on breakout.",
      "waitingFor": "Strong breakout above $175 with volume confirmation",
      "stageScoring": "Stage 1 (Direction): PASS — LONG signal assigned | Stage 2 (S/R Gate): FAIL — LONG blocked by resistance air pocket | Stage 3 (Regime Gate): N/A",
      "catalyst": "Awaiting breakout above key resistance",
      "risks": ["Could fail at resistance", "Market sentiment dependent"],
      "pillars": {
        "livermore": { "pass": true, "note": "Approaching pivotal point" },
        "oneil": { "pass": true, "note": "Strong RS rating" },
        "minervini": { "pass": false, "note": "Not yet in Stage 2" },
        "darvas": { "pass": true, "note": "Box forming" },
        "raschke": { "pass": false, "note": "Waiting for momentum" },
        "sectorRS": { "pass": false, "note": "Underperforming sector" }
      }
    }
  ],
  "dayTrades": [
    {
      "ticker": "NVDA",
      "direction": "LONG",
      "tier": "A-GRADE",
      "totalScore": 14,
      "entry": "$944.30",
      "stop": "$938.84",
      "target": "$953.40",
      "riskReward": "1.67:1",
      "iATR": 18.20,
      "entryType": "opening_range_breakout",
      "setup": "Strong gap alignment with sector catalyst. OR breakout entry after 15-min range.",
      "qualitativeAssessment": "High conviction setup with peer AVGO earnings catalyst driving sector momentum. 3/3 momentum consistency supports direction.",
      "riskFactors": ["Could fail at $950 round number resistance", "VIX at 18.5 — normal conditions"],
      "crabelEligible": true,
      "vwapBias": "ALIGNED",
      "spreadBetSizing": {
        "stopDistance": "546 points",
        "poundsPerPoint": "£9.16",
        "riskAmount": "£50"
      }
    }
  ],
  "positionReviews": [
    {
      "ticker": "CSCO",
      "direction": "LONG",
      "entry": "$87.25",
      "currentPrice": "$86.29",
      "pnlPercent": -1.1,
      "pnlAmount": "-£24",
      "daysHeld": 0,
      "pillarStatus": "3/6 Active",
      "action": "HOLD",
      "stop": "$85.60",
      "newStop": null,
      "target": "$95.00",
      "assessment": "Fresh position entered today, experiencing normal initial volatility. Six pillar alignment remains intact. Hold position with original stop."
    }
  ],
  "positionSummary": "1 position reviewed, 0 on track, 0 flagged for exit",
  "summary": "Enter long positions in NVDA on VCP breakout pattern with 4 pillar alignment.",
  "totalRisk": "£100",
  "portfolioHeat": "1.0%",
  "keyLevels": {
    "sp500": { "current": 6000, "support": 5900, "resistance": 6100 },
    "ftse": { "current": 8500, "support": 8400, "resistance": 8600 }
  }
}
\`\`\`

Replace the example values with actual analysis. The JSON must be valid and parseable. Include ALL trades from the TRADES TABLE in the trades array. The tradeAnalysis object must contain the FULL detailed analysis for each trade.

**dayTrades:** Include ALL Day-1 qualified candidates from the PRE-SCORED section above. Copy the ticker, direction, tier, totalScore, entry, stop, target, riskReward, iATR, entryType, vwapBias, and crabelEligible EXACTLY from the pre-computed data. Add your own qualitativeAssessment (1-2 sentences), riskFactors (array of strings), and setup description. Include spreadBetSizing. If no candidates qualified, use an empty array [].

**IMPORTANT FOR WATCHLIST ITEMS:** Each watchlist item MUST include ALL fields shown in the example above, including:
- company, sector, setupType
- currentPrice, triggerLevel, potentialEntry, potentialStop, potentialTarget
- pillarCount, grade, reasoning, catalyst, risks
- waitingFor: 1 sentence describing the specific condition that would make this tradeable (e.g. "Breakout above 9000 with volume" or "Pullback to 150 support zone")
- stageScoring: Copy the TRADE STAGE SCORING from the Scanner Gate section above for this ticker. Use the exact stage results provided — do NOT recalculate.
- pillars object with pass/note for all 6 pillars (livermore, oneil, minervini, darvas, raschke, sectorRS)

**IMPORTANT FOR POSITION REVIEWS:** If there are open positions, include a "positionReviews" array with each position containing:
- ticker, direction (LONG/SHORT), entry (entry price), currentPrice
- pnlPercent (number, e.g. -1.1 for -1.1%), pnlAmount (e.g. "-£24")
- daysHeld (number of days)
- pillarStatus (e.g. "3/6 Active" or "5/6 Active")
- action: "HOLD" / "TRAIL" / "EXIT" / "PARTIAL" / "ADD"
- stop (current stop), newStop (if trailing, otherwise null), target
- assessment (1-2 sentence review of position status)

---

Be specific and practical. For each trade signal, provide BOTH Standard (shares) AND Spread Bet (£/point) sizing. Mark any data that needs real-time verification as **NEEDS CHECK**.`
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

function parseResponse(responseText, scannerResults = null) {
  // First, try to extract structured JSON data (most reliable)
  const jsonData = extractJsonData(responseText)

  const result = {
    mode: jsonData?.committee || extractCommitteeStance(responseText),
    summary: jsonData?.summary || extractSummary(responseText),
    signals: jsonData ? convertJsonToSignals(jsonData, scannerResults) : extractSignals(responseText),
    parsedPositions: jsonData?.positionReviews || [],
    positionSummary: jsonData?.positionSummary || null,
    marketRegime: extractSection(responseText, 'PART A', 'PART B') || extractSection(responseText, 'MARKET REGIME', 'PART B'),
    positionsReview: extractSection(responseText, 'PART B', 'PART C') || extractSection(responseText, 'OPEN POSITIONS REVIEW', 'PART C'),
    watchlistSignals: extractSection(responseText, 'PART C', 'PART D') || extractSection(responseText, 'WATCHLIST SIGNALS', 'PART D'),
    committeePositions: extractSection(responseText, 'PART D', 'PART E') || extractSection(responseText, 'THREE COMMITTEE POSITIONS', 'PART E'),
    chairDecision: extractSection(responseText, 'PART E', 'PART F') || extractSection(responseText, "CHAIR'S DECISION", 'PART F'),
    decisionJournal: extractSection(responseText, 'PART F', 'PILLAR REMINDER') || extractSection(responseText, 'DECISION JOURNAL', null),
    pillarReminder: extractSection(responseText, 'PILLAR REMINDER', 'PART G') || extractSection(responseText, 'PILLAR REMINDER', null),
    fullAnalysis: responseText
  }

  return result
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
function convertJsonToSignals(jsonData, scannerResults = null) {
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

      signals.push({
        ticker: trade.ticker?.replace('.L', ''),
        name: canonical || trade.ticker,
        direction: trade.direction?.toUpperCase() || 'LONG',
        verdict: 'TAKE TRADE',
        entry: trade.entry,
        stop: trade.stop,
        target: trade.target,
        grade: trade.grade,
        pillarCount: trade.pillarCount,
        setupType: trade.setupType || `${trade.direction?.toUpperCase() || 'BUY'} ${trade.direction?.toUpperCase() || 'LONG'}`,
        riskReward: trade.tradeAnalysis?.riskReward1 || null,
        rawSection
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

      signals.push({
        ticker: item.ticker?.replace('.L', ''),
        name: canonical || item.ticker,
        direction: 'WATCHLIST ONLY',
        verdict: 'WATCHLIST',
        entry: item.potentialEntry || null,
        stop: item.potentialStop || null,
        target: item.potentialTarget || null,
        grade: item.grade || null,
        pillarCount: item.pillarCount || null,
        setupType: item.note?.substring(0, 50) || 'Watchlist',
        riskReward: null,
        rawSection
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

      signals.push({
        ticker: dt.ticker?.replace('.L', ''),
        name: canonical || dt.ticker,
        direction: dt.direction?.toUpperCase() || 'LONG',
        verdict: 'DAY TRADE',
        entry: dt.entry,
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

function extractCommitteeStance(text) {
  const stancePatterns = [
    // Match **Selected Committee:** Balanced format (with markdown bold)
    /\*\*Selected Committee:\*\*\s*(Aggressive|Balanced|Defensive)/i,
    /\*\*Committee Stance:\*\*\s*(Aggressive|Balanced|Defensive)/i,
    // Match plain text formats
    /Selected Committee[:\s]*(Aggressive|Balanced|Defensive)/i,
    /Committee Stance[:\s]*(Aggressive|Balanced|Defensive)/i,
    /\*\*Stance\*\*[:\s]*(Aggressive|Balanced|Defensive)/i,
    // Match from Decision Journal table
    /Committee Stance\s*\|\s*(Aggressive|Balanced|Defensive)/i,
    // Generic patterns
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
  // Helper to clean up summary text
  const cleanSummary = (text) => {
    return text
      .replace(/^#+\s*[-─━═]*\s*/gm, '') // Remove header markers and lines
      .replace(/^[-─━═]+\s*/gm, '') // Remove horizontal lines
      .replace(/^\*\*ACTION SUMMARY.*?\*\*\s*/i, '') // Remove ACTION SUMMARY header
      .replace(/^["'"]\s*/gm, '') // Remove leading quotes
      .replace(/["'"]\s*$/gm, '') // Remove trailing quotes
      .replace(/^\s*\n/gm, '') // Remove empty lines at start
      .trim()
  }

  // FIRST: Try to extract from Chair's Decision - look for Selected Committee and Rationale
  const chairPattern = /\*\*Selected Committee:\*\*\s*([^\n]+)\s*\n\s*\*\*Rationale:\*\*\s*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i
  const chairMatch = responseText.match(chairPattern)
  if (chairMatch) {
    const committee = chairMatch[1].trim()
    const rationale = chairMatch[2].trim()

    // Also look for ACTION SUMMARY content - try multiple patterns
    let actionSummary = ''

    // Pattern 1: Standard ACTION SUMMARY format
    const actionMatch1 = responseText.match(/ACTION SUMMARY[^"]*"This session we will:?"?\*?\*?\s*\n?([\s\S]*?)(?=\n\n\*\*(?:TRADES|Total|Watchlist)|$)/i)
    if (actionMatch1 && actionMatch1[1]) {
      actionSummary = cleanSummary(actionMatch1[1])
      actionSummary = actionSummary.split(/\n\|/)[0].trim()
    }

    // Pattern 2: Standalone "This session we will" without ACTION SUMMARY header
    if (!actionSummary || actionSummary.length < 20) {
      const sessionWillPattern = /This session we will:?\s*\n?([\s\S]*?)(?=\n\n\*\*(?:TRADES|Total)|$)/i
      const sessionMatch = responseText.match(sessionWillPattern)
      if (sessionMatch && sessionMatch[1]) {
        actionSummary = cleanSummary(sessionMatch[1])
        actionSummary = actionSummary.split(/\n\|/)[0].trim()
      }
    }

    let summary = `**Selected Committee:** ${committee}\n**Rationale:** ${rationale}`
    if (actionSummary && actionSummary.length > 10) {
      summary += `\n\n**This session we will:** ${actionSummary}`
    }

    if (summary.length > 50) {
      return summary.substring(0, 1200) // Allow longer summary
    }
  }

  // SECOND: Find "This session we will" content
  const sessionWillIndex = responseText.toLowerCase().indexOf('this session we will')
  if (sessionWillIndex !== -1) {
    const textFromSession = responseText.substring(sessionWillIndex)

    // Find where the summary ends (next major section or table)
    const endPatterns = [/\n\n##/, /\n\n###/, /\n---\n/, /\n\n\*\*TRADES/, /\n\n\*\*Total/, /\n\|.*\|.*\|/]
    let endIndex = textFromSession.length
    for (const pattern of endPatterns) {
      const match = textFromSession.match(pattern)
      if (match && match.index < endIndex && match.index > 20) {
        endIndex = match.index
      }
    }

    let summary = textFromSession.substring(0, Math.min(endIndex, 1000)).trim()
    summary = cleanSummary(summary)

    // Keep the "This session we will:" prefix
    if (summary.length > 20) {
      return summary.substring(0, 1000)
    }
  }

  // THIRD: Try to get Rationale alone
  const rationaleMatch = responseText.match(/\*\*Rationale:\*\*\s*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
  if (rationaleMatch && rationaleMatch[1]) {
    const rationale = rationaleMatch[1].trim()
    if (rationale.length > 30) {
      return rationale.substring(0, 800)
    }
  }

  // FOURTH: Try alternative pattern for executive summary section
  const execSummaryMatch = responseText.match(/(?:Executive Summary|EXECUTIVE SUMMARY)[:\s]*\n([\s\S]*?)(?=\n##|\n###|\n---|\n\|)/i)
  if (execSummaryMatch && execSummaryMatch[1]) {
    const summary = cleanSummary(execSummaryMatch[1])
    if (summary.length > 20) {
      return summary.substring(0, 800)
    }
  }

  // Try to find chair's decision summary - look for content after the header
  const chairDecisionMatch = responseText.match(/(?:Chair'?s? Decision|CHAIR'?S? DECISION)[:\s]*\n([\s\S]*?)(?=\n##|\n###|\n---|\n\|)/i)
  if (chairDecisionMatch && chairDecisionMatch[1]) {
    const summary = chairDecisionMatch[1].trim()
    if (summary.length > 20) {
      return summary.substring(0, 800)
    }
  }

  // Try to find any "Today we will" or "Session summary" patterns
  const todayMatch = responseText.match(/(?:Today|Tonight|This morning|This evening)[,\s]+(?:we will|the committee will|I recommend)[:\s]*([\s\S]*?)(?=\n\n##|\n---)/i)
  if (todayMatch && todayMatch[1]) {
    const summary = todayMatch[1].trim()
    if (summary.length > 30) {
      return summary.substring(0, 800)
    }
  }

  // Fallback: extract the first non-table, non-header paragraph
  const lines = responseText.split('\n')
  const paragraphs = []
  let currentPara = []

  for (const line of lines) {
    // Skip headers, tables, horizontal rules
    if (line.startsWith('#') || line.startsWith('|') || line.startsWith('---') || line.trim() === '') {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '))
        currentPara = []
      }
      continue
    }
    currentPara.push(line.trim())
  }
  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '))
  }

  // Find a substantial paragraph
  for (const para of paragraphs) {
    if (para.length > 50 && !para.includes('|')) {
      return para.substring(0, 500)
    }
  }

  return 'Analysis complete. Review the trade signals and full report below for detailed recommendations.'
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

  // Helper to add a signal if not already present
  const addSignal = (ticker, direction, verdict, setupType, rawSection, entry = null, stop = null) => {
    // Normalize ticker - handle .L suffix
    const normalizedTicker = ticker.replace('.L', '')
    if (!signals.find(s => s.ticker === normalizedTicker || s.ticker === ticker)) {
      signals.push({
        ticker: normalizedTicker,
        name: ticker,
        direction,
        verdict,
        entry,
        stop,
        grade: null,
        pillarCount: null,
        setupType,
        target: null,
        riskReward: null,
        rawSection
      })
    }
  }

  // FIRST: Extract from Chair's Decision table (Part E) - these are the ACTUAL trades
  const chairSection = extractSection(text, 'PART E', 'PART F') ||
                       extractSection(text, "CHAIR'S DECISION", 'PART F') ||
                       extractSection(text, "CHAIR'S DECISION", 'DECISION JOURNAL')

  // ALSO check the Decision Journal for trade list
  const journalSection = extractSection(text, 'PART F', 'PILLAR') ||
                         extractSection(text, 'DECISION JOURNAL', 'PILLAR')

  // Also get the summary section for extracting tickers
  const summarySection = extractSection(text, 'ACTION SUMMARY', 'TRADES TABLE') ||
                         extractSection(text, 'This session we will', 'TRADES TABLE')

  if (chairSection) {
    // Pattern 1: Full table format | BUY | NVDA | LONG | $191-193 | $183.50 | ...
    // Also handle tickers with = like GC=F (commodities)
    const tableRowPattern = /\|\s*(BUY|SELL|HOLD)\s*\|\s*([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\s*\|\s*(LONG|SHORT)\s*\|\s*[£$]?([\d,.-]+(?:\s*[-–]\s*[\d,.]+)?)\s*\|\s*[£$]?([\d,.]+)/gi

    for (const match of chairSection.matchAll(tableRowPattern)) {
      const action = match[1].toUpperCase()
      const ticker = match[2].toUpperCase()
      const direction = match[3].toUpperCase()
      const entry = match[4].replace(/,/g, '').replace('–', '-')
      const stop = match[5].replace(/,/g, '')

      addSignal(ticker, direction, 'TAKE TRADE', `${action} ${direction}`,
                `Chair's Decision: ${action} ${ticker} ${direction} Entry: ${entry} Stop: ${stop}`, entry, stop)
    }
  }

  // Pattern 2: Extract from Decision Journal "Trades | META LONG, SHEL.L LONG |" format
  if (journalSection) {
    const tradesMatch = journalSection.match(/Trades\s*\|\s*([^|]+)\|/i)
    if (tradesMatch) {
      const tradesStr = tradesMatch[1].trim()
      // Parse "META LONG, SHEL.L LONG, GC=F LONG" format - handle commodities too
      const tradePattern = /([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\s+(LONG|SHORT)/gi
      for (const match of tradesStr.matchAll(tradePattern)) {
        const ticker = match[1].toUpperCase()
        const direction = match[2].toUpperCase()
        addSignal(ticker, direction, 'TAKE TRADE', `BUY ${direction}`,
                  `From Decision Journal: ${ticker} ${direction}`)
      }
    }
  }

  // Pattern 3: Look for explicit "BUY TICKER" or "SELL TICKER" in Chair's section
  if (chairSection) {
    const buyPattern = /\b(BUY|SELL)\s+([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\b/gi
    for (const match of chairSection.matchAll(buyPattern)) {
      const action = match[1].toUpperCase()
      const ticker = match[2].toUpperCase()
      const direction = action === 'BUY' ? 'LONG' : 'SHORT'
      addSignal(ticker, direction, 'TAKE TRADE', `${action} ${direction}`,
                `Chair's Decision: ${action} ${ticker}`)
    }
  }

  // Pattern 4: Extract "TICKER long/short" - with or without following words
  // This catches: "NVDA long on...", "VOD.L short", "GC=F long for..."
  if (chairSection) {
    const narrativePattern = /\b([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\s+(long|short)\b/gi
    for (const match of chairSection.matchAll(narrativePattern)) {
      const ticker = match[1].toUpperCase()
      const direction = match[2].toUpperCase()
      addSignal(ticker, direction, 'TAKE TRADE', `${direction === 'LONG' ? 'BUY' : 'SELL'} ${direction}`,
                `From Chair's Summary: ${ticker} ${direction}`)
    }
  }

  // Pattern 5: Extract tickers in parentheses like "(SHEL.L, BP.L)" from summary text
  // This is for narrative formats like "energy breakouts (SHEL.L, BP.L)"
  const allText = (chairSection || '') + ' ' + (summarySection || '')
  const parenthesesPattern = /\(([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)(?:\s*,\s*([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?))*\)/gi
  for (const match of allText.matchAll(parenthesesPattern)) {
    // Get the full match content inside parentheses
    const content = match[0].slice(1, -1) // Remove ( and )
    const tickers = content.split(/\s*,\s*/)
    for (const ticker of tickers) {
      const cleanTicker = ticker.trim().toUpperCase()
      if (cleanTicker && cleanTicker.length >= 1 && /^[A-Z]/.test(cleanTicker)) {
        // Check context for direction (look for nearby "long" or "short")
        const contextStart = Math.max(0, match.index - 100)
        const contextEnd = Math.min(allText.length, match.index + match[0].length + 50)
        const context = allText.substring(contextStart, contextEnd).toLowerCase()

        let direction = 'LONG' // Default to LONG
        if (context.includes('short') || context.includes('weakness') || context.includes('decline')) {
          direction = 'SHORT'
        }
        addSignal(cleanTicker, direction, 'TAKE TRADE', `${direction === 'LONG' ? 'BUY' : 'SELL'} ${direction}`,
                  `From Summary: ${cleanTicker} ${direction}`)
      }
    }
  }

  // Pattern 6: Look for "TICKER short" pattern specifically (no "on/for/at" required)
  // This catches "VOD.L short" at end of sentences
  if (allText) {
    const shortPattern = /([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\s+short(?:\s|$|,|\))/gi
    for (const match of allText.matchAll(shortPattern)) {
      const ticker = match[1].toUpperCase()
      addSignal(ticker, 'SHORT', 'TAKE TRADE', 'SELL SHORT', `From Text: ${ticker} SHORT`)
    }
  }

  // Pattern 7: Extract from specific "take X trades" or "X high-probability trades" patterns
  // e.g., "Take five high-probability trades focusing on energy breakouts (SHEL.L, BP.L)"
  const tradeCountPattern = /take\s+(?:(\d+)|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:high[- ]probability\s+)?trades?\s+(?:focusing\s+on\s+)?([^.]+)/gi
  for (const match of allText.matchAll(tradeCountPattern)) {
    const tradeDescription = match[2]
    // Extract any tickers mentioned in this description
    const tickerMentions = tradeDescription.matchAll(/([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)/g)
    for (const tickerMatch of tickerMentions) {
      const ticker = tickerMatch[1].toUpperCase()
      // Filter out common non-ticker words
      if (!['A', 'I', 'THE', 'AND', 'OR', 'FOR', 'ON', 'IN', 'TO', 'AT', 'OF'].includes(ticker)) {
        const isShort = tradeDescription.toLowerCase().includes('short') ||
                        tradeDescription.toLowerCase().includes('weakness')
        addSignal(ticker, isShort ? 'SHORT' : 'LONG', 'TAKE TRADE',
                  isShort ? 'SELL SHORT' : 'BUY LONG',
                  `From Trade Summary: ${ticker}`)
      }
    }
  }

  // Also extract watchlist items from Chair's Decision
  if (chairSection) {
    // Format: "1. GOOGL – Watch for breakout above $340"
    const watchlistPattern = /\d+\.\s*([A-Z]{1,5}(?:=[A-Z])?(?:\.[A-Z])?)\s*[-–]\s*([^\n]+)/gi
    const watchlistSection = chairSection.match(/\*\*Watchlist[^*]*\*\*[\s\S]*?(?=\*\*|$)/i)

    if (watchlistSection) {
      for (const match of watchlistSection[0].matchAll(watchlistPattern)) {
        const ticker = match[1].toUpperCase()
        const note = match[2].trim()
        addSignal(ticker, 'WATCHLIST ONLY', 'WATCHLIST', note.substring(0, 50),
                  `Watchlist: ${ticker} - ${note}`)
      }
    }
  }

  // Pattern 8: LAST RESORT - scan the full text for TICKER with LONG/SHORT context
  // This catches anything we might have missed
  if (signals.length === 0) {
    // Look for tickers followed by long/short anywhere in the text
    const fullTextPattern = /\b([A-Z]{2,5}(?:=[A-Z])?(?:\.[A-Z])?)\b[^.]*?\b(LONG|SHORT)\b/gi
    for (const match of text.matchAll(fullTextPattern)) {
      const ticker = match[1].toUpperCase()
      const direction = match[2].toUpperCase()
      // Filter out common non-ticker words and ensure it looks like a ticker
      if (!['A', 'I', 'THE', 'AND', 'OR', 'FOR', 'ON', 'IN', 'TO', 'AT', 'OF', 'IF', 'IS', 'BE'].includes(ticker)) {
        if (/^[A-Z]{2,5}(=[A-Z])?(\.[A-Z])?$/.test(ticker)) {
          addSignal(ticker, direction, 'TAKE TRADE', `${direction === 'LONG' ? 'BUY' : 'SELL'} ${direction}`,
                    `From Full Text: ${ticker} ${direction}`)
        }
      }
    }
  }

  // If we found signals from Chair's Decision, enrich them with detailed analysis from Part C
  if (signals.length > 0) {
    // Get the watchlist signals section (Part C) which has detailed analysis
    const watchlistAnalysis = extractSection(text, 'PART C', 'PART D') ||
                              extractSection(text, 'WATCHLIST SIGNALS', 'PART D')

    if (watchlistAnalysis) {
      // For each signal, find and attach its detailed analysis
      for (const signal of signals) {
        // Try with and without .L suffix
        const tickerVariants = [signal.ticker, signal.ticker + '.L', signal.name]
        let detailedMatch = null

        for (const tickerVariant of tickerVariants) {
          const tickerPattern = new RegExp(
            `##\\s*TRADE SIGNAL[:\\s]+${tickerVariant.replace('.', '\\.')}[^#]*?(?=##\\s*TRADE SIGNAL|PART [D-F]|$)`,
            'is'
          )
          detailedMatch = watchlistAnalysis.match(tickerPattern)
          if (detailedMatch) break
        }

        if (detailedMatch) {
          signal.rawSection = detailedMatch[0].trim()

          // Also extract additional data from detailed analysis
          const pillarMatch = detailedMatch[0].match(/(\d)\s*\/\s*6\s*Pillars?/i) ||
                              detailedMatch[0].match(/Pillar.*?(\d)\/6/i)
          if (pillarMatch) {
            signal.pillarCount = parseInt(pillarMatch[1])
          }

          const gradeMatch = detailedMatch[0].match(/Grade[:\s|]*\*?\*?([ABC]\+?)\*?\*?/i)
          if (gradeMatch) {
            signal.grade = gradeMatch[1].toUpperCase()
          }
        }
      }
    }

    return filterSparseSignals(signals)
  }

  // FALLBACK: If no Chair's Decision table found, extract from individual TRADE SIGNAL sections
  const tradeSignalPattern = /^#{1,3}\s*TRADE SIGNAL[:\s]+([A-Z]{2,5})(?:\.L)?(?:\s*\([^)]*\))?\s*$/gm

  for (const match of text.matchAll(tradeSignalPattern)) {
    const ticker = match[1].toUpperCase()
    if (signals.find(s => s.ticker === ticker)) continue

    // Find the section for this ticker (until next ## header or ---)
    const sectionStart = match.index
    const nextSection = text.substring(sectionStart + match[0].length).search(/\n#{1,3}\s+(?:TRADE SIGNAL|PART)|---/)
    const sectionEnd = nextSection > 0 ? sectionStart + match[0].length + nextSection : sectionStart + 6000
    const section = text.substring(sectionStart, Math.min(sectionEnd, text.length))

    // Extract company name from header or COMPANY field
    const headerNameMatch = match[0].match(/\(([^)]+)\)/)
    const companyMatch = section.match(/\*\*COMPANY[:\s]*\*\*\s*([^\n]+)/i) ||
                        section.match(/COMPANY[:\s]*([^\n*]+)/i)
    const name = headerNameMatch?.[1] || (companyMatch ? companyMatch[1].trim().replace(/\*+/g, '') : ticker)

    const signal = parseSignalSection(section, ticker, name)
    if (signal) {
      signals.push(signal)
    }
  }

  return filterSparseSignals(signals)
}

// Drop TAKE TRADE signals that lack critical trade levels (entry AND stop both missing).
// These are typically tickers only "mentioned" in the summary rather than properly structured.
function filterSparseSignals(signals) {
  return signals.filter(s => {
    if (s.verdict === 'TAKE TRADE' && !s.entry && !s.stop) {
      console.warn(`[Analyze] Dropping sparse signal ${s.ticker} — no entry/stop levels found`)
      return false
    }
    return true
  })
}

function parseSignalSection(section, ticker, name) {
  // Extract grade - look for letter grades A+, A, B+, B, C in various formats
  const gradePatterns = [
    /Signal\s*(?:Quality\s*)?(?:Score\s*(?:and\s*)?)?Grade[:\s]*\*?\*?([ABC]\+?)\*?\*?/i,
    /Grade[:\s|]*\*?\*?([ABC]\+?)\*?\*?/i,
    /\*\*([ABC]\+?)\*\*\s*(?:Grade|Signal|Setup)/i,
    /Quality[:\s]*\*?\*?([ABC]\+?)\*?\*?/i,
    /Score[:\s]*\*?\*?([ABC]\+?)\*?\*?/i,
    /\[([ABC]\+?)\]\s*(?:Grade|Signal)?/i,
    /\(([ABC]\+?)\s*(?:Grade|Signal|Setup)\)/i
  ]
  let grade = null
  for (const pattern of gradePatterns) {
    const match = section.match(pattern)
    if (match) {
      grade = match[1].toUpperCase()
      break
    }
  }

  // Extract verdict - multiple patterns
  const verdictPatterns = [
    /(?:FINAL\s*)?Verdict[:\s]*\*?\*?(TAKE TRADE|WATCHLIST|NO TRADE|PASS)\*?\*?/i,
    /\*\*(TAKE TRADE|WATCHLIST|NO TRADE|PASS)\*\*/i,
    /Decision[:\s]*(TAKE TRADE|WATCHLIST|NO TRADE|PASS)/i,
    /Recommendation[:\s]*(TAKE TRADE|WATCHLIST|NO TRADE|PASS)/i,
    /Action[:\s]*(TAKE TRADE|WATCHLIST|NO TRADE|PASS)/i
  ]
  let verdict = null
  for (const pattern of verdictPatterns) {
    const match = section.match(pattern)
    if (match) {
      verdict = match[1].toUpperCase()
      break
    }
  }

  // Extract pillar count - multiple patterns
  const pillarMatch = section.match(/(?:Pillar\s*)?Count[:\s]*\*?\*?(\d)\s*\/\s*6/i) ||
                      section.match(/(\d)\s*\/\s*6\s*Pillars?/i) ||
                      section.match(/Pillars?[:\s]*(\d)\s*\/\s*6/i) ||
                      section.match(/(\d)\/6/i)
  const pillarCount = pillarMatch ? parseInt(pillarMatch[1]) : null

  // Extract entry zone - multiple patterns with USD/GBP support
  const entryMatch = section.match(/Entry(?:\s*Zone)?[:\s|]*[£$]?([\d,.]+)\s*[-–to]\s*[£$]?([\d,.]+)/i) ||
                     section.match(/Entry[:\s|]*[£$]?([\d,.]+)/i)
  let entry = null
  if (entryMatch) {
    const price1 = entryMatch[1].replace(/,/g, '')
    const price2 = entryMatch[2]?.replace(/,/g, '')
    entry = price2 ? `${price1} - ${price2}` : price1
  }

  // Extract stop loss - multiple patterns
  const stopMatch = section.match(/Stop(?:\s*Loss)?[:\s|]*[£$]?([\d,.]+)/i) ||
                    section.match(/Initial Stop[:\s|]*[£$]?([\d,.]+)/i)
  const stop = stopMatch ? stopMatch[1].replace(/,/g, '') : null

  // Extract target
  const targetMatch = section.match(/Target[:\s|]*[£$]?([\d,.]+)/i) ||
                      section.match(/Price Target[:\s|]*[£$]?([\d,.]+)/i)
  const target = targetMatch ? targetMatch[1].replace(/,/g, '') : null

  // Extract setup type
  const setupPatterns = [
    /Setup(?:\s*Type)?[:\s|]*\*?\*?([^|\n*]+)\*?\*?/i,
    /Pattern[:\s|]*\*?\*?([^|\n*]+)\*?\*?/i,
    /Setup\s*(?:Identification)?[:\s|]*\*?\*?([^|\n*]+)\*?\*?/i,
    /Trade\s*Type[:\s|]*\*?\*?([^|\n*]+)\*?\*?/i,
    /\*\*Setup\*\*[:\s]*([^\n]+)/i
  ]
  let setupType = null
  for (const pattern of setupPatterns) {
    const match = section.match(pattern)
    if (match) {
      let setup = match[1].trim().replace(/\*+/g, '').substring(0, 50)
      // Skip unhelpful values
      if (setup && !setup.match(/^(IDENTIFICATION|LONG|SHORT|N\/A|None)$/i) && setup.length > 2) {
        setupType = setup
        break
      }
    }
  }

  // Extract direction - expanded patterns to catch more formats
  const directionPatterns = [
    /Direction[:\s|]*\*?\*?(LONG|SHORT)\*?\*?/i,
    /Position[:\s|]*\*?\*?(LONG|SHORT)\*?\*?/i,
    /\*\*Direction\*\*[:\s|]*(LONG|SHORT)/i,
    /\*\*(LONG|SHORT)\*\*\s*(?:position|trade|setup|direction)/i,
    /\b(LONG|SHORT)\s*(?:position|trade|setup|bias|signal)/i,
    /(?:Setup|Signal|Trade)\s*(?:Type)?[:\s]*\*?\*?(LONG|SHORT)/i,
    /(?:Bias|Outlook)[:\s]*\*?\*?(LONG|SHORT|BULLISH|BEARISH)\*?\*?/i,
    /\|\s*Direction\s*\|\s*(LONG|SHORT)\s*\|/i,
    /\|\s*(LONG|SHORT)\s*\|/i,
    /^[*-]\s*\*?\*?Direction\*?\*?[:\s]*(LONG|SHORT)/im,
    /(?:go|going|recommend|suggesting)\s+(LONG|SHORT)/i,
    /\b(LONG|SHORT)\b.*(?:entry|position|trade)/i
  ]

  let direction = null
  for (const pattern of directionPatterns) {
    const match = section.match(pattern)
    if (match) {
      let dir = match[1].toUpperCase()
      // Convert BULLISH/BEARISH to LONG/SHORT
      if (dir === 'BULLISH') dir = 'LONG'
      if (dir === 'BEARISH') dir = 'SHORT'
      direction = dir
      break
    }
  }

  // Fallback: if we still don't have direction, infer from context
  if (!direction) {
    const upperSection = section.toUpperCase()
    // Check for strong indicators
    if (upperSection.includes('BUY SIGNAL') || upperSection.includes('BULLISH SETUP') ||
        upperSection.includes('LONG ENTRY') || upperSection.includes('BUY ZONE')) {
      direction = 'LONG'
    } else if (upperSection.includes('SELL SIGNAL') || upperSection.includes('BEARISH SETUP') ||
               upperSection.includes('SHORT ENTRY') || upperSection.includes('SELL ZONE')) {
      direction = 'SHORT'
    }
  }

  // Extract risk/reward
  const rrMatch = section.match(/R(?:isk)?[\/:]?R(?:eward)?[:\s]*([\d.]+)[:\s]*([\d.]+)/i) ||
                  section.match(/Risk[:\s]*[\d.]+[:\s]*Reward[:\s]*([\d.]+)/i)
  const riskReward = rrMatch ? `${rrMatch[1]}:${rrMatch[2] || '1'}` : null

  return {
    ticker,
    name: name || ticker,
    grade,
    verdict,
    pillarCount,
    entry,
    stop,
    target,
    setupType,
    direction,
    riskReward,
    rawSection: section.substring(0, 1500) // Store for expanded view
  }
}
