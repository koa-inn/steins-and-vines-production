'use strict';

// ---------------------------------------------------------------------------
// Phase 100 -- Limited Release deposits.
//
//   POST /api/preorder/initialize  nonce-binding Helcim checkout (D-17)
//   POST /api/preorder/deposit     verification stage: ownership -> approval ->
//                                  lock -> replay -> reCAPTCHA -> basket/nonce ->
//                                  amount -> offline -> bookDeposit (Plan 07)
//
// Void policy (RESEARCH Pitfall 1): a charge is voided ONLY after the Helcim
// readback proves the caller owns it (readback.invoiceNumber equals the
// caller's server-minted nonce). A forged request carrying someone else's
// transaction id can never void it. checkout.js's rejectWithVoid pattern is
// deliberately not used here.
// ---------------------------------------------------------------------------

var express = require('express');
var crypto = require('crypto');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var helcimLib = require('../lib/helcim');
var helpers = require('../lib/checkout-helpers');
var moneyPath = require('../lib/money-path');
var mailer = require('../lib/mailer');
var limited = require('../lib/limited-releases');
var deposit = require('../lib/limited-releases-deposit');
var mailerlite = require('../lib/mailerlite');
var redact = require('../lib/redact');
var captureExceptionSafe = require('../lib/sentry-capture').captureExceptionSafe;

var verifyRecaptcha = helpers.verifyRecaptcha;

var router = express.Router();

var NONCE_RE = /^LR-[0-9a-f]{16}$/;
var NONCE_TTL = 3600;
var LOCK_TTL = 900;
var REPLAY_SUFFIXES = ['', ':sv-cart-ferment', ':sv-cart-ingredients', ':preorder'];
var UNAVAILABLE_MSG = 'Reservations are temporarily unavailable.';
var UNAVAILABLE_VOIDED_MSG = 'Reservations are temporarily unavailable. Your card has been refunded if charged.';
var RECAPTCHA_MSG = 'Request could not be verified. Please try again.';

var PENDING_TTL = 604800;
var REPLAY_TTL = 2592000;
var IDEM_TTL = 86400;
var FAIL_MSG = 'We could not complete your reservation.';

function logPending(txnId, count) {
  log.info('[preorder] pending sentinel txn=' + txnId + ' kits=' + count);
}

// ---------------------------------------------------------------------------
// Booking stage (Plan 07). Contact -> rates/fees -> N SOs + N advances. Any
// failure after the charge is proven: cleanup every created record, THEN void
// (the void always runs), alert staff on leftovers. Sends its own response.
// ---------------------------------------------------------------------------
async function realBookDeposit(ctx) {
  var txnId = ctx.txnId;
  var res = ctx.res;
  var pendingKey = 'preorder:pending:' + txnId;
  var consentAt = new Date().toISOString();
  var stage = 'contact';
  var created = [];

  try {
    // Ids and counts only -- no PII in the sentinel.
    await cache.set(pendingKey, {
      txnId: txnId,
      kitCount: ctx.totalKits,
      amount: ctx.amount,
      created_at: consentAt
    }, PENDING_TTL);
    logPending(txnId, ctx.totalKits);

    var contact = await helpers.resolveOrCreateContact({
      name: ctx.customer.name,
      email: ctx.customer.email,
      phone: ctx.customer.phone
    });

    stage = 'pricing';
    var fees = await deposit.resolveFeeItems();
    var distinct = [];
    ctx.lines.forEach(function (l) { if (distinct.indexOf(l.item_id) === -1) distinct.push(l.item_id); });
    var rates = await Promise.all(distinct.map(function (id) { return deposit.getKitRate(id); }));
    var kitRates = {};
    distinct.forEach(function (id, i) { kitRates[id] = rates[i]; });

    stage = 'create';
    var set = await deposit.createDepositSet({
      customerId: contact.contactId,
      units: limited.expandUnits(ctx.lines),
      kitRates: kitRates,
      fees: fees,
      txnId: txnId,
      consentText: ctx.consent.text,
      consentAt: consentAt,
      date: new Date().toISOString().slice(0, 10)
    });
    created = set.created;
  } catch (err) {
    return failAfterCapture(ctx, err, stage, pendingKey);
  }

  var responseBody = {
    ok: true,
    deposit_total: ctx.amount,
    kit_count: ctx.totalKits,
    salesorders: created.map(function (c) {
      return {
        salesorder_id: c.salesorder_id,
        salesorder_number: c.salesorder_number,
        item_id: c.item_id,
        name: limited.ALLOWLIST[c.item_id].name,
        release_label: limited.ALLOWLIST[c.item_id].release_label
      };
    })
  };

  try { await cache.set(ctx.idemKey, responseBody, IDEM_TTL); } catch (e) { log.warn('[preorder] idem cache failed txn=' + txnId); }
  for (var i = 0; i < REPLAY_SUFFIXES.length; i++) {
    await moneyPath.markTxnUsed(cache, txnId, REPLAY_SUFFIXES[i], REPLAY_TTL);
  }
  try { await cache.del('preorder:nonce:' + ctx.invoiceNumber); } catch (e) { log.warn('[preorder] nonce delete failed txn=' + txnId); }
  try { await cache.del(pendingKey); } catch (e) { log.warn('[preorder] sentinel delete failed txn=' + txnId); }

  res.status(201).json(responseBody);

  eventLog.logEvent('preorder.deposit_completed', {
    txnId: txnId,
    kitCount: ctx.totalKits,
    soCount: created.length,
    grandTotal: ctx.amount
  });

  var mailData = {
    email: ctx.customer.email,
    name: ctx.customer.name,
    phone: ctx.customer.phone,
    txnId: txnId,
    salesorders: responseBody.salesorders,
    depositTotal: ctx.amount,
    kitCount: ctx.totalKits
  };
  Promise.resolve().then(function () { return mailer.sendPreorderDepositConfirmation(mailData); })
    .catch(function (e) { log.warn('[preorder] customer confirmation email failed: ' + (e && e.message)); });
  Promise.resolve().then(function () { return mailer.sendPreorderDepositNotification(mailData); })
    .catch(function (e) { log.warn('[preorder] staff notification email failed: ' + (e && e.message)); });

  // Newsletter: strict boolean true only (CASL). Fire-and-forget.
  if (ctx.newsletter === true && ctx.customer.email) {
    var nlEmail = ctx.customer.email.toLowerCase();
    eventLog.logEvent('preorder.newsletter_opt_in', {
      orderNumber: created[0] ? created[0].salesorder_number : '',
      email: redact.maskEmail(nlEmail),
      source: 'preorder'
    });
    if (mailerlite.isConfigured()) {
      var group = (process.env.MAILERLITE_NEWSLETTER_GROUP_ID || '').trim();
      Promise.resolve().then(function () {
        return mailerlite.addSubscriber(nlEmail, group ? [group] : []);
      }).then(function (ml) {
        var sub = (ml && ml.data) || {};
        return mailer.sendNewsletterNotification({
          email: nlEmail,
          source: 'preorder',
          orderNumber: created[0] ? created[0].salesorder_number : '',
          alreadySubscribed: !!(sub.created_at && sub.updated_at && sub.created_at !== sub.updated_at)
        });
      }).catch(function (e) {
        log.error('[preorder] newsletter subscribe failed (non-fatal) for ' + redact.maskEmail(nlEmail) + ': ' + (e && e.message));
      });
    } else {
      log.warn('[preorder] MAILERLITE_API_KEY not set -- newsletter opt-in recorded but not synced for ' + redact.maskEmail(nlEmail));
    }
  }
}

async function failAfterCapture(ctx, err, stage, pendingKey) {
  var txnId = ctx.txnId;
  var created = (err && err.created) || [];
  var leftovers = [];
  var cleanupThrew = false;

  if (created.length) {
    try {
      var cleanup = await deposit.cleanupDepositSet(created, txnId);
      leftovers = (cleanup && cleanup.leftovers) || [];
    } catch (cleanErr) {
      cleanupThrew = true;
      log.error('[preorder] cleanup threw txn=' + txnId + ': ' + (cleanErr && cleanErr.message));
      leftovers = created.map(function (c) {
        return { kind: 'salesorder', id: c.salesorder_id, error: 'cleanup threw' };
      });
    }
  }

  // The void is never skipped (D-04).
  var voidResult;
  try {
    voidResult = await moneyPath.voidWithTimeout(helcimLib, txnId, ctx.amount, {
      mailer: mailer,
      eventLog: eventLog,
      reqId: ctx.reqId
    });
  } catch (voidErr) {
    log.error('[preorder] void threw txn=' + txnId + ': ' + (voidErr && voidErr.message));
    voidResult = { ok: false };
  }
  var voided = !!(voidResult && voidResult.ok);
  var possibleOrphan = !!(err && err.possibleOrphan);

  if (leftovers.length || possibleOrphan || cleanupThrew) {
    Promise.resolve().then(function () {
      return mailer.sendPreorderCleanupAlert({
        txnId: txnId,
        voided: voided,
        leftovers: leftovers,
        possibleOrphan: possibleOrphan
      });
    }).catch(function (e) { log.warn('[preorder] cleanup alert failed: ' + (e && e.message)); });
  }

  if (voided && !leftovers.length && !possibleOrphan && !cleanupThrew) {
    try { await cache.del(pendingKey); } catch (e) { log.warn('[preorder] sentinel delete failed txn=' + txnId); }
  }

  log.error('[preorder] failed after charge txn=' + txnId + ' stage=' + stage + ' voided=' + voided);
  captureExceptionSafe(err, { level: 'error', tags: { reqId: ctx.reqId || null, txnId: txnId, stage: stage } });
  eventLog.logEvent('preorder.failed_after_charge', {
    txnId: txnId,
    kitCount: ctx.totalKits,
    grandTotal: ctx.amount,
    stage: stage,
    voided: voided,
    leftoverCount: leftovers.length
  });
  return ctx.res.status(500).json({ error: FAIL_MSG, voided: voided });
}

var bookDeposit = realBookDeposit;

function emailLine(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim().substring(0, maxLen);
}

function isNonEmptyStr(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

// ---------------------------------------------------------------------------
// POST /api/preorder/initialize
// ---------------------------------------------------------------------------
router.post('/api/preorder/initialize', async function (req, res) {
  if (process.env.PREORDER_DEPOSITS_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Limited release reservations are not open yet.' });
  }

  var body = req.body || {};
  var basket = limited.validateBasket(body.items);
  if (!basket.ok) {
    return res.status(400).json({ error: basket.error });
  }

  var rcToken = (typeof body.recaptcha_token === 'string') ? body.recaptcha_token : '';
  try {
    var captcha = await verifyRecaptcha(rcToken);
    if (!captcha.success || captcha.score < 0.5) {
      log.warn('[preorder] initialize reCAPTCHA rejected -- score: ' + (captcha.score || 0));
      return res.status(400).json({ error: RECAPTCHA_MSG });
    }
  } catch (err) {
    var isProd = process.env.NODE_ENV === 'production';
    log.warn('[preorder] initialize reCAPTCHA network error' +
      (isProd ? ' -- rejecting in prod: ' : ' -- allowing through (dev): ') + (err && err.message));
    if (isProd) {
      return res.status(400).json({ error: RECAPTCHA_MSG });
    }
  }

  var amount = limited.computeDeposit(basket.totalKits);
  var invoiceNumber = 'LR-' + crypto.randomBytes(8).toString('hex');

  var init;
  try {
    init = await helcimLib.initializeCheckout(amount, 'CAD', { invoiceNumber: invoiceNumber });
  } catch (err) {
    log.error('[preorder] Helcim initialize failed: ' + (err && err.message));
    captureExceptionSafe(err, { level: 'error', tags: { reqId: req.id, phase: 'preorder_initialize' } });
    return res.status(502).json({ error: 'Payment initialization failed' });
  }

  try {
    await cache.set('preorder:nonce:' + invoiceNumber, {
      amount: amount,
      lines: basket.lines,
      created_at: new Date().toISOString()
    }, NONCE_TTL);
  } catch (err) {
    log.error('[preorder] nonce store failed: ' + (err && err.message));
    return res.status(503).json({ error: 'Payment initialization failed' });
  }

  log.info('[preorder] initialize ok kits=' + basket.totalKits + ' amount=' + amount);
  return res.status(200).json({
    checkoutToken: init.checkoutToken,
    secretToken: init.secretToken,
    invoice_number: invoiceNumber,
    deposit_total: amount,
    kit_count: basket.totalKits
  });
});

// ---------------------------------------------------------------------------
// POST /api/preorder/deposit -- verification stage
// ---------------------------------------------------------------------------

function sameLines(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  var map = {};
  a.forEach(function (l) { map[l.item_id] = l.qty; });
  return b.every(function (l) { return map[l.item_id] === l.qty; });
}

function validShape(body) {
  if (!body || typeof body !== 'object') return false;
  if (!isNonEmptyStr(body.transaction_id, 64)) return false;
  if (typeof body.invoice_number !== 'string' || !NONCE_RE.test(body.invoice_number)) return false;
  var c = body.customer;
  if (!c || typeof c !== 'object') return false;
  if (!isNonEmptyStr(c.name, 100)) return false;
  if (typeof c.email !== 'string' || c.email.length > 254 || c.email.indexOf('@') < 1) return false;
  if (c.phone !== undefined && c.phone !== null &&
      (typeof c.phone !== 'string' || c.phone.length > 30)) return false;
  var k = body.consent;
  if (!k || k.accepted !== true || !isNonEmptyStr(k.text, 500)) return false;
  if (body.newsletter !== undefined && typeof body.newsletter !== 'boolean') return false;
  return true;
}

router.post('/api/preorder/deposit', async function (req, res) {
  var body = req.body || {};
  var reqId = req.id;

  if (!validShape(body)) {
    return res.status(400).json({ error: 'Invalid reservation request', voided: false });
  }

  var txnId = body.transaction_id;
  var invoiceNumber = body.invoice_number;
  var nonceKey = 'preorder:nonce:' + invoiceNumber;
  var idemKey = 'preorder:idem:' + txnId;

  async function voidAndRespond(status, error, amountForAlert) {
    var result = await moneyPath.voidWithTimeout(helcimLib, txnId, amountForAlert || 0, {
      mailer: mailer,
      eventLog: eventLog,
      reqId: reqId
    });
    var voided = !!(result && result.ok);
    var msg = error;
    if (msg === UNAVAILABLE_VOIDED_MSG && !voided) msg = UNAVAILABLE_MSG;
    return res.status(status).json({ error: msg, voided: voided });
  }

  // 2. Ownership (read-only, before any lock)
  var readback;
  try {
    readback = await helcimLib.getCardTransactionById(txnId);
  } catch (err) {
    var is404 = !!(err && err.response && err.response.status === 404);
    log.warn('[preorder] readback failed txn=' + txnId + ': ' + (err && err.message));
    if (!is404) {
      var liveRecord = null;
      try { liveRecord = await cache.get(nonceKey); } catch (cacheErr) { log.warn('[preorder] nonce lookup failed: ' + cacheErr.message); }
      if (liveRecord) {
        Promise.resolve(mailer.sendPreorderCleanupAlert({
          txnId: txnId,
          voided: false,
          leftovers: [],
          possibleOrphan: false,
          reason: 'Helcim readback failed for a live deposit nonce -- check Helcim for this txn and void it by hand if it was charged'
        })).catch(function () {});
      }
    }
    return res.status(502).json({ error: 'Could not verify payment', voided: false });
  }

  if (!readback || readback.invoiceNumber !== invoiceNumber) {
    eventLog.logEvent('preorder.unverified_txn', { txnId: txnId });
    return res.status(400).json({ error: 'Payment could not be verified', voided: false });
  }

  // 3. Charged check
  if (readback.status !== 'APPROVED' || readback.type !== 'purchase') {
    return res.status(400).json({ error: 'Payment was not approved', voided: false });
  }

  var chargedAmount = readback.amount;

  // 4. Lock
  var lock = await moneyPath.acquireIdempotencyLock(cache, idemKey, LOCK_TTL);
  if (lock.status === 'replay') {
    return res.status(200).json(lock.cached);
  }
  if (lock.status === 'contention') {
    return res.status(409).json({ error: 'Reservation already in progress', voided: false });
  }
  if (lock.status === 'failclosed') {
    return voidAndRespond(503, UNAVAILABLE_VOIDED_MSG, chargedAmount);
  }

  // 5. Replay guard across checkout namespaces
  var failClosed = false;
  for (var i = 0; i < REPLAY_SUFFIXES.length; i++) {
    var r = await moneyPath.assertTxnNotReplayed(cache, txnId, REPLAY_SUFFIXES[i]);
    if (r.status === 'replay') {
      return res.status(409).json({ error: 'Payment already processed', voided: false });
    }
    if (r.status === 'failclosed') failClosed = true;
  }
  if (failClosed) {
    return voidAndRespond(503, UNAVAILABLE_VOIDED_MSG, chargedAmount);
  }

  // 6. reCAPTCHA
  var rcToken = (typeof body.recaptcha_token === 'string') ? body.recaptcha_token : '';
  var rcFail = false;
  try {
    var captcha = await verifyRecaptcha(rcToken);
    if (!captcha.success || captcha.score < 0.5) rcFail = true;
  } catch (err) {
    log.warn('[preorder] deposit reCAPTCHA network error: ' + (err && err.message));
    if (process.env.NODE_ENV === 'production') rcFail = true;
  }
  if (rcFail) {
    return voidAndRespond(400, RECAPTCHA_MSG, chargedAmount);
  }

  // 7. Basket + nonce record
  var basket = limited.validateBasket(body.items);
  if (!basket.ok) {
    return voidAndRespond(400, 'Invalid reservation request', chargedAmount);
  }
  var record = null;
  try {
    record = await cache.get(nonceKey);
  } catch (err) {
    log.warn('[preorder] nonce lookup failed: ' + (err && err.message));
    return voidAndRespond(503, UNAVAILABLE_VOIDED_MSG, chargedAmount);
  }
  if (!record || !sameLines(record.lines, basket.lines)) {
    return voidAndRespond(400, 'Invalid reservation request', chargedAmount);
  }

  // 8. Amount, integer cents, no tolerance
  var chargedCents = Math.round(parseFloat(readback.amount) * 100);
  var expectedCents = limited.computeDepositCents(basket.totalKits);
  if (chargedCents !== expectedCents || chargedCents !== Math.round(Number(record.amount) * 100)) {
    return voidAndRespond(400, 'Payment amount did not match your reservation', chargedAmount);
  }

  // 9. Zoho offline
  if (req.zohoOffline) {
    return voidAndRespond(503, UNAVAILABLE_VOIDED_MSG, chargedAmount);
  }

  // 10. Booking seam (Plan 07)
  var amount = expectedCents / 100;
  try {
    await bookDeposit({
      txnId: txnId,
      invoiceNumber: invoiceNumber,
      lines: basket.lines,
      totalKits: basket.totalKits,
      amount: amount,
      customer: {
        name: emailLine(body.customer.name, 100),
        email: emailLine(body.customer.email, 254),
        phone: emailLine(body.customer.phone || '', 30)
      },
      consent: { accepted: true, text: emailLine(body.consent.text, 500) },
      newsletter: body.newsletter === true,
      reqId: reqId,
      res: res,
      idemKey: idemKey
    });
  } catch (err) {
    log.error('[preorder] booking failed txn=' + txnId + ': ' + (err && err.message));
    captureExceptionSafe(err, { level: 'error', tags: { reqId: reqId, txnId: txnId, phase: 'preorder_book' } });
    if (!res.headersSent) {
      return voidAndRespond(500, 'Reservation could not be completed', amount);
    }
  }
});

module.exports = router;
module.exports.__setBookDeposit = function (fn) { bookDeposit = fn; };
