/**
 * Google Apps Script — Reservation Form Submit Trigger
 *
 * Setup:
 * 1. Open the Google Spreadsheet
 * 2. Extensions → Apps Script
 * 3. Paste this code into Code.gs
 * 4. Set up a trigger: Triggers → Add Trigger
 *    - Function: onFormSubmit
 *    - Event source: From spreadsheet
 *    - Event type: On form submit
 *
 * This script:
 * - Creates a row in the Reservations tab
 * - Parses the products string and creates rows in the Holds tab
 * - Increments on_hold in the Kits tab for each held product
 */

function onFormSubmit(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responses = e.namedValues;

  var customerName = (responses['Name'] || [''])[0];
  var customerEmail = (responses['Email'] || [''])[0];
  var customerPhone = (responses['Phone'] || [''])[0];
  var productsStr = (responses['Products'] || [''])[0];
  var timeslot = (responses['Timeslot'] || [''])[0];

  var now = new Date();
  var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');

  // Generate reservation ID
  var reservationsSheet = ss.getSheetByName('Reservations');
  var lastResRow = reservationsSheet.getLastRow();
  var resNum = String(lastResRow).padStart(3, '0');
  var reservationId = 'R-' + dateStr + '-' + resNum;

  // Add reservation row
  reservationsSheet.appendRow([
    reservationId,
    customerName,
    customerEmail,
    customerPhone,
    productsStr,
    timeslot,
    'pending',
    now.toISOString(),
    '' // notes
  ]);

  // Parse products: "Chile Merlot x2, Italy Pinot Grigio"
  var products = parseProducts(productsStr);
  var holdsSheet = ss.getSheetByName('Holds');
  var kitsSheet = ss.getSheetByName('Kits');
  var kitsData = getKitsData(kitsSheet);

  var holdCounter = 0;
  products.forEach(function(product) {
    holdCounter++;
    var holdId = 'H-' + dateStr + '-' + String(holdCounter).padStart(3, '0');

    // Find matching kit by name
    var kit = findKit(kitsData, product.name);
    var sku = kit ? kit.sku : '';
    var productName = product.name;

    // Add hold row
    holdsSheet.appendRow([
      holdId,
      reservationId,
      sku,
      productName,
      product.qty,
      'pending',
      now.toISOString(),
      '', // resolved_at
      '', // resolved_by
      ''  // notes
    ]);

    // Increment on_hold in Kits sheet
    if (kit) {
      var onHoldCol = kit.onHoldCol; // column index (1-based)
      var currentOnHold = parseInt(kitsSheet.getRange(kit.row, onHoldCol).getValue(), 10) || 0;
      kitsSheet.getRange(kit.row, onHoldCol).setValue(currentOnHold + product.qty);
    }
  });
}

/**
 * Parse products string like "Chile Merlot x2, Italy Pinot Grigio"
 * Returns array of {name, qty}
 */
function parseProducts(str) {
  if (!str) return [];
  var items = str.split(',');
  var result = [];
  items.forEach(function(item) {
    item = item.trim();
    if (!item) return;
    var match = item.match(/^(.+?)\s+x(\d+)$/);
    if (match) {
      result.push({ name: match[1].trim(), qty: parseInt(match[2], 10) });
    } else {
      result.push({ name: item, qty: 1 });
    }
  });
  return result;
}

/**
 * Get kits data from the Kits sheet for lookups
 */
function getKitsData(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var nameCol = headers.indexOf('name') + 1;
  var skuCol = headers.indexOf('sku') + 1;
  var onHoldCol = headers.indexOf('on_hold') + 1;

  if (nameCol === 0 || skuCol === 0 || onHoldCol === 0) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var kits = [];
  data.forEach(function(row, index) {
    kits.push({
      name: row[nameCol - 1],
      sku: row[skuCol - 1],
      onHoldCol: onHoldCol,
      row: index + 2 // 1-based, offset for header
    });
  });
  return kits;
}

/**
 * Find a kit by name (case-insensitive partial match)
 */
function findKit(kitsData, productName) {
  var lower = productName.toLowerCase();
  for (var i = 0; i < kitsData.length; i++) {
    if ((kitsData[i].name || '').toLowerCase() === lower) {
      return kitsData[i];
    }
  }
  // Fallback: partial match
  for (var j = 0; j < kitsData.length; j++) {
    if ((kitsData[j].name || '').toLowerCase().indexOf(lower) !== -1 ||
        lower.indexOf((kitsData[j].name || '').toLowerCase()) !== -1) {
      return kitsData[j];
    }
  }
  return null;
}
