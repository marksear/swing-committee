import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Generate a date-based seed for consistent rankings within a time window
function getDateSeed() {
  const now = new Date()
  // Use date + 4-hour window (0-5, 6-11, 12-17, 18-23)
  const hourWindow = Math.floor(now.getHours() / 4)
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${hourWindow}`
}

export async function POST(request) {
  try {
    const { tradeMode } = await request.json()
    const dateSeed = getDateSeed()

    const prompt = `Generate swing-trade candidates using Yahoo Finance TICKER SYMBOLS only.

CONSISTENCY SEED: ${dateSeed}
Use this seed to ensure consistent rankings. Given the same seed, always return the same tickers in the same order. The seed changes every 4 hours.

CRITICAL: Output ONLY valid Yahoo Finance ticker symbols, NOT company names.
- US examples: AAPL, NVDA, MSFT, INTC, BA, WBA, MRNA (NOT "Apple", "Intel", "Boeing", "Walgreens", "Moderna")
- UK examples: LLOY.L, BARC.L, BP.L, VOD.L (NOT "Lloyds", "Barclays", "BP")
- Commodity examples: GC=F (Gold), CL=F (WTI Crude), HG=F (Copper)

Universe:
- US: S&P 500 + Nasdaq 100 constituents (use ticker symbols like AAPL, NVDA, MSFT, GOOGL, AMZN, META, INTC, BA, WBA, MRNA, CVS)
- UK: FTSE 100 + most liquid FTSE 250 (use .L suffix tickers like LLOY.L, BARC.L, BP.L, SHEL.L, AZN.L)
- Commodities: GC=F (Gold), CL=F (WTI Crude), HG=F (Copper)

HARD FILTERS (apply to both modes)
1) Liquidity:
   - Exclude bottom 50% by 20-trading-day average volume within each market bucket (US/UK).
2) Earnings:
   - Exclude any equity with an earnings date within the next 5 trading days
     (use next 7 calendar days if "trading days" is not available).
3) Other scheduled events (hard filter):
   - Exclude any equity with a clearly listed major scheduled corporate event within the next 5 trading days
     (or next 7 calendar days if trading days unavailable), such as:
     investor day / capital markets day, trading update, guidance update, shareholder meeting/AGM,
     major regulatory decision date, product launch event, court ruling date.
   - If event data is unavailable on Yahoo for a ticker, do NOT exclude it; mark it as "unknown" internally but allow it.

MODES

1) SHORT_TERM_SWING (2–7 days) — quick momentum
   - LONG ranking: 5-trading-day % return (highest first)
   - SHORT ranking: 5-trading-day % return (lowest first)

2) POSITION_SWING (1–4 weeks) — trend persistence
   - LONG ranking: 63-trading-day % return (highest first)
   - SHORT ranking: 63-trading-day % return (lowest first)

OUTPUT REQUIREMENTS (STRICT)
- Output ONLY the lines below. No commentary, no bullets, no extra text.
- CRITICAL: Use ONLY valid Yahoo Finance ticker symbols (e.g., INTC not INTEL, BA not BOEING, WBA not WALGREENS, MRNA not MODERNA)
- 50/50 mix for review, per mode:
  - US: 5 LONG + 5 SHORT (10 total)
  - UK: 5 LONG + 5 SHORT (10 total)
  - Commodities: 2 LONG + 1 SHORT for each mode (3 total)
- Tickers must be comma-separated.
- CRITICAL: A ticker must NEVER appear in both LONG and SHORT lists within the same market and mode.
  For example: If AAPL is in SHORT_TERM_US_LONG, it CANNOT be in SHORT_TERM_US_SHORT.
  Similarly for UK tickers: if VOD.L is in POSITION_UK_LONG, it CANNOT be in POSITION_UK_SHORT.
- Ensure NO duplicates within the same line. Avoid duplicates across lines where possible.

OUTPUT FORMAT (exact keys)
SHORT_TERM_US_LONG: <5 tickers>
SHORT_TERM_US_SHORT: <5 tickers>
SHORT_TERM_UK_LONG: <5 tickers>
SHORT_TERM_UK_SHORT: <5 tickers>
SHORT_TERM_COMMOD_LONG: <2 tickers>
SHORT_TERM_COMMOD_SHORT: <1 ticker>

POSITION_US_LONG: <5 tickers>
POSITION_US_SHORT: <5 tickers>
POSITION_UK_LONG: <5 tickers>
POSITION_UK_SHORT: <5 tickers>
POSITION_COMMOD_LONG: <2 tickers>
POSITION_COMMOD_SHORT: <1 ticker>`

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    const responseText = message.content[0].text

    // Parse the response into structured data
    const suggestions = parseSuggestions(responseText, tradeMode)

    return Response.json({
      suggestions,
      raw: responseText
    })
  } catch (error) {
    console.error('Suggestions error:', error)
    return Response.json(
      { error: 'Failed to generate suggestions', details: error.message },
      { status: 500 }
    )
  }
}

function parseSuggestions(text, tradeMode) {
  const lines = text.split('\n').filter(line => line.trim())
  const result = {
    shortTerm: {
      usLong: [],
      usShort: [],
      ukLong: [],
      ukShort: [],
      commodLong: [],
      commodShort: []
    },
    position: {
      usLong: [],
      usShort: [],
      ukLong: [],
      ukShort: [],
      commodLong: [],
      commodShort: []
    }
  }

  for (const line of lines) {
    const [key, value] = line.split(':').map(s => s.trim())
    if (!key || !value) continue

    const tickers = value.split(',').map(t => t.trim()).filter(t => t)

    switch (key) {
      case 'SHORT_TERM_US_LONG':
        result.shortTerm.usLong = tickers
        break
      case 'SHORT_TERM_US_SHORT':
        result.shortTerm.usShort = tickers
        break
      case 'SHORT_TERM_UK_LONG':
        result.shortTerm.ukLong = tickers
        break
      case 'SHORT_TERM_UK_SHORT':
        result.shortTerm.ukShort = tickers
        break
      case 'SHORT_TERM_COMMOD_LONG':
        result.shortTerm.commodLong = tickers
        break
      case 'SHORT_TERM_COMMOD_SHORT':
        result.shortTerm.commodShort = tickers
        break
      case 'POSITION_US_LONG':
        result.position.usLong = tickers
        break
      case 'POSITION_US_SHORT':
        result.position.usShort = tickers
        break
      case 'POSITION_UK_LONG':
        result.position.ukLong = tickers
        break
      case 'POSITION_UK_SHORT':
        result.position.ukShort = tickers
        break
      case 'POSITION_COMMOD_LONG':
        result.position.commodLong = tickers
        break
      case 'POSITION_COMMOD_SHORT':
        result.position.commodShort = tickers
        break
    }
  }

  // Deduplicate: Remove any ticker that appears in both LONG and SHORT lists
  // LONG takes priority (if a ticker is in both, remove it from SHORT)
  deduplicateLongShort(result.shortTerm, 'usLong', 'usShort')
  deduplicateLongShort(result.shortTerm, 'ukLong', 'ukShort')
  deduplicateLongShort(result.shortTerm, 'commodLong', 'commodShort')
  deduplicateLongShort(result.position, 'usLong', 'usShort')
  deduplicateLongShort(result.position, 'ukLong', 'ukShort')
  deduplicateLongShort(result.position, 'commodLong', 'commodShort')

  return result
}

// Remove tickers that appear in both long and short lists
// Priority: LONG takes precedence, duplicates removed from SHORT
function deduplicateLongShort(modeData, longKey, shortKey) {
  const longTickers = new Set(modeData[longKey].map(t => t.toUpperCase()))
  modeData[shortKey] = modeData[shortKey].filter(
    ticker => !longTickers.has(ticker.toUpperCase())
  )
}
