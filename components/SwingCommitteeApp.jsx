'use client'

import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Shield, Brain, ChevronRight, ChevronLeft,
  Check, AlertCircle, Loader2, Target, Zap, Rocket, BarChart2,
  Newspaper, ChevronDown, Activity, Clock, DollarSign, ShieldAlert,
  ArrowUpRight, ArrowDownRight, Crosshair, LineChart, BarChart3,
  AlertTriangle, Eye, Scale, Flame, Gauge, Calendar, BookOpen, Lightbulb,
  XCircle, RefreshCw, Sparkles
} from 'lucide-react';

export default function SwingCommitteeApp() {
  const [step, setStep] = useState(0);  // Start at welcome screen with Market Pulse
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [showUKSources, setShowUKSources] = useState(false);
  const [showUSSources, setShowUSSources] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState(null);
  const [expandedPosition, setExpandedPosition] = useState(null);
  const [activeReportTab, setActiveReportTab] = useState('summary');
  const [watchlistPrices, setWatchlistPrices] = useState({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [priceError, setPriceError] = useState(null);
  const [marketPulseData, setMarketPulseData] = useState(null);
  const [isLoadingMarketPulse, setIsLoadingMarketPulse] = useState(true);
  const [marketPulseError, setMarketPulseError] = useState(null);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  const [formData, setFormData] = useState({
    // Account
    accountSize: '10000',
    riskPerTrade: '1',
    maxPositions: '6',
    maxHeat: '6',
    // Permissions
    shortSellingAllowed: true,
    ukStocks: true,
    usStocks: true,
    indices: false,
    forex: false,
    crypto: false,
    // Execution Mode
    executionMode: 'spread_bet', // Spread bet only
    spreadBetBroker: 'IG',
    // Positions
    openPositions: '',
    // Watchlist
    watchlist: '',
    // Session
    tradeMode: 'short_term',
    marketSentiment: 5,
    regimeView: 'uncertain',
    sessionType: 'daily',
  });

  const steps = [
    { title: 'Welcome', icon: BookOpen },
    { title: 'Account', icon: DollarSign },
    { title: 'Positions', icon: BarChart3 },
    { title: 'Watchlist', icon: Eye },
    { title: 'Session', icon: Activity },
    { title: 'Analysis', icon: Brain },
  ];

  // Fetch Market Pulse on component mount
  const fetchMarketPulse = async () => {
    setIsLoadingMarketPulse(true);
    setMarketPulseError(null);

    try {
      const response = await fetch('/api/market-pulse');
      if (!response.ok) throw new Error('Failed to fetch market data');

      const data = await response.json();
      setMarketPulseData(data);
    } catch (error) {
      setMarketPulseError(error.message);
      // Set fallback data on error
      setMarketPulseData({
        uk: { score: 5, label: 'Data Unavailable', regime: 'Unknown', changeDirection: 'up', change: '0.00' },
        us: { score: 5, label: 'Data Unavailable', regime: 'Unknown', changeDirection: 'up', change: '0.00' }
      });
    } finally {
      setIsLoadingMarketPulse(false);
    }
  };

  useEffect(() => {
    fetchMarketPulse();
    // No localStorage caching - Google Sheets is the source of truth
  }, []);

  // Reset all analysis-related state for a fresh start
  const resetForNewAnalysis = () => {
    // Reset analysis state
    setStep(0);  // Go back to welcome screen
    setAnalysisComplete(false);
    setAnalysisResult(null);
    setAnalysisError(null);

    // Clear watchlist and prices
    setWatchlistPrices({});
    setPriceError(null);

    // Clear suggestions
    setSuggestions(null);
    setSuggestionsError(null);
    setShowSuggestions(false);

    // Clear watchlist tickers in form
    setFormData(prev => ({
      ...prev,
      watchlist: ''
    }));

    // Reset UI state
    setExpandedSignal(null);
    setActiveReportTab('summary');
    setShowUKSources(false);
    setShowUSSources(false);
  };

  const getMarketSentimentColor = (score) => {
    if (score <= 3) return { text: 'text-red-600', bg: 'bg-red-500', light: 'bg-red-100' };
    if (score <= 4.5) return { text: 'text-orange-600', bg: 'bg-orange-500', light: 'bg-orange-100' };
    if (score <= 5.5) return { text: 'text-amber-600', bg: 'bg-amber-500', light: 'bg-amber-100' };
    if (score <= 7) return { text: 'text-lime-600', bg: 'bg-lime-500', light: 'bg-lime-100' };
    return { text: 'text-green-600', bg: 'bg-green-500', light: 'bg-green-100' };
  };

  const getSentimentLabel = (value) => {
    if (value <= 2) return { label: 'Very Bearish', color: 'text-red-600', bg: 'bg-red-50' };
    if (value <= 4) return { label: 'Cautious', color: 'text-orange-600', bg: 'bg-orange-50' };
    if (value <= 6) return { label: 'Neutral', color: 'text-amber-600', bg: 'bg-amber-50' };
    if (value <= 8) return { label: 'Bullish', color: 'text-lime-600', bg: 'bg-lime-50' };
    return { label: 'Very Bullish', color: 'text-green-600', bg: 'bg-green-50' };
  };

  const analysisSteps = [
    'Loading account parameters...',
    'Scanning market regime...',
    'Checking UK market breadth...',
    'Checking US market breadth...',
    'Reviewing open positions...',
    'Applying Livermore pivotal points...',
    'Running O\'Neil CANSLIM screen...',
    'Checking Minervini trend template...',
    'Identifying Darvas boxes...',
    'Raschke momentum analysis...',
    'Sector RS check...',
    'Scoring setups against 6 pillars...',
    'Building committee positions...',
    'Calculating position sizes...',
    'Generating trade signals...',
  ];

  const [currentAnalysisStep, setCurrentAnalysisStep] = useState(0);

  // Extract tickers from watchlist text
  const extractTickers = (text) => {
    if (!text) return [];
    const lines = text.split('\n').filter(line => line.trim());
    return lines.map(line => {
      // Skip comment lines (starting with #)
      if (line.trim().startsWith('#')) return null;
      const parts = line.split(',');
      return parts[0]?.trim().toUpperCase();
    }).filter(ticker => ticker && ticker.length >= 1 && !ticker.startsWith('#'));
  };

  // Fetch live prices from Yahoo Finance
  const fetchPrices = async () => {
    const tickers = extractTickers(formData.watchlist);
    if (tickers.length === 0) {
      setPriceError('No valid tickers found');
      return;
    }

    setIsFetchingPrices(true);
    setPriceError(null);

    try {
      const response = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      });

      if (!response.ok) throw new Error('Failed to fetch prices');

      const data = await response.json();
      const priceMap = {};
      data.prices.forEach(p => {
        // Only include stocks with valid prices (no errors, valid price number)
        if (!p.error && p.price !== undefined && p.price !== null && !isNaN(p.price)) {
          priceMap[p.ticker] = p;
        }
      });
      setWatchlistPrices(priceMap);
    } catch (error) {
      setPriceError(error.message);
    } finally {
      setIsFetchingPrices(false);
    }
  };

  // Format price for display
  const formatPrice = (price, currency) => {
    if (price === undefined || price === null) return 'N/A';
    if (currency === 'GBp') return `${price.toFixed(0)}p`; // UK pence
    if (currency === 'GBP') return `£${price.toFixed(2)}`;
    return `$${price.toFixed(2)}`;
  };

  // Generate watchlist suggestions using Claude
  const generateSuggestions = async () => {
    setIsGeneratingSuggestions(true);
    setSuggestionsError(null);
    setShowSuggestions(true);

    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeMode: formData.tradeMode })
      });

      if (!response.ok) throw new Error('Failed to generate suggestions');

      const data = await response.json();
      setSuggestions(data.suggestions);
    } catch (error) {
      setSuggestionsError(error.message);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  // Add suggested tickers to watchlist
  const addSuggestionsToWatchlist = (tickers, label) => {
    const tickerList = tickers.join('\n');
    const comment = `# ${label}`;
    const newEntry = `${comment}\n${tickerList}`;

    const currentWatchlist = formData.watchlist.trim();
    const updatedWatchlist = currentWatchlist
      ? `${currentWatchlist}\n\n${newEntry}`
      : newEntry;

    setFormData({ ...formData, watchlist: updatedWatchlist });
    setWatchlistPrices({}); // Clear prices when watchlist changes
  };

  // Run technical scanner on market universe
  const runScanner = async () => {
    setIsScanning(true);
    setScanError(null);
    setScanResults(null); // Clear previous results
    setShowScanner(true);

    try {
      // Determine overall market trend from US and UK regimes
      let marketTrend = 'neutral';
      if (marketPulseData) {
        const usUp = marketPulseData.us?.regime === 'Trending Up';
        const ukUp = marketPulseData.uk?.regime === 'Trending Up';
        const usDown = marketPulseData.us?.regime === 'Trending Down';
        const ukDown = marketPulseData.uk?.regime === 'Trending Down';

        // If both or one is trending, use that direction
        if (usUp || ukUp) marketTrend = 'up';
        if (usDown || ukDown) marketTrend = 'down';
        // If conflicting, stay neutral
        if ((usUp && ukDown) || (usDown && ukUp)) marketTrend = 'neutral';
      }

      // ========================================
      // REGIME GATE - Per-Market Risk Assessment
      // ========================================
      // Risk-On if: benchmark > rising 50DMA AND distribution days ≤ 4
      // Risk-Off: tighter filters, half position size, fewer trades

      // Calculate per-market regime gate
      const calculateMarketRisk = (market) => {
        if (!market) return { riskOn: true, aboveMa50: true, ma50Rising: true, distributionDays: 0 };
        const aboveMa50 = market.aboveMa50 === true;
        const ma50Rising = market.ma50Rising === true;
        const distributionDays = market.distributionDays || 0;
        const isRiskOn = aboveMa50 && ma50Rising && distributionDays <= 4;
        return { riskOn: isRiskOn, aboveMa50, ma50Rising, distributionDays };
      };

      const ukRisk = marketPulseData ? calculateMarketRisk(marketPulseData.uk) : { riskOn: true, aboveMa50: true, ma50Rising: true, distributionDays: 0 };
      const usRisk = marketPulseData ? calculateMarketRisk(marketPulseData.us) : { riskOn: true, aboveMa50: true, ma50Rising: true, distributionDays: 0 };

      // Overall regime gate - conservative: if EITHER market is Risk-Off, apply tighter filters
      const overallRiskOn = ukRisk.riskOn && usRisk.riskOn;

      const regimeGate = {
        riskOn: overallRiskOn,
        uk: ukRisk,
        us: usRisk
      };

      const response = await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'short_term',
          marketTrend,
          shortSellingAllowed: formData.shortSellingAllowed,
          regimeGate,
          instruments: {
            ukStocks: formData.ukStocks,
            usStocks: formData.usStocks,
            indices: formData.indices,
            forex: formData.forex,
            crypto: formData.crypto
          },
          // Account data for £ per point position sizing
          accountSize: formData.accountSize,
          riskPerTrade: formData.riskPerTrade
        })
      });

      if (!response.ok) throw new Error('Scanner failed');

      const data = await response.json();
      setScanResults(data);

      // Save to Google Sheets
      try {
        const sheetsResponse = await fetch('/api/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'saveScanResults', data })
        });
        const sheetsResult = await sheetsResponse.json();
        console.log('Scan results saved to sheets:', sheetsResult);
      } catch (err) {
        console.log('Sheets save skipped:', err.message);
      }

    } catch (error) {
      setScanError(error.message);
    } finally {
      setIsScanning(false);
    }
  };

  // Add scanned stocks to watchlist
  const addScanResultsToWatchlist = (stocks, label) => {
    const tickerList = stocks.map(s => s.ticker).join('\n');
    const comment = `# ${label}`;
    const newEntry = `${comment}\n${tickerList}`;

    const currentWatchlist = formData.watchlist.trim();
    const updatedWatchlist = currentWatchlist
      ? `${currentWatchlist}\n\n${newEntry}`
      : newEntry;

    setFormData({ ...formData, watchlist: updatedWatchlist });
    setWatchlistPrices({});
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setCurrentAnalysisStep(0);
    setAnalysisError(null);

    // Animate through steps while waiting for API
    const interval = setInterval(() => {
      setCurrentAnalysisStep(prev => {
        if (prev >= analysisSteps.length - 1) return prev;
        return prev + 1;
      });
    }, 800);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData,
          marketPulse: {
            uk: { score: marketPulseData.uk.score, label: marketPulseData.uk.label, regime: marketPulseData.uk.regime },
            us: { score: marketPulseData.us.score, label: marketPulseData.us.label, regime: marketPulseData.us.regime }
          },
          livePrices: watchlistPrices, // Pass live prices to the analysis
          scannerResults: scanResults || null // Pass scanner data so AI respects quantitative gate
        })
      });

      clearInterval(interval);

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result = await response.json();
      setAnalysisResult(result);
      setCurrentAnalysisStep(analysisSteps.length - 1);

      // Save trade signals to Google Sheets (fire and forget)
      fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveTradeSignals', data: result })
      }).catch(err => console.log('Sheets save skipped:', err.message));

      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisComplete(true);
      }, 500);

    } catch (error) {
      clearInterval(interval);
      setAnalysisError(error.message);
      setIsAnalyzing(false);
    }
  };

  const getGradeColor = (grade) => {
    if (!grade) return 'bg-gray-400';
    if (grade === 'A+' || grade === 'A') return 'bg-green-600';
    if (grade === 'B') return 'bg-amber-500';
    return 'bg-gray-400';
  };

  // Helper to check if signal is a NO TRADE
  const isNoTrade = (signal) => {
    const verdict = (signal?.verdict || '').toUpperCase();
    const direction = (signal?.direction || '').toUpperCase();
    const rawSection = (signal?.rawSection || '').toUpperCase();

    // Check verdict field
    if (verdict.includes('NO TRADE') || verdict === 'PASS') return true;
    // Check direction field
    if (direction.includes('NO TRADE') || direction === 'PASS') return true;
    // Check raw section for explicit NO TRADE verdict
    if (rawSection.includes('**VERDICT:** NO TRADE') || rawSection.includes('VERDICT: NO TRADE')) return true;
    if (rawSection.includes('- DIRECTION: NO TRADE')) return true;

    return false;
  };

  // Helper to check if signal is WATCHLIST
  const isWatchlist = (signal) => {
    const verdict = (signal?.verdict || '').toUpperCase();
    const direction = (signal?.direction || '').toUpperCase();

    if (verdict.includes('WATCHLIST')) return true;
    if (direction.includes('WATCHLIST')) return true;

    return false;
  };

  // Helper to get actual trade direction (LONG/SHORT) - only if it's a real trade
  const getTradeDirection = (signal) => {
    if (isNoTrade(signal) || isWatchlist(signal)) return null;

    const direction = (signal?.direction || '').toUpperCase();
    if (direction === 'LONG') return 'LONG';
    if (direction === 'SHORT') return 'SHORT';
    return null;
  };

  const getSignalBoxColor = (signal) => {
    // NO TRADE = should not be shown (filtered out)
    if (isNoTrade(signal)) return 'bg-red-500';
    // WATCHLIST = orange
    if (isWatchlist(signal)) return 'bg-orange-500';
    // TAKE TRADE with direction
    const tradeDir = getTradeDirection(signal);
    if (tradeDir === 'LONG') return 'bg-green-600';
    if (tradeDir === 'SHORT') return 'bg-red-600';
    // Fallback
    return 'bg-gray-400';
  };

  const getSignalBoxLabel = (signal) => {
    // NO TRADE = should not be shown
    if (isNoTrade(signal)) return '✕';
    // WATCHLIST = W
    if (isWatchlist(signal)) return 'W';
    // TAKE TRADE with direction
    const tradeDir = getTradeDirection(signal);
    if (tradeDir === 'LONG') return 'L';
    if (tradeDir === 'SHORT') return 'S';
    // Fallback
    return '?';
  };

  const getVerdictColor = (verdict) => {
    if (!verdict) return 'bg-gray-100 text-gray-600';
    if (verdict === 'TAKE TRADE') return 'bg-green-100 text-green-700';
    if (verdict === 'WATCHLIST') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-8">
            {/* Hero Section */}
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg">
                <Activity className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900">The Trading Program</h1>
              <p className="text-gray-600 max-w-md mx-auto">
                Systematic swing trading using the wisdom of Livermore, O'Neil, Minervini, Darvas, Raschke & Sector RS.
              </p>
              <div className="grid grid-cols-6 gap-2 max-w-lg mx-auto pt-4">
                {[
                  { name: 'Livermore', short: 'L', color: 'bg-blue-100 text-blue-700' },
                  { name: 'O\'Neil', short: 'O', color: 'bg-green-100 text-green-700' },
                  { name: 'Minervini', short: 'M', color: 'bg-purple-100 text-purple-700' },
                  { name: 'Darvas', short: 'D', color: 'bg-amber-100 text-amber-700' },
                  { name: 'Raschke', short: 'R', color: 'bg-pink-100 text-pink-700' },
                  { name: 'Sector RS', short: 'RS', color: 'bg-indigo-100 text-indigo-700' },
                ].map((master) => (
                  <div key={master.name} className="text-center">
                    <div className={`w-10 h-10 ${master.color} rounded-full mx-auto mb-1 flex items-center justify-center text-sm font-bold`}>
                      {master.short}
                    </div>
                    <span className="text-xs text-gray-500">{master.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Market Pulse Section */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                    <BarChart2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">Market Pulse</h2>
                    <p className="text-gray-400 text-sm">Live data from Yahoo Finance</p>
                  </div>
                </div>
                <button
                  onClick={fetchMarketPulse}
                  disabled={isLoadingMarketPulse}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingMarketPulse ? 'animate-spin' : ''}`} />
                  {isLoadingMarketPulse ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {isLoadingMarketPulse && !marketPulseData ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                  <span className="ml-3 text-gray-400">Fetching live market data...</span>
                </div>
              ) : marketPulseError && !marketPulseData ? (
                <div className="bg-red-500/20 rounded-xl p-4 text-center">
                  <p className="text-red-300">{marketPulseError}</p>
                  <button onClick={fetchMarketPulse} className="mt-2 text-sm underline">Try again</button>
                </div>
              ) : marketPulseData && (
              <div className="grid md:grid-cols-2 gap-4">
                {/* UK Market */}
                <div className="bg-white rounded-xl text-gray-900 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🇬🇧</span>
                        <span className="font-bold">{marketPulseData.uk.index || 'FTSE 100'}</span>
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        marketPulseData.uk.regime === 'Trending Up' ? 'bg-green-100 text-green-700' :
                        marketPulseData.uk.regime === 'Trending Down' ? 'bg-red-100 text-red-700' :
                        marketPulseData.uk.regime === 'Volatile' ? 'bg-orange-100 text-orange-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {marketPulseData.uk.regime}
                      </span>
                    </div>
                    {marketPulseData.uk.price && (
                      <p className="text-xs text-gray-500 mt-1">{marketPulseData.uk.price.toLocaleString()} pts</p>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className={`text-2xl font-bold ${getMarketSentimentColor(marketPulseData.uk.score).text}`}>
                          {marketPulseData.uk.score?.toFixed(1) || '—'}
                        </p>
                        <p className="text-xs text-gray-500">{marketPulseData.uk.label}</p>
                      </div>
                      <div className={`flex items-center gap-1 text-sm ${marketPulseData.uk.changeDirection === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                        {marketPulseData.uk.changeDirection === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {marketPulseData.uk.changePercent || marketPulseData.uk.change}
                      </div>
                    </div>
                    <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-amber-500 to-green-500">
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-5 bg-white border-2 border-gray-800 rounded-sm shadow-lg"
                        style={{ left: `calc(${((marketPulseData.uk.score || 5) / 10) * 100}% - 8px)` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-400">
                      <span>Bearish</span>
                      <span>Bullish</span>
                    </div>
                    {marketPulseData.uk.aboveMa50 !== null && (
                      <div className="flex flex-wrap gap-2 mt-3 text-xs">
                        <span className={`px-2 py-0.5 rounded ${marketPulseData.uk.aboveMa50 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {marketPulseData.uk.aboveMa50 ? '↑' : '↓'} 50MA
                          {marketPulseData.uk.ma50Rising !== null && (
                            <span className="ml-1 opacity-75">{marketPulseData.uk.ma50Rising ? '(rising)' : '(falling)'}</span>
                          )}
                        </span>
                        <span className={`px-2 py-0.5 rounded ${marketPulseData.uk.aboveMa200 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {marketPulseData.uk.aboveMa200 ? '↑' : '↓'} 200MA
                        </span>
                        {marketPulseData.uk.distributionDays !== undefined && (
                          <span className={`px-2 py-0.5 rounded ${marketPulseData.uk.distributionDays <= 4 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {marketPulseData.uk.distributionDays} dist days
                          </span>
                        )}
                        {/* Per-market RISK-ON/OFF indicator */}
                        {(() => {
                          const isRiskOn = marketPulseData.uk.aboveMa50 && marketPulseData.uk.ma50Rising && (marketPulseData.uk.distributionDays || 0) <= 4;
                          return (
                            <span className={`px-2 py-0.5 rounded font-bold ${isRiskOn ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>
                              {isRiskOn ? '🟢 RISK-ON' : '🟠 RISK-OFF'}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* US Market */}
                <div className="bg-white rounded-xl text-gray-900 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🇺🇸</span>
                        <span className="font-bold">{marketPulseData.us.index || 'S&P 500'}</span>
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        marketPulseData.us.regime === 'Trending Up' ? 'bg-green-100 text-green-700' :
                        marketPulseData.us.regime === 'Trending Down' ? 'bg-red-100 text-red-700' :
                        marketPulseData.us.regime === 'Volatile' ? 'bg-orange-100 text-orange-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {marketPulseData.us.regime}
                      </span>
                    </div>
                    {marketPulseData.us.price && (
                      <p className="text-xs text-gray-500 mt-1">{marketPulseData.us.price.toLocaleString()} pts</p>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className={`text-2xl font-bold ${getMarketSentimentColor(marketPulseData.us.score).text}`}>
                          {marketPulseData.us.score?.toFixed(1) || '—'}
                        </p>
                        <p className="text-xs text-gray-500">{marketPulseData.us.label}</p>
                      </div>
                      <div className={`flex items-center gap-1 text-sm ${marketPulseData.us.changeDirection === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                        {marketPulseData.us.changeDirection === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {marketPulseData.us.changePercent || marketPulseData.us.change}
                      </div>
                    </div>
                    <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-amber-500 to-green-500">
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-5 bg-white border-2 border-gray-800 rounded-sm shadow-lg"
                        style={{ left: `calc(${((marketPulseData.us.score || 5) / 10) * 100}% - 8px)` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-400">
                      <span>Bearish</span>
                      <span>Bullish</span>
                    </div>
                    {marketPulseData.us.aboveMa50 !== null && (
                      <div className="flex flex-wrap gap-2 mt-3 text-xs">
                        <span className={`px-2 py-0.5 rounded ${marketPulseData.us.aboveMa50 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {marketPulseData.us.aboveMa50 ? '↑' : '↓'} 50MA
                          {marketPulseData.us.ma50Rising !== null && (
                            <span className="ml-1 opacity-75">{marketPulseData.us.ma50Rising ? '(rising)' : '(falling)'}</span>
                          )}
                        </span>
                        <span className={`px-2 py-0.5 rounded ${marketPulseData.us.aboveMa200 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {marketPulseData.us.aboveMa200 ? '↑' : '↓'} 200MA
                        </span>
                        {marketPulseData.us.distributionDays !== undefined && (
                          <span className={`px-2 py-0.5 rounded ${marketPulseData.us.distributionDays <= 4 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {marketPulseData.us.distributionDays} dist days
                          </span>
                        )}
                        {/* Per-market RISK-ON/OFF indicator */}
                        {(() => {
                          const isRiskOn = marketPulseData.us.aboveMa50 && marketPulseData.us.ma50Rising && (marketPulseData.us.distributionDays || 0) <= 4;
                          return (
                            <span className={`px-2 py-0.5 rounded font-bold ${isRiskOn ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>
                              {isRiskOn ? '🟢 RISK-ON' : '🟠 RISK-OFF'}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>

            {/* Risk Warning */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <strong>Risk Warning:</strong> Swing trading involves substantial risk of loss. Never risk more than you can afford to lose. This is educational only — not financial advice.
              </p>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Account Settings</h2>
            <p className="text-gray-600">Configure your risk parameters</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Size (£)</label>
                <input
                  type="number"
                  value={formData.accountSize}
                  onChange={(e) => setFormData({ ...formData, accountSize: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Risk Per Trade (%)</label>
                <select
                  value={formData.riskPerTrade}
                  onChange={(e) => setFormData({ ...formData, riskPerTrade: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="0.5">0.5% (Conservative)</option>
                  <option value="1">1% (Standard)</option>
                  <option value="2">2% (Aggressive)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Positions</label>
                <select
                  value={formData.maxPositions}
                  onChange={(e) => setFormData({ ...formData, maxPositions: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="4">4 positions</option>
                  <option value="5">5 positions</option>
                  <option value="6">6 positions</option>
                  <option value="8">8 positions</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Portfolio Heat (%)</label>
                <select
                  value={formData.maxHeat}
                  onChange={(e) => setFormData({ ...formData, maxHeat: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="4">4% (Conservative)</option>
                  <option value="6">6% (Standard)</option>
                  <option value="8">8% (Aggressive)</option>
                </select>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="font-medium text-gray-900 mb-4">Trading Permissions</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Short Selling</p>
                    <p className="text-sm text-gray-500">Allow short positions</p>
                  </div>
                  <button
                    onClick={() => setFormData({ ...formData, shortSellingAllowed: !formData.shortSellingAllowed })}
                    className={`w-12 h-7 rounded-full transition-colors relative ${formData.shortSellingAllowed ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.shortSellingAllowed ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Instruments Allowed</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'ukStocks', label: 'UK Stocks' },
                    { key: 'usStocks', label: 'US Stocks' },
                    { key: 'indices', label: 'Indices' },
                    { key: 'forex', label: 'Forex' },
                    { key: 'crypto', label: 'Crypto' },
                  ].map(item => (
                    <button
                      key={item.key}
                      onClick={() => setFormData({ ...formData, [item.key]: !formData[item.key] })}
                      className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                        formData[item.key]
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Spread Bet Settings */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="font-medium text-gray-900 mb-4">Spread Bet Settings</h3>

              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  <span className="font-bold text-gray-900">Spread Betting</span>
                  <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">UK Tax-Free</span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Broker</label>
                  <select
                    value={formData.spreadBetBroker}
                    onChange={(e) => setFormData({ ...formData, spreadBetBroker: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="IG">IG Index</option>
                    <option value="CMC">CMC Markets</option>
                    <option value="Spreadex">Spreadex</option>
                    <option value="CityIndex">City Index</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="text-xs text-green-800">
                  <p><strong>How it works:</strong> Position sized in £ per point. 1 point = 1p (UK) or 1¢ (US).</p>
                  <p className="mt-1"><strong>Tax:</strong> Profits are tax-free under UK gambling rules. Losses not deductible.</p>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-green-50 border-green-200">
              <p className="text-sm text-green-800">
                <strong>Risk calculation:</strong> With £{formData.accountSize} and {formData.riskPerTrade}% risk,
                your max risk per trade is <strong>£{(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)}</strong>
                <span className="block mt-1">
                  <strong>Example:</strong> 500pt stop = £{((parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100) / 500).toFixed(2)}/point
                </span>
              </p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Current Positions</h2>
            <p className="text-gray-600">Enter your open swing trades (if any)</p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Open Positions</label>
              <textarea
                value={formData.openPositions}
                onChange={(e) => setFormData({ ...formData, openPositions: e.target.value })}
                placeholder="Example:
NVDA, 2026-01-10, 138.50, 20, 131.00
AAPL, 2026-01-15, 185.00, 15, 177.00

Format: Ticker, Entry_Date, Entry_Price, Shares, Current_Stop"
                rows={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Expected Format</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2">Ticker</th>
                    <th className="pb-2">Entry Date</th>
                    <th className="pb-2">Entry £</th>
                    <th className="pb-2">Shares</th>
                    <th className="pb-2">Stop £</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  <tr>
                    <td className="py-1">NVDA</td>
                    <td>2026-01-10</td>
                    <td>138.50</td>
                    <td>20</td>
                    <td>131.00</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                <strong>Tip:</strong> Include your stop loss for each position. We'll calculate current portfolio heat and review each trade.
              </p>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Watchlist</h2>
            <p className="text-gray-600">Scan markets or enter tickers manually</p>

            {/* Scanner Button */}
            <div className="flex gap-3">
              <button
                onClick={runScanner}
                disabled={isScanning}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium rounded-xl hover:from-blue-700 hover:to-cyan-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Scanning Momentum Setups...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Scan Markets (AI)
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center -mt-1 mb-1">Best run pre-market for freshest daily data</p>

            {/* Scanner Results Panel */}
            {showScanner && (
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-blue-900 flex items-center gap-2">
                    <Crosshair className="w-5 h-5 text-blue-600" />
                    Technical Scanner Results
                    {scanResults && (
                      <span className="text-xs font-normal text-blue-600">
                        ({scanResults.totalScanned} stocks scanned)
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setShowScanner(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                {isScanning ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-3" />
                    <p className="text-blue-700 font-medium">Scanning 100+ stocks...</p>
                    <p className="text-blue-600 text-sm">Calculating RSI, MAs, momentum, volume...</p>
                  </div>
                ) : scanError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {scanError}
                    <button onClick={runScanner} className="ml-2 underline">Try again</button>
                  </div>
                ) : scanResults ? (
                  <div className="space-y-4">
                    {/* Per-Market Regime Gate Status — Independent UK/US */}
                    {(() => {
                      const gate = scanResults.regimeGate || { riskOn: true, regimeState: 'GREEN', uk: { riskOn: true }, us: { riskOn: true } };
                      const ukGate = gate.uk || { riskOn: true, aboveMa50: true, distributionDays: 0 };
                      const usGate = gate.us || { riskOn: true, aboveMa50: true, distributionDays: 0 };
                      const ukRegime = gate.ukRegimeState || (ukGate.riskOn ? 'GREEN' : 'RED');
                      const usRegime = gate.usRegimeState || (usGate.riskOn ? 'GREEN' : 'RED');

                      const regimeDesc = {
                        GREEN: 'Favour longs \u2022 Shorts need 85%+',
                        YELLOW: 'Half size \u2022 Be selective',
                        RED: 'Favour shorts \u2022 Longs need 85%+'
                      };
                      const regimeBg = { GREEN: 'bg-green-500', YELLOW: 'bg-amber-500', RED: 'bg-red-500' };
                      const regimeBannerBg = { GREEN: 'bg-green-50 border-green-200 text-green-800', YELLOW: 'bg-amber-50 border-amber-200 text-amber-800', RED: 'bg-red-50 border-red-200 text-red-800' };

                      return (
                        <div className="relative mb-2 pb-2">
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            {/* UK Market */}
                            <div>
                              <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg text-sm font-bold ${regimeBg[ukRegime] || 'bg-amber-500'} text-white`}>
                                <span>{'\uD83C\uDDEC\uD83C\uDDE7'} UK {ukGate.riskOn ? 'Risk-On' : 'Risk-Off'}</span>
                                <span className="text-xs font-normal opacity-90">{ukGate.distributionDays || 0}d dist</span>
                              </div>
                              <div className={`px-2 py-1 rounded-b-lg border text-xs text-center ${regimeBannerBg[ukRegime] || regimeBannerBg.YELLOW}`}>
                                {regimeDesc[ukRegime]}
                              </div>
                            </div>
                            {/* US Market */}
                            <div>
                              <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg text-sm font-bold ${regimeBg[usRegime] || 'bg-amber-500'} text-white`}>
                                <span>{'\uD83C\uDDFA\uD83C\uDDF8'} US {usGate.riskOn ? 'Risk-On' : 'Risk-Off'}</span>
                                <span className="text-xs font-normal opacity-90">{usGate.distributionDays || 0}d dist</span>
                              </div>
                              <div className={`px-2 py-1 rounded-b-lg border text-xs text-center ${regimeBannerBg[usRegime] || regimeBannerBg.YELLOW}`}>
                                {regimeDesc[usRegime]}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Universe + Scan Info */}
                    <div className="text-xs text-gray-500 mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span><span className="font-medium text-gray-600">Universe:</span> S&P 100 + NQ 25 + FTSE 50 ({scanResults.totalScanned || '—'} scanned)</span>
                      {(() => {
                        // Show bar freshness from first available result
                        const allResults = [
                          ...(scanResults.results?.long || []),
                          ...(scanResults.results?.short || []),
                          ...(scanResults.results?.watchlist || [])
                        ];
                        const sample = allResults.find(r => r.lastBarDate);
                        if (!sample) return null;
                        const isHolidayGap = sample.barFresh && sample.lastBarDate !== sample.expectedBarDate;
                        return (
                          <span>
                            <span className="font-medium text-gray-600">Data:</span>{' '}
                            {sample.lastBarDate}
                            {sample.barFresh
                              ? isHolidayGap
                                ? <span className="text-green-600 ml-1">OK (holiday gap)</span>
                                : <span className="text-green-600 ml-1">Fresh</span>
                              : <span className="text-amber-600 ml-1">Stale (expected {sample.expectedBarDate})</span>
                            }
                          </span>
                        );
                      })()}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
                      <span>Trend: <span className={scanResults.marketTrend === 'up' ? 'text-green-600 font-medium' : scanResults.marketTrend === 'down' ? 'text-red-600 font-medium' : 'text-gray-600'}>{scanResults.marketTrend || 'neutral'}</span></span>
                      {(() => {
                        const ukT = scanResults.thresholds?.uk;
                        const usT = scanResults.thresholds?.us;
                        const sameThresholds = ukT && usT &&
                          ukT.long?.score === usT.long?.score &&
                          ukT.short?.score === usT.short?.score;

                        if (sameThresholds || !ukT || !usT) {
                          // Same thresholds — show once
                          return (
                            <>
                              <span>•</span>
                              <span>Longs ≥{scanResults.thresholds?.long?.score}%</span>
                              {scanResults.shortSellingAllowed && <><span>•</span><span>Shorts ≥{scanResults.thresholds?.short?.score}%</span></>}
                            </>
                          );
                        }
                        // Different thresholds — show per-market
                        return (
                          <>
                            <span>•</span>
                            <span>{'\uD83C\uDDEC\uD83C\uDDE7'} L≥{ukT.long?.score}% S≥{ukT.short?.score}%</span>
                            <span>•</span>
                            <span>{'\uD83C\uDDFA\uD83C\uDDF8'} L≥{usT.long?.score}% S≥{usT.short?.score}%</span>
                          </>
                        );
                      })()}
                    </div>

                    {/* Long Candidates */}
                    {scanResults.results.long.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-green-800 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4" />
                            Long Candidates ({scanResults.results.long.length})
                          </h4>
                          <button
                            onClick={() => addScanResultsToWatchlist(scanResults.results.long, 'Scanner Longs')}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                          >
                            Add All to Watchlist
                          </button>
                        </div>
                        <div className="grid gap-3 max-h-96 overflow-y-auto">
                          {scanResults.results.long.map((stock, i) => (
                            <div key={stock.ticker} className="bg-white border border-green-200 rounded-lg p-3">
                              {/* Header row */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-bold">
                                    {i + 1}
                                  </span>
                                  <span className="font-bold text-gray-900">{stock.ticker}</span>
                                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">LONG</span>
                                  <span className="text-xs text-gray-500">Score: {stock.score?.toFixed(0)}%</span>
                                  {stock.setupTier && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                                      stock.setupTier === 'A+' ? 'bg-yellow-100 text-yellow-800' :
                                      stock.setupTier === 'A' ? 'bg-green-100 text-green-800' :
                                      stock.setupTier === 'B' ? 'bg-blue-100 text-blue-800' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {stock.setupTier}
                                    </span>
                                  )}
                                </div>
                                {stock.tradeManagement && (
                                  <span className="text-sm font-bold text-green-600">R:R {stock.tradeManagement.riskRewardRatio}:1</span>
                                )}
                              </div>

                              {/* Trade management details */}
                              {stock.tradeManagement ? (
                                <div className="grid grid-cols-4 gap-1.5 text-xs">
                                  <div className="bg-gray-50 rounded p-1.5">
                                    <div className="text-gray-500">Entry</div>
                                    <div className="font-medium">
                                      {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                      {stock.tradeManagement.entryZone.low?.toFixed(2)}-{stock.tradeManagement.entryZone.high?.toFixed(2)}
                                    </div>
                                    {stock.entryTiming?.avoidUntil && (
                                      <div className="text-amber-600 text-[10px]">after {stock.entryTiming.avoidUntil}</div>
                                    )}
                                  </div>
                                  <div className="bg-red-50 rounded p-1.5">
                                    <div className="text-gray-500">Stop</div>
                                    <div className="font-medium text-red-600">
                                      {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                      {stock.tradeManagement.stopLoss?.toFixed(2)}
                                    </div>
                                  </div>
                                  <div className="bg-green-50 rounded p-1.5">
                                    <div className="text-gray-500">T1 ({stock.tradeManagement.t1Mult || 1.0}R)</div>
                                    <div className="font-medium text-green-600">
                                      {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                      {stock.tradeManagement.target1?.toFixed(2)}
                                    </div>
                                  </div>
                                  <div className="bg-green-50 rounded p-1.5" title={stock.tradeManagement.t2Basis || ''}>
                                    <div className="text-gray-500">T2 ({stock.tradeManagement.t2Basis?.includes('FRACTAL') ? 'Frac' : 'Fib'})</div>
                                    <div className="font-medium text-green-600">
                                      {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                      {stock.tradeManagement.target2?.toFixed(2)}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-gray-500">
                                  Price: {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}{stock.price?.toFixed(2)} | RSI: {stock.indicators?.rsi?.toFixed(0)}
                                </div>
                              )}

                              {/* Position sizing + runner info */}
                              {stock.tradeManagement && (
                                <div className="flex items-center gap-3 mt-1.5 text-xs bg-purple-50 rounded p-1.5">
                                  <div>
                                    <span className="text-gray-500">At T1: </span>
                                    <span className="font-medium text-purple-700">Take {stock.tradeManagement.t1SizePct || 50}%</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Stop → </span>
                                    <span className="font-medium text-purple-700">BE</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Runner: </span>
                                    <span className="font-medium text-purple-700">{stock.tradeManagement.runnerSizePct || 50}% → T2</span>
                                  </div>
                                </div>
                              )}

                              {/* Position sizing - £ per point */}
                              {stock.tradeManagement?.poundsPerPoint && (
                                <div className="flex items-center gap-3 mt-1 text-xs bg-blue-50 rounded p-1.5">
                                  <div>
                                    <span className="text-gray-500">Size: </span>
                                    <span className="font-bold text-blue-700">£{stock.tradeManagement.poundsPerPoint.toFixed(2)}/pt</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Risk: </span>
                                    <span className="font-medium text-gray-700">£{stock.tradeManagement.effectiveRisk?.toFixed(0)}</span>
                                  </div>
                                  {stock.tradeManagement.regimeMultiplier < 1 && (
                                    <span className="text-amber-600">({stock.tradeManagement.regimeMultiplier}x regime)</span>
                                  )}
                                </div>
                              )}

                              {/* Reasoning */}
                              <p className="text-xs text-gray-500 mt-2 truncate">{stock.reasoning}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                        <TrendingUp className="w-4 h-4 inline mr-1 text-green-600" />
                        No long candidates meet the threshold ({scanResults.thresholds?.long?.score}%+ score, {scanResults.thresholds?.long?.pillars}+ pillars)
                      </div>
                    )}

                    {/* Short Candidates - only show if short selling is allowed */}
                    {scanResults.shortSellingAllowed && (
                      scanResults.results.short.length > 0 ? (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium text-red-800 flex items-center gap-2">
                              <TrendingDown className="w-4 h-4" />
                              Short Candidates ({scanResults.results.short.length})
                            </h4>
                            <button
                              onClick={() => addScanResultsToWatchlist(scanResults.results.short, 'Scanner Shorts')}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                            >
                              Add All to Watchlist
                            </button>
                          </div>
                          <div className="grid gap-3 max-h-96 overflow-y-auto">
                            {scanResults.results.short.map((stock, i) => (
                              <div key={stock.ticker} className="bg-white border border-red-200 rounded-lg p-3">
                                {/* Header row */}
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-xs font-bold">
                                      {i + 1}
                                    </span>
                                    <span className="font-bold text-gray-900">{stock.ticker}</span>
                                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">SHORT</span>
                                    <span className="text-xs text-gray-500">Score: {stock.score?.toFixed(0)}%</span>
                                    {stock.setupTier && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                                        stock.setupTier === 'A+' ? 'bg-yellow-100 text-yellow-800' :
                                        stock.setupTier === 'A' ? 'bg-green-100 text-green-800' :
                                        stock.setupTier === 'B' ? 'bg-blue-100 text-blue-800' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>
                                        {stock.setupTier}
                                      </span>
                                    )}
                                  </div>
                                  {stock.tradeManagement && (
                                    <span className="text-sm font-bold text-red-600">R:R {stock.tradeManagement.riskRewardRatio}:1</span>
                                  )}
                                </div>

                                {/* Trade management details */}
                                {stock.tradeManagement ? (
                                  <div className="grid grid-cols-4 gap-1.5 text-xs">
                                    <div className="bg-gray-50 rounded p-1.5">
                                      <div className="text-gray-500">Entry</div>
                                      <div className="font-medium">
                                        {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                        {stock.tradeManagement.entryZone.low?.toFixed(2)}-{stock.tradeManagement.entryZone.high?.toFixed(2)}
                                      </div>
                                      {stock.entryTiming?.avoidUntil && (
                                        <div className="text-amber-600 text-[10px]">after {stock.entryTiming.avoidUntil}</div>
                                      )}
                                    </div>
                                    <div className="bg-red-50 rounded p-1.5">
                                      <div className="text-gray-500">Stop</div>
                                      <div className="font-medium text-red-600">
                                        {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                        {stock.tradeManagement.stopLoss?.toFixed(2)}
                                      </div>
                                    </div>
                                    <div className="bg-green-50 rounded p-1.5">
                                      <div className="text-gray-500">T1 ({stock.tradeManagement.t1Mult || 1.0}R)</div>
                                      <div className="font-medium text-green-600">
                                        {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                        {stock.tradeManagement.target1?.toFixed(2)}
                                      </div>
                                    </div>
                                    <div className="bg-green-50 rounded p-1.5" title={stock.tradeManagement.t2Basis || ''}>
                                      <div className="text-gray-500">T2 ({stock.tradeManagement.t2Basis?.includes('FRACTAL') ? 'Frac' : 'Fib'})</div>
                                      <div className="font-medium text-green-600">
                                        {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}
                                        {stock.tradeManagement.target2?.toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-xs text-gray-500">
                                    Price: {stock.currency === 'GBp' ? 'p' : stock.currency === 'USD' ? '$' : ''}{stock.price?.toFixed(2)} | RSI: {stock.indicators?.rsi?.toFixed(0)}
                                  </div>
                                )}

                                {/* Position sizing + runner info */}
                                {stock.tradeManagement && (
                                  <div className="flex items-center gap-3 mt-1.5 text-xs bg-purple-50 rounded p-1.5">
                                    <div>
                                      <span className="text-gray-500">At T1: </span>
                                      <span className="font-medium text-purple-700">Take {stock.tradeManagement.t1SizePct || 50}%</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Stop → </span>
                                      <span className="font-medium text-purple-700">BE</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Runner: </span>
                                      <span className="font-medium text-purple-700">{stock.tradeManagement.runnerSizePct || 50}% → T2</span>
                                    </div>
                                  </div>
                                )}

                                {/* Position sizing - £ per point */}
                                {stock.tradeManagement?.poundsPerPoint && (
                                  <div className="flex items-center gap-3 mt-1 text-xs bg-blue-50 rounded p-1.5">
                                    <div>
                                      <span className="text-gray-500">Size: </span>
                                      <span className="font-bold text-blue-700">£{stock.tradeManagement.poundsPerPoint.toFixed(2)}/pt</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Risk: </span>
                                      <span className="font-medium text-gray-700">£{stock.tradeManagement.effectiveRisk?.toFixed(0)}</span>
                                    </div>
                                    {stock.tradeManagement.regimeMultiplier < 1 && (
                                      <span className="text-amber-600">({stock.tradeManagement.regimeMultiplier}x regime)</span>
                                    )}
                                  </div>
                                )}

                                {/* Reasoning */}
                                <p className="text-xs text-gray-500 mt-2 truncate">{stock.reasoning}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                          <TrendingDown className="w-4 h-4 inline mr-1 text-red-600" />
                          No short candidates meet the threshold ({scanResults.thresholds?.short?.score}%+ score, {scanResults.thresholds?.short?.pillars}+ pillars)
                        </div>
                      )
                    )}

                    {/* Watchlist Candidates */}
                    {scanResults.results.watchlist.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-amber-800 flex items-center gap-2">
                            <Eye className="w-4 h-4" />
                            Developing ({scanResults.results.watchlist.length})
                            <span className="text-xs font-normal text-gray-500">— interesting but not ready to trade</span>
                          </h4>
                          <button
                            onClick={() => addScanResultsToWatchlist(scanResults.results.watchlist, 'Scanner Watch')}
                            className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700"
                          >
                            Track These
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {scanResults.results.watchlist.slice(0, 10).map((stock) => (
                            <span
                              key={stock.ticker}
                              className={`bg-white border rounded px-2 py-1 text-sm ${
                                stock.earningsWarning ? 'border-blue-300' :
                                stock.volatilityWarning ? 'border-red-300' : 'border-amber-200'
                              }`}
                              title={stock.earningsWarning || stock.volatilityWarning || stock.reasoning}
                            >
                              {stock.earningsWarning && <span className="text-blue-500 mr-1">📅</span>}
                              {stock.volatilityWarning && !stock.earningsWarning && <span className="text-red-500 mr-1">⚠️</span>}
                              <span className="font-medium">{stock.ticker}</span>
                              <span className="text-amber-600 ml-1">{stock.score?.toFixed(0)}%</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-blue-600 italic">
                      Scanned using Six Pillars methodology: momentum, RSI, MAs, volume, VCP patterns
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {/* Suggestions Panel */}
            {showSuggestions && (
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-purple-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    AI-Generated Suggestions
                  </h3>
                  <button
                    onClick={() => setShowSuggestions(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                {isGeneratingSuggestions ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                    <span className="ml-3 text-purple-700">Analyzing markets for swing candidates...</span>
                  </div>
                ) : suggestionsError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {suggestionsError}
                    <button onClick={generateSuggestions} className="ml-2 underline">Try again</button>
                  </div>
                ) : suggestions ? (
                  <div className="space-y-4">
                    <p className="text-sm text-purple-700">Click a category to add those tickers to your watchlist:</p>

                    {/* Short-Term Suggestions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-blue-500" />
                        Short-Term Swing (2-7 days)
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {suggestions.shortTerm.usLong.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.usLong, 'US Long (Short-Term)')}
                            className="p-2 bg-white border border-green-200 rounded-lg text-left hover:bg-green-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-green-600 font-medium mb-1">
                              <TrendingUp className="w-3 h-3" /> US Long
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.usLong.join(', ')}</p>
                          </button>
                        )}
                        {suggestions.shortTerm.usShort.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.usShort, 'US Short (Short-Term)')}
                            className="p-2 bg-white border border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-red-600 font-medium mb-1">
                              <TrendingDown className="w-3 h-3" /> US Short
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.usShort.join(', ')}</p>
                          </button>
                        )}
                        {suggestions.shortTerm.ukLong.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.ukLong, 'UK Long (Short-Term)')}
                            className="p-2 bg-white border border-green-200 rounded-lg text-left hover:bg-green-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-green-600 font-medium mb-1">
                              <TrendingUp className="w-3 h-3" /> UK Long
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.ukLong.join(', ')}</p>
                          </button>
                        )}
                        {suggestions.shortTerm.ukShort.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.ukShort, 'UK Short (Short-Term)')}
                            className="p-2 bg-white border border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-red-600 font-medium mb-1">
                              <TrendingDown className="w-3 h-3" /> UK Short
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.ukShort.join(', ')}</p>
                          </button>
                        )}
                        {suggestions.shortTerm.commodLong.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.commodLong, 'Commodities Long (Short-Term)')}
                            className="p-2 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-amber-600 font-medium mb-1">
                              <TrendingUp className="w-3 h-3" /> Commod Long
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.commodLong.join(', ')}</p>
                          </button>
                        )}
                        {suggestions.shortTerm.commodShort.length > 0 && (
                          <button
                            onClick={() => addSuggestionsToWatchlist(suggestions.shortTerm.commodShort, 'Commodities Short (Short-Term)')}
                            className="p-2 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-1 text-xs text-amber-600 font-medium mb-1">
                              <TrendingDown className="w-3 h-3" /> Commod Short
                            </div>
                            <p className="text-xs text-gray-600 truncate">{suggestions.shortTerm.commodShort.join(', ')}</p>
                          </button>
                        )}
                      </div>
                    </div>


                    <p className="text-xs text-purple-600 italic">
                      Note: Suggestions are based on recent momentum. Always verify with your own analysis.
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Watchlist Tickers</label>
              <textarea
                value={formData.watchlist}
                onChange={(e) => {
                  setFormData({ ...formData, watchlist: e.target.value });
                  setWatchlistPrices({}); // Clear prices when watchlist changes
                }}
                placeholder="Example:
NVDA, VCP forming, earnings Feb 26
MSFT, Cup and handle
AAPL, Pulling back to 50-day
LLOY.L, UK bank breakout

Format: Ticker, Notes (we'll fetch live prices)"
                rows={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </div>

            {/* Fetch Prices Button */}
            <button
              onClick={fetchPrices}
              disabled={isFetchingPrices || !formData.watchlist.trim()}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all ${
                isFetchingPrices || !formData.watchlist.trim()
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isFetchingPrices ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Fetching live prices...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Fetch Live Prices from Yahoo Finance
                </>
              )}
            </button>

            {priceError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {priceError}
              </div>
            )}

            {/* Live Prices Display */}
            {Object.keys(watchlistPrices).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <h3 className="font-medium text-gray-900 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-600" />
                    Live Prices
                    <span className="text-xs text-gray-500 font-normal">via Yahoo Finance</span>
                  </h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {Object.values(watchlistPrices).map((stock) => {
                    // Skip invalid stocks - no ticker, no price, or has error
                    if (!stock || !stock.ticker) return null;
                    if (stock.error) return null;
                    if (stock.price === undefined || stock.price === null || isNaN(stock.price)) return null;

                    const change = parseFloat(stock.change) || 0;
                    return (
                      <div key={stock.ticker} className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{stock.ticker}</p>
                          <p className="text-xs text-gray-500">{stock.name || ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-gray-900">
                            {formatPrice(stock.price, stock.currency)}
                          </p>
                          <p className={`text-sm ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {change >= 0 ? '+' : ''}{stock.change || '0'} ({stock.changePercent || '0%'})
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">What We'll Check</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Livermore pivotal points & timing</li>
                <li>• O'Neil CANSLIM & relative strength</li>
                <li>• Minervini trend template & VCP</li>
                <li>• Darvas box structure</li>
                <li>• Raschke momentum/mean reversion</li>
                <li>• Sector relative strength</li>
              </ul>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-medium text-green-900 mb-2">Supported Tickers</h3>
              <p className="text-sm text-green-800">
                <strong>US stocks:</strong> NVDA, AAPL, MSFT, etc.<br />
                <strong>UK stocks:</strong> Add .L suffix (e.g., LLOY.L, BARC.L, BP.L)
              </p>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Session Settings</h2>
            <p className="text-gray-600">Configure this analysis session</p>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="font-bold text-gray-900">Short-Term Momentum Swing</span>
              </div>
              <p className="text-sm text-gray-600">1-3 day holds • Momentum breakouts • ATR-based stops</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Market View</label>
              <select
                value={formData.regimeView}
                onChange={(e) => setFormData({ ...formData, regimeView: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="trending_up">Trending Up — Buy breakouts</option>
                <option value="choppy">Choppy — Mean reversion / selective</option>
                <option value="volatile">Volatile — Reduce size, careful</option>
                <option value="trending_down">Trending Down — Defensive / short bias</option>
                <option value="uncertain">Uncertain — Let committee decide</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Your Confidence Level: {formData.marketSentiment}/10
              </label>
              <div className="relative h-8 flex items-center">
                {/* Gradient track background */}
                <div className="absolute inset-x-0 h-3 rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-green-500" />
                {/* Slider input */}
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={formData.marketSentiment}
                  onChange={(e) => setFormData({ ...formData, marketSentiment: parseInt(e.target.value) })}
                  className="relative w-full h-3 bg-transparent rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gray-800 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-gray-800 [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:cursor-pointer"
                />
              </div>
              <div className="relative flex text-xs mt-1">
                <span className="text-red-600 font-medium">Defensive</span>
                <span className="absolute left-1/2 -translate-x-1/2 text-amber-600 font-medium">Balanced</span>
                <span className="ml-auto text-green-600 font-medium">Aggressive</span>
              </div>
              <div className={`mt-2 p-2 rounded-lg text-sm text-center ${getSentimentLabel(formData.marketSentiment).bg}`}>
                <span className={getSentimentLabel(formData.marketSentiment).color}>
                  {getSentimentLabel(formData.marketSentiment).label}
                </span>
                <span className="text-gray-600"> — Committee stance: {
                  formData.marketSentiment <= 4 ? 'Defensive' :
                  formData.marketSentiment <= 6 ? 'Balanced' : 'Aggressive'
                }</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Session Type</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'daily', label: 'Daily Scan', icon: Activity },
                  { value: 'weekly', label: 'Weekly Review', icon: Calendar },
                  { value: 'idea', label: 'Quick Idea Check', icon: Lightbulb },
                ].map(type => (
                  <button
                    key={type.value}
                    onClick={() => setFormData({ ...formData, sessionType: type.value })}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${
                      formData.sessionType === type.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <type.icon className={`w-5 h-5 mx-auto mb-1 ${formData.sessionType === type.value ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="text-sm font-medium">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 5:
        if (isAnalyzing) {
          return (
            <div className="text-center py-8 space-y-6">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                <Activity className="absolute inset-0 m-auto w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">The Trading Program in Session</h2>

              <div className="max-w-md mx-auto text-left bg-gray-50 rounded-xl p-4">
                <div className="space-y-2">
                  {analysisSteps.map((stepText, i) => (
                    <div key={i} className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                      i < currentAnalysisStep ? 'text-green-600' :
                      i === currentAnalysisStep ? 'text-blue-600 font-medium' :
                      'text-gray-300'
                    }`}>
                      {i < currentAnalysisStep ? (
                        <Check className="w-4 h-4 flex-shrink-0" />
                      ) : i === currentAnalysisStep ? (
                        <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span>{stepText}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        if (analysisError) {
          return (
            <div className="text-center py-12 space-y-6">
              <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Analysis Failed</h2>
              <p className="text-gray-600">{analysisError}</p>
              <button
                onClick={runAnalysis}
                className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
              >
                Try Again
              </button>
            </div>
          );
        }

        if (analysisComplete && analysisResult) {
          return (
            <div className="space-y-6">
              {/* Report Header */}
              <div className="bg-gradient-to-r from-blue-900 to-indigo-800 rounded-2xl p-6 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-blue-200 text-sm">The Trading Program Report</p>
                    <h1 className="text-2xl font-bold mt-1">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
                    <p className="text-blue-300 mt-2">
                      Momentum Swing • {analysisResult.mode || 'Balanced'} Committee
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6">
                  <div className="bg-white/10 rounded-lg p-3 flex flex-col items-center justify-center">
                    <p className="text-blue-200 text-xs text-center">Committee Stance</p>
                    <p className={`text-lg font-bold text-center ${
                      analysisResult.mode === 'Aggressive' ? 'text-green-400' :
                      analysisResult.mode === 'Defensive' ? 'text-amber-400' :
                      'text-blue-300'
                    }`}>{analysisResult.mode || 'Balanced'}</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3 flex flex-col items-center justify-center">
                    <p className="text-blue-200 text-xs text-center">Signals Found</p>
                    <p className="text-lg font-bold text-center">{analysisResult.signals?.filter(s => !isNoTrade(s)).length || 0}</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3 flex flex-col items-center justify-center">
                    <p className="text-blue-200 text-xs text-center">Market Regime</p>
                    <p className={`text-lg font-bold text-center ${
                      marketPulseData?.us?.regime === 'Trending Up' ? 'text-green-400' :
                      marketPulseData?.us?.regime === 'Trending Down' ? 'text-red-400' :
                      marketPulseData?.us?.regime === 'Volatile' ? 'text-orange-400' :
                      marketPulseData?.us?.regime === 'Choppy' ? 'text-amber-400' :
                      'text-blue-300'
                    }`}>{marketPulseData?.us?.regime || 'Analyzing...'}</p>
                  </div>
                </div>
              </div>

              {/* Report Tabs */}
              <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
                {[
                  { id: 'summary', label: 'Summary' },
                  { id: 'signals', label: 'Trade Signals' },
                  { id: 'openpositions', label: 'Open Positions' },
                  { id: 'full', label: 'Full Report' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveReportTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      activeReportTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeReportTab === 'summary' && (
                <div className="space-y-6">
                  {/* Executive Summary */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">Executive Summary</h2>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                        {analysisResult.summary || 'Analysis complete. Review your recommendations below.'}
                      </p>
                    </div>
                  </div>

                  {/* Chair's Decision */}
                  {analysisResult.chairDecision && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                      <h3 className="font-bold text-gray-900 mb-3">Chair's Decision</h3>
                      <div className="prose prose-sm max-w-none">
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-4 rounded-lg overflow-auto">
                          {analysisResult.chairDecision}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Pillar Reminder */}
                  {analysisResult.pillarReminder && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <h3 className="font-medium text-amber-900 mb-2">Wisdom from the Masters</h3>
                      <p className="text-amber-800 italic whitespace-pre-wrap">{analysisResult.pillarReminder}</p>
                    </div>
                  )}
                </div>
              )}

              {activeReportTab === 'signals' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <h2 className="font-bold text-gray-900">Trade Signals</h2>
                  </div>

                  {analysisResult.signals && analysisResult.signals.length > 0 ? (
                    <div>
                      {analysisResult.signals
                        .filter(signal => !isNoTrade(signal))
                        .filter(signal => signal.ticker && !signal.ticker.includes('REQUEST') && !signal.ticker.includes('NEEDED') && !signal.ticker.includes('TBD'))
                        .map((signal, index) => (
                        <div key={index} className="border-b border-gray-100 last:border-b-0">
                          <button
                            onClick={() => setExpandedSignal(expandedSignal === signal.ticker ? null : signal.ticker)}
                            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 ${getSignalBoxColor(signal)} rounded-xl flex items-center justify-center text-white font-bold text-xl`}>
                                {getSignalBoxLabel(signal)}
                              </div>
                              <div className="text-left">
                                <p className="font-bold text-gray-900">{signal.ticker}</p>
                                <p className="text-sm text-gray-500">
                                  {signal.setupType || signal.name || 'Swing Setup'}
                                  {signal.grade && <span className="ml-2 font-medium">• Grade {signal.grade}</span>}
                                </p>
                              </div>
                              {signal.pillarCount && (
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  signal.pillarCount >= 4 ? 'bg-green-100 text-green-700' :
                                  signal.pillarCount >= 3 ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {signal.pillarCount}/6 Pillars
                                </span>
                              )}
                              {signal.verdict && (
                                <span className={`px-2 py-1 text-xs font-medium rounded ${getVerdictColor(signal.verdict)}`}>
                                  {signal.verdict}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                {signal.entry && <p className="font-bold text-gray-900">Entry: {signal.entry}</p>}
                                {signal.stop && <p className="text-sm text-gray-500">Stop: {signal.stop}</p>}
                              </div>
                              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expandedSignal === signal.ticker ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {/* Expanded signal details */}
                          {expandedSignal === signal.ticker && (
                            <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
                                {signal.grade && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Grade</p>
                                    <p className="font-bold text-gray-900">{signal.grade}</p>
                                  </div>
                                )}
                                {signal.direction && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Direction</p>
                                    <p className="font-bold text-gray-900">{signal.direction}</p>
                                  </div>
                                )}
                                {signal.entry && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Entry Zone</p>
                                    <p className="font-bold text-gray-900">{signal.entry}</p>
                                  </div>
                                )}
                                {signal.stop && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Stop Loss</p>
                                    <p className="font-bold text-red-600">{signal.stop}</p>
                                  </div>
                                )}
                                {signal.target && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Target</p>
                                    <p className="font-bold text-green-600">{signal.target}</p>
                                  </div>
                                )}
                                {signal.riskReward && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Risk:Reward</p>
                                    <p className="font-bold text-gray-900">{signal.riskReward}</p>
                                  </div>
                                )}
                                {signal.pillarCount && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Pillar Count</p>
                                    <p className="font-bold text-gray-900">{signal.pillarCount}/6</p>
                                  </div>
                                )}
                                {signal.setupType && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Setup Type</p>
                                    <p className="font-bold text-gray-900">{signal.setupType}</p>
                                  </div>
                                )}
                              </div>

                              {/* Show raw analysis section if available */}
                              {signal.rawSection && (
                                <div className="mt-3 pt-3 border-t border-gray-200">
                                  <p className="text-xs text-gray-500 uppercase mb-2">Full Analysis</p>
                                  <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-white p-3 rounded-lg overflow-auto max-h-64">
                                    {signal.rawSection}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      <p>No actionable trade signals found. All tickers were marked as NO TRADE.</p>
                      <p className="text-sm mt-2">Check the Full Report for detailed analysis of each ticker.</p>
                    </div>
                  )}

                </div>
              )}

              {activeReportTab === 'openpositions' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <h2 className="font-bold text-gray-900">Open Positions</h2>
                  </div>

                  {analysisResult.parsedPositions && analysisResult.parsedPositions.length > 0 ? (
                    <div>
                      {analysisResult.parsedPositions.map((position, index) => (
                        <div key={index} className="border-b border-gray-100 last:border-b-0">
                          <button
                            onClick={() => setExpandedPosition(expandedPosition === position.ticker ? null : position.ticker)}
                            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 ${
                                position.action === 'EXIT' || position.action === 'CLOSE' ? 'bg-red-500' :
                                position.action === 'HOLD' ? 'bg-blue-500' :
                                position.action === 'TRAIL' ? 'bg-green-500' :
                                position.direction === 'LONG' ? 'bg-green-500' :
                                position.direction === 'SHORT' ? 'bg-red-500' : 'bg-blue-500'
                              } rounded-xl flex items-center justify-center text-white font-bold text-lg`}>
                                {position.direction === 'LONG' ? 'L' : position.direction === 'SHORT' ? 'S' : 'H'}
                              </div>
                              <div className="text-left">
                                <p className="font-bold text-gray-900">{position.ticker}</p>
                                <p className="text-sm text-gray-500">
                                  Entry: {position.entry}
                                  {position.daysHeld !== undefined && <span className="ml-2">• {position.daysHeld} days</span>}
                                </p>
                              </div>
                              {position.pillarStatus && (
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  position.pillarStatus.includes('Active') || parseInt(position.pillarStatus) >= 4 ? 'bg-green-100 text-green-700' :
                                  parseInt(position.pillarStatus) >= 3 ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {position.pillarStatus}
                                </span>
                              )}
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                position.action === 'EXIT' || position.action === 'CLOSE' ? 'bg-red-100 text-red-700' :
                                position.action === 'HOLD' ? 'bg-blue-100 text-blue-700' :
                                position.action === 'TRAIL' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {position.action || 'HOLD'}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className={`font-bold ${
                                  position.pnlPercent > 0 ? 'text-green-600' :
                                  position.pnlPercent < 0 ? 'text-red-600' : 'text-gray-900'
                                }`}>
                                  {position.pnlPercent > 0 ? '+' : ''}{position.pnlPercent?.toFixed(1)}%
                                  {position.pnlAmount && <span className="text-sm"> ({position.pnlAmount})</span>}
                                </p>
                                {position.currentPrice && (
                                  <p className="text-sm text-gray-500">Current: {position.currentPrice}</p>
                                )}
                              </div>
                              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expandedPosition === position.ticker ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {/* Expanded position details */}
                          {expandedPosition === position.ticker && (
                            <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
                                {position.entry && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Entry Price</p>
                                    <p className="font-bold text-gray-900">{position.entry}</p>
                                  </div>
                                )}
                                {position.currentPrice && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Current Price</p>
                                    <p className="font-bold text-gray-900">{position.currentPrice}</p>
                                  </div>
                                )}
                                {position.stop && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Stop Loss</p>
                                    <p className="font-bold text-red-600">{position.stop}</p>
                                  </div>
                                )}
                                {position.newStop && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">New Stop</p>
                                    <p className="font-bold text-amber-600">{position.newStop}</p>
                                  </div>
                                )}
                                {position.target && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Target</p>
                                    <p className="font-bold text-green-600">{position.target}</p>
                                  </div>
                                )}
                                {position.daysHeld !== undefined && (
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Days Held</p>
                                    <p className="font-bold text-gray-900">{position.daysHeld}</p>
                                  </div>
                                )}
                              </div>
                              {position.assessment && (
                                <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                                  <p className="text-sm text-blue-800">{position.assessment}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : formData.openPositions ? (
                    <div className="p-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <pre className="whitespace-pre-wrap text-sm text-gray-700">
                          {analysisResult.positionsReview || 'No position analysis available.'}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      <p>No open positions to review.</p>
                      <p className="text-sm mt-1">Positions entered in the setup will appear here with analysis.</p>
                    </div>
                  )}

                  {/* Position Summary */}
                  {analysisResult.positionSummary && (
                    <div className="p-4 bg-blue-50 border-t border-blue-200">
                      <p className="text-sm text-blue-800">{analysisResult.positionSummary}</p>
                    </div>
                  )}
                </div>
              )}

              {activeReportTab === 'full' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <h3 className="font-bold text-gray-900 mb-3">Full Analysis Report</h3>
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-4 rounded-lg overflow-auto max-h-[600px]">
                      {analysisResult.fullAnalysis || 'No detailed analysis available.'}
                    </pre>
                  </div>
                </div>
              )}

              {/* Start Over */}
              <div className="text-center">
                <button
                  onClick={resetForNewAnalysis}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Start New Analysis
                </button>
              </div>
            </div>
          );
        }

        // Fallback - analysis should auto-start when reaching step 5
        // This handles edge cases like page refresh or direct navigation
        return (
          <div className="text-center py-12 space-y-6">
            <Activity className="w-16 h-16 text-blue-500 mx-auto" />
            <p className="text-gray-600">Starting analysis...</p>
            <button
              onClick={runAnalysis}
              className="px-6 py-3 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 transition-colors"
            >
              Start Analysis
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className={`mx-auto ${analysisComplete ? 'max-w-4xl' : showScanner ? 'max-w-3xl' : 'max-w-2xl'}`}>
        {/* Progress Steps - Show for Account through Session (steps 1-4) */}
        {step > 0 && step < 5 && (
          <div className="flex items-center justify-between mb-8">
            {steps.slice(1, 5).map((s, i) => (
              <React.Fragment key={s.title}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      i + 1 < step
                        ? 'bg-green-500 text-white'
                        : i + 1 === step
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {i + 1 < step ? <Check className="w-5 h-5" /> : <s.icon className="w-5 h-5" />}
                  </div>
                  <span className="text-xs mt-1 text-gray-500">{s.title}</span>
                </div>
                {i < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${i + 1 < step ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {renderStep()}
        </div>

        {/* Navigation */}
        {!isAnalyzing && !analysisComplete && (
          <div className="flex justify-between mt-6">
            {step > 0 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-2 px-6 py-3 text-gray-600 hover:text-gray-900"
              >
                <ChevronLeft className="w-5 h-5" />
                Back
              </button>
            ) : (
              <div />
            )}
            {step < 5 && (
              <button
                onClick={() => {
                  if (step === 4) {
                    // Skip the "Ready to Scan" screen - go directly to step 5 and start analysis
                    setStep(5);
                    runAnalysis();
                  } else {
                    setStep(step + 1);
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                {step === 0 ? 'Get Started' : step === 4 ? 'Run Analysis' : 'Continue'}
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        )}


        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>The Trading Program • Educational Tool Only • Not Financial Advice</p>
        </div>
      </div>
    </div>
  );
}
