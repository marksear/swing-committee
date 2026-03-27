// Shared ticker universe — used by scanner, calendar, and day trade scorer
// S&P 100 (top 100 by market cap) + top 25 Nasdaq-100 not in S&P 100
// ~125 unique US names covering mega-cap and large-cap growth/tech
export const US_STOCKS = [
  // ── S&P 100 (by market cap) ──
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'BRK-B', 'WMT',
  'LLY', 'JPM', 'XOM', 'V', 'JNJ', 'MA', 'ORCL', 'COST', 'ABBV', 'HD',
  'BAC', 'PG', 'CVX', 'CAT', 'KO', 'AMD', 'GE', 'NFLX', 'PLTR', 'CSCO',
  'MRK', 'PM', 'GS', 'MS', 'WFC', 'RTX', 'UNH', 'IBM', 'TMUS', 'INTC',
  'MCD', 'AXP', 'PEP', 'LIN', 'VZ', 'TXN', 'T', 'AMGN', 'ABT', 'NEE',
  'C', 'GILD', 'BA', 'TMO', 'DIS', 'CRM', 'ISRG', 'SCHW', 'BLK', 'DE',
  'LOW', 'PFE', 'UNP', 'HON', 'DHR', 'LMT', 'QCOM', 'UBER', 'ACN', 'COP',
  'BKNG', 'COF', 'MDT', 'BMY', 'CMCSA', 'MO', 'NOW', 'INTU', 'ADBE', 'SBUX',
  'SO', 'UPS', 'CVS', 'DUK', 'GD', 'NKE', 'MMM', 'AMT', 'USB', 'FDX',
  'EMR', 'BK', 'MDLZ', 'CL', 'GM', 'SPG', 'TGT', 'MET', 'AIG', 'PYPL',
  // ── Nasdaq-100 top 25 NOT in S&P 100 ──
  'ASML', 'LRCX', 'AMAT', 'KLAC', 'ADI', 'SHOP', 'PDD', 'PANW', 'ARM', 'APP',
  'CRWD', 'CEG', 'MELI', 'WDC', 'MAR', 'STX', 'ADP', 'REGN', 'SNPS', 'CDNS',
  'ORLY', 'MNST', 'CTAS', 'CSX', 'ABNB'
]

// FTSE 100 — top 50 most liquid by market cap
export const UK_STOCKS = [
  'SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'BP.L', 'GSK.L', 'RIO.L', 'REL.L', 'DGE.L', 'BATS.L',
  'LSEG.L', 'NG.L', 'AAL.L', 'GLEN.L', 'VOD.L', 'BHP.L', 'PRU.L', 'LLOY.L', 'BARC.L', 'RKT.L',
  'IMB.L', 'SSE.L', 'AHT.L', 'BA.L', 'CPG.L', 'EXPN.L', 'STAN.L', 'ABF.L', 'ANTO.L', 'CRH.L',
  'FERG.L', 'IAG.L', 'IHG.L', 'KGF.L', 'LAND.L', 'LGEN.L', 'MNG.L', 'NWG.L', 'PSON.L', 'RR.L',
  'SBRY.L', 'SGE.L', 'SMDS.L', 'SMT.L', 'SN.L', 'SPX.L', 'SVT.L', 'TSCO.L', 'WPP.L', 'WTB.L'
]

// FTSE 250 — top 50 most liquid by market cap (mid-cap swing candidates)
export const UK_STOCKS_250 = [
  'AUTO.L', 'DARK.L', 'WEIR.L', 'MNDI.L', 'HIK.L',
  'HWDN.L', 'SMIN.L', 'IGG.L', 'PHNX.L', 'BDEV.L',
  'TW.L',   'RSW.L',  'HLMA.L', 'CRDA.L', 'OSB.L',
  'DPLM.L', 'IMI.L',  'RTO.L',  'BNZL.L', 'JET2.L',
  'TPK.L',  'DOCS.L', 'INF.L',  'TMPL.L', 'AGK.L',
  'MGAM.L', 'BOWL.L', 'BWNG.L', 'FOUR.L', 'SDR.L',
  'JDW.L',  'CARD.L', 'ITV.L',  'HSX.L',  'BOY.L',
  'GNS.L',  'FDM.L',  'BME.L',  'DRVL.L', 'GAW.L',
  'INCH.L', 'PAGE.L', 'VTY.L',  'BRBY.L', 'EZJ.L',
  'WHC.L',  'BYIT.L', 'SHI.L',  'CINE.L', 'HBR.L'
]

// Major indices
export const INDICES = [
  '^GSPC',   // S&P 500
  '^DJI',    // Dow Jones
  '^IXIC',   // NASDAQ Composite
  '^FTSE',   // FTSE 100
  '^GDAXI',  // DAX
  '^FCHI',   // CAC 40
  '^N225',   // Nikkei 225
  '^HSI',    // Hang Seng
]

// Major forex pairs
export const FOREX = [
  'GBPUSD=X', 'EURUSD=X', 'USDJPY=X', 'AUDUSD=X',
  'USDCAD=X', 'USDCHF=X', 'EURGBP=X', 'GBPJPY=X',
]

// Major cryptocurrencies
export const CRYPTO = [
  'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD',
  'SOL-USD', 'ADA-USD', 'DOGE-USD', 'AVAX-USD',
]

// Key commodities
export const COMMODITIES = [
  'GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F', 'HG=F',
]

// Combined universe object (backward-compatible with scanner)
export const UNIVERSE = {
  usStocks: US_STOCKS,
  ukStocks: UK_STOCKS,
  ukStocks250: UK_STOCKS_250,
  indices: INDICES,
  forex: FOREX,
  crypto: CRYPTO,
  commodities: COMMODITIES,
}
