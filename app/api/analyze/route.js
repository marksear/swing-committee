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

  return `# TheMoneyProgram — Swing Committee Prompt
## UK/US Swing Trading Mode (v1)
### Livermore • O'Neil • Minervini • Darvas • Raschke • Weinstein

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

## PILLAR 6: WEINSTEIN — Stage Analysis & Weekly Charts

> "Don't ever argue with the tape. The market knows more than you do."

> "The trend is your friend until the end when it bends."

**Application:** Weinstein focuses on WEEKLY charts for swing trades:

**The Four Stages (Weekly Chart):**

| Stage | 30-Week MA | Price Action | Volume | Strategy |
|-------|-----------|--------------|--------|----------|
| **Stage 1** | Flattening | Base forming | Quiet | Watch for accumulation |
| **Stage 2** | Rising | Higher highs/lows | Expanding | **BUY AND HOLD** ✓ |
| **Stage 3** | Flattening/Rolling | Choppy, false breakouts | Heavy but mixed | Take profits |
| **Stage 4** | Declining | Lower highs/lows | Spikes on drops | **AVOID or SHORT** |

**Weinstein Buy Checklist:**
1. ✓ Stock breaking out from Stage 1 base
2. ✓ 30-week MA turning UP (not flat or down)
3. ✓ Price ABOVE 30-week MA
4. ✓ Relative strength line rising (vs market)
5. ✓ Volume surge on breakout week
6. ✓ Industry group also in Stage 2

**Weinstein Sell Signals:**
- Price closes below 30-week MA on heavy volume
- 30-week MA flattens and starts to roll over
- Lower highs form (Stage 3 beginning)
- Relative strength line turns down

**Weinstein Red Flags:**
- ❌ Buying below 30-week MA
- ❌ Buying in Stage 3 or 4
- ❌ 30-week MA sloping down
- ❌ Weak relative strength vs market

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

1. Only short Stage 4 stocks (Weinstein)
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
- Use weekly charts for trend confirmation (Weinstein)
- Trail stops using daily chart structure
- More patience — let winners run
- More emphasis on O'Neil, Minervini, Weinstein

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
[✓/✗] WEINSTEIN — Weekly Stage: [Assessment]

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

## WEINSTEIN
- "Don't ever argue with the tape."
- "The trend is your friend until the end when it bends."
- "Stage 2 is the only stage where you want to be long."
- "The 30-week moving average is your best friend."

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
| Leverage Allowed | ${formData.leverageAllowed ? 'Yes (max ' + formData.maxLeverage + 'x)' : 'No'} |
| Short Selling Allowed | ${formData.shortSellingAllowed ? 'Yes' : 'No'} |
| Execution Mode | ${formData.executionMode === 'spread_bet' ? 'Spread Bet (UK Tax-Free)' : 'Standard (Shares/CFDs)'} |
${formData.executionMode === 'spread_bet' ? `| Spread Bet Broker | ${formData.spreadBetBroker} |` : ''}

## Instruments Allowed
${[formData.ukStocks && '- UK Stocks', formData.usStocks && '- US Stocks', formData.indices && '- Indices', formData.forex && '- Forex', formData.crypto && '- Crypto'].filter(Boolean).join('\n')}

## Session Settings

| Parameter | Value |
|-----------|-------|
| Trade Mode | ${formData.tradeMode === 'position' ? 'Position Swing (1-4 weeks)' : 'Short-Term Swing (2-7 days)'} |
| Session Type | ${formData.sessionType} |
| User Sentiment | ${formData.marketSentiment}/10 |
| User Regime View | ${formData.regimeView} |

## Market Pulse

| Market | Score | Label | Regime |
|--------|-------|-------|--------|
| UK | ${marketPulse.uk.score}/10 | ${marketPulse.uk.label} | ${marketPulse.uk.regime} |
| US | ${marketPulse.us.score}/10 | ${marketPulse.us.label} | ${marketPulse.us.regime} |

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

Be specific and practical. For each trade signal, provide BOTH Standard (shares) AND Spread Bet (£/point) sizing. Mark any data that needs real-time verification as **NEEDS CHECK**.`
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

    // Extract setup type
    const setupMatch = section.match(/Setup Type[:\s]*([^\n]+)/i)
    const setupType = setupMatch ? setupMatch[1].trim() : null

    // Extract direction
    const directionMatch = section.match(/Direction[:\s]*(LONG|SHORT|NO TRADE)/i)
    const direction = directionMatch ? directionMatch[1] : null

    signals.push({
      ticker,
      name,
      grade,
      verdict,
      pillarCount,
      entry,
      stop,
      setupType,
      direction
    })
  }

  // Also look for TRADE SIGNAL: format
  const signalMatches = text.matchAll(/TRADE SIGNAL:\s*\[?([A-Z0-9]{2,6})\]?/g)
  for (const match of signalMatches) {
    const ticker = match[1]
    const existing = signals.find(s => s.ticker === ticker)
    if (!existing) {
      const sectionStart = match.index
      const sectionEnd = text.indexOf('TRADE SIGNAL:', sectionStart + 1)
      const section = text.substring(sectionStart, sectionEnd > 0 ? sectionEnd : sectionStart + 3000)

      // Extract company name
      const companyMatch = section.match(/COMPANY[:\s]*([^\n]+)/i)
      const name = companyMatch ? companyMatch[1].trim() : ticker

      // Extract grade
      const gradeMatch = section.match(/Signal Grade[:\s]*\*?\*?([A-C]\+?)/i)
      const grade = gradeMatch ? gradeMatch[1] : null

      // Extract verdict
      const verdictMatch = section.match(/VERDICT[:\s]*\*?\*?(TAKE TRADE|WATCHLIST|NO TRADE)/i)
      const verdict = verdictMatch ? verdictMatch[1] : null

      // Extract pillar count
      const pillarMatch = section.match(/PILLAR COUNT[:\s]*\*?\*?(\d)\/6/i)
      const pillarCount = pillarMatch ? parseInt(pillarMatch[1]) : null

      signals.push({
        ticker,
        name,
        grade,
        verdict,
        pillarCount
      })
    }
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
