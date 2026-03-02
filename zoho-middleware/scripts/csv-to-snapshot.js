/**
 * csv-to-snapshot.js
 *
 * Converts a Zoho Inventory item export CSV into content/zoho-snapshot.json,
 * the same static fallback file the site uses when the middleware is unreachable.
 * Use this when the Zoho API is down or quota-exhausted and you need to refresh
 * the site's product catalog without a live API call.
 *
 * How to export from Zoho Inventory:
 *   Items → (hamburger / filter icon) → Export Items → Export as CSV → Download
 *
 * Usage:
 *   node zoho-middleware/scripts/csv-to-snapshot.js /path/to/Item-export.csv
 *   — or —
 *   npm run snapshot:csv -- /path/to/Item-export.csv
 *
 * After running, commit content/zoho-snapshot.json and push to deploy.
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var csvPath = process.argv[2];
if (!csvPath) {
  console.error('[csv-to-snapshot] ERROR: No CSV file specified.');
  console.error('[csv-to-snapshot] Usage: node csv-to-snapshot.js /path/to/Item-export.csv');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error('[csv-to-snapshot] ERROR: File not found: ' + csvPath);
  process.exit(1);
}

var OUTPUT_PATH = path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json');
var KIT_CATS    = ['wine', 'beer', 'cider', 'seltzer'];

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields containing commas and escaped quotes ("")
// ---------------------------------------------------------------------------
function parseCSV(text) {
  // Normalise line endings
  var raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var rows = [];
  var row  = [];
  var field = '';
  var inQ   = false;

  for (var i = 0; i < raw.length; i++) {
    var ch = raw[i];

    if (inQ) {
      if (ch === '"') {
        // Peek ahead for escaped double-quote ("")
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        if (row.some(function (f) { return f !== ''; })) {
          rows.push(row);
        }
        row = [];
      } else {
        field += ch;
      }
    }
  }

  // Flush last field / row
  row.push(field);
  if (row.some(function (f) { return f !== ''; })) {
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------
function makeColFn(headers) {
  return function col(row, name) {
    var idx = headers.indexOf(name);
    return idx !== -1 && row[idx] !== undefined ? row[idx].trim() : '';
  };
}

function parsePrice(str) {
  // "CAD 220.00" → 220  |  "0" → 0
  var m = (str || '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

// Build a flattened object from all CF.* columns, matching the key format
// that catalog.js flattenCF() produces:  label.toLowerCase().replace(/\s+/g, '_')
function flattenCFCols(headers, row) {
  var obj = {};
  headers.forEach(function (h, i) {
    if (h.indexOf('CF.') !== 0) return;
    var label  = h.slice(3);                              // strip "CF."
    var key    = label.toLowerCase().replace(/\s+/g, '_'); // e.g. "batch_size_(l)"
    var val    = (row[i] || '').trim();
    if (val !== '') obj[key] = val;
  });
  return obj;
}

// ---------------------------------------------------------------------------
// Shape functions — must match shapeProduct / shapeIngredient / shapeService
// in zoho-middleware/routes/catalog.js exactly so the snapshot is a drop-in
// ---------------------------------------------------------------------------
function shapeProduct(col, headers, row) {
  var rate     = parsePrice(col(row, 'Selling Price'));
  var discount = col(row, 'CF.Discount') || '0';
  var cfType   = col(row, 'CF.Type');       // e.g. "Wine", "Beer"

  var obj = {
    name:           col(row, 'Item Name'),
    sku:            col(row, 'SKU'),
    item_id:        col(row, 'Item ID'),
    brand:          col(row, 'Brand'),
    stock:          col(row, 'Stock On Hand') || '0',
    description:    col(row, 'Sales Description'),
    discount:       discount,
    _zoho_category: cfType,
    retail_kit:     '$' + rate.toFixed(2),
    retail_instore: '$' + (rate + 50).toFixed(2)
  };

  // Merge all CF fields (type, subcategory, tasting_notes, body, oak, etc.)
  var cf = flattenCFCols(headers, row);
  Object.keys(cf).forEach(function (k) { obj[k] = cf[k]; });

  return obj;
}

function shapeIngredient(col, headers, row) {
  var rate = parsePrice(col(row, 'Selling Price'));

  var obj = {
    name:           col(row, 'Item Name'),
    unit:           col(row, 'Unit'),
    price_per_unit: String(rate),
    stock:          col(row, 'Stock On Hand') || '0',
    description:    col(row, 'Sales Description'),
    sku:            col(row, 'SKU'),
    category:       col(row, 'CF.Subcategory') || '',
    low_amount:     '',
    high_amount:    '',
    step:           ''
  };

  var cf = flattenCFCols(headers, row);
  Object.keys(cf).forEach(function (k) { obj[k] = cf[k]; });

  return obj;
}

function shapeService(col, row) {
  var rate     = parsePrice(col(row, 'Selling Price'));
  var discount = col(row, 'CF.Discount') || '0';

  return {
    name:        col(row, 'Item Name'),
    price:       String(rate),
    description: col(row, 'Sales Description'),
    sku:         col(row, 'SKU'),
    stock:       col(row, 'Stock On Hand') || '0',
    discount:    discount
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('[csv-to-snapshot] Reading ' + csvPath);
var text = fs.readFileSync(csvPath, 'utf8');
var rows = parseCSV(text);

if (rows.length < 2) {
  console.error('[csv-to-snapshot] ERROR: CSV appears empty or has no data rows.');
  process.exit(1);
}

var headers = rows[0];
var col     = makeColFn(headers);

console.log('[csv-to-snapshot] Parsed ' + (rows.length - 1) + ' data rows');
console.log('[csv-to-snapshot] Columns: ' + headers.length);

var products    = [];
var ingredients = [];
var services    = [];
var skipped     = 0;

rows.slice(1).forEach(function (row) {
  // Skip blank / short rows
  if (row.length < 5) { skipped++; return; }

  // Only include Active items
  var status = col(row, 'Status').toLowerCase();
  if (status !== 'active') { skipped++; return; }

  var prodType = col(row, 'Product Type').toLowerCase(); // 'goods' | 'service'
  var cfType   = col(row, 'CF.Type').toLowerCase();      // 'wine' | 'beer' | ...
  var price    = parsePrice(col(row, 'Selling Price'));

  if (prodType === 'service') {
    services.push(shapeService(col, row));
    return;
  }

  var isKit = KIT_CATS.indexOf(cfType) !== -1;

  if (isKit) {
    products.push(shapeProduct(col, headers, row));
  } else {
    // Ingredients: skip zero-price items (same rule as catalog.js)
    if (price <= 0) { skipped++; return; }
    ingredients.push(shapeIngredient(col, headers, row));
  }
});

if (products.length === 0 && ingredients.length === 0 && services.length === 0) {
  console.error('[csv-to-snapshot] ERROR: No items were mapped.');
  console.error('[csv-to-snapshot] Check that the CSV has a "Status" column with "Active" rows,');
  console.error('[csv-to-snapshot] a "CF.Type" column (Wine/Beer/Cider/Seltzer for kits),');
  console.error('[csv-to-snapshot] and a "Product Type" column (goods/service).');
  process.exit(1);
}

var snapshot = {
  generated_at: new Date().toISOString(),
  source:       'csv-import',
  products:     products,
  ingredients:  ingredients,
  services:     services
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');

console.log('[csv-to-snapshot] ✓ Wrote ' + OUTPUT_PATH);
console.log('[csv-to-snapshot]   products:     ' + products.length);
console.log('[csv-to-snapshot]   ingredients:  ' + ingredients.length);
console.log('[csv-to-snapshot]   services:     ' + services.length);
console.log('[csv-to-snapshot]   skipped:      ' + skipped + ' (inactive or zero-price)');
console.log('[csv-to-snapshot]   generated_at: ' + snapshot.generated_at);
console.log('[csv-to-snapshot]');
console.log('[csv-to-snapshot] Next steps:');
console.log('[csv-to-snapshot]   git add content/zoho-snapshot.json');
console.log('[csv-to-snapshot]   git commit -m "chore: update snapshot from CSV export"');
console.log('[csv-to-snapshot]   git push origin main');
