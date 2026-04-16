# The Trading Program — End-to-End Process Document

**Document Purpose:** Compliance review of the automated trading signal generation system
**System Type:** Informational decision-support tool (advisory only — does not execute trades)
**Version:** Includes Day-1 Capture Module (v2.1.1)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Controls & Inputs](#2-user-controls--inputs)
3. [Stage 1 — Scanner: Universe & Data Collection](#3-stage-1--scanner-universe--data-collection)
4. [Stage 2 — Scanner: Six-Pillar Scoring & Direction Assignment](#4-stage-2--scanner-six-pillar-scoring--direction-assignment)
5. [Stage 3 — Scanner: Relative Strength Ranking](#5-stage-3--scanner-relative-strength-ranking)
6. [Stage 4 — Scanner: Safety Guardrails (S/R, Earnings, Volatility)](#6-stage-4--scanner-safety-guardrails)
7. [Stage 5 — Scanner: Regime Gate](#7-stage-5--scanner-regime-gate)
8. [Stage 6 — Day-1 Capture Module (Intraday Scoring)](#8-stage-6--day-1-capture-module)
9. [Stage 7 — AI Committee Analysis](#9-stage-7--ai-committee-analysis)
10. [Stage 8 — Signal Generation & Output](#10-stage-8--signal-generation--output)
11. [Stage 9 — Google Sheets Audit Trail](#11-stage-9--google-sheets-audit-trail)
12. [Stage 10 — Frontend Display & Human Review](#12-stage-10--frontend-display--human-review)
13. [Risk Controls Summary](#13-risk-controls-summary)
14. [Deterministic vs AI Boundary](#14-deterministic-vs-ai-boundary)
15. [Data Sources](#15-data-sources)
16. [Glossary](#16-glossary)

---

## 1. System Overview

The Trading Program is a web-based decision-support tool that scans a defined stock universe, applies quantitative scoring, and generates trade signal recommendations for human review. It operates as an **advisory system only** — it does not connect to any brokerage, does not place orders, and does not execute trades.

### High-Level Pipeline

```
User Configuration (risk params, account size, instrument selection)
        ↓
Scanner: Fetch 90 days of daily OHLCV data per stock from Yahoo Finance
        ↓
Six-Pillar Scoring: Each stock scored on 6 quantitative pillars (0-60 per side)
        ↓
Direction Assignment: LONG / SHORT / BOTH / WATCH / NONE
        ↓
Relative Strength Ranking: Cross-sectional percentile rank vs market benchmark
        ↓
Safety Guardrails: Earnings proximity, volatility spike, S/R air pocket checks
        ↓
Regime Gate: Market-condition-dependent score/pillar thresholds filter candidates
        ↓
Day-1 Capture Module: 9-factor intraday scoring for day trade candidates
        ↓
AI Committee Analysis: Qualitative narrative, risk assessment, committee stance
        ↓
Signal Generation: Structured JSON output (entry, stop, target, grade)
        ↓
Audit Trail: All signals persisted to Google Sheets (append-only)
        ↓
Frontend Display: Signals shown to user for manual review
```

### Key Design Principle

All quantitative scoring is **deterministic** — computed entirely by code with fixed formulas. The AI layer provides **qualitative assessment only** and is subject to hard constraints that prevent it from overriding code-computed values.

---

## 2. User Controls & Inputs

The user configures the following parameters before each scan:

### Risk Parameters

| Parameter | Options | Purpose |
|-----------|---------|---------|
| Account Size | Free entry (£) | Position sizing denominator |
| Risk Per Trade | 0.5%, 1%, 2% | Maximum risk as % of account per position |
| Max Positions | 4, 5, 6, or 8 | Concurrent position limit |
| Max Portfolio Heat | 4%, 6%, or 8% | Total portfolio risk ceiling |
| Short Selling | On / Off toggle | Whether short signals are generated |
| Spread Bet Broker | IG, CMC, Spreadex, City Index, Other | Affects spread estimates |

### Instrument Selection

| Instrument Class | Toggle | Universe |
|------------------|--------|----------|
| US Stocks | On/Off | S&P 100 + top 25 Nasdaq-100 (~125 tickers) |
| UK Stocks | On/Off | FTSE 100 top 50 most liquid (~50 tickers) |
| Indices | On/Off | S&P 500, DJIA, NASDAQ, FTSE, DAX, CAC, Nikkei, HSI |
| Forex | On/Off | 8 major pairs |
| Crypto | On/Off | 6 major cryptocurrencies |

### Additional Inputs

- **Watchlist:** User-entered tickers added to the scan universe
- **Open Positions:** Existing trades with stop losses (for portfolio heat calculation and position review)
- **Session Type:** London Open, US Pre-Market, US Open, etc.

---

## 3. Stage 1 — Scanner: Universe & Data Collection

### Ticker Universe

The system scans a **static, pre-defined universe** of approximately 175 stocks:

- **US Stocks (≈125):** S&P 100 components plus the top 25 Nasdaq-100 stocks not already in the S&P 100, selected by market capitalisation
- **UK Stocks (≈50):** The 50 most liquid FTSE 100 constituents by market capitalisation (identified by `.L` suffix)
- **User Watchlist:** Any additional tickers the user enters are merged in and deduplicated

### Data Fetched Per Stock

For each ticker, the system fetches from Yahoo Finance:

| Data Point | Range | Purpose |
|------------|-------|---------|
| Daily OHLCV bars | 90 calendar days | Technical indicator calculation |
| Previous close | Latest | Gap and level analysis |
| Earnings calendar | Next event | Earnings proximity check |
| Live quote | Current session | Current price for level calculations |

**Minimum data requirement:** 50 valid daily bars. Stocks with insufficient data are excluded with an error flag.

### Benchmark Data

Fetched in parallel with stock data:

| Benchmark | Ticker | Purpose |
|-----------|--------|---------|
| US Market | SPY (S&P 500 ETF) | Relative strength calculation for US stocks |
| UK Market | ^FTSE (FTSE 100 Index) | Relative strength calculation for UK stocks |
| Volatility | ^VIX (CBOE VIX) | Day-1 eligibility and position sizing filter |

VIX is cached for 15 minutes; benchmarks are cached for 1 hour.

---

## 4. Stage 2 — Scanner: Six-Pillar Scoring & Direction Assignment

### The Six Pillars

Each stock is scored on six independent quantitative pillars, with each pillar evaluating both the LONG and SHORT case on a 0–10 scale:

| # | Pillar | Named After | What It Measures |
|---|--------|-------------|------------------|
| 1 | **Livermore** | Jesse Livermore | Volatility contraction (VCP), pivot proximity, position relative to 52-week range |
| 2 | **O'Neill** | William O'Neil | Volume participation — accumulation vs distribution, volume surges, confirmation |
| 3 | **Minervini** | Mark Minervini | Moving average trend stack — whether Price > MA10 > MA20 > MA50 (long) or inverse |
| 4 | **Darvas** | Nicolas Darvas | Volatility contraction/expansion — ATR tightness, expansion ratio, squeeze release |
| 5 | **Raschke** | Linda Raschke | Momentum speed and acceleration — 3/5/10/20-day momentum, RSI confirmation |
| 6 | **Sector RS** | Relative Strength | Stock performance vs its sector — leader/laggard classification, sector tailwinds |

**Maximum score per direction:** 60 points (6 pillars × 10 points each)

### Technical Indicators Computed

The following indicators are calculated from the 90-day daily OHLCV data:

- Moving Averages: 10, 20, 50, 200-day
- Momentum: 3-day, 5-day, 10-day, 20-day, 63-day percentage returns
- RSI: 14-period Relative Strength Index
- ATR: 14-period Average True Range (raw and as % of price)
- Volume Analysis: 20-day average, 5-day recent, up-volume/down-volume ratios
- VCP Detection: 4-week volatility contraction pattern analysis
- Support/Resistance Levels: Previous day high/low, period highs/lows (5/10/20-day), swing fractal highs/lows, round numbers
- Price Relationships: % distance from each MA, 52-week high/low

### Direction Assignment

After pillar scoring, each stock receives a direction based on fixed thresholds:

| Direction | Criteria |
|-----------|----------|
| **LONG** | ≥ 4 pillars scoring ≥ 5 on long side, AND aggregate long score ≥ 50% of maximum, AND directional long signal present |
| **SHORT** | ≥ 4 pillars scoring ≥ 5 on short side, AND aggregate short score ≥ 50%, AND directional short signal present |
| **BOTH** | Meets LONG criteria (at 3-pillar, 45% threshold) AND meets SHORT criteria simultaneously |
| **WATCH** | ≥ 2 passing pillars OR VCP pattern forming (insufficient conviction for trade signal) |
| **NONE** | No criteria met — excluded from further processing |

---

## 5. Stage 3 — Scanner: Relative Strength Ranking

### Cross-Sectional Ranking

After direction assignment, all stocks within each market (US and UK separately) are ranked by their **Relative Strength Slope** — a 20-bar OLS linear regression of the log-ratio of the stock's price to its market benchmark (SPY for US, ^FTSE for UK).

### Percentile-Based Bonuses

| Percentile | Classification | Score Bonus |
|------------|---------------|-------------|
| ≥ 85th | RS_STRONG_LEADER | +5 to long score (only if base score ≥ 65%) |
| ≥ 70th | RS_LEADER | +3 to long score |
| ≤ 30th | RS_LAGGARD | +3 to short score |
| ≤ 15th | RS_STRONG_LAGGARD | +5 to short score |
| Middle | RS_NEUTRAL | No bonus |

**Promotion mechanism:** Stocks previously classified as WATCH or NONE are re-evaluated after RS bonuses are applied. If the bonus pushes them over the direction assignment thresholds, they are promoted to LONG, SHORT, or BOTH.

**Bonus cap:** Maximum 5 points. Minimum base score of 65% required to receive any bonus (prevents inflating weak stocks).

---

## 6. Stage 4 — Scanner: Safety Guardrails

Three safety checks are applied that can **demote** a stock from its assigned direction to WATCH:

### 6.1 Earnings Proximity Guard

| Condition | Action |
|-----------|--------|
| Stock has earnings within 5 days before to 2 days after | Direction → WATCH with earnings warning |

**Rationale:** Earnings events create binary risk that invalidates technical analysis. Stocks are automatically excluded from trade candidates during this window.

### 6.2 Volatility Spike Detection

| Condition | Action |
|-----------|--------|
| Daily range > 2× ATR with > 3% recovery from the session's extreme | Direction → WATCH |

**Rationale:** Post-news/earnings volatility spikes indicate unstable price action unsuitable for systematic entries.

### 6.3 Support/Resistance Air Pocket Gate

This check ensures sufficient price room between the entry and the nearest opposing S/R level:

**For SHORT candidates — Support Break Validation:**
- **Hard gates (both required):** Close must break below support by ≥ 0.4%, AND 5-day momentum must be negative
- **Soft confirms (2 of available required):** Volume ≥ 1.2× average, live price still below support, candle close in bottom 33% of range
- If not a valid support break: SHORT blocked if support within 0.5R, or demoted to WATCH if support blocks the 1R target

**For LONG candidates — Resistance Ceiling Check:**
- LONG blocked if resistance within 0.5R of entry
- LONG demoted to WATCH if resistance blocks the 1R target (no air pocket)

---

## 7. Stage 5 — Scanner: Regime Gate

The regime gate applies **market-condition-dependent thresholds** that filter candidates more aggressively in adverse market conditions.

### Regime Classification

The system maintains separate regime states for UK and US markets:

| Regime | Conditions | Bias |
|--------|-----------|------|
| **GREEN** | Risk-on AND market trending up or neutral | Favours long trades |
| **RED** | Risk-off OR market trending down | Favours short trades |
| **YELLOW** | All other conditions | Balanced / cautious |

### Filtering Thresholds

| Regime | Long Score | Long Pillars | Short Score | Short Pillars |
|--------|-----------|-------------|-------------|---------------|
| GREEN | ≥ 70% | ≥ 4 | ≥ 85% | ≥ 5 |
| YELLOW | ≥ 75% | ≥ 4 | ≥ 75% | ≥ 4 |
| RED | ≥ 85% | ≥ 5 | ≥ 70% | ≥ 4 |

**Each stock must meet BOTH the score AND pillar threshold for its direction, within its own market's regime.** Stocks failing either threshold are excluded from trade candidates and placed on the watchlist.

### BOTH Resolution

Stocks with dual (BOTH) direction are resolved to a single direction based on the regime:
- GREEN → LONG
- RED → SHORT (if short selling is enabled, else LONG)
- YELLOW → Whichever side has the higher score

### Position Size Adjustment

The regime gate also applies position size multipliers (e.g., 0.5× in adverse regimes) to reduce exposure when market conditions are unfavourable.

### Output

After the regime gate, the pipeline produces three lists:
- **Long Candidates:** Stocks that passed all gates for LONG trades
- **Short Candidates:** Stocks that passed all gates for SHORT trades
- **Watchlist:** All other stocks with any directional signal, sorted by score (capped at 15)

---

## 8. Stage 6 — Day-1 Capture Module

### Purpose

The Day-1 Capture Module is a **deterministic intraday scoring system** that evaluates all stocks with a Stage 1 direction (LONG, SHORT, or BOTH) for potential day trade suitability. It runs independently of the swing trade pipeline — a stock can qualify as both a swing trade and a day trade candidate.

### Candidate Pool

**All stocks that received a direction at Stage 1** (before any earnings/volatility/S/R demotions or regime gate filtering) are evaluated, except those with active earnings warnings. This ensures the widest possible pool is assessed.

### 9-Factor Scoring System (Maximum 16 Points)

| Factor | Name | Max | What Is Measured | Scoring |
|--------|------|-----|------------------|---------|
| 1 | Gap Alignment | 2 | Pre-market gap supports the trade direction | 2 = strong gap (≥0.5%) aligned with direction; 1 = flat/small; 0 = gap opposes direction |
| 2 | Pre-Market Volume | 2 | Elevated activity before open | 2 = ratio ≥ 2.0×; 1 = ratio 1.0–2.0×; 0 = below average. Defaults to 1 (data not yet available) |
| 3 | Catalyst Presence | 2 | Sector peer moves indicating sector-wide event | 2 = peer stock moved ≥3%; 1 = peer moved ≥2%; 0 = no notable moves |
| 4 | Technical Level Proximity | 2 | Price at or breaking key S/R | 2 = breaking through level; 1 = within 0.5 iATR; 0 = further away |
| 5 | Momentum Consistency | 2 | Last 3 sessions closed in the trade direction | 2 = 3/3 aligned; 1 = 2/3; 0 = fewer than 2 |
| 6 | Spread & Liquidity | 2 | Bid-ask spread and volume adequacy | 2 = tight spread + high volume; 1 = adequate; **0 = HARD DISQUALIFIER** |
| 7 | Relative Strength vs Index | 2 | Stock outperforming its benchmark over 5 days | 2 = ≥1% outperformance; 1 = ≥0.5%; 0 = no edge |
| 8 | VWAP Alignment | 1 | Price position relative to VWAP | 1 = aligned with direction; 0 = neutral/opposed. Currently returns 0 (VWAP data not yet available) |
| 9 | Sector Momentum | 1 | Number of same-sector stocks on the combined candidate lists | 1 = 3+ sector peers present; 0 = fewer |

**Hard Disqualifier:** If Factor 6 (Spread & Liquidity) scores 0, the stock is immediately excluded from all day trade consideration regardless of total score.

### Tier Assignment

| Tier | Score Range | Risk Per Trade | Stop Distance | Target Distance |
|------|-----------|---------------|---------------|-----------------|
| **A-GRADE** | 13–16 / 16 | 0.50% of account | 0.30 × iATR | 0.50 × iATR |
| **B-GRADE** | 10–12 / 16 | 0.25% of account | 0.40 × iATR | 0.50 × iATR |
| **Below threshold** | 0–9 / 16 | — | — | — (excluded) |

**No C-GRADE tier exists.** Stocks scoring below 10 are excluded entirely.

### iATR (Intraday ATR)

iATR is the intraday-specific ATR used for all day trade distance calculations:

- **Calculation:** `daily_ATR_14 × 0.65`
- **Rationale:** Empirically, intraday price range is approximately 65% of the full daily ATR
- **Status:** This is a fallback estimate. When 5-minute bar data becomes available, iATR will be calculated directly from intraday data.

### Friction Offset

Accounts for real-world execution costs:

- **Formula:** `(estimated_spread / 2) + (0.02 × iATR)`
- **Clamp:** Between `0.01 × iATR` and `0.05 × iATR`
- **Purpose:** Adjusts breakeven point to account for spread crossing and slippage

### Stop Progression (4-Stage Ladder)

Day trades use an automated stop progression system:

| Stage | Trigger (High Favourable Excursion) | Stop Level | Purpose |
|-------|--------------------------------------|-----------|---------|
| INITIAL | Entry | Entry − stop distance (0.3 or 0.4 iATR) | Original protective stop |
| BREAKEVEN | Price reaches 0.25 iATR in favour | Entry ± friction offset | Eliminate risk |
| LOCK | Price reaches 0.35 iATR in favour | Entry + 0.15 iATR | Lock partial profit |
| CLOSE | Price reaches 0.45 iATR in favour | Entry + 0.30 iATR | Lock majority of move |
| TARGET | Price reaches 0.50 iATR | Full exit | Full target reached |

**Time-based rules:**
- 90 minutes: Close at breakeven if profitable (stale trade)
- 120 minutes: Lock 50% of close HFE (fading trade)
- 60 minutes before market close: Lock 50% of unrealised P/L
- VWAP violation after 30 minutes: Close at breakeven minimum

### VIX Filter

| VIX Level | Day Trade Eligibility |
|-----------|----------------------|
| < 20 | All tiers eligible at full size |
| 20–24 | A-GRADE at 75% size; B-GRADE excluded |
| 25–29 | A-GRADE at 50% size; B-GRADE excluded |
| ≥ 30 | **All day trades suspended** |

### Air Pocket Gate (Day Trades)

Each day trade candidate must have ≥ 0.85 iATR of clear price space to the nearest opposing S/R level (excluding VWAP). VWAP is explicitly excluded from the air pocket gate calculation. Only structural S/R levels with weight ≥ 2 participate in the gate. Round numbers (weight = 1) do not block trades.

### Entry Types

| Type | Condition | Description |
|------|-----------|-------------|
| **Opening Range Breakout** | Default | Wait for 15-minute opening range to form, then enter on breakout with 5-min (A) or 8-min (B) candle close confirmation |
| **Micro-Zone S/R Bounce** | Structural S/R within 0.3 iATR | Enter on bounce from key level; zone width = 0.1 iATR |
| **Crabel Early Entry** | A-GRADE only, 6 conditions met | Enter before opening range established; requires gap ≥1%, pre-market vol ≥3×, Factor 1=2, Factor 2=2, Factor 3≥1, score ≥13 |

### Target Capping

S/R levels with weight ≥ 2 that sit between entry and target will cap the target (with a 0.1 iATR buffer deducted). If capping produces R:R < 1.0, the trade is rejected. Round numbers (weight = 1) do **not** cap targets.

---

## 9. Stage 7 — AI Committee Analysis

### What the AI Receives

The AI receives a comprehensive prompt containing:

1. **Educational framework:** Six trading masters methodology, risk management rules, trade mode definition
2. **Market regime data:** Index levels, 50/200-day MA relationships, regime classification
3. **Scanner-approved candidates:** All stocks that passed the 3-stage scanner gate, with full pillar breakdowns
4. **Watchlist stocks:** Stocks that failed the scanner gate, with specific failure reasons (score, pillars, S/R, regime)
5. **Day-1 pre-scored candidates:** All day trade candidates with 9-factor scores, tiers, and pre-computed levels
6. **Open positions:** User's existing trades for review
7. **Risk parameters:** Account size, risk per trade, max positions, max heat
8. **Live prices:** Current market prices for each stock

### What the AI Does

| Task | Description |
|------|-------------|
| Qualitative narrative | Explains *why* a setup is attractive or risky in plain language |
| Catalyst identification | Notes relevant news, sector themes, or macro drivers |
| Risk factor articulation | Identifies what could go wrong with each trade |
| Entry zone refinement | Adjusts entry within 1–3% of current price (cannot exceed 5%) |
| Committee stance selection | Chooses Aggressive, Balanced, or Defensive based on conditions |
| Position review | Assesses open trades and recommends HOLD / TRAIL / PARTIAL / CLOSE |
| Signal quality grading | Assigns A+, A, B, or C grade to each signal |

### What the AI CANNOT Do (Hard Constraints)

| Constraint | Enforcement |
|------------|-------------|
| Cannot upgrade a watchlist stock to a trade signal | Prompt instruction; watchlist stocks explicitly labelled as WATCHLIST ONLY |
| Cannot override iATR-based day trade stop/target distances | Prompt instruction: "You must NOT override these distances" |
| Cannot suggest day trades for stocks scoring below 10/16 | Pre-computed by code; only ≥10 presented to AI as candidates |
| Cannot trade stocks within the earnings window | Earnings-blocked stocks excluded from candidate pool |
| Cannot use setups with fewer than 3 pillar alignment | Prompt instruction and scanner gate prevents this |

### Committee Stance System

The AI generates analysis from three independent committee perspectives, then selects one:

| Stance | Setup Acceptance | Max Heat | Max Positions | Entry Flexibility |
|--------|-----------------|----------|---------------|-------------------|
| **Aggressive** | B+ and above | 8% | 8 | Up to 3% past optimal |
| **Balanced** (default) | A and A+ only | 6% | 5–6 | 1–2% of optimal |
| **Defensive** | A+ only, confirmed uptrend | 4% | 3–4 | Must be precise |

**Day trade acceptance by stance:**
- Aggressive: A-GRADE and B-GRADE
- Balanced: A-GRADE only
- Defensive: A-GRADE only, VIX must be < 20

### AI Model

- **Primary:** Claude Sonnet 4 (2 attempts with 5s/10s retry delays)
- **Fallback:** Claude Opus 4 (2 attempts with 5s/10s retry delays)
- If both models are unavailable, the system returns an error

---

## 10. Stage 8 — Signal Generation & Output

### JSON Schema

The AI outputs a structured JSON object containing:

```
{
  committee:        "Balanced" | "Aggressive" | "Defensive"
  trades: [{
    ticker, direction, entry, stop, target, grade,
    pillarCount, setupType, shares, spreadBetSize, risk,
    tradeAnalysis: {
      company, sector, marketCap, currentPrice,
      riskReward1, riskReward2, confidence,
      standardSizing: { ... },
      spreadBetSizing: { ... },
      pillars: { livermore, oneil, minervini, darvas, raschke, sectorRS },
      catalyst, risks: []
    }
  }]
  watchlist: [{
    ticker, note, direction, triggerLevel, potentialEntry/Stop/Target,
    stageScoring, reasoning, waitingFor
  }]
  dayTrades: [{
    ticker, direction, tier, totalScore, entry, stop, target,
    riskReward, iATR, entryType, qualitativeAssessment,
    riskFactors, crabelEligible, vwapBias, spreadBetSizing
  }]
  positionReviews: [{
    ticker, direction, entry, currentPrice, pnlPercent, daysHeld,
    action, stop, newStop, target, assessment
  }]
  summary, totalRisk, portfolioHeat, keyLevels
}
```

### Signal Verdicts

Each signal is assigned one of four verdicts:

| Verdict | Meaning | Persisted to Sheets? |
|---------|---------|---------------------|
| **TAKE TRADE** | Full swing trade recommendation | Yes |
| **DAY TRADE** | Intraday trade recommendation (Day-1 scored) | Yes |
| **WATCHLIST** | Not ready for trade; monitor for trigger | Yes |
| **NO TRADE / PASS** | Rejected | No |

---

## 11. Stage 9 — Google Sheets Audit Trail

All signals (except NO TRADE / PASS) are appended to Google Sheets immediately after analysis completes. This is an **append-only** audit log — records are never modified or deleted.

### Sheet 1: Scan Results (8 columns)

| Column | Content |
|--------|---------|
| Timestamp | ISO 8601 datetime |
| Direction | LONG, SHORT, or WATCH |
| Ticker | Stock symbol |
| Name | Company name |
| Price | Price at scan time |
| Currency | GBP or USD |
| Score | Scanner score (0–100 scale) |
| Reasoning | Brief qualification summary |

### Sheet 2: Trade Signals (15 columns)

| Column | Content |
|--------|---------|
| Timestamp | ISO 8601 datetime |
| Ticker | Stock symbol |
| Direction | LONG, SHORT, DAY LONG (A), DAY LONG (B), DAY SHORT (A), DAY SHORT (B), or WATCHLIST ONLY |
| Entry | Entry price or zone |
| Stop | Stop loss level |
| Target | Profit target level |
| Grade | A+, A, B, or C |
| Risk/Reward | Ratio (e.g., "2.1:1") |
| Pillars | e.g., "5/6 pillars" |
| Setup/Reasoning | Setup type description |
| Committee Stance | Aggressive, Balanced, or Defensive |
| Day Trade Tier | A-GRADE, B-GRADE, or — |
| Day-1 Score | e.g., "14/16" or — |
| iATR | Intraday ATR value or — |
| VWAP Bias | ALIGNED, OPPOSED, NEUTRAL, or — |

**Direction encoding for day trades:** Includes the tier suffix — e.g., `DAY LONG (A)` for an A-GRADE long day trade, `DAY SHORT (B)` for a B-GRADE short day trade.

---

## 12. Stage 10 — Frontend Display & Human Review

### Signal Cards

Each signal is displayed as an expandable card showing:

- **Header:** Ticker, direction badge (colour-coded), verdict, grade
- **Key Levels:** Entry, stop, target, risk/reward ratio
- **Swing Trades:** Pillar count (e.g., "5/6 pillars"), setup type
- **Day Trades:** Tier badge (green for A-GRADE, blue for B-GRADE), total score out of 16, iATR, entry type, VWAP bias, Crabel eligibility, stop progression stages
- **Expanded Details:** Full narrative analysis, risk factors, catalyst, pillar-by-pillar assessment

### Pipeline Summary

The frontend displays a funnel summary showing:
- Total universe scanned
- Stocks passing each stage (with pass rates)
- Day-1 assessment counts (A-GRADE, B-GRADE, excluded)
- Near misses (stocks that narrowly failed a gate)

### Human Role

**The system is advisory only.** After analysis completes:
- Signals are displayed for the user to review
- There is no "execute trade" button — the user must manually place any trades via their broker
- There is no automated order routing or brokerage integration
- The user retains full discretion over which signals (if any) to act upon

---

## 13. Risk Controls Summary

### Automated (Code-Enforced, Cannot Be Overridden)

| Control | Stage | Description |
|---------|-------|-------------|
| Earnings block | Stage 4 | Stocks within ±5 days of earnings excluded from trade candidates |
| Volatility spike filter | Stage 4 | Post-news days with range > 2× ATR demoted to WATCH |
| S/R air pocket gate | Stage 4 | Trades blocked if S/R within 0.5R or if S/R blocks 1R target |
| Regime gate | Stage 5 | Market-condition thresholds filter weak candidates |
| Liquidity disqualifier | Stage 6 | Day trade excluded if spread/volume inadequate (Factor 6 = 0) |
| VIX suspension | Stage 6 | All day trades suspended when VIX ≥ 30 |
| VIX size reduction | Stage 6 | Day trade position sizes reduced at VIX 20–29 |
| Score threshold | Stage 6 | Day trades below 10/16 automatically excluded |
| iATR-based stops | Stage 6 | Stop and target distances computed from iATR, AI cannot override |
| R:R minimum | Stage 6 | Day trades with R:R < 1.0 after S/R capping are rejected |

### User-Configurable

| Control | Description |
|---------|-------------|
| Risk per trade | User sets maximum risk % per position |
| Max positions | User sets concurrent position limit |
| Max portfolio heat | User sets total open risk ceiling |
| Short selling toggle | User can disable all short signals |
| Instrument selection | User controls which markets are scanned |

### AI-Enforced (Prompt Constraints)

| Control | Description |
|---------|-------------|
| Cannot upgrade watchlist to trade | Explicit prompt instruction |
| Entry within 1–3% of live price | Prompt instruction (5% hard max) |
| Cannot override iATR distances | Explicit prompt instruction |
| Committee stance limits | Each stance has max heat and position limits |

---

## 14. Deterministic vs AI Boundary

### Code-Computed (Deterministic — Fixed Formulas)

- ✅ Six-pillar scoring (0–60 per direction)
- ✅ Direction assignment (LONG/SHORT/BOTH/WATCH/NONE)
- ✅ RS Slope ranking and percentile bonuses
- ✅ Earnings proximity check
- ✅ Volatility spike detection
- ✅ S/R air pocket gate
- ✅ Regime gate filtering
- ✅ Day-1 nine-factor scoring (0–16)
- ✅ Tier assignment (A-GRADE / B-GRADE / excluded)
- ✅ iATR computation
- ✅ Friction offset
- ✅ Stop/target distances
- ✅ Stop progression ladder (4 stages)
- ✅ Position sizing (including VIX adjustment)
- ✅ Entry type determination
- ✅ Crabel eligibility check
- ✅ Day trade air pocket gate

### AI-Generated (Qualitative Layer)

- ✅ Narrative trade assessment
- ✅ Catalyst identification
- ✅ Risk factor articulation
- ✅ Committee stance selection
- ✅ Entry zone refinement (within constrained range)
- ✅ Open position review and action recommendation
- ✅ Signal quality grading (A+/A/B/C)
- ✅ Watchlist monitoring triggers
- ✅ Qualitative assessment of day trade setups

### Items the AI CANNOT Do

- ❌ Override any code-computed score or threshold
- ❌ Promote watchlist stocks to trade signals
- ❌ Modify iATR-based day trade stop/target distances
- ❌ Include stocks blocked by earnings guard
- ❌ Generate signals for stocks with fewer than 3 aligned pillars
- ❌ Promote sub-10/16 scored stocks to day trades

---

## 15. Data Sources

| Source | Data | Frequency | Caching |
|--------|------|-----------|---------|
| Yahoo Finance (v8 chart API) | Daily OHLCV, previous close, live quotes | Per scan | None (fetched fresh each scan) |
| Yahoo Finance (v8 chart API) | VIX level | Per scan | 15-minute cache |
| Yahoo Finance (v8 chart API) | SPY, ^FTSE benchmark closes | Per scan | 1-hour cache |
| Yahoo Finance (calendar API) | Earnings dates | Per scan | None |
| Anthropic API | Claude Sonnet 4 / Opus 4 | Per analysis | None |
| Google Sheets API | Audit trail persistence | Per analysis | None |

**No real-time streaming data is used.** All data is point-in-time snapshot data fetched at the moment the scan is initiated.

---

## 16. Glossary

| Term | Definition |
|------|------------|
| **ATR** | Average True Range — 14-period measure of daily price volatility |
| **iATR** | Intraday ATR — estimated as daily ATR × 0.65 for day trade distance calculations |
| **Pillar** | One of 6 independent quantitative scoring dimensions (Livermore, O'Neill, Minervini, Darvas, Raschke, Sector RS) |
| **VCP** | Volatility Contraction Pattern — decreasing weekly ranges indicating a potential breakout |
| **RS Slope** | Relative Strength Slope — 20-bar OLS regression of log(stock price / benchmark price) |
| **Air Pocket** | Sufficient empty price space between entry and nearest opposing S/R level |
| **R-unit** | One unit of risk, defined as the distance from entry to stop loss |
| **Regime Gate** | Market-condition-dependent filter that adjusts score/pillar thresholds |
| **HFE** | High Favourable Excursion — the maximum price movement in the trade's favour |
| **Friction** | Execution cost estimate: (spread/2) + (0.02 × iATR), clamped between 1–5% of iATR |
| **VWAP** | Volume-Weighted Average Price — currently stubbed (returns null) pending 5-minute data |
| **Crabel** | Early entry type (before opening range), named after Toby Crabel; A-GRADE only, 6 conditions |
| **Day-1** | The intraday scoring module that evaluates day trade candidates on 9 quantitative factors |
| **MCL** | Market Condition Logic — automated regime classification system |
| **Heat** | Total portfolio risk expressed as % of account (sum of all open position risks) |
| **Near Miss** | A stock that failed a gate by a narrow margin — recorded for transparency |
| **Spread Bet** | UK financial instrument where P/L is calculated as £/point × point movement |

---

*Document generated from system source code analysis. All scoring formulas, thresholds, and constraints are implemented in code and cannot be modified at runtime.*
