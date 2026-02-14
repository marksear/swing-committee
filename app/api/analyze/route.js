import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(request) {
  try {
    const { formData, marketPulse, livePrices } = await request.json()

    // Build the full Swing Committee prompt
    const prompt = buildFullPrompt(formData, marketPulse, livePrices)

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

function buildFullPrompt(formData, marketPulse, livePrices = {}) {
  const hasWatchlist = formData.watchlist && formData.watchlist.trim().length > 0
  const hasPositions = formData.openPositions && formData.openPositions.trim().length > 0
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
1. Entry zones MUST be within 1-3% of the CURRENT PRICE shown above
2. If current price is $100, entry zone must be between $97-$103
3. If current price is 1000p, entry zone must be between 970p-1030p
4. DO NOT suggest entry zones more than 5% away - that trade has been MISSED
5. For EACH ticker, state "Current price from Yahoo: $X.XX" before giving entry zone
6. If a stock has already moved significantly, recommend WATCHLIST instead of forcing a bad entry

**EXAMPLE - CORRECT:**
- Current Yahoo price: $150.00
- Entry Zone: $147.00 - $152.00 (within 2% of current)

**EXAMPLE - WRONG (DO NOT DO THIS):**
- Current Yahoo price: $150.00
- Entry Zone: $120.00 - $125.00 (20% away - THIS IS WRONG!)

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

> "There is a time for all things, but I didn't know it. And that is precisely what beats so many men in Wall Street... the market does not beat them. They beat themselves, because though they have brains they cannot sit tight."

> "It never was my thinking that made the big money for me. It always was my sitting."

> "Don't anticipate — react. Let the market tell you what to do."

**Application:** For any trade signal, apply the Livermore Test:

1. **Pivotal Point Identification:**
   - Is this a natural reaction point? (breakout level, key support/resistance)
   - Has the stock "proven itself" by breaking through resistance on volume?
   - Is this the LINE OF LEAST RESISTANCE direction?

2. **Timing Check:**
   - Has the consolidation been long enough? (Livermore waited for the "right moment")
   - Is the breakout decisive or tentative?
   - Are we chasing or catching?

3. **Pyramiding Rules (if adding to winners):**
   - Only add when the trade is profitable
   - Each addition should be smaller than the last
   - Never average down

**Livermore Red Flags:**
- ❌ Buying before the breakout ("anticipating")
- ❌ Position too large too early
- ❌ Fighting the tape / general market direction
- ❌ Trading out of boredom

**Key Livermore Quotes:**
- "The big money is made in the waiting."
- "A stock is never too high to buy or too low to sell."
- "Markets are never wrong; opinions often are."

---

## PILLAR 2: O'NEIL — CANSLIM & Leadership

> "What seems too high and risky to the majority generally goes higher, and what seems low and cheap generally goes lower."

> "The whole secret to winning in the stock market is to lose the least amount possible when you're not right."

**Application:** For any LONG trade, apply the O'Neil CANSLIM screen:

| Letter | Factor | Swing Adaptation |
|--------|--------|------------------|
| **C** | Current quarterly earnings | EPS acceleration or beat? |
| **A** | Annual earnings growth | 3-year trend positive? |
| **N** | New product/management/high | Is there a catalyst? Breaking to new highs? |
| **S** | Supply & demand | Tight float? Volume on breakout? |
| **L** | Leader or laggard? | RS Rating 80+? Sector leader? |
| **I** | Institutional sponsorship | Smart money accumulating? |
| **M** | Market direction | Is the general market in uptrend? |

**O'Neil Position Rules:**
- Cut losses at **7-8% maximum** — no exceptions
- Take partial profits at **20-25%** gains
- Only buy stocks making **new highs** (or within 15% of high)
- **Relative Strength (RS) rating must be 70+**, ideally 85+
- Volume on breakout should be **50%+ above average**

**O'Neil Red Flags:**
- ❌ RS rating below 70 (laggard)
- ❌ Breaking out on low volume (no conviction)
- ❌ General market in correction (M factor negative)
- ❌ Buying extended stocks (more than 5% past buy point)

---

## PILLAR 3: MINERVINI — SEPA & Volatility Contraction

> "The goal is not to buy at the lowest price; the goal is to buy at the right price."

> "Volatility contraction is one of the most reliable precursors to a significant price move."

**Application:** Apply the SEPA (Specific Entry Point Analysis) framework:

**Stage Analysis (mandatory):**
| Stage | Description | Action |
|-------|-------------|--------|
| **Stage 1** | Basing/Accumulation | Watch, don't buy |
| **Stage 2** | Advancing/Markup | **BUY ZONE** ✓ |
| **Stage 3** | Topping/Distribution | Take profits, don't initiate |
| **Stage 4** | Declining/Markdown | Avoid or short |

**Minervini Trend Template (must pass 7/8):**
1. Stock price above 150-day MA
2. 150-day MA above 200-day MA
3. 200-day MA trending up for at least 1 month
4. 50-day MA above 150-day and 200-day MA
5. Stock price above 50-day MA
6. Stock price at least 25% above 52-week low
7. Stock price within 25% of 52-week high
8. Relative Strength rating 70+ (ideally 90+)

**Volatility Contraction Pattern (VCP):**
- Look for successive tightening of price ranges
- Each pullback should be shallower than the last
- Volume should contract during consolidation
- Volume should EXPAND on breakout
- Buy point: breakout from the final contraction

**Minervini Red Flags:**
- ❌ Stage 3 or 4 stock (distribution or decline)
- ❌ Wide, loose price action (no VCP)
- ❌ Below key moving averages
- ❌ Relative weakness vs market

---

## PILLAR 4: DARVAS — Box Theory & Mechanical Discipline

> "I kept on buying higher and selling higher. It was like climbing a staircase."

> "I never bought a stock at the low or sold one at the high in my life. I am satisfied to be along for most of the ride."

**Application:** Apply the Darvas Box Method:

**Box Identification:**
1. Identify the recent trading range (the "box")
2. Upper boundary = recent high
3. Lower boundary = support level
4. Stock "dances" within the box during consolidation

**Entry Rules:**
- Buy ONLY when price breaks ABOVE the box top
- Breakout must be accompanied by increased volume
- Enter as close to the breakout point as possible

**Stop Loss Rules (MECHANICAL — NO DISCRETION):**
- Initial stop: just below the bottom of the box
- As price rises, raise stop to bottom of each new box
- NEVER move stop down
- NEVER override the stop

**Exit Rules:**
- Sell when stop is hit (no second-guessing)
- Or sell when stock fails to form a new higher box
- Or sell partial on climactic volume spike

**Darvas Red Flags:**
- ❌ Buying within the box (anticipating breakout)
- ❌ No clear box structure (choppy, undefined)
- ❌ Low volume breakout (false breakout risk)
- ❌ Overriding mechanical stops

---

## PILLAR 5: RASCHKE — Mean Reversion & Momentum

> "The market is a rubber band — it can only stretch so far before it snaps back."

> "Momentum precedes price."

**Application:** Raschke combines mean reversion AND momentum strategies:

**Mean Reversion Setups (counter-trend):**
- Look for overextended moves (2+ ATR from moving average)
- Wait for exhaustion signal (reversal candle, divergence)
- Enter counter-trend with tight stop
- Target: return to mean (moving average)
- **Best in:** choppy/ranging markets

**Momentum Setups (trend-following):**
- Look for strong directional thrust (breakaway move)
- Buy the first pullback to support (flag/pennant)
- Enter in direction of thrust
- Target: measured move or new highs
- **Best in:** trending markets

**Raschke's Market Mode Check:**
| Mode | Characteristics | Strategy |
|------|-----------------|----------|
| **Trending** | Higher highs/lows, MA stacked | Momentum / buy pullbacks |
| **Choppy** | Overlapping bars, no direction | Mean reversion / fade extremes |
| **Volatile** | Wide ranges, gaps | Reduce size, wider stops |

**Key Raschke Indicators:**
- ADX: >25 = trending, <20 = ranging
- Bollinger Bands: width for volatility, touches for extremes
- RSI: divergences for mean reversion
- MACD: momentum confirmation

**Raschke Red Flags:**
- ❌ Fading a trend in a trending market
- ❌ Trend-following in a choppy market
- ❌ Ignoring the first thrust (most powerful)
- ❌ Oversized position in volatile conditions

---

## PILLAR 6: SECTOR RS — Relative Strength vs Sector

> "Fish where the fish are. The strongest stocks are in the strongest sectors."

**Application:** Sector RS measures whether a stock is OUTPERFORMING its sector peers over the last 20 days. This is critical for 1-3 day swing trades because sector rotation drives short-term flows.

**Why Sector RS matters for spread bets:**
- A stock up 5% when its sector is up 8% is actually WEAK (laggard)
- A stock up 5% when its sector is up 1% is genuinely STRONG (leader)
- Sector leaders get institutional flow; laggards get sold on rotation

**Sector RS Checklist:**
1. ✓ Stock 20d momentum > Sector ETF 20d momentum (outperforming)
2. ✓ Stock 10d momentum positive while outperforming sector (short-term leader)
3. ✓ Sector itself trending up (tailwind, not headwind)

**Sector RS Red Flags:**
- ❌ Stock underperforming its sector (relative weakness)
- ❌ Sector in downtrend (no tailwind, swimming upstream)
- ❌ Stock only rising because sector is rising (no alpha)

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 2 — RISK MANAGEMENT (NON-NEGOTIABLE)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**These rules override all signals. No exceptions.**

---

## 2.1 POSITION SIZING

### STANDARD MODE (Shares/CFDs)

**The 1-2% Rule:**
\`\`\`
Position Size = (Account × Risk %) / (Entry Price - Stop Price)

Example:
Account: £10,000
Risk per trade: 1% = £100
Entry: £50.00
Stop: £47.00 (6% below)
Risk per share: £3.00

Position Size = £100 / £3.00 = 33 shares
Position Value = 33 × £50 = £1,650 (16.5% of account)
\`\`\`

### SPREAD BET MODE (UK Tax-Free)

**Key Concepts:**
- Position sized in **£ per point** (not shares)
- 1 point = 1 penny movement for UK stocks, 1 cent for US stocks
- US stocks quoted in points (e.g., NVDA at 13800 = $138.00)
- UK stocks quoted in pence (e.g., LLOY at 5250 = £52.50)
- **Tax-free gains** (classified as gambling, not investment)
- **Losses not tax-deductible**

**Spread Bet Position Sizing:**
\`\`\`
£ per Point = Risk Amount / Stop Distance in Points

Example (US Stock):
Account: £10,000
Risk per trade: 1% = £100
Entry: 13800 points ($138.00)
Stop: 13100 points ($131.00)
Stop Distance: 700 points

£ per Point = £100 / 700 = £0.14 per point
Notional Exposure = 13800 × £0.14 = £1,932

Example (UK Stock):
Account: £10,000
Risk per trade: 1% = £100
Entry: 5250 points (£52.50)
Stop: 5000 points (£50.00)
Stop Distance: 250 points

£ per Point = £100 / 250 = £0.40 per point
Notional Exposure = 5250 × £0.40 = £2,100
\`\`\`

**Spread Bet Margin:**
- Typical margin: 10-20% of notional exposure
- £1,932 exposure @ 20% margin = £386 required
- Allows more positions with same capital
- **WARNING:** Leverage cuts both ways

**UK Spread Bet Brokers:**
- IG Index (largest, most liquid)
- CMC Markets
- Spreadex
- City Index
- eToro (limited)

**Spread Bet Tax Notes (UK):**
- Profits: **Tax-free** (no CGT)
- Losses: **Not deductible** against other gains
- HMRC may investigate if trading is primary income
- Keep records anyway for your own tracking

**Position Size Limits:**
| Account Size | Max Position Size | Max Positions | Max Portfolio Heat |
|--------------|-------------------|---------------|-------------------|
| <£10k | 25% | 4-5 | 5% |
| £10k-£50k | 20% | 5-6 | 6% |
| £50k-£100k | 15% | 6-8 | 8% |
| >£100k | 10% | 8-10 | 10% |

---

## 2.2 STOP LOSS RULES

**Hard Rules:**
- Every trade MUST have a stop loss defined BEFORE entry
- Stop loss must be at a logical technical level (not arbitrary %)
- Maximum stop distance: 8-10% for position swings, 5-6% for short-term
- Once stop is set: NEVER move it down (can only trail UP)

**Stop Placement by Setup:**
| Setup Type | Stop Location |
|------------|---------------|
| Breakout | Below breakout level or last pivot low |
| Pullback buy | Below the pullback low |
| Mean reversion | Beyond the extreme + 1 ATR |
| Box breakout | Below bottom of the Darvas box |
| VCP | Below the last contraction low |

---

## 2.3 PORTFOLIO HEAT

**Portfolio Heat = Sum of all open position risks**

\`\`\`
Example:
Position 1: £100 at risk
Position 2: £100 at risk
Position 3: £100 at risk
Total Heat: £300 (3% of £10k account)
\`\`\`

**Heat Limits:**
- Normal conditions: Max 6% portfolio heat
- Volatile/uncertain conditions: Max 4% portfolio heat
- Strong trending market: Can stretch to 8%

**If heat limit reached: NO NEW TRADES until existing trades are in profit (and stops raised) or closed.**

---

## 2.4 LEVERAGE RULES

**If leverage permitted:**

| Instrument | Max Leverage | Notes |
|------------|--------------|-------|
| CFDs/Spread Bets | 5:1 effective | Calculate position size on FULL notional value |
| Margin (stocks) | 2:1 | Treat as 2% risk per trade, not 1% |
| Forex | 10:1 max | Very tight stops required |

**Leverage Warning:**
Leverage does NOT change the % risk per trade rule. It only affects capital efficiency.
A leveraged trade must still risk only 1-2% of TOTAL account value.

---

## 2.5 SHORT SELLING RULES

**If short selling permitted:**

1. Only short stocks with weak sector relative strength
2. Stop loss ABOVE resistance (reverse of long)
3. Cover partial at 1:1 R:R (take some profit quickly)
4. Watch for short squeeze setups (high short interest + good news)
5. Never short a stock making new highs
6. Reduced position size (shorts can gap against you harder)

---

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECTION 3 — TRADE MODES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User selected mode: ${formData.tradeMode === 'position' ? 'Position Swing (1-4 weeks)' : 'Short-Term Swing (2-7 days)'}

---

## MODE A: SHORT-TERM SWING (2-7 Days)

**Best for:**
- Earnings breakouts/breakdowns
- News-driven momentum
- Mean reversion snaps
- Quick sector rotations

**Settings:**
| Parameter | Short-Term Setting |
|-----------|-------------------|
| Typical hold | 2-7 trading days |
| Stop distance | 3-6% |
| Target | 6-15% or 2:1 R:R |
| Position size | Standard (1% risk) |
| Charts | Daily + 60-min |
| Key MAs | 10-day, 21-day EMA |

**Short-Term Specific Rules:**
- Take at least 50% off at first target
- Don't hold through earnings (unless that's the catalyst)
- Respect daily support/resistance levels
- More emphasis on Raschke (momentum) and Darvas (boxes)

---

## MODE B: POSITION SWING (1-4 Weeks)

**Best for:**
- Trend continuation
- Sector rotation plays
- Weekly breakouts
- Higher conviction setups

**Settings:**
| Parameter | Position Setting |
|-----------|-----------------|
| Typical hold | 1-4 weeks |
| Stop distance | 6-10% |
| Target | 15-30% or 3:1 R:R |
| Position size | Standard (1% risk) |
| Charts | Weekly + Daily |
| Key MAs | 50-day, 30-week |

**Position Swing Specific Rules:**
- Check sector relative strength (Sector RS pillar)
- Trail stops using daily chart structure
- More patience — let winners run
- More emphasis on O'Neil, Minervini, Sector RS

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
- Timeframe: [Short-Term Swing / Position Swing]
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
# SECTION 8 — WISDOM LIBRARY (VERIFIED QUOTES)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For committee deliberation and reports:

## LIVERMORE
- "There is a time for all things — a time to buy, a time to sell, and a time to go fishing."
- "It never was my thinking that made the big money for me. It always was my sitting."
- "The big money is made in the waiting."
- "The market does not beat them. They beat themselves."
- "Don't anticipate — react."

## O'NEIL
- "What seems too high and risky to the majority generally goes higher."
- "The whole secret to winning in the stock market is to lose the least amount possible when you're not right."
- "90% of stocks will decline with the general market, regardless of how good they are."
- "The successful investor learns to buy stocks as they emerge from sound bases."

## MINERVINI
- "The goal is not to buy at the lowest price; the goal is to buy at the right price."
- "Volatility contraction is one of the most reliable precursors to a significant price move."
- "Risk management isn't about avoiding risk — it's about defining it."
- "Superperformance is built on consistency, not home runs."

## DARVAS
- "I kept on buying higher and selling higher."
- "I never bought a stock at the low or sold one at the high in my life. I am satisfied to be along for most of the ride."
- "I decided to make my method completely mechanical."
- "The stop loss is not a sign of failure — it's a tool of survival."

## RASCHKE
- "The market is a rubber band — it can only stretch so far before it snaps back."
- "Momentum precedes price."
- "The first thrust in a new direction is usually the most powerful."
- "Adapt to what the market is giving you, not what you want it to give you."

## SECTOR RS
- "Fish where the fish are. The strongest stocks are in the strongest sectors."
- "Relative strength tells you who's leading and who's lagging."
- "In a rotation market, sector selection is 80% of the trade."

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
| Trade Mode | ${formData.tradeMode === 'position' ? 'Position Swing (1-4 weeks)' : 'Short-Term Swing (2-7 days)'} |
| Session Type | ${formData.sessionType} |
| User Sentiment | ${formData.marketSentiment}/10 |
| User Regime View | ${formData.regimeView} |

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

${hasWatchlist ? `# WATCHLIST TO ANALYZE

${formData.watchlist}

${livePricesSection}
For each watchlist ticker, run the FULL SWING SIGNAL PROTOCOL as defined in Section 5 above:
1. Company Snapshot (sector, market cap, avg volume)
2. Setup Identification (direction, setup type, timeframe, confidence)
3. Levels (entry zone, stop loss, targets) — include BOTH standard prices AND spread bet points
4. Position Sizing — BOTH Standard (shares) AND Spread Bet (£/point) formats
5. Six Pillars Alignment (check each pillar, need 3+ to pass)
6. Signal Quality Score and Grade (A+/A/B/C)
7. Risk Factors
8. Trade Management Plan
9. Final Verdict

---` : '# WATCHLIST\n\nNo watchlist provided.\n\n---'}

# REQUIRED OUTPUT STRUCTURE

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

**IMPORTANT FOR WATCHLIST ITEMS:** Each watchlist item MUST include ALL fields shown in the example above, including:
- company, sector, setupType
- currentPrice, triggerLevel, potentialEntry, potentialStop, potentialTarget
- pillarCount, grade, reasoning, catalyst, risks
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

function parseResponse(responseText) {
  // First, try to extract structured JSON data (most reliable)
  const jsonData = extractJsonData(responseText)

  const result = {
    mode: jsonData?.committee || extractCommitteeStance(responseText),
    summary: jsonData?.summary || extractSummary(responseText),
    signals: jsonData ? convertJsonToSignals(jsonData) : extractSignals(responseText),
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
  try {
    // Look for JSON code block
    const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/i)
    if (jsonMatch && jsonMatch[1]) {
      const jsonStr = jsonMatch[1].trim()
      const data = JSON.parse(jsonStr)
      console.log('Successfully parsed JSON data:', data)
      return data
    }
  } catch (error) {
    console.error('Failed to parse JSON data:', error.message)
  }
  return null
}

// Convert JSON data to signals array format
function convertJsonToSignals(jsonData) {
  const signals = []

  // Convert trades to signals
  if (jsonData.trades && Array.isArray(jsonData.trades)) {
    for (const trade of jsonData.trades) {
      // Build comprehensive rawSection from tradeAnalysis
      let rawSection = buildTradeAnalysisText(trade)

      signals.push({
        ticker: trade.ticker?.replace('.L', ''),
        name: trade.ticker,
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
      // Build comprehensive rawSection for watchlist items
      let rawSection = buildWatchlistAnalysisText(item)

      signals.push({
        ticker: item.ticker?.replace('.L', ''),
        name: item.ticker,
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

  return signals
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

  // Catalyst
  if (item.catalyst) {
    text += `**WAITING FOR:** ${item.catalyst}\n\n`
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

    return signals
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

  return signals
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
