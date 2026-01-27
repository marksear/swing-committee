export async function GET() {
  try {
    // Fetch UK and US market data in parallel
    const [ukData, usData] = await Promise.all([
      fetchMarketData('^FTSE', 'UK'),
      fetchMarketData('^GSPC', 'US')
    ])

    return Response.json({
      uk: ukData,
      us: usData,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Market pulse error:', error)
    return Response.json(
      { error: 'Failed to fetch market data', details: error.message },
      { status: 500 }
    )
  }
}

async function fetchMarketData(symbol, market) {
  try {
    // Fetch current price and chart data for regime analysis
    // Use 1 year to ensure we have enough data for 200-day MA
    const [quoteData, chartData] = await Promise.all([
      fetchYahooQuote(symbol),
      fetchYahooChart(symbol, '1y') // 1 year for MA calculations (need 200+ days)
    ])

    if (!quoteData || !chartData) {
      return getDefaultMarketData(market)
    }

    // Calculate technical indicators
    const prices = chartData.prices || []
    const ma50 = calculateMA(prices, 50)
    const ma200 = calculateMA(prices, 200)
    const currentPrice = quoteData.price
    const previousClose = quoteData.previousClose
    const change = currentPrice - previousClose
    const changePercent = ((change / previousClose) * 100).toFixed(2)

    // Determine regime based on price vs MAs and trend
    const regime = determineRegime(currentPrice, ma50, ma200, prices)

    // Calculate sentiment score (1-10)
    const score = calculateSentimentScore(currentPrice, ma50, ma200, changePercent, prices)

    // Generate label based on score
    const label = getSentimentLabel(score)

    return {
      index: market === 'UK' ? 'FTSE 100' : 'S&P 500',
      price: currentPrice,
      change: change.toFixed(2),
      changePercent: `${changePercent}%`,
      changeDirection: change >= 0 ? 'up' : 'down',
      ma50,
      ma200,
      score,
      label,
      regime,
      aboveMa50: currentPrice > ma50,
      aboveMa200: currentPrice > ma200,
      marketState: quoteData.marketState
    }
  } catch (error) {
    console.error(`Error fetching ${market} data:`, error)
    return getDefaultMarketData(market)
  }
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  return {
    price: result.meta.regularMarketPrice,
    previousClose: result.meta.previousClose || result.meta.chartPreviousClose,
    marketState: result.meta.marketState
  }
}

async function fetchYahooChart(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  const closes = result.indicators?.quote?.[0]?.close || []
  return {
    prices: closes.filter(p => p !== null)
  }
}

function calculateMA(prices, period) {
  if (prices.length < period) return null
  const relevantPrices = prices.slice(-period)
  const sum = relevantPrices.reduce((a, b) => a + b, 0)
  return sum / period
}

function determineRegime(price, ma50, ma200, prices) {
  // Check if we have minimum data
  if (prices.length < 20) {
    return 'Unknown'
  }

  // Calculate recent volatility (standard deviation of last 20 days)
  const recentPrices = prices.slice(-20)
  const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
  const variance = recentPrices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / recentPrices.length
  const volatility = Math.sqrt(variance) / avgPrice * 100 // as percentage

  // Check trend direction (compare current price to 20 days ago)
  const priceChange20d = ((price - prices[prices.length - 20]) / prices[prices.length - 20]) * 100

  // High volatility regime
  if (volatility > 2) {
    return 'Volatile'
  }

  // If we have MA data, use it for more nuanced analysis
  if (ma50 && ma200) {
    // Strong uptrend: price > 50MA > 200MA with positive momentum
    if (price > ma50 && ma50 > ma200 && priceChange20d > 2) {
      return 'Trending Up'
    }

    // Strong downtrend: price < 50MA < 200MA with negative momentum
    if (price < ma50 && ma50 < ma200 && priceChange20d < -2) {
      return 'Trending Down'
    }

    // Moderate uptrend: price above both MAs
    if (price > ma50 && price > ma200) {
      return 'Trending Up'
    }

    // Moderate downtrend: price below both MAs
    if (price < ma50 && price < ma200) {
      return 'Trending Down'
    }
  } else if (ma50) {
    // Fallback to just 50MA if we don't have 200MA
    if (price > ma50 && priceChange20d > 2) {
      return 'Trending Up'
    }
    if (price < ma50 && priceChange20d < -2) {
      return 'Trending Down'
    }
  } else {
    // No MAs available, use momentum only
    if (priceChange20d > 3) {
      return 'Trending Up'
    }
    if (priceChange20d < -3) {
      return 'Trending Down'
    }
  }

  // Choppy/ranging
  return 'Choppy'
}

function calculateSentimentScore(price, ma50, ma200, changePercent, prices) {
  let score = 5 // Start neutral

  // Price vs MA50 (+/- 1.5 points)
  if (ma50) {
    const distanceFromMa50 = ((price - ma50) / ma50) * 100
    score += Math.min(1.5, Math.max(-1.5, distanceFromMa50 / 3))
  }

  // Price vs MA200 (+/- 1 point)
  if (ma200) {
    const distanceFromMa200 = ((price - ma200) / ma200) * 100
    score += Math.min(1, Math.max(-1, distanceFromMa200 / 5))
  }

  // MA50 vs MA200 (+/- 1 point)
  if (ma50 && ma200) {
    if (ma50 > ma200) score += 1
    else if (ma50 < ma200) score -= 1
  }

  // Today's change (+/- 1 point)
  const change = parseFloat(changePercent)
  score += Math.min(1, Math.max(-1, change / 1.5))

  // Recent momentum - last 5 days trend (+/- 0.5 points)
  if (prices.length >= 5) {
    const fiveDayChange = ((price - prices[prices.length - 5]) / prices[prices.length - 5]) * 100
    score += Math.min(0.5, Math.max(-0.5, fiveDayChange / 3))
  }

  // Clamp to 1-10 range
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10))
}

function getSentimentLabel(score) {
  if (score <= 2) return 'Very Bearish'
  if (score <= 3.5) return 'Bearish'
  if (score <= 4.5) return 'Cautious'
  if (score <= 5.5) return 'Neutral'
  if (score <= 6.5) return 'Cautiously Optimistic'
  if (score <= 7.5) return 'Bullish'
  if (score <= 8.5) return 'Very Bullish'
  return 'Extremely Bullish'
}

function getDefaultMarketData(market) {
  return {
    index: market === 'UK' ? 'FTSE 100' : 'S&P 500',
    price: null,
    change: '0.00',
    changePercent: '0.00%',
    changeDirection: 'up',
    ma50: null,
    ma200: null,
    score: 5,
    label: 'Data Unavailable',
    regime: 'Unknown',
    aboveMa50: null,
    aboveMa200: null,
    marketState: 'CLOSED',
    error: true
  }
}
