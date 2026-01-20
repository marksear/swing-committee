import React, { useState } from 'react';
import { 
  TrendingUp, TrendingDown, Shield, Brain, ChevronRight, ChevronLeft, 
  Check, AlertCircle, Loader2, Target, Zap, Rocket, BarChart2, 
  Newspaper, ChevronDown, Activity, Clock, DollarSign, ShieldAlert,
  ArrowUpRight, ArrowDownRight, Crosshair, LineChart, BarChart3,
  AlertTriangle, Eye, Scale, Flame, Gauge, Calendar, BookOpen, Lightbulb
} from 'lucide-react';

export default function SwingCommitteeApp() {
  const [step, setStep] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [showUKSources, setShowUKSources] = useState(false);
  const [showUSSources, setShowUSSources] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState('NVDA');

  const [formData, setFormData] = useState({
    // Account
    accountSize: '10000',
    riskPerTrade: '1',
    maxPositions: '6',
    maxHeat: '6',
    // Permissions
    leverageAllowed: false,
    maxLeverage: '2',
    shortSellingAllowed: false,
    ukStocks: true,
    usStocks: true,
    indices: false,
    forex: false,
    crypto: false,
    // Execution Mode
    executionMode: 'standard', // 'standard' or 'spread_bet'
    spreadBetBroker: 'IG',
    // Positions
    openPositions: '',
    // Watchlist
    watchlist: '',
    // Session
    tradeMode: 'position',
    marketSentiment: 5,
    regimeView: 'trending_up',
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

  // Market Pulse Data
  const marketPulseData = {
    uk: {
      score: 5.8,
      label: 'Cautiously Optimistic',
      change: '+0.3',
      changeDirection: 'up',
      regime: 'Choppy',
      sources: [
        { name: 'Financial Times', sentiment: 6, headline: 'FTSE 100 consolidates near highs' },
        { name: 'The Times', sentiment: 5, headline: 'UK markets mixed amid rate uncertainty' },
        { name: 'Bloomberg UK', sentiment: 6, headline: 'Breadth improving in mid-caps' },
        { name: 'Reuters UK', sentiment: 5, headline: 'Defensive sectors leading' },
        { name: 'Investors Chronicle', sentiment: 6, headline: 'Breakout candidates emerging' },
      ]
    },
    us: {
      score: 7.2,
      label: 'Bullish',
      change: '+0.5',
      changeDirection: 'up',
      regime: 'Trending Up',
      sources: [
        { name: 'Wall Street Journal', sentiment: 7, headline: 'S&P 500 extends winning streak' },
        { name: 'Bloomberg', sentiment: 8, headline: 'Tech leads broad market rally' },
        { name: 'CNBC', sentiment: 7, headline: 'New highs expanding across sectors' },
        { name: 'MarketWatch', sentiment: 7, headline: 'Momentum indicators bullish' },
        { name: 'IBD', sentiment: 8, headline: 'Market in confirmed uptrend' },
      ]
    }
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
    'Analyzing watchlist: NVDA...',
    'Analyzing watchlist: MSFT...',
    'Analyzing watchlist: AAPL...',
    'Applying Livermore pivotal points...',
    'Running O\'Neil CANSLIM screen...',
    'Checking Minervini trend template...',
    'Identifying Darvas boxes...',
    'Raschke momentum analysis...',
    'Weinstein stage check...',
    'Scoring setups against 6 pillars...',
    'Building committee positions...',
    'Calculating position sizes...',
    'Generating trade signals...',
  ];

  const [currentAnalysisStep, setCurrentAnalysisStep] = useState(0);

  const runAnalysis = () => {
    setIsAnalyzing(true);
    setCurrentAnalysisStep(0);
    
    const interval = setInterval(() => {
      setCurrentAnalysisStep(prev => {
        if (prev >= analysisSteps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setIsAnalyzing(false);
            setAnalysisComplete(true);
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
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
              <h1 className="text-3xl font-bold text-gray-900">Swing Committee</h1>
              <p className="text-gray-600 max-w-md mx-auto">
                Systematic swing trading using the wisdom of Livermore, O'Neil, Minervini, Darvas, Raschke & Weinstein.
              </p>
              <div className="grid grid-cols-6 gap-2 max-w-lg mx-auto pt-4">
                {[
                  { name: 'Livermore', short: 'L', color: 'bg-blue-100 text-blue-700' },
                  { name: 'O\'Neil', short: 'O', color: 'bg-green-100 text-green-700' },
                  { name: 'Minervini', short: 'M', color: 'bg-purple-100 text-purple-700' },
                  { name: 'Darvas', short: 'D', color: 'bg-amber-100 text-amber-700' },
                  { name: 'Raschke', short: 'R', color: 'bg-pink-100 text-pink-700' },
                  { name: 'Weinstein', short: 'W', color: 'bg-indigo-100 text-indigo-700' },
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
                    <p className="text-gray-400 text-sm">Live regime & sentiment data</p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* UK Market */}
                <div className="bg-white rounded-xl text-gray-900 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🇬🇧</span>
                        <span className="font-bold">UK Markets</span>
                      </div>
                      <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                        {marketPulseData.uk.regime}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-2xl font-bold ${getMarketSentimentColor(marketPulseData.uk.score).text}`}>
                        {marketPulseData.uk.score.toFixed(1)}
                      </p>
                      <div className={`flex items-center gap-1 text-sm ${marketPulseData.uk.changeDirection === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                        {marketPulseData.uk.changeDirection === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {marketPulseData.uk.change}
                      </div>
                    </div>
                    <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-amber-500 to-green-500">
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-5 bg-white border-2 border-gray-800 rounded-sm shadow-lg"
                        style={{ left: `calc(${(marketPulseData.uk.score / 10) * 100}% - 8px)` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-400">
                      <span>Bearish</span>
                      <span>Bullish</span>
                    </div>
                  </div>
                </div>

                {/* US Market */}
                <div className="bg-white rounded-xl text-gray-900 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🇺🇸</span>
                        <span className="font-bold">US Markets</span>
                      </div>
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                        {marketPulseData.us.regime}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-2xl font-bold ${getMarketSentimentColor(marketPulseData.us.score).text}`}>
                        {marketPulseData.us.score.toFixed(1)}
                      </p>
                      <div className={`flex items-center gap-1 text-sm ${marketPulseData.us.changeDirection === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                        {marketPulseData.us.changeDirection === 'up' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {marketPulseData.us.change}
                      </div>
                    </div>
                    <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-amber-500 to-green-500">
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-5 bg-white border-2 border-gray-800 rounded-sm shadow-lg"
                        style={{ left: `calc(${(marketPulseData.us.score / 10) * 100}% - 8px)` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-400">
                      <span>Bearish</span>
                      <span>Bullish</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Risk Warning */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <strong>⚠️ Risk Warning:</strong> Swing trading involves substantial risk of loss. Never risk more than you can afford to lose. This is educational only — not financial advice.
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
                    <p className="font-medium text-gray-900">Leverage / CFDs</p>
                    <p className="text-sm text-gray-500">Allow leveraged instruments</p>
                  </div>
                  <button
                    onClick={() => setFormData({ ...formData, leverageAllowed: !formData.leverageAllowed })}
                    className={`w-12 h-7 rounded-full transition-colors relative ${formData.leverageAllowed ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.leverageAllowed ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

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
                    { key: 'ukStocks', label: '🇬🇧 UK Stocks' },
                    { key: 'usStocks', label: '🇺🇸 US Stocks' },
                    { key: 'indices', label: '📊 Indices' },
                    { key: 'forex', label: '💱 Forex' },
                    { key: 'crypto', label: '₿ Crypto' },
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

            {/* Execution Mode */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="font-medium text-gray-900 mb-4">Execution Mode</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setFormData({ ...formData, executionMode: 'standard' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    formData.executionMode === 'standard'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className={`w-5 h-5 ${formData.executionMode === 'standard' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="font-bold text-gray-900">Standard</span>
                  </div>
                  <p className="text-sm text-gray-600">Shares / CFDs</p>
                  <p className="text-xs text-gray-400 mt-1">Subject to Capital Gains Tax</p>
                </button>
                <button
                  onClick={() => setFormData({ ...formData, executionMode: 'spread_bet' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    formData.executionMode === 'spread_bet'
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className={`w-5 h-5 ${formData.executionMode === 'spread_bet' ? 'text-green-600' : 'text-gray-400'}`} />
                    <span className="font-bold text-gray-900">Spread Bet</span>
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">UK Tax-Free</span>
                  </div>
                  <p className="text-sm text-gray-600">£ per point sizing</p>
                  <p className="text-xs text-gray-400 mt-1">Profits exempt from CGT</p>
                </button>
              </div>

              {formData.executionMode === 'spread_bet' && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Spread Bet Broker</label>
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
              )}
            </div>

            <div className={`border rounded-lg p-4 ${formData.executionMode === 'spread_bet' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
              <p className={`text-sm ${formData.executionMode === 'spread_bet' ? 'text-green-800' : 'text-blue-800'}`}>
                <strong>Risk calculation:</strong> With £{formData.accountSize} and {formData.riskPerTrade}% risk, 
                your max risk per trade is <strong>£{(parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100).toFixed(0)}</strong>
                {formData.executionMode === 'spread_bet' && (
                  <span className="block mt-1">
                    <strong>Spread Bet example:</strong> 500pt stop = £{((parseFloat(formData.accountSize) * parseFloat(formData.riskPerTrade) / 100) / 500).toFixed(2)}/point
                  </span>
                )}
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
            <p className="text-gray-600">Enter tickers you want the committee to analyze</p>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Watchlist Tickers</label>
              <textarea
                value={formData.watchlist}
                onChange={(e) => setFormData({ ...formData, watchlist: e.target.value })}
                placeholder="Example:
NVDA, VCP forming, earnings Feb 26
MSFT, Cup and handle
AAPL, Pulling back to 50-day
TSLA, Tight range breakout watch

Format: Ticker, Notes (optional)"
                rows={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">What We'll Check</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>✓ Livermore pivotal points & timing</li>
                <li>✓ O'Neil CANSLIM & relative strength</li>
                <li>✓ Minervini trend template & VCP</li>
                <li>✓ Darvas box structure</li>
                <li>✓ Raschke momentum/mean reversion</li>
                <li>✓ Weinstein stage analysis</li>
              </ul>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Session Settings</h2>
            <p className="text-gray-600">Configure this analysis session</p>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Trade Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setFormData({ ...formData, tradeMode: 'short_term' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    formData.tradeMode === 'short_term'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className={`w-5 h-5 ${formData.tradeMode === 'short_term' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="font-bold text-gray-900">Short-Term Swing</span>
                  </div>
                  <p className="text-sm text-gray-600">2-7 days • Tighter stops • Quick momentum</p>
                </button>
                <button
                  onClick={() => setFormData({ ...formData, tradeMode: 'position' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    formData.tradeMode === 'position'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Target className={`w-5 h-5 ${formData.tradeMode === 'position' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="font-bold text-gray-900">Position Swing</span>
                  </div>
                  <p className="text-sm text-gray-600">1-4 weeks • Wider stops • Trend following</p>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Market View</label>
              <select
                value={formData.regimeView}
                onChange={(e) => setFormData({ ...formData, regimeView: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="trending_up">📈 Trending Up — Buy breakouts</option>
                <option value="choppy">↔️ Choppy — Mean reversion / selective</option>
                <option value="volatile">⚡ Volatile — Reduce size, careful</option>
                <option value="trending_down">📉 Trending Down — Defensive / short bias</option>
                <option value="uncertain">❓ Uncertain — Let committee decide</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Your Confidence Level: {formData.marketSentiment}/10
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={formData.marketSentiment}
                onChange={(e) => setFormData({ ...formData, marketSentiment: parseInt(e.target.value) })}
                className="w-full h-2 bg-gradient-to-r from-red-400 via-amber-400 to-green-500 rounded-full appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Very Cautious</span>
                <span>Neutral</span>
                <span>Very Confident</span>
              </div>
              <div className={`mt-2 p-2 rounded-lg text-sm ${getSentimentLabel(formData.marketSentiment).bg}`}>
                <span className={getSentimentLabel(formData.marketSentiment).color}>
                  {getSentimentLabel(formData.marketSentiment).label}
                </span>
                <span className="text-gray-600"> — This affects committee stance (Aggressive/Balanced/Defensive)</span>
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
              <h2 className="text-2xl font-bold text-gray-900">Swing Committee in Session</h2>
              
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

        if (analysisComplete) {
          return (
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-900 to-indigo-800 rounded-2xl p-6 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-blue-200 text-sm">Swing Committee Report</p>
                    <h1 className="text-2xl font-bold mt-1">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
                    <p className="text-blue-300 mt-2">
                      {formData.tradeMode === 'position' ? 'Position Swing Mode' : 'Short-Term Swing Mode'} • Balanced Committee
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-4 gap-4 mt-6">
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="text-blue-200 text-xs">Market Regime</p>
                    <p className="text-lg font-bold text-green-400">Trending Up</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="text-blue-200 text-xs">Signals Found</p>
                    <p className="text-lg font-bold">3</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="text-blue-200 text-xs">Portfolio Heat</p>
                    <p className="text-lg font-bold text-amber-400">2.1%</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="text-blue-200 text-xs">Capacity</p>
                    <p className="text-lg font-bold text-green-400">3 more trades</p>
                  </div>
                </div>
              </div>

              {/* Trade Signals */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h2 className="font-bold text-gray-900">Trade Signals</h2>
                </div>
                
                {/* Signal Card - NVDA */}
                <div className="border-b border-gray-100">
                  <button
                    onClick={() => setExpandedSignal(expandedSignal === 'NVDA' ? null : 'NVDA')}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center text-white font-bold">
                        A+
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-gray-900">NVDA</p>
                        <p className="text-sm text-gray-500">VCP Breakout • Long</p>
                      </div>
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">6/6 Pillars</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-gray-900">Entry $138-140</p>
                        <p className="text-sm text-gray-500">R:R 3.2:1</p>
                      </div>
                      <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expandedSignal === 'NVDA' ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  
                  {expandedSignal === 'NVDA' && (
                    <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-4">
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-white rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500">Entry Zone</p>
                          <p className="font-bold text-gray-900">$138-140</p>
                          <p className="text-xs text-gray-400">13800-14000 pts</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500">Stop Loss</p>
                          <p className="font-bold text-red-600">$131.20</p>
                          <p className="text-xs text-gray-400">13120 pts</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500">Target 1</p>
                          <p className="font-bold text-green-600">$152</p>
                          <p className="text-xs text-gray-400">15200 pts</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500">Target 2</p>
                          <p className="font-bold text-green-600">$165</p>
                          <p className="text-xs text-gray-400">16500 pts</p>
                        </div>
                      </div>

                      {/* Position Sizing - Both Modes */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-blue-600" />
                            <p className="text-sm font-medium text-gray-700">Standard (Shares)</p>
                          </div>
                          <p className="text-gray-600 text-sm">Buy <strong>15 shares</strong> at $139</p>
                          <p className="text-gray-500 text-xs">Position: £1,670 • Risk: £100</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-green-600" />
                            <p className="text-sm font-medium text-gray-700">Spread Bet</p>
                            <span className="px-1 py-0.5 bg-green-100 text-green-700 text-xs rounded">Tax-Free</span>
                          </div>
                          <p className="text-gray-600 text-sm">Buy <strong>£0.14/point</strong> at 13900</p>
                          <p className="text-gray-500 text-xs">Stop: 780 pts • Risk: £100 • Margin: ~£390</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Six Pillars Alignment</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { name: 'Livermore', pass: true, note: 'Breaking 3-week consolidation' },
                            { name: 'O\'Neil', pass: true, note: 'RS 94, volume +45%' },
                            { name: 'Minervini', pass: true, note: 'Stage 2, VCP complete' },
                            { name: 'Darvas', pass: true, note: 'New box breakout' },
                            { name: 'Raschke', pass: true, note: 'Momentum thrust' },
                            { name: 'Weinstein', pass: true, note: 'Above rising 30-week' },
                          ].map(pillar => (
                            <div key={pillar.name} className={`p-2 rounded text-xs ${pillar.pass ? 'bg-green-50' : 'bg-red-50'}`}>
                              <div className="flex items-center gap-1">
                                <Check className={`w-3 h-3 ${pillar.pass ? 'text-green-600' : 'text-red-600'}`} />
                                <span className="font-medium">{pillar.name}</span>
                              </div>
                              <p className="text-gray-500 mt-1">{pillar.note}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* More signals... */}
                <div className="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center text-white font-bold">
                      A
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">MSFT</p>
                      <p className="text-sm text-gray-500">Pullback to 50-day • Long</p>
                    </div>
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">5/6 Pillars</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">Entry $415-418</p>
                    <p className="text-sm text-gray-500">R:R 2.5:1</p>
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer border-t border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-400 rounded-xl flex items-center justify-center text-white font-bold">
                      B
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">AAPL</p>
                      <p className="text-sm text-gray-500">Range breakout watch • Pending</p>
                    </div>
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">4/6 Pillars</span>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-600">Watchlist</p>
                    <p className="text-sm text-gray-500">Needs volume confirm</p>
                  </div>
                </div>
              </div>

              {/* Committee Stance */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
                <h3 className="font-bold text-gray-900 mb-3">Committee Stance</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-gray-50 rounded-lg opacity-60">
                    <p className="font-medium text-red-700">Aggressive</p>
                    <p className="text-xs text-gray-600">Take all 3 signals, max size</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg border-2 border-blue-500">
                    <p className="font-medium text-blue-700">Balanced ✓</p>
                    <p className="text-xs text-gray-600">NVDA + MSFT only, standard size</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg opacity-60">
                    <p className="font-medium text-green-700">Defensive</p>
                    <p className="text-xs text-gray-600">NVDA only, half size</p>
                  </div>
                </div>
              </div>

              {/* Action Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h3 className="font-medium text-blue-900 mb-3">📋 Action Summary</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">STANDARD (Shares)</p>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li><strong>NVDA:</strong> 15 shares at $138-140, stop $131.20</li>
                      <li><strong>MSFT:</strong> 8 shares at $415-418, stop $398</li>
                    </ul>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                    <p className="text-xs font-medium text-green-700 mb-2">SPREAD BET (Tax-Free)</p>
                    <ul className="text-sm text-green-800 space-y-1">
                      <li><strong>NVDA:</strong> £0.14/pt at 13900, stop 13120</li>
                      <li><strong>MSFT:</strong> £0.06/pt at 41600, stop 39800</li>
                    </ul>
                  </div>
                </div>
                
                <p className="text-sm text-blue-700 mt-3"><strong>Watch:</strong> AAPL for volume confirmation above $195</p>
              </div>
            </div>
          );
        }

        return (
          <div className="text-center py-12 space-y-6">
            <Activity className="w-16 h-16 text-blue-500 mx-auto" />
            <h2 className="text-2xl font-bold text-gray-900">Ready to Scan</h2>
            <p className="text-gray-600 max-w-md mx-auto">
              The Swing Committee will analyze your watchlist using all six pillars.
            </p>
            <button
              onClick={runAnalysis}
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium rounded-xl hover:from-blue-600 hover:to-indigo-600 transition-colors shadow-lg"
            >
              Run Swing Analysis
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className={`mx-auto ${analysisComplete ? 'max-w-4xl' : 'max-w-2xl'}`}>
        {/* Progress Steps */}
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
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                {step === 0 ? 'Get Started' : step === 4 ? 'Run Analysis' : 'Continue'}
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {analysisComplete && (
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setStep(0);
                setAnalysisComplete(false);
              }}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              ← Start New Analysis
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>Swing Committee • Educational Tool Only • Not Financial Advice</p>
        </div>
      </div>
    </div>
  );
}
