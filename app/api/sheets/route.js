// API endpoint to save data to Google Sheets
import { appendScanResults, appendTradeSignals, initializeSheets } from '@/lib/googleSheets';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    // Check if Google Sheets is configured
    if (!process.env.GOOGLE_SHEETS_CREDENTIALS || !process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
      return Response.json({
        success: false,
        error: 'Google Sheets not configured',
        message: 'Set GOOGLE_SHEETS_CREDENTIALS and GOOGLE_SHEETS_SPREADSHEET_ID environment variables'
      }, { status: 200 }); // Return 200 so it doesn't break the app
    }

    switch (action) {
      case 'saveScanResults':
        const scanResult = await appendScanResults(data);
        return Response.json({ success: true, ...scanResult });

      case 'saveTradeSignals':
        const signalResult = await appendTradeSignals(data);
        return Response.json({ success: true, ...signalResult });

      case 'initialize':
        const initResult = await initializeSheets();
        return Response.json({ success: true, ...initResult });

      default:
        return Response.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Sheets API error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
