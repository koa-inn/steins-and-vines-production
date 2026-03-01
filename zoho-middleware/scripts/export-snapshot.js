/**
 * export-snapshot.js
 *
 * Fetches /api/snapshot from the local middleware and writes the result to
 * content/zoho-snapshot.json in the site root. Run this before every deploy
 * to update the static fallback used when the middleware is unreachable.
 *
 * Prerequisites:
 *   1. Local middleware running:  node server.js  (in zoho-middleware/)
 *   2. Zoho authenticated:        visit http://localhost:3001/auth/zoho
 *
 * Usage:
 *   node zoho-middleware/scripts/export-snapshot.js
 *
 * The script exits 0 on success and 1 on failure so it can be chained
 * into a pre-deploy npm script if desired.
 */

'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');

var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';
var SNAPSHOT_URL   = MIDDLEWARE_URL + '/api/snapshot';
// Output goes to content/zoho-snapshot.json in the site root (two levels up from scripts/)
var OUTPUT_PATH    = path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json');

console.log('[export-snapshot] Fetching ' + SNAPSHOT_URL);

http.get(SNAPSHOT_URL, function (res) {
  var body = '';

  if (res.statusCode !== 200) {
    console.error('[export-snapshot] ERROR: middleware returned HTTP ' + res.statusCode);
    console.error('[export-snapshot] Make sure the middleware is running and Zoho is authenticated.');
    process.exit(1);
  }

  res.setEncoding('utf8');
  res.on('data', function (chunk) { body += chunk; });
  res.on('end', function () {
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error('[export-snapshot] ERROR: Could not parse response as JSON: ' + e.message);
      process.exit(1);
    }

    var products    = (parsed.products    || []).length;
    var ingredients = (parsed.ingredients || []).length;
    var services    = (parsed.services    || []).length;

    if (products === 0 && ingredients === 0 && services === 0) {
      console.error('[export-snapshot] ERROR: Snapshot contains 0 items in all three catalogs.');
      console.error('[export-snapshot] The middleware cache may still be warming. Wait 30s and retry.');
      process.exit(1);
    }

    var formatted = JSON.stringify(parsed, null, 2);
    fs.writeFile(OUTPUT_PATH, formatted, 'utf8', function (err) {
      if (err) {
        console.error('[export-snapshot] ERROR: Could not write ' + OUTPUT_PATH + ': ' + err.message);
        process.exit(1);
      }
      console.log('[export-snapshot] Wrote ' + OUTPUT_PATH);
      console.log('[export-snapshot]   products:     ' + products);
      console.log('[export-snapshot]   ingredients:  ' + ingredients);
      console.log('[export-snapshot]   services:     ' + services);
      console.log('[export-snapshot]   generated_at: ' + parsed.generated_at);
      console.log('[export-snapshot] Done. Commit content/zoho-snapshot.json before deploying.');
      process.exit(0);
    });
  });
}).on('error', function (err) {
  console.error('[export-snapshot] ERROR: Could not reach middleware at ' + MIDDLEWARE_URL);
  console.error('[export-snapshot] ' + err.message);
  console.error('[export-snapshot] Start the middleware with: node zoho-middleware/server.js');
  process.exit(1);
});
