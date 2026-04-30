'use client'

import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Shield, Brain, ChevronRight, ChevronLeft,
  Check, AlertCircle, Loader2, Target, Zap, Rocket, BarChart2,
  Newspaper, Activity, Clock, DollarSign, ShieldAlert,
  ArrowUpRight, ArrowDownRight, Crosshair, LineChart, BarChart3,
  AlertTriangle, Eye, Scale, Flame, Gauge, Calendar, BookOpen, Lightbulb,
  XCircle, RefreshCw, Sparkles, Globe
} from 'lucide-react';
import { computeMclPolicy } from '../lib/mclPolicy';

// ─── System Status Summary ──────────────────────────────────────────
// Data-driven summary computed from scanner results + MCL context.
// Replaces the old AI-generated "PART A — Market Regime" section.
function buildSystemSummary(scanResults, marketContextData) {
  if (!scanResults) return null

  const funnel = scanResults.funnel
  const gate = scanResults.regimeGate || {}
  const results = scanResults.results || {}
  const longs = results.long || []
  const shorts = results.short || []
  const watchlist = results.watchlist || []
  const totalTrades = longs.length + shorts.length
  const totalScanned = scanResults.totalScanned || funnel?.universe || 0

  // ── Regime posture ──
  const ukRegime = gate.ukRegimeState || 'YELLOW'
  const usRegime = gate.usRegimeState || 'YELLOW'
  const ukRiskOn = gate.uk?.riskOn
  const usRiskOn = gate.us?.riskOn
  const mclPolicy = gate.mclPolicy

  let regimePosture
  if (ukRegime === usRegime) {
    regimePosture = `Both markets ${ukRegime}${ukRegime === 'YELLOW' ? ' (cautious)' : ukRegime === 'GREEN' ? ' (risk-on)' : ' (defensive)'}.`
  } else {
    const ukLabel = ukRiskOn ? 'risk-on' : 'risk-off'
    const usLabel = usRiskOn ? 'risk-on' : 'risk-off'
    regimePosture = `Mixed regime: UK ${ukLabel} (${ukRegime}), US ${usLabel} (${usRegime}).`
  }

  // ── Result summary ──
  let resultSummary
  if (totalTrades === 0) {
    resultSummary = `${totalScanned} stocks scanned, no trades passed all gates.`
  } else {
    const parts = []
    if (longs.length > 0) parts.push(`${longs.length} long${longs.length !== 1 ? 's' : ''}`)
    if (shorts.length > 0) parts.push(`${shorts.length} short${shorts.length !== 1 ? 's' : ''}`)
    resultSummary = `${totalScanned} stocks scanned, ${parts.join(' and ')} passed all gates.`
  }

  // ── Key bottleneck ──
  let bottleneck = ''
  if (funnel) {
    const dirPassRate = funnel.stage1?.passed / funnel.universe
    const regimePassRate = funnel.stage2?.passed > 0 ? funnel.stage3?.passed / funnel.stage2.passed : 0

    if (dirPassRate < 0.05) {
      // Very few stocks even have a directional thesis
      const dirFailed = funnel.universe - funnel.stage1.passed
      bottleneck = `Only ${funnel.stage1.passed} of ${funnel.universe} stocks had a strong enough directional thesis (4+ pillars) — typical when markets lack clear direction.`
    } else if (regimePassRate < 0.3 && funnel.stage2.passed > 0) {
      // Direction filter OK but regime gate is strict
      const regimeFailed = funnel.stage2.passed - funnel.stage3.passed
      bottleneck = `${funnel.stage2.passed} stocks had direction, but ${regimeFailed} fell short at the regime gate thresholds.`
    } else if (totalTrades > 0) {
      bottleneck = `The pipeline is producing candidates — regime conditions are favourable.`
    }
  }

  // ── Closest candidates (from near misses or watchlist) ──
  const nearMisses = scanResults.nearMisses || {}
  const allNearMisses = [...(nearMisses.long || []), ...(nearMisses.short || [])]
  let closestCandidates = ''
  if (totalTrades === 0 && allNearMisses.length > 0) {
    const top3 = allNearMisses.slice(0, 3)
    const labels = top3.map(nm => `${nm.ticker} (${nm.badges?.[0] || nm.failureType})`).join(', ')
    closestCandidates = `${allNearMisses.length} near miss${allNearMisses.length !== 1 ? 'es' : ''} detected: ${labels}.`
  } else if (totalTrades === 0 && watchlist.length > 0) {
    const top3 = watchlist.slice(0, 3)
    const labels = top3.map(w => `${w.ticker} ${w.score?.toFixed(0)}%`).join(', ')
    closestCandidates = `Closest to threshold: ${labels}.`
  }

  // ── Build TL;DR ──
  const tldr = [regimePosture, resultSummary, bottleneck, closestCandidates]
    .filter(Boolean).join(' ')

  // ── Direction breakdown (why few/many passed) ──
  let directionExplanation = ''
  if (funnel) {
    const topReasons = funnel.stage1.topReasons || []
    if (topReasons.length > 0) {
      const reasonLabels = {
        insufficient_pillars: 'insufficient pillar alignment',
        no_direction: 'no directional signal',
        near_earnings: 'near earnings',
        volatility_spike: 'volatility spike',
        sr_demotion: 'S/R proximity demotion'
      }
      const topReason = topReasons[0]
      directionExplanation = `Most stocks were filtered at Direction because of ${reasonLabels[topReason.reason] || topReason.reason.replace(/_/g, ' ')} (${topReason.count} stocks).`
    }
  }

  // ── Regime gate detail ──
  const ukMcl = mclPolicy?.uk
  const usMcl = mclPolicy?.us
  const regimeDetail = {
    uk: {
      regime: ukRegime,
      riskOn: ukRiskOn,
      longSize: ukMcl?.longSize || gate.positionSizeMultiplier?.ukLong || 1.0,
      shortSize: ukMcl?.shortSize || gate.positionSizeMultiplier?.ukShort || 1.0,
      explain: ukMcl?.explain || null,
    },
    us: {
      regime: usRegime,
      riskOn: usRiskOn,
      longSize: usMcl?.longSize || gate.positionSizeMultiplier?.usLong || 1.0,
      shortSize: usMcl?.shortSize || gate.positionSizeMultiplier?.usShort || 1.0,
      explain: usMcl?.explain || null,
    },
  }

  return {
    tldr,
    regimePosture,
    resultSummary,
    bottleneck,
    closestCandidates,
    directionExplanation,
    regimeDetail,
    funnel,
    totalTrades,
    totalScanned,
    longs: longs.length,
    shorts: shorts.length,
    watchlistCount: watchlist.length,
    thresholds: scanResults.thresholds,
  }
}

export default function SwingCommitteeApp() {
  const [step, setStep] = useState(0);  // Start at welcome screen with Market Pulse
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [showUKSources, setShowUKSources] = useState(false);
  const [showUSSources, setShowUSSources] = useState(false);
  const [expandedPosition, setExpandedPosition] = useState(null);
  const [marketPulseData, setMarketPulseData] = useState(null);
  const [isLoadingMarketPulse, setIsLoadingMarketPulse] = useState(true);
  const [marketPulseError, setMarketPulseError] = useState(null);
  const [marketContextData, setMarketContextData] = useState(null);
  const [isLoadingMarketContext, setIsLoadingMarketContext] = useState(true);
  const [marketContextError, setMarketContextError] = useState(null);
  const [calendarData, setCalendarData] = useState(null);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(true);
  const [calendarError, setCalendarError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  // Gate-bypass (mechanics-test) state.
  //
  // While we exercise the IG execution mechanics end-to-end on DEMO, the user
  // can opt into a bypass path: pick up to 5 tickers from the Trade Signals
  // tab and ship them to entry-rules with entry gates suspended, sizing +
  // exits still enforced. Floor rules: max 5, grade-D disabled. The ingest
  // layer in entry-rules refuses bypass on LIVE and refuses expired
  // bypass_until dates — belt-and-braces. Default window is 20 days, which
  // leaves a ~40-day buffer before any live-money plan.
  //
  // Cap bumped 3 → 5 on 2026-04-29 for DEMO mechanics-testing only.
  // Live trading remains N=3 per feedback_small_account_sizing — that's a
  // budget-discipline cap (top-3 × 1% = 3% open risk, well inside R5's 6%).
  // The DEMO cap is purely diagnostic: more sample tickers per session
  // means more rule-stack evidence to verify number-correctness against.
  const BYPASS_MAX_SELECTIONS = 5;
  const BYPASS_DEFAULT_DAYS = 20;
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [bypassUntilDays, setBypassUntilDays] = useState(BYPASS_DEFAULT_DAYS);
  const [selectedSignals, setSelectedSignals] = useState(() => new Set());

  const [formData, setFormData] = useState({
    // Account
    accountSize: '10000',
    riskPerTrade: '1',
    maxPositions: '6',
    maxHeat: '6',
    // Permissions
    shortSellingAllowed: true,
    ukStocks: true,
    ukStocks250: false,
    usStocks: true,
    indices: false,
    forex: false,
    crypto: false,
    // Execution Mode
    executionMode: 'spread_bet', // Spread bet only
    spreadBetBroker: 'IG',
    // Positions
    openPositions: '',
    // Session
    tradeMode: 'short_term',
    marketSentiment: 5,
    regimeView: 'uncertain',
    sessionType: 'daily',
  });

  const steps = [
    { title: 'Account', icon: DollarSign },
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

  // Fetch Market Context Layer on component mount
  const fetchMarketContext = async () => {
    setIsLoadingMarketContext(true);
    setMarketContextError(null);
    try {
      const response = await fetch('/api/market-context');
      if (!response.ok) throw new Error('Failed to fetch market context');
      const data = await response.json();
      setMarketContextData(data);
    } catch (error) {
      setMarketContextError(error.message);
    } finally {
      setIsLoadingMarketContext(false);
    }
  };

  const fetchCalendar = async () => {
    setIsLoadingCalendar(true);
    setCalendarError(null);
    try {
      const response = await fetch('/api/calendar');
      if (!response.ok) throw new Error('Failed to fetch calendar data');
      const data = await response.json();
      setCalendarData(data);
    } catch (error) {
      setCalendarError(error.message);
    } finally {
      setIsLoadingCalendar(false);
    }
  };

  useEffect(() => {
    fetchMarketPulse();
    fetchMarketContext();
    fetchCalendar();
  }, []);

  // Reset all analysis-related state for a fresh start
  const resetForNewAnalysis = () => {
    // Reset analysis state
    setStep(0);  // Go back to welcome screen
    setAnalysisComplete(false);
    setAnalysisResult(null);
    setAnalysisError(null);

    // Reset UI state
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

  const [analysisSteps, setAnalysisSteps] = useState([]);
  const [currentAnalysisStep, setCurrentAnalysisStep] = useState(0);

  const systemSummary = useMemo(
    () => buildSystemSummary(scanResults, marketContextData),
    [scanResults, marketContextData]
  );

  // Format price for display
  const formatPrice = (price, currency) => {
    if (price === undefined || price === null) return 'N/A';
    if (currency === 'GBp') return `${price.toFixed(0)}p`; // UK pence
    if (currency === 'GBP') return `£${price.toFixed(2)}`;
    return `$${price.toFixed(2)}`;
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

      // ── MCL Policy — auto-compute regime from Market Context Layer ──
      // If MCL data is available, compute per-market policy (replaces manual regime).
      // Falls back to legacy regimeGate if MCL unavailable.
      let mclPolicyPayload = null;
      if (marketContextData?.factors) {
        mclPolicyPayload = {
          uk: computeMclPolicy(marketContextData.factors, 'UK'),
          us: computeMclPolicy(marketContextData.factors, 'US'),
        };
      }

      const response = await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'short_term',
          marketTrend,
          shortSellingAllowed: formData.shortSellingAllowed,
          regimeGate,
          mclPolicy: mclPolicyPayload,
          instruments: {
            ukStocks: formData.ukStocks,
            ukStocks250: formData.ukStocks250,
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
      return data;
    } catch (error) {
      setScanError(error.message);
      return null;
    } finally {
      setIsScanning(false);
    }
  };

  const runAnalysis = async (scanDataOverride = null) => {
    // The Watchlist step (case 3) used to trigger runScanner() before
    // runAnalysis. That step is gone, so runAnalysis now ensures the
    // scanner has run before proceeding. The click handler typically
    // passes the data via `scanDataOverride` (avoiding React closure
    // staleness on scanResults state); retry buttons rely on the inline
    // fallback below. See `narrow-scan-ui` 2a/2b.
    let effectiveScanResults = scanDataOverride || scanResults;
    if (!effectiveScanResults) {
      effectiveScanResults = await runScanner();
      if (!effectiveScanResults) {
        setAnalysisError('Scanner failed — cannot proceed with analysis');
        return;
      }
    }
    // Build dynamic steps based on what we're analyzing
    const baseSteps = [
      'Loading account parameters...',
      'Scanning market regime...',
      'Checking UK market breadth...',
      'Checking US market breadth...',
    ];

    // Add open positions review if present
    const hasPositions = formData.openPositions && formData.openPositions.trim().length > 0;
    if (hasPositions) baseSteps.push('Reviewing open positions...');

    baseSteps.push(
      'Applying Livermore pivotal points...',
      'Running O\'Neil CANSLIM screen...',
      'Checking Minervini trend template...',
      'Identifying Darvas boxes...',
      'Raschke momentum analysis...',
      'Sector RS check...',
      'Scoring setups against 6 pillars...',
    );

    // Add per-ticker review steps — show ALL tickers being analyzed
    const scannerWatchlist = effectiveScanResults?.results?.watchlist || [];

    // Scanner-approved trades
    const approvedLongs = effectiveScanResults?.results?.long || [];
    const approvedShorts = effectiveScanResults?.results?.short || [];
    const approvedTickers = [...approvedLongs, ...approvedShorts].map(s => s.ticker);

    // Scanner developing stocks (always included)
    const developingTickers = scannerWatchlist.slice(0, 5).map(s => s.ticker);

    // Combine all, deduplicate
    const allReviewTickers = [...new Set([...approvedTickers, ...developingTickers])];

    if (allReviewTickers.length > 0) {
      baseSteps.push('Generating trade signals...');
      allReviewTickers.forEach(t => baseSteps.push(`Reviewing ${t}...`));
    }

    baseSteps.push('Building committee positions...');
    baseSteps.push('Calculating position sizes...');
    baseSteps.push('Finalising report...');

    setAnalysisSteps(baseSteps);
    setIsAnalyzing(true);
    setCurrentAnalysisStep(0);
    setAnalysisError(null);

    // Animate through steps while waiting for API
    const totalSteps = baseSteps.length;
    const interval = setInterval(() => {
      setCurrentAnalysisStep(prev => {
        if (prev >= totalSteps - 1) return prev;
        return prev + 1;
      });
    }, 800);

    try {
      // Strip scanner results to only what the analyze prompt needs (regime gate + minimal per-ticker data)
      // Full effectiveScanResults can be 100-200KB; this reduces it to ~2-5KB
      const lightScannerResults = effectiveScanResults ? {
        regimeGate: {
          source: effectiveScanResults.regimeGate?.source,
          regimeState: effectiveScanResults.regimeGate?.regimeState,
          ukRegimeState: effectiveScanResults.regimeGate?.ukRegimeState,
          usRegimeState: effectiveScanResults.regimeGate?.usRegimeState,
        },
        thresholds: effectiveScanResults.thresholds,
        results: {
          long: (effectiveScanResults.results?.long || []).map(s => ({
            ticker: s.ticker, score: s.score, setupTier: s.setupTier,
            tradeManagement: s.tradeManagement ? { riskRewardRatio: s.tradeManagement.riskRewardRatio } : null,
          })),
          short: (effectiveScanResults.results?.short || []).map(s => ({
            ticker: s.ticker, score: s.score, setupTier: s.setupTier,
            tradeManagement: s.tradeManagement ? { riskRewardRatio: s.tradeManagement.riskRewardRatio } : null,
          })),
          watchlist: (effectiveScanResults.results?.watchlist || []).map(s => ({
            ticker: s.ticker, score: s.score, direction: s.direction,
            price: s.price, currency: s.currency,
            // Stage failure data
            srDemotion: s.srDemotion || false,
            originalDirection: s.originalDirection || null,
            longScore: s.longScore, shortScore: s.shortScore,
            longPassing: s.longPassing, shortPassing: s.shortPassing,
            volatilityWarning: s.volatilityWarning || null,
            // Earnings proximity
            earningsDate: s.earningsDate,
            daysUntilEarnings: s.daysUntilEarnings,
            earningsWarning: s.earningsWarning,
            // Day trade data — S/R, volatility, volume, momentum
            atr: s.indicators?.atr,
            atrRaw: s.indicators?.atrRaw,
            nearestSupport: s.indicators?.nearestSupport,
            nearestResistance: s.indicators?.nearestResistance,
            volumeRatio: s.indicators?.volumeRatio,
            avgVolume20: s.indicators?.avgVolume20,
            rsi: s.indicators?.rsi,
            momentum5d: s.indicators?.momentum5d,
            priceVsMa20: s.indicators?.priceVsMa20,
          })),
          // Day-1 Capture Module results (pre-scored, pass through to analyze)
          dayTrades: effectiveScanResults.results?.dayTrades || { candidates: [], excluded: [], summary: {} },
        },
      } : null;

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData,
          marketPulse: {
            uk: { score: marketPulseData.uk.score, label: marketPulseData.uk.label, regime: marketPulseData.uk.regime },
            us: { score: marketPulseData.us.score, label: marketPulseData.us.label, regime: marketPulseData.us.regime }
          },
          livePrices: {},
          scannerResults: lightScannerResults
        })
      });

      clearInterval(interval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Analysis failed');
      }

      const result = await response.json();
      setAnalysisResult(result);
      setCurrentAnalysisStep(totalSteps - 1);

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

  // Download the scan handoff JSON as a file the user can drop into
  // entry-rules/money-program-trading/data/scans/. This is the only way to
  // get the file onto the user's local disk when the app runs on Vercel —
  // the serverless filesystem is ephemeral so server-side writes do not
  // persist. The payload shape matches what session_init.py ingests.
  const downloadScanJson = (scan) => {
    if (!scan || scan.ok === false || !scan.filename) return;
    const payload = {
      schema_version: scan.schema_version,
      scan_record: scan.scan_record,
      shortlist_entries: scan.shortlist_entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });

    // Primary: today's file — overwrites yesterday (unless validator blocked).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scan.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Archive sibling: timestamped, never overwrites. Only when flag is on.
    // NEXT_PUBLIC_SCAN_ARCHIVE is build-time inlined, so flipping it needs a
    // redeploy. Ships default-off — see IMPLEMENTATION_SPEC.md §6.
    if (process.env.NEXT_PUBLIC_SCAN_ARCHIVE === '1') {
      const ymd = scan.filename.replace(/^scan_|\.json$/g, '');
      const now = new Date();
      const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join('');
      const archiveUrl = URL.createObjectURL(blob);
      const archiveA = document.createElement('a');
      archiveA.href = archiveUrl;
      archiveA.download = `scan_${ymd}_${hhmmss}.json`;
      document.body.appendChild(archiveA);
      archiveA.click();
      document.body.removeChild(archiveA);
      setTimeout(() => URL.revokeObjectURL(archiveUrl), 1000);
    }
  };

  // Gate-bypass helpers ----------------------------------------------------

  // Compute bypass_until as YYYY-MM-DD, N days from today (UTC).
  const computeBypassUntil = (days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Math.max(1, Math.floor(Number(days) || 0)));
    return d.toISOString().slice(0, 10);
  };

  // Is a signal eligible for bypass selection? Must have a grade that
  // lib/scanEmission.js can size. A+/A/B are the production ladder; C is
  // permitted ONLY here on the bypass path so a DEMO mechanics-test run can
  // proceed even when the day's scan produced nothing above C (which happens
  // whenever sector data is missing and sectorRS defaults to 5 — the known
  // grade-ceiling issue documented in project_grade_ceiling_diagnosis.md).
  // C is still excluded from live flow because bypass itself is DEMO-only
  // (enforced on both sides — the emitter throws on brokerMode=LIVE and the
  // entry-rules ingester refuses bypass on LIVE). D and ungraded stay out:
  // GRADE_TO_RISK_PCT has no entry for them, so they'd silently drop from
  // the built bypass payload.
  const isBypassEligible = (signal) => {
    if (!signal || !signal.grade) return false;
    const g = String(signal.grade).toUpperCase();
    return g === 'A+' || g === 'A' || g === 'B' || g === 'C';
  };

  // Build + download the bypass-flavoured scan JSON.
  //
  // Filters the server-built `bypass_candidate_entries` (every gradable signal,
  // not just TAKE-TRADE — see lib/scanEmission.js) down to the user's 1–3
  // picks, stamps `gate_bypass: true` + `bypass_until` on the scan_record,
  // and triggers a browser download. The ingester on the entry-rules side
  // refuses bypass payloads on LIVE or with expired bypass_until dates.
  //
  // Diagnostic logging (visible in DevTools → Console) so any future silent
  // fail surfaces with a reason instead of a no-op. Each early-return below
  // is a distinct bug class; collapsing them to one console.warn family makes
  // the failure visible without breaking the non-DevTools user.
  const downloadBypassScanJson = (scan, tickerSet, bypassUntil) => {
    if (!scan || scan.ok === false || !scan.filename) {
      console.warn('[bypass] no scan on analysisResult — run a scan first', { scan });
      return;
    }
    if (!tickerSet || tickerSet.size === 0) {
      console.warn('[bypass] no tickers selected');
      return;
    }

    const upper = new Set([...tickerSet].map((t) => String(t).toUpperCase()));

    // Prefer the bypass-eligible pool (all gradable verdicts). Fall back to
    // the narrow shortlist for old scan payloads that pre-date the
    // bypass_candidate_entries field — lets cached analyses still work.
    const pool =
      (Array.isArray(scan.bypass_candidate_entries) && scan.bypass_candidate_entries.length > 0
        ? scan.bypass_candidate_entries
        : scan.shortlist_entries) || [];

    const filteredShortlist = pool.filter((e) =>
      upper.has(String(e.symbol).toUpperCase()),
    );

    if (filteredShortlist.length === 0) {
      console.warn(
        '[bypass] selected tickers matched nothing in the bypass pool — ' +
          'likely an ungradable signal or a zone/stop the emitter rejected',
        { selected: [...upper], poolSymbols: pool.map((e) => e.symbol) },
      );
      return;
    }

    const bypassScanRecord = {
      ...scan.scan_record,
      gate_bypass: true,
      bypass_until: bypassUntil,
    };

    const payload = {
      schema_version: scan.schema_version,
      scan_record: bypassScanRecord,
      shortlist_entries: filteredShortlist,
    };

    // Rename file so the user can tell bypass scans apart on disk.
    const origName = scan.filename || 'scan.json';
    const bypassName = origName.replace(/\.json$/i, '_bypass.json');

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bypassName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log(
      `[bypass] downloaded ${bypassName} — ${filteredShortlist.length} entries, bypass_until=${bypassUntil}`,
    );
  };

  const toggleSignalSelection = (ticker, signal) => {
    if (!ticker || !isBypassEligible(signal)) return;
    setSelectedSignals((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else if (next.size >= BYPASS_MAX_SELECTIONS) {
        // At cap — ignore attempts to add a fourth. UI also disables the box.
        return prev;
      } else {
        next.add(ticker);
      }
      return next;
    });
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

  // Helper to check if signal is a DAY TRADE
  const isDayTrade = (signal) => {
    const verdict = (signal?.verdict || '').toUpperCase();
    return verdict === 'DAY TRADE';
  };

  // Helper to get actual trade direction (LONG/SHORT) - only if it's a real trade or day trade
  const getTradeDirection = (signal) => {
    if (isNoTrade(signal) || isWatchlist(signal)) return null;

    const direction = (signal?.direction || '').toUpperCase();
    if (direction === 'LONG') return 'LONG';
    if (direction === 'SHORT') return 'SHORT';
    return null;
  };

  // getSignalBoxColor / getSignalBoxLabel / getVerdictColor removed —
  // they powered the old expandable signal cards. The lean-scan table
  // uses inline grade/direction badges instead (see CandidatesTable
  // render below).

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-6">
            <div>
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
                    { key: 'ukStocks', label: 'FTSE 100' },
                    { key: 'ukStocks250', label: 'FTSE 250' },
                    { key: 'usStocks', label: 'US Stocks' },
                    { key: 'indices', label: 'Indices' },
                    { key: 'forex', label: 'Forex' },
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

          </div>
        );

      case 1:
        if (isAnalyzing) {
          return (
            <div className="text-center py-8 space-y-6">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                <Activity className="absolute inset-0 m-auto w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">The Trading Program in Session</h2>

              <div className="max-w-md mx-auto text-center">
                <div className="flex items-center justify-center gap-3 text-sm text-blue-600 font-medium">
                  <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
                  <span>Status: {analysisSteps[currentAnalysisStep] || 'Starting...'}</span>
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
                    <p className="text-blue-200 text-xs text-center">Regime Gate</p>
                    {(() => {
                      const ukR = scanResults?.regimeGate?.ukRegimeState
                      const usR = scanResults?.regimeGate?.usRegimeState
                      const regimeColor = (r) => r === 'GREEN' ? 'text-green-400' : r === 'RED' ? 'text-red-400' : 'text-amber-400'
                      if (ukR && usR) {
                        return ukR === usR
                          ? <p className={`text-lg font-bold text-center ${regimeColor(ukR)}`}>{ukR}</p>
                          : <p className="text-sm font-bold text-center">
                              <span className={regimeColor(ukR)}>UK {ukR}</span>
                              <span className="text-blue-300 mx-1">/</span>
                              <span className={regimeColor(usR)}>US {usR}</span>
                            </p>
                      }
                      return <p className="text-lg font-bold text-center text-blue-300">-</p>
                    })()}
                  </div>
                </div>

                {/* Entry-rules handoff — download scan JSON for session_init.py */}
                {analysisResult.scan?.ok && analysisResult.scan.shortlist_count > 0 && (
                  <div className="mt-5 pt-4 border-t border-white/20 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-blue-200 text-xs">
                      <span className="font-semibold text-white">Entry-rules handoff:</span>{' '}
                      {analysisResult.scan.shortlist_count} shortlist{' '}
                      {analysisResult.scan.shortlist_count === 1 ? 'entry' : 'entries'}
                      {' · '}
                      <code className="bg-white/10 px-1.5 py-0.5 rounded text-[11px]">
                        {analysisResult.scan.filename}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadScanJson(analysisResult.scan)}
                      className="px-4 py-2 bg-white text-blue-900 rounded-lg hover:bg-blue-50 transition-colors text-sm font-semibold whitespace-nowrap"
                      title="Save to entry-rules/money-program-trading/data/scans/"
                    >
                      Download scan JSON
                    </button>
                  </div>
                )}
                {analysisResult.scan?.ok === false && (
                  <div className="mt-5 pt-4 border-t border-white/20 text-amber-300 text-xs">
                    Scan handoff build failed: {analysisResult.scan.error || 'unknown error'}
                  </div>
                )}
              </div>

              {/* Lean-scan: tab navigation + Summary/Open Positions/Full Report
                  tabs removed. Only the Trade Signals view remains, rendered
                  unconditionally below. */}

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <h2 className="font-bold text-gray-900">Trade Signals</h2>
                  </div>

                  {/* Mechanics-test bypass ribbon — DEMO only. Toggling the
                      checkbox enables the per-row selection controls below
                      and reveals the bypass download button. */}
                  <div className={`px-4 py-3 border-b border-gray-100 ${bypassEnabled ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={bypassEnabled}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setBypassEnabled(on);
                            if (!on) setSelectedSignals(new Set());
                          }}
                          className="w-4 h-4 rounded border-gray-400 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="font-semibold">
                          Mechanics-test bypass
                          <span className="ml-1 text-xs font-normal text-gray-500">
                            (DEMO only · pick up to {BYPASS_MAX_SELECTIONS})
                          </span>
                        </span>
                      </label>
                      {bypassEnabled && (
                        <div className="flex items-center gap-2 text-xs text-gray-700">
                          <span>Window:</span>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={bypassUntilDays}
                            onChange={(e) => setBypassUntilDays(e.target.value)}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <span>days (until {computeBypassUntil(bypassUntilDays)})</span>
                          <span className="ml-3 px-2 py-0.5 bg-white border border-gray-300 rounded font-medium">
                            {selectedSignals.size}/{BYPASS_MAX_SELECTIONS} selected
                          </span>
                        </div>
                      )}
                    </div>
                    {bypassEnabled && (
                      <p className="mt-2 text-xs text-amber-800">
                        Entry gates suspended; exits + position sizing still enforced. A+/A/B/C selectable (C sizes at B's 0.5% for mechanics-test); D and ungraded excluded.
                      </p>
                    )}
                  </div>

                  {/* Lean-scan: compact candidates table.
                      Expandable cards removed. Columns per docs/lean_scan_spec.md §4.4.
                      Sort order: grade descending (A+ first), then ticker alpha. */}
                  {(() => {
                    const gradeOrder = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }
                    const tradeable = (analysisResult.signals || [])
                      .filter(s => !isNoTrade(s) && s.ticker && !s.ticker.includes('REQUEST') && !s.ticker.includes('NEEDED') && !s.ticker.includes('TBD'))
                      .slice()
                      .sort((a, b) => {
                        const ga = gradeOrder[a.grade] ?? 99
                        const gb = gradeOrder[b.grade] ?? 99
                        if (ga !== gb) return ga - gb
                        return (a.ticker || '').localeCompare(b.ticker || '')
                      })

                    if (tradeable.length === 0) {
                      return (
                        <div className="p-8 text-center text-gray-500">
                          <p>No actionable trade signals found.</p>
                        </div>
                      )
                    }

                    const fmtTrigger = (s) => {
                      if (typeof s.trigger_low === 'number' && typeof s.trigger_high === 'number') {
                        const lo = s.trigger_low
                        const hi = s.trigger_high
                        return lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`
                      }
                      if (s.entry && typeof s.entry === 'object') {
                        const lo = s.entry.low
                        const hi = s.entry.high ?? s.entry.low
                        if (typeof lo === 'number') {
                          return lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${(hi ?? lo).toFixed(2)}`
                        }
                      }
                      return s.entry ?? '—'
                    }
                    const fmtNum = (v) => {
                      if (typeof v === 'number') return v.toFixed(2)
                      return v ?? '—'
                    }
                    const gradeClass = (g) => {
                      if (g === 'A+') return 'bg-emerald-600 text-white'
                      if (g === 'A') return 'bg-green-600 text-white'
                      if (g === 'B') return 'bg-amber-500 text-white'
                      if (g === 'C') return 'bg-gray-400 text-white'
                      if (g === 'D') return 'bg-red-500 text-white'
                      return 'bg-gray-200 text-gray-600'
                    }
                    const dirClass = (d) => d === 'LONG'
                      ? 'bg-green-100 text-green-700'
                      : d === 'SHORT'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-600'

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                            <tr>
                              {bypassEnabled && <th className="px-3 py-2 w-8"></th>}
                              <th className="px-3 py-2 text-left">Symbol</th>
                              <th className="px-2 py-2 text-left">Dir</th>
                              <th className="px-2 py-2 text-left">Grade</th>
                              <th className="px-3 py-2 text-right">Trigger</th>
                              <th className="px-3 py-2 text-right">Stop</th>
                              <th className="px-3 py-2 text-right">Target</th>
                              <th className="px-3 py-2 text-left">Why</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tradeable.map((signal, idx) => {
                              const ticker = signal.ticker
                              const isSelected = selectedSignals.has(ticker)
                              const eligibleForBypass = isBypassEligible(signal)
                              const atCap = selectedSignals.size >= BYPASS_MAX_SELECTIONS && !isSelected
                              const checkboxDisabled = !bypassEnabled || !eligibleForBypass || atCap
                              return (
                                <tr key={idx} className={`border-t border-gray-100 ${isSelected ? 'bg-amber-50/60' : 'hover:bg-gray-50'}`}>
                                  {bypassEnabled && (
                                    <td className="px-3 py-2 align-middle">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={checkboxDisabled}
                                        onChange={() => toggleSignalSelection(ticker, signal)}
                                        title={
                                          !eligibleForBypass
                                            ? "Grade-D or ungraded — can't bypass"
                                            : atCap
                                              ? `Max ${BYPASS_MAX_SELECTIONS} selected`
                                              : 'Select for mechanics-test execution'
                                        }
                                        className="w-4 h-4 rounded border-gray-400 text-amber-600 focus:ring-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                  )}
                                  <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">{ticker}</td>
                                  <td className="px-2 py-2">
                                    <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${dirClass(signal.direction)}`}>
                                      {signal.direction || '—'}
                                    </span>
                                  </td>
                                  <td className="px-2 py-2">
                                    <span className={`px-1.5 py-0.5 text-xs rounded font-bold ${gradeClass(signal.grade)}`}>
                                      {signal.grade || '—'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtTrigger(signal)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-red-600 whitespace-nowrap">{fmtNum(signal.stop)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-green-700 whitespace-nowrap">{fmtNum(signal.target)}</td>
                                  <td className="px-3 py-2 text-gray-600 max-w-xl" title={signal.rationale_one_liner || signal.setupType || ''}>
                                    <span className="block truncate">{signal.rationale_one_liner || signal.setupType || '—'}</span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  {/* Bypass execute footer — only shows when bypass mode is
                      on and the user has curated at least one eligible pick. */}
                  {bypassEnabled && selectedSignals.size > 0 && analysisResult.scan?.ok && (
                    <div className="p-4 bg-amber-50 border-t border-amber-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-amber-900">
                        <span className="font-semibold">Mechanics-test bypass:</span>{' '}
                        {selectedSignals.size}/{BYPASS_MAX_SELECTIONS} selected
                        {' · '}bypass_until <code className="bg-white px-1.5 py-0.5 rounded">{computeBypassUntil(bypassUntilDays)}</code>
                        {' · '}DEMO only
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          downloadBypassScanJson(
                            analysisResult.scan,
                            selectedSignals,
                            computeBypassUntil(bypassUntilDays),
                          )
                        }
                        className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-semibold whitespace-nowrap"
                        title="Download a bypass scan JSON for entry-rules/data/scans/"
                      >
                        Download bypass scan ({selectedSignals.size})
                      </button>
                    </div>
                  )}

                </div>

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
        {step > 0 && step < 1 && (
          <div className="flex items-center justify-between mb-8">
            {steps.slice(0, 1).map((s, i) => (
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
                {i < 2 && (
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
            {step < 1 && (
              <button
                onClick={async () => {
                  if (step === 0) {
                    // Run scanner FIRST — it used to be triggered by the
                    // deleted Watchlist step. Pass its return value
                    // straight into runAnalysis to sidestep React closure
                    // staleness on scanResults state.
                    setStep(1);
                    const scanData = await runScanner();
                    if (scanData) {
                      runAnalysis(scanData);
                    }
                  } else {
                    setStep(step + 1);
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                {"Run Analysis"}
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
