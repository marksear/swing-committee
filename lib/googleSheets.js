// Google Sheets integration for persisting scan results and trade signals
import { google } from 'googleapis';

// Initialize Google Sheets API client
function getAuthClient() {
  // Credentials come from environment variable (JSON string)
  const credentials = process.env.GOOGLE_SHEETS_CREDENTIALS;
  if (!credentials) {
    throw new Error('GOOGLE_SHEETS_CREDENTIALS environment variable not set');
  }

  const parsedCredentials = JSON.parse(credentials);

  const auth = new google.auth.GoogleAuth({
    credentials: parsedCredentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return auth;
}

function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// Get spreadsheet ID from environment
function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID environment variable not set');
  }
  return id;
}

// Headers for each sheet
const SCAN_RESULTS_HEADERS = ['Timestamp', 'Direction', 'Ticker', 'Name', 'Price', 'Currency', 'Score', 'Reasoning', 'RSI', 'Momentum 20d', 'Market Trend'];
const TRADE_SIGNALS_HEADERS = ['Timestamp', 'Ticker', 'Direction', 'Entry', 'Stop', 'Target', 'Grade', 'Risk/Reward', 'Pillars', 'Setup/Reasoning', 'Committee Stance'];

// Ensure headers exist in both sheets
async function ensureHeaders(sheets, spreadsheetId) {
  try {
    // Check Scan Results headers
    const scanCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Scan Results!A1:A1',
    });

    if (!scanCheck.data.values || scanCheck.data.values.length === 0 || scanCheck.data.values[0][0] !== 'Timestamp') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Scan Results!A1:K1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [SCAN_RESULTS_HEADERS] },
      });
      console.log('Added Scan Results headers');
    }

    // Check Trade Signals headers
    const signalsCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trade Signals!A1:A1',
    });

    if (!signalsCheck.data.values || signalsCheck.data.values.length === 0 || signalsCheck.data.values[0][0] !== 'Timestamp') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Trade Signals!A1:K1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [TRADE_SIGNALS_HEADERS] },
      });
      console.log('Added Trade Signals headers');
    }
  } catch (error) {
    console.error('Error ensuring headers:', error.message);
    // Don't throw - headers are nice to have but not critical
  }
}

/**
 * Append scan results to the "Scan Results" sheet
 */
export async function appendScanResults(scanResults) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Ensure headers exist first
  await ensureHeaders(sheets, spreadsheetId);

  const timestamp = new Date().toISOString();
  const rows = [];

  // Safely get arrays (handle undefined)
  const longCandidates = scanResults?.results?.long || [];
  const shortCandidates = scanResults?.results?.short || [];
  const watchlistCandidates = scanResults?.results?.watchlist || [];

  console.log(`Processing scan results: ${longCandidates.length} longs, ${shortCandidates.length} shorts, ${watchlistCandidates.length} watch`);

  // Add long candidates
  for (const stock of longCandidates) {
    rows.push([
      timestamp,
      'LONG',
      stock.ticker || '',
      stock.name || '',
      stock.price || '',
      stock.currency || '',
      stock.score?.toFixed(1) || '',
      stock.reasoning || '',
      stock.indicators?.rsi?.toFixed(1) || '',
      stock.indicators?.momentum20d?.toFixed(2) || '',
      scanResults.marketTrend || 'neutral'
    ]);
  }

  // Add short candidates
  for (const stock of shortCandidates) {
    rows.push([
      timestamp,
      'SHORT',
      stock.ticker || '',
      stock.name || '',
      stock.price || '',
      stock.currency || '',
      stock.score?.toFixed(1) || '',
      stock.reasoning || '',
      stock.indicators?.rsi?.toFixed(1) || '',
      stock.indicators?.momentum20d?.toFixed(2) || '',
      scanResults.marketTrend || 'neutral'
    ]);
  }

  // Add watchlist candidates
  for (const stock of watchlistCandidates) {
    rows.push([
      timestamp,
      'WATCH',
      stock.ticker || '',
      stock.name || '',
      stock.price || '',
      stock.currency || '',
      stock.score?.toFixed(1) || '',
      stock.reasoning || '',
      stock.indicators?.rsi?.toFixed(1) || '',
      stock.indicators?.momentum20d?.toFixed(2) || '',
      scanResults.marketTrend || 'neutral'
    ]);
  }

  if (rows.length === 0) {
    console.log('No scan results to append');
    return { success: true, rowsAdded: 0 };
  }

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Scan Results!A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    console.log(`Appended ${rows.length} scan results to Google Sheets`);
    return { success: true, rowsAdded: rows.length };
  } catch (error) {
    console.error('Error appending scan results:', error);
    throw error;
  }
}

/**
 * Append trade signals to the "Trade Signals" sheet
 */
export async function appendTradeSignals(analysisResult) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Ensure headers exist first
  await ensureHeaders(sheets, spreadsheetId);

  const timestamp = new Date().toISOString();
  const rows = [];

  // Extract signals from analysis result
  const signals = analysisResult?.signals || [];

  for (const signal of signals) {
    // Skip NO TRADE signals
    const verdict = (signal.verdict || signal.direction || '').toUpperCase();
    if (verdict.includes('NO TRADE') || verdict === 'PASS') continue;

    // Extract pillar info from rawSection if available
    const rawSection = signal.rawSection || '';
    const pillarMatch = rawSection.match(/(\d\/6) pillars/i);
    const pillarInfo = pillarMatch ? pillarMatch[0] : (signal.pillarCount ? `${signal.pillarCount}/6 pillars` : '');

    // Extract a brief reasoning from setupType or rawSection
    const reasoning = signal.setupType || '';

    rows.push([
      timestamp,
      signal.ticker || '',
      signal.direction || verdict || '',
      signal.entry || '',
      signal.stop || '',
      signal.target || '',
      signal.grade || '',
      signal.riskReward || '',
      pillarInfo,  // Pillars info
      reasoning,   // Setup type / reasoning
      analysisResult.committee_stance || analysisResult.committeeStance || ''
    ]);
  }

  if (rows.length === 0) {
    console.log('No trade signals to append');
    return { success: true, rowsAdded: 0 };
  }

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Trade Signals!A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    console.log(`Appended ${rows.length} trade signals to Google Sheets`);
    return { success: true, rowsAdded: rows.length };
  } catch (error) {
    console.error('Error appending trade signals:', error);
    throw error;
  }
}

/**
 * Initialize sheets with headers if they don't exist
 */
export async function initializeSheets() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const scanResultsHeaders = [
    ['Timestamp', 'Direction', 'Ticker', 'Name', 'Price', 'Currency', 'Score', 'Reasoning', 'RSI', 'Momentum 20d', 'Market Trend']
  ];

  const tradeSignalsHeaders = [
    ['Timestamp', 'Ticker', 'Direction', 'Entry', 'Stop', 'Target', 'Grade', 'Risk/Reward', 'Position Size', 'Pillars Assessment', 'Key Levels', 'Reasoning', 'Committee Stance']
  ];

  try {
    // Check if headers exist for Scan Results
    const scanCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Scan Results!A1:K1',
    });

    if (!scanCheck.data.values || scanCheck.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Scan Results!A1:K1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: scanResultsHeaders },
      });
      console.log('Initialized Scan Results headers');
    }

    // Check if headers exist for Trade Signals
    const signalsCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trade Signals!A1:K1',
    });

    if (!signalsCheck.data.values || signalsCheck.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Trade Signals!A1:K1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: tradeSignalsHeaders },
      });
      console.log('Initialized Trade Signals headers');
    }

    return { success: true };
  } catch (error) {
    console.error('Error initializing sheets:', error);
    throw error;
  }
}
