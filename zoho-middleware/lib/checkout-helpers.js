var https = require('https');
var fs = require('fs');
var path = require('path');
var querystring = require('querystring');
var log = require('./logger');
var pricing = require('./pricing');
var axios = require('axios');

/**
 * Read services directly from the snapshot file.
 * Used as a fallback when the services Redis cache is empty.
 */
function readServicesSnapshot() {
  try {
    var snap = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json'), 'utf8'
    ));
    if (snap && Array.isArray(snap.services)) {
      return snap.services.map(function (s) {
        return Object.assign({}, s, {
          item_id: s.item_id || '',
          rate: parseFloat(String(s.price || s.rate || '0').replace(/[^0-9.]/g, '')) || 0
        });
      });
    }
  } catch (e) {}
  return [];
}

/**
 * Race a promise against a timeout.
 * Rejects with an Error('Timeout after Nms') if the promise doesn't settle in time.
 */
function withTimeout(promise, ms) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('Timeout after ' + ms + 'ms')); }, ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Verify a reCAPTCHA v3 token with Google.
 * Resolves with the verification result object.
 * If RECAPTCHA_SECRET_KEY is not set, skips verification (graceful dev fallback).
 */
function verifyRecaptcha(token) {
  var secret = process.env.RECAPTCHA_SECRET_KEY || '';
  if (!secret) return Promise.resolve({ success: true, score: 1.0 }); // unconfigured → allow
  if (!token) return Promise.resolve({ success: false, score: 0 });

  var verifyPromise = new Promise(function (resolve, reject) {
    var body = querystring.stringify({ secret: secret, response: token });
    var options = {
      hostname: 'www.google.com',
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  return withTimeout(verifyPromise, 5000).catch(function(timeoutErr) {
    log.warn('[checkout] reCAPTCHA verification timed out — allowing through: ' + timeoutErr.message);
    return { success: true, score: 1.0 };
  });
}

/**
 * Fire-and-forget: write the new reservation to Google Sheets via Apps Script
 * so it appears immediately in the admin panel.
 * Requires env vars: APPS_SCRIPT_URL, APPS_SCRIPT_SERVER_TOKEN
 */
function notifyAdminPanel(soNumber, customerName, customerEmail, customerPhone, lineItems, timeslot, notes) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) return; // not configured — skip silently

  var payload = {
    action: 'add_reservation',
    server_token: token,
    customer_name: customerName || '',
    customer_email: customerEmail || '',
    customer_phone: customerPhone || '',
    order_number: soNumber || '',
    timeslot: timeslot || '',
    notes: notes || '',
    items: (lineItems || []).map(function (li) {
      return { name: li.name || '', quantity: li.quantity || 1 };
    })
  };

  axios.post(url, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(function (resp) {
    var data = resp.data || {};
    if (data.ok) {
      log.info('[checkout] Admin panel updated — reservation_id=' + (data.reservation_id || '?') + ' order=' + soNumber);
    } else {
      log.warn('[checkout] Admin panel returned error: ' + (data.message || data.error || JSON.stringify(data)));
    }
  }).catch(function (err) {
    log.warn('[checkout] Admin panel notification failed (non-fatal): ' + err.message);
  });
}

/**
 * Build line items and compute order total from a cart.
 * Uses catalog prices when available; falls back to client-supplied rates.
 *
 * Delegates per-item price arithmetic to pricing.computeLineItem() and
 * accumulates the cart total via pricing.computeCartTotals().
 *
 * @param {Array}   items            - Cart items from the request body
 * @param {object}  catalogMap       - item_id → rate from authoritative cache
 * @param {boolean} catalogAvailable - Whether catalogMap is populated
 * @returns {{ lineItems: Array, orderTotal: number }}
 */
function buildLineItems(items, catalogMap, catalogAvailable) {
  var computed = [];
  var lineItems = items.map(function (item) {
    var qty = Number(item.quantity) || 1;
    var rate = catalogAvailable ? catalogMap[item.item_id] : (Number(item.rate) || 0);
    var discountPct = (typeof item.discount === 'number' && item.discount > 0) ? item.discount : 0;

    var lineCalc = pricing.computeLineItem({ rate: rate }, qty, { discountPct: discountPct });
    computed.push(lineCalc);

    var li = { item_id: item.item_id, name: item.name || '', quantity: qty, rate: rate };
    if (discountPct > 0) li.discount = discountPct + '%';
    return li;
  });

  var totals = pricing.computeCartTotals(computed);
  var orderTotal = totals.subtotal;

  return { lineItems: lineItems, orderTotal: orderTotal };
}

/**
 * Find the Maker's Fee item in the services catalog.
 * Searches by MAKERS_FEE_ITEM_ID env var first, then by SKU 'MAKERS-FEE', then by name.
 * @param {Array}  services        - Services catalog array from cache or snapshot
 * @param {string} makersFeeItemId - Value of MAKERS_FEE_ITEM_ID env var (may be empty string)
 * @returns {object|null} The matching service item, or null if not found
 */
function findMakersFeeItem(services, makersFeeItemId) {
  if (!Array.isArray(services)) return null;
  for (var i = 0; i < services.length; i++) {
    var s = services[i];
    if (!s) continue;
    if (makersFeeItemId && s.item_id === makersFeeItemId) return s;
    var sku = (s.sku || '').toUpperCase();
    var name = (s.name || '').toLowerCase();
    if (sku === 'MAKERS-FEE' || name.indexOf('makers fee') !== -1 || name.indexOf("maker's fee") !== -1) return s;
  }
  return null;
}

module.exports = {
  readServicesSnapshot: readServicesSnapshot,
  withTimeout: withTimeout,
  verifyRecaptcha: verifyRecaptcha,
  notifyAdminPanel: notifyAdminPanel,
  buildLineItems: buildLineItems,
  findMakersFeeItem: findMakersFeeItem
};
