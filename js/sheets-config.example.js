/**
 * Google Sheets configuration for Steins & Vines inventory system.
 *
 * Setup instructions:
 * 1. Copy this file to sheets-config.js
 * 2. Create a Google Cloud project and enable the Google Sheets API.
 * 3. Create an API key (restrict to Sheets API + your domain).
 * 4. Create an OAuth 2.0 Client ID (Web application type).
 *    - Add your site origin to Authorized JavaScript origins.
 * 5. Create a Google Spreadsheet with tabs: Kits, Ingredients, Holds, Reservations, Config.
 * 6. Publish the Kits tab: File > Share > Publish to web > Kits tab > CSV.
 * 7. Fill in the values below.
 */
var SHEETS_CONFIG = {
  // Google Spreadsheet ID (from the spreadsheet URL)
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // API key for public read access (restricted to Sheets API)
  API_KEY: 'YOUR_API_KEY',

  // OAuth 2.0 Client ID for staff sign-in
  CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  // Published CSV URL for the Kits tab (public, no auth required)
  PUBLISHED_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/YOUR_PUBLISHED_ID/pub?gid=0&single=true&output=csv',

  // OAuth scope for read/write access to spreadsheets
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

  // Sheet/tab names within the spreadsheet
  SHEET_NAMES: {
    KITS: 'Kits',
    INGREDIENTS: 'Ingredients',
    HOLDS: 'Holds',
    RESERVATIONS: 'Reservations',
    CONFIG: 'Config'
  }
};
