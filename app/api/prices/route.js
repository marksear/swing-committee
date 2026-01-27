export async function POST(request) {
  try {
    const { tickers } = await request.json()

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return Response.json({ error: 'No tickers provided' }, { status: 400 })
    }

    // Fetch prices for all tickers in parallel
    const pricePromises = tickers.map(async (ticker) => {
      try {
        // Clean the ticker (handle UK stocks with .L suffix)
        let yahooTicker = ticker.toUpperCase().trim()

        // Yahoo Finance API endpoint
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })

        if (!response.ok) {
          // Try with .L suffix for UK stocks
          if (!yahooTicker.includes('.')) {
            const ukUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}.L?interval=1d&range=1d`
            const ukResponse = await fetch(ukUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            })
            if (ukResponse.ok) {
              const ukData = await ukResponse.json()
              return parseYahooResponse(yahooTicker + '.L', ukData)
            }
          }
          return { ticker: yahooTicker, error: 'Not found' }
        }

        const data = await response.json()
        return parseYahooResponse(yahooTicker, data)

      } catch (error) {
        return { ticker, error: error.message }
      }
    })

    const prices = await Promise.all(pricePromises)

    return Response.json({ prices })
  } catch (error) {
    console.error('Price fetch error:', error)
    return Response.json({ error: 'Failed to fetch prices', details: error.message }, { status: 500 })
  }
}

function parseYahooResponse(ticker, data) {
  try {
    const result = data.chart?.result?.[0]
    if (!result) {
      return { ticker, error: 'No data' }
    }

    const meta = result.meta
    const quote = result.indicators?.quote?.[0]

    const currentPrice = meta.regularMarketPrice
    const previousClose = meta.previousClose || meta.chartPreviousClose
    const change = currentPrice - previousClose
    const changePercent = ((change / previousClose) * 100).toFixed(2)
    const currency = meta.currency || 'USD'

    // Get today's high/low if available
    const high = quote?.high?.[quote.high.length - 1] || meta.regularMarketDayHigh
    const low = quote?.low?.[quote.low.length - 1] || meta.regularMarketDayLow
    const volume = quote?.volume?.[quote.volume.length - 1] || meta.regularMarketVolume

    return {
      ticker,
      name: meta.shortName || meta.symbol,
      price: currentPrice,
      currency,
      change: change.toFixed(2),
      changePercent: `${changePercent}%`,
      high,
      low,
      volume,
      previousClose,
      marketState: meta.marketState, // PRE, REGULAR, POST, CLOSED
      exchange: meta.exchangeName
    }
  } catch (error) {
    return { ticker, error: 'Parse error' }
  }
}
