#!/usr/bin/env node
/**
 * replay-collect-webhook.js — STAGING-ONLY dev tool (Phase-2 webhook-replay helper)
 *
 * Verifies the kiosk SO-collect money-path (phase 71) end-to-end against the REAL
 * Zoho + Helcim APIs WITHOUT the physical Smart Terminal, by replaying a signed
 * `cardTransaction` webhook at the middleware's own `/api/webhooks/terminal`.
 *
 * WHY THIS EXISTS
 *   Collect (POST /api/pos/collect) pushes to the terminal, then Helcim delivers a
 *   signed webhook that the handler turns into: ensureOpenInvoiceForSalesOrder →
 *   apply customerpayment (the 71 fix). Staging has no terminal, so we synthesise
 *   the webhook. Two constraints make a naive replay impossible:
 *     1. The handler VERIFIES the HMAC signature (staging runs NODE_ENV=production),
 *        so we sign with the staging HELCIM_WEBHOOK_SECRET — hence this must run
 *        INSIDE the staging container (it needs the secret + private Redis).
 *     2. The handler resolves the txn via getCardTransactionById (live Helcim), and
 *        correlates the collect by that txn's invoiceNumber. Staging shares the SAME
 *        live Helcim account (Option B), so ANY real APPROVED txn resolves — we reuse
 *        an existing approved txn instead of taking a new charge.
 *
 * SAFETY
 *   - Refuses to run unless SENTRY_ENVIRONMENT === 'staging' (or --allow-nonstaging).
 *   - Requires an APPROVED txn and an SO with a positive balance; never charges.
 *   - Seeds a short-TTL collect-pending key exactly as collect.js would.
 *
 * USAGE (inside the staging container, e.g. `railway ssh`):
 *   node zoho-middleware/scripts/replay-collect-webhook.js --txn <TXN_ID> --so <SO_ID>
 *   Optional: --base http://127.0.0.1:$PORT  (default) | --ttl 600 | --allow-nonstaging
 */

'use strict';

var crypto = require('crypto');
var axios = require('axios');
var cache = require('../lib/cache');
var C = require('../lib/constants');
var helcim = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var zohoAuth = require('../lib/zohoAuth');

// ---- arg parsing ---------------------------------------------------------
function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
function flag(name) { return process.argv.indexOf('--' + name) !== -1; }

var TXN_ID = arg('txn', process.env.REPLAY_TXN_ID);
var SO_ID = arg('so', process.env.REPLAY_SO_ID);
var BASE_URL = arg('base', 'http://127.0.0.1:' + (process.env.PORT || 3001));
var TTL = parseInt(arg('ttl', '600'), 10);

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

function main() {
  // Safety gate: staging only.
  if (process.env.SENTRY_ENVIRONMENT !== 'staging' && !flag('allow-nonstaging')) {
    die('Refusing to run: SENTRY_ENVIRONMENT is "' + (process.env.SENTRY_ENVIRONMENT || '') +
      '" (expected "staging"). This tool books real Zoho payments — pass --allow-nonstaging only if you are certain.');
  }
  if (!TXN_ID) die('Missing --txn <helcim transaction id> (a real APPROVED txn on the account).');
  if (!SO_ID) die('Missing --so <zoho salesorder id> (a test SO with a positive balance).');
  if (!process.env.HELCIM_WEBHOOK_SECRET) die('HELCIM_WEBHOOK_SECRET not set — cannot sign the webhook.');

  console.log('▶ Collect webhook replay');
  console.log('  env=' + process.env.SENTRY_ENVIRONMENT + '  base=' + BASE_URL);
  console.log('  txn=' + TXN_ID + '  so=' + SO_ID + '\n');

  var soNumber, customerId, balance, invoiceNumber, chargeAmount;

  // -1. Bootstrap the same singletons the server initialises at boot — this is a
  //     SEPARATE process from the running server, so it must connect Redis and
  //     hydrate the Zoho refresh token + Helcim token itself (server.js does the
  //     equivalent: cache.init → helcim.init → zohoAuth.init).
  var boot = cache.init()
    .then(function () { helcim.init(); })
    .then(function () { return zohoAuth.init(); })
    .then(function () {
      if (!zohoAuth.isAuthenticated()) {
        die('Zoho not authenticated after init — the staging refresh token may be missing/expired. Re-run the /auth/zoho flow on staging.');
      }
      console.log('  Bootstrapped: redis + helcim + zoho auth ✓');
    });

  // 0. (optional) Confirm a draft SO to 'open' so it is convertible to an invoice.
  //    Real collect operates on confirmed SOs; test SOs created via the API start
  //    as 'draft'. Idempotent: an already-open SO just no-ops on Zoho's side.
  var pre = boot.then(function () {
    if (!flag('confirm-so')) return;
    return zohoPost('/salesorders/' + SO_ID + '/status/open', {})
      .then(function () { console.log('  Confirmed SO ' + SO_ID + ' → open'); })
      .catch(function (e) {
        var m = (e && e.message || '').toLowerCase();
        if (m.indexOf('already') !== -1) { console.log('  SO already open'); return; }
        throw e;
      });
  });

  // 1. Load the test SO (validates existence + balance, and gives us customer_id).
  return pre.then(function () { return zohoGet('/salesorders/' + SO_ID); }).then(function (data) {
    var so = (data && data.salesorder) || {};
    soNumber = so.salesorder_number;
    customerId = so.customer_id;
    balance = parseFloat(so.balance != null ? so.balance : so.total);
    if (!soNumber || !customerId) die('SO ' + SO_ID + ' missing salesorder_number/customer_id.');
    if (!(balance > 0)) die('SO ' + SO_ID + ' has no positive balance (balance=' + balance + '). Use an unpaid test SO.');
    console.log('  SO ' + soNumber + '  customer=' + customerId + '  balance=$' + balance);

    // 2. Resolve the real txn (must be APPROVED); capture its invoiceNumber (the
    //    correlation key the handler will look up).
    return helcim.getCardTransactionById(TXN_ID);
  }).then(function (txn) {
    var status = (txn.status || '').toUpperCase();
    invoiceNumber = txn.invoiceNumber || '';
    chargeAmount = parseFloat(txn.amount) || balance;
    console.log('  Txn ' + TXN_ID + '  status=' + status + '  invoiceNumber=' + invoiceNumber + '  amount=$' + chargeAmount);
    if (status !== 'APPROVED') die('Txn ' + TXN_ID + ' is ' + status + ', not APPROVED. Replay needs an approved txn.');
    if (!invoiceNumber) die('Txn ' + TXN_ID + ' has no invoiceNumber — cannot correlate the collect-pending key.');

    // 3. Seed the collect-pending context exactly as collect.js does, keyed by the
    //    txn's invoiceNumber (that is what processCardTransactionResult looks up).
    var pendingKey = C.CACHE_KEYS.COLLECT_PENDING_PREFIX + invoiceNumber;
    var ctx = {
      salesorder_id: SO_ID,
      salesorder_number: soNumber,
      customer_id: customerId,
      amount: balance,
      idempotency_key: 'replay-' + TXN_ID,
      created_at: new Date().toISOString()
    };
    console.log('  Seeding ' + pendingKey);
    return cache.set(pendingKey, ctx, TTL);
  }).then(function () {
    // 4. Build + sign the minimal cardTransaction webhook Helcim would send.
    var rawBody = JSON.stringify({ id: TXN_ID, type: 'cardTransaction' });
    var webhookId = 'replay-' + Date.now();
    var timestamp = String(Math.floor(Date.now() / 1000));
    var rawSecret = process.env.HELCIM_WEBHOOK_SECRET.replace(/^whsec_/, '');
    var key = Buffer.from(rawSecret, 'base64'); // Svix-standard: base64-decoded key
    var sig = crypto.createHmac('sha256', key)
      .update(webhookId + '.' + timestamp + '.' + rawBody).digest('base64');

    console.log('  POST ' + BASE_URL + '/api/webhooks/terminal');
    return axios.post(BASE_URL + '/api/webhooks/terminal', rawBody, {
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': 'v1,' + sig
      },
      timeout: 10000,
      // send our exact raw string, not a re-serialised object
      transformRequest: [function (d) { return d; }]
    });
  }).then(function (resp) {
    console.log('  → ' + resp.status + ' ' + JSON.stringify(resp.data) +
      '  (handler processes asynchronously)');
    console.log('\n  Waiting 6s for async collect-apply…');
    return new Promise(function (r) { setTimeout(r, 6000); });
  }).then(function () {
    // 5. Verify against Zoho: the SO should now have a finalized invoice that is
    //    paid with a zero balance.
    return zohoGet('/salesorders/' + SO_ID);
  }).then(function (data) {
    var so = (data && data.salesorder) || {};
    var invoices = so.invoices || [];
    console.log('\n── RESULT ──────────────────────────────────────────');
    console.log('  SO ' + soNumber + '  status=' + so.status + '  balance=$' + so.balance);
    console.log('  Linked invoices: ' + JSON.stringify(invoices.map(function (i) {
      return { invoice_number: i.invoice_number, status: i.status, balance: i.balance, total: i.total };
    })));
    var booked = invoices.filter(function (i) { return String(i.status) !== 'draft'; });
    if (booked.length === 1 && parseFloat(booked[0].balance) === 0) {
      console.log('\n✓ PASS — collect booked a finalized, fully-paid invoice (' +
        booked[0].invoice_number + ', $' + booked[0].total + ', balance 0). No duplicate invoice.');
      console.log('  CLEANUP: void invoice ' + booked[0].invoice_number + ' + its payment, and refund/void Helcim txn ' + TXN_ID + '.');
    } else {
      console.log('\n✗ REVIEW — expected exactly one finalized invoice with balance 0. Inspect the middleware logs and Zoho.');
    }
  }).catch(function (err) {
    var detail = (err.response && JSON.stringify(err.response.data)) || err.message;
    die('Replay failed: ' + detail);
  });
}

main().then(function () { process.exit(0); }).catch(function (e) { die(e.message); });
