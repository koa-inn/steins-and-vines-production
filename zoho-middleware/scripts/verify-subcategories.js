/**
 * verify-subcategories.js
 *
 * Read-only verification script that calls the local middleware /api/ingredients
 * endpoint and reports subcategory coverage. Use this after running
 * tag-subcategories.js (and manually tagging ambiguous items in Zoho) to confirm
 * all ingredient items have a Subcategory custom field set.
 *
 * Prerequisites:
 *   1. Local middleware running:  node server.js  (in zoho-middleware/)
 *   2. Zoho authenticated:        visit http://localhost:3001/auth/zoho
 *
 * Usage:
 *   node zoho-middleware/scripts/verify-subcategories.js
 *
 * Exit codes:
 *   0 — 100% coverage (all items tagged)
 *   1 — gaps found (one or more items missing subcategory), or fatal error
 */

'use strict';

var http = require('http');

var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';
var INGREDIENTS_URL = MIDDLEWARE_URL + '/api/ingredients';

console.log('[verify-subcategories] Fetching ' + INGREDIENTS_URL);

http.get(INGREDIENTS_URL, function (res) {
  var body = '';

  if (res.statusCode !== 200) {
    console.error('[verify-subcategories] ERROR: middleware returned HTTP ' + res.statusCode);
    console.error('[verify-subcategories] Make sure the middleware is running and Zoho is authenticated.');
    process.exit(1);
  }

  res.setEncoding('utf8');
  res.on('data', function (chunk) { body += chunk; });
  res.on('end', function () {
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error('[verify-subcategories] ERROR: Could not parse response as JSON: ' + e.message);
      process.exit(1);
    }

    var items = (parsed && parsed.items) ? parsed.items : [];

    // Guard: empty response may mean cache is still warming
    if (items.length === 0) {
      console.error('[verify-subcategories] WARNING: /api/ingredients returned 0 items.');
      console.error('[verify-subcategories] The middleware cache may still be warming. Wait 30s and retry.');
      process.exit(1);
    }

    // Tally subcategory counts and collect missing items
    var counts = {};
    var missing = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var sub = (item.subcategory || '').trim();
      if (!sub) {
        missing.push(item);
      } else {
        counts[sub] = (counts[sub] || 0) + 1;
      }
    }

    var tagged = items.length - missing.length;
    var coverage = items.length > 0 ? Math.round(tagged / items.length * 100) : 0;

    // Coverage report
    console.log('');
    console.log('[verify-subcategories] === Subcategory Coverage Report ===');
    console.log('[verify-subcategories] Total ingredients: ' + items.length);
    console.log('[verify-subcategories] Tagged:            ' + tagged);
    console.log('[verify-subcategories] Missing:           ' + missing.length);
    console.log('[verify-subcategories] Coverage:          ' + coverage + '%');

    // Per-subcategory breakdown (sorted alphabetically)
    console.log('');
    console.log('[verify-subcategories] Breakdown:');
    var subcategoryNames = Object.keys(counts).sort();
    for (var si = 0; si < subcategoryNames.length; si++) {
      var name = subcategoryNames[si];
      console.log('[verify-subcategories]   ' + name + ': ' + counts[name]);
    }

    if (missing.length > 0) {
      console.log('');
      console.log('[verify-subcategories] === Items Still Missing Subcategory (' + missing.length + ') ===');
      console.log('[verify-subcategories] Tag these manually in Zoho Inventory:');
      for (var mi = 0; mi < missing.length; mi++) {
        var m = missing[mi];
        console.log('[verify-subcategories]   SKU: ' + (m.sku || '(no SKU)') + ' | ' + (m.name || '(no name)'));
      }
      process.exit(1);
    }

    console.log('');
    console.log('[verify-subcategories] All items tagged. Coverage is 100%.');
    process.exit(0);
  });
}).on('error', function (err) {
  console.error('[verify-subcategories] ERROR: Could not reach middleware at ' + MIDDLEWARE_URL);
  console.error('[verify-subcategories] ' + err.message);
  console.error('[verify-subcategories] Start the middleware: node zoho-middleware/server.js');
  process.exit(1);
});
