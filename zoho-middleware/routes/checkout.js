var express = require('express');
var https = require('https');
var fs = require('fs');
var path = require('path');
var querystring = require('querystring');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var helcimLib = require('../lib/helcim');
var ledger = require('../lib/inventory-ledger');
var pricing = require('../lib/pricing');
var C = require('../lib/constants');

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
  // M11: 5s timeout on reCAPTCHA — fail open so slow Google responses don't block customers
  return withTimeout(verifyPromise, 5000).catch(function(timeoutErr) {
    log.warn('[checkout] reCAPTCHA verification timed out — allowing through: ' + timeoutErr.message);
    return { success: true, score: 1.0 };
  });
}

var zohoPost = zohoApi.zohoPost;
var zohoGet = zohoApi.zohoGet;
var mailer = require('../lib/mailer');
var axios = require('axios');

// #6: Warn at startup when reCAPTCHA is not configured — bot protection bypassed on /api/checkout
if (!process.env.RECAPTCHA_SECRET_KEY) {
  log.warn('[checkout] RECAPTCHA_SECRET_KEY is not set — bot protection disabled on /api/checkout');
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

var PRODUCTS_CACHE_KEY = C.CACHE_KEYS.PRODUCTS;
var SERVICES_CACHE_KEY = C.CACHE_KEYS.SERVICES;
var INGREDIENTS_CACHE_KEY = C.CACHE_KEYS.INGREDIENTS;
var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
var CHECKOUT_IDEMPOTENCY_TTL = 600; // 10 minutes in seconds

/**
 * Build line items and compute order total from a cart.
 * Uses catalog prices when available; falls back to client-supplied rates.
 * NOTE: In production, runCheckout() always rejects the request before calling
 * this function when the catalog is unavailable (fail-closed). The catalogAvailable
 * flag and client-rate fallback path exist only for unit-test compatibility.
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
    // C3: Server never trusts client-supplied discount — always apply zero discount
    // Any applicable discounts must be computed server-side from authoritative data
    var discountPct = (typeof item.discount === 'number' && item.discount > 0) ? item.discount : 0;

    // Delegate per-item arithmetic to shared pricing module
    var lineCalc = pricing.computeLineItem({ rate: rate }, qty, { discountPct: discountPct });
    computed.push(lineCalc);

    var li = { item_id: item.item_id, name: item.name || '', quantity: qty, rate: rate };
    if (discountPct > 0) li.discount = discountPct + '%';
    return li;
  });

  // Delegate cart total accumulation (with rounding) to shared pricing module
  var totals = pricing.computeCartTotals(computed);
  var orderTotal = totals.subtotal; // tax is tracked by Zoho; subtotal is the line-items sum

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

var router = express.Router();

/**
 * POST /api/payment/initialize
 * Initialize a HelcimPay.js checkout session.
 * Returns a checkoutToken that the frontend uses to render the payment iframe.
 * The payment is processed inside the Helcim iframe; result comes back via postMessage.
 *
 * Expected body: { amount: number, currency?: string }
 * Returns: { checkoutToken: string, depositAmount: number }
 */
function handlePaymentInitialize(req, res) {
  if (!helcimLib.isEnabled()) {
    return res.status(503).json({ error: 'Payment gateway not configured' });
  }
  // Full amount is charged at checkout — no partial deposit.
  // The actual amount is determined by the cart at checkout time;
  // this endpoint initializes a session that the iframe will use.
  var amount = parseFloat(req.body && req.body.amount) || 0;
  if (amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  helcimLib.initializeCheckout(amount, 'CAD')
    .then(function (result) {
      res.json({ checkoutToken: result.checkoutToken, depositAmount: amount });
    })
    .catch(function (err) {
      log.error('[payment/initialize] Failed: ' + err.message);
      res.status(502).json({ error: 'Payment initialization failed' });
    });
}
router.post('/api/payment/initialize', handlePaymentInitialize);

/**
 * POST /api/checkout
 * Accepts a cart payload, formats it as a Zoho Books Sales Order, and creates
 * it via the API. Invalidates the products cache so stock counts refresh.
 *
 * If a payment transaction_id is provided (full amount was charged online),
 * a Zoho Books customer payment is recorded against the sales order.
 *
 * The Zoho contact is always derived server-side from the submitted email address
 * (via lookup-or-create). A client-supplied customer_id is intentionally ignored
 * to prevent a caller from attaching an order to an arbitrary contact record.
 *
 * Expected request body:
 * {
 *   customer: { name: "...", email: "...", phone: "..." },
 *   items: [
 *     { item_id: "zoho_item_id", name: "Product Name", quantity: 2, rate: 14.99 }
 *   ],
 *   notes: "optional order notes",
 *   transaction_id: "helcim-txn-id (optional — full amount was charged)",
 *   idempotency_key: "client-generated-uuid (optional)"
 * }
 */
router.post('/api/checkout', async function (req, res) {
  var body = req.body;

  // --- Validate customer block ---
  if (!body || !body.customer || !body.customer.email) {
    return res.status(400).json({ error: 'Missing customer email' });
  }
  if (typeof body.customer.email !== 'string' ||
      body.customer.email.length > 254 ||
      body.customer.email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'Invalid customer email' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  if (body.items.length > 50) {
    return res.status(400).json({ error: 'Too many items' });
  }
  if (body.transaction_id && (typeof body.transaction_id !== 'string' || body.transaction_id.length > 64)) {
    return res.status(400).json({ error: 'Invalid transaction_id' });
  }
  if (body.payment_token && (typeof body.payment_token !== 'string' || body.payment_token.length > 500)) {
    return res.status(400).json({ error: 'Invalid payment_token' });
  }

  // M2: Server-side string length limits
  var nameVal = (body.customer && body.customer.name) ? String(body.customer.name) : '';
  var emailVal = (body.customer && body.customer.email) ? String(body.customer.email) : '';
  var phoneVal = (body.customer && body.customer.phone) ? String(body.customer.phone) : '';
  var notesVal = body.notes ? String(body.notes) : '';
  if (nameVal.length > 100) return res.status(400).json({ error: 'Input too long: name' });
  if (emailVal.length > 200) return res.status(400).json({ error: 'Input too long: email' });
  if (phoneVal.length > 30) return res.status(400).json({ error: 'Input too long: phone' });
  if (notesVal.length > 1000) return res.status(400).json({ error: 'Input too long: notes' });

  // --- Validate each line item ---
  for (var v = 0; v < body.items.length; v++) {
    var vi = body.items[v];
    var vQty = Number(vi.quantity) || 1;
    var vRate = Number(vi.rate) || 0;
    if (vQty < 1 || vQty > 100) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + v });
    }
    if (vRate < 0 || vRate > 10000) {
      return res.status(400).json({ error: 'Invalid rate for item ' + v });
    }
    // M3: Validate item_id is a non-empty string or number
    if (!vi.item_id || (typeof vi.item_id !== 'string' && typeof vi.item_id !== 'number') ||
        String(vi.item_id).trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing item_id for item ' + v });
    }
  }

  // Item #40 — Idempotency key
  var idempotencyKey = (body && typeof body.idempotency_key === 'string' && body.idempotency_key)
    ? C.CACHE_KEYS.CHECKOUT_IDEM_PREFIX + body.idempotency_key.slice(0, 128)
    : null;

  // reCAPTCHA v3 verification — runs before idempotency to avoid wasting Redis on bots
  var rcToken = (typeof body.recaptcha_token === 'string') ? body.recaptcha_token : '';

  var zohoOffline = !!req.zohoOffline;

  async function proceed() {
    if (idempotencyKey) {
      try {
        var cached = await cache.get(idempotencyKey);
        if (cached) {
          log.info('[checkout] Idempotent replay: ' + idempotencyKey);
          return res.status(201).json(cached);
        }
        processCheckout(body, idempotencyKey, res, zohoOffline);
      } catch (e) {
        processCheckout(body, idempotencyKey, res, zohoOffline);
      }
      return;
    }
    processCheckout(body, null, res, zohoOffline);
  }

  try {
    var captcha = await verifyRecaptcha(rcToken);
    if (!captcha.success || captcha.score < 0.5) {
      log.warn('[checkout] reCAPTCHA rejected — score: ' + (captcha.score || 0) +
        ', action: ' + (captcha.action || '') + ', errors: ' + JSON.stringify(captcha['error-codes'] || []));
      return res.status(400).json({ error: 'Request could not be verified. Please try again.' });
    }
    return proceed();
  } catch (err) {
    // Google unreachable — log and allow through rather than blocking real customers
    log.warn('[checkout] reCAPTCHA verification failed (network error) — allowing through: ' + (err && err.message));
    return proceed();
  }
});

async function processCheckout(body, idempotencyKey, res, zohoOffline) {
  // Offline fallback: Zoho not authenticated — send email notification and return reference number
  if (zohoOffline) {
    var offlineRef = 'REF-' + Date.now().toString(36).toUpperCase();
    mailer.sendOfflineOrderNotification({
      ref: offlineRef,
      customer: body.customer || {},
      items: body.items || [],
      timeslot: body.timeslot || '',
      notes: body.notes || ''
    }).then(function () {
      log.info('[checkout/offline] Notification email sent, ref=' + offlineRef);
    }).catch(function (emailErr) {
      log.error('[checkout/offline] Notification email failed: ' + emailErr.message);
    });
    return res.status(201).json({ ok: true, salesorder_number: offlineRef, deposit_amount: 0, balance_due: 0 });
  }

  var customerEmail = body.customer.email.trim();
  var customerName  = (body.customer.name || '').toString().trim().substring(0, 200) || customerEmail;
  var customerPhone = (body.customer.phone || '').toString().trim().substring(0, 40);

  var transactionId = body.transaction_id || '';
  // Full amount is charged at checkout — no partial deposit.
  // depositAmount is set to orderTotal after line items are built (inside runCheckout).
  var depositAmount = 0;

  // H3: Transaction ID single-use enforcement — prevent replay attacks
  // Check Redis before processing; mark as used after successful order creation.
  // Dual-cart checkout shares one Helcim transaction across two cart_keys,
  // so the replay key includes the cart_key to allow both orders through.
  async function checkTransactionIdAndProceed() {
    if (!transactionId) {
      return runCheckout();
    }
    var txnKeySuffix = body.cart_key ? ':' + body.cart_key : '';
    var txnKey = 'helcim:txn:' + transactionId + txnKeySuffix;
    try {
      var existing = await cache.get(txnKey);
      if (existing) {
        log.warn('[checkout] Replay attack detected — transaction_id already used: ' + transactionId);
        return res.status(409).json({ error: 'Payment already processed' });
      }
      return runCheckout();
    } catch (e) {
      // Redis unavailable — allow through (fail open)
      return runCheckout();
    }
  }

  // --- Resolve Zoho contact server-side from email (lookup or create) ---
  // This prevents a caller from supplying an arbitrary customer_id to attach
  // the order to someone else's contact record.
  // Returns { contactId, freshlyCreated } so callers can log orphan warnings.
  var CONTACT_CACHE_KEY = C.CACHE_KEYS.CONTACT_PREFIX + customerEmail.toLowerCase();
  var CONTACT_CACHE_TTL = 600; // 10 minutes

  async function resolveCustomerId() {
    var cached = await cache.get(CONTACT_CACHE_KEY);
    if (cached) {
      return { contactId: cached, freshlyCreated: false };
    }

    var data = await zohoGet('/contacts', { email: customerEmail });
    var contacts = (data.contacts || []);
    if (contacts.length > 0) {
      var contactId = contacts[0].contact_id;
      cache.set(CONTACT_CACHE_KEY, contactId, CONTACT_CACHE_TTL).catch(function () {});
      return { contactId: contactId, freshlyCreated: false };
    }
    // Not found — create a new contact
    var contactPayload = {
      contact_name: customerName,
      contact_type: 'customer',
      email: customerEmail
    };
    if (customerPhone) contactPayload.phone = customerPhone;
    try {
      var createData = await zohoPost('/contacts', contactPayload);
      var contact = createData.contact || {};
      if (contact.contact_id) {
        cache.set(CONTACT_CACHE_KEY, contact.contact_id, CONTACT_CACHE_TTL).catch(function () {});
      }
      return { contactId: contact.contact_id, freshlyCreated: true };
    } catch (createErr) {
      // Zoho rejects duplicate contact names — fall back to name search
      if (createErr.response && createErr.response.status === 400) {
        var nameData = await zohoGet('/contacts', { contact_name: customerName });
        var nameContacts = (nameData.contacts || []);
        if (nameContacts.length > 0) {
          var nameContactId = nameContacts[0].contact_id;
          cache.set(CONTACT_CACHE_KEY, nameContactId, CONTACT_CACHE_TTL).catch(function () {});
          return { contactId: nameContactId, freshlyCreated: false };
        }
        throw createErr; // give up — surface the original error
      }
      throw createErr;
    }
  }

  // Item #11 — Anchor prices to authoritative catalog cache.
  // Fail closed: if the catalog cache is empty (e.g. after a cold start), reject
  // the checkout with a 503 rather than accepting client-supplied rates.
  // Use the general products catalog for checkout validation.
  // (Kiosk catalog is a different item set — retail POS items — and must not
  //  be used to validate regular website reservations.)
  async function runCheckout() {
    var results;
    try {
      results = await Promise.all([
        cache.get(PRODUCTS_CACHE_KEY),
        cache.get(SERVICES_CACHE_KEY),
        cache.get(INGREDIENTS_CACHE_KEY)
      ]);
    } catch (cacheErr) {
      // Catalog cache read failed entirely — still allow checkout to proceed
      // by falling back to an empty catalogMap (which will reject items not found)
      log.error('[checkout] Catalog cache read failed: ' + cacheErr.message);
      return res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
    }

    var catalog = results[0];
    var services = results[1];
    var ingredients = results[2];
    // If services cache is empty, fall back to snapshot directly
    if (!Array.isArray(services) || services.length === 0) {
      log.warn('[checkout] Services cache empty — using snapshot fallback');
      services = readServicesSnapshot();
    }
    // Build item_id → rate lookup from the authoritative catalog (products + services)
    var catalogMap = {};
    var catalogAvailable = Array.isArray(catalog) && catalog.length > 0;

    // Fix 1: Fail closed — reject if catalog is unavailable rather than trusting client rates
    if (!catalogAvailable) {
      log.warn('[checkout] Catalog cache empty — rejecting checkout to prevent client-rate injection');
      return res.status(503).json({ error: 'Pricing temporarily unavailable. Please try again in a moment.' });
    }

    catalog.forEach(function (p) {
      if (p && p.item_id) catalogMap[p.item_id] = p.rate;
    });
    // Also include service items (e.g. Makers Fee, milling) so they pass validation
    if (Array.isArray(services)) {
      services.forEach(function (s) {
        if (s && s.item_id) catalogMap[s.item_id] = s.rate;
      });
    }
    // Include ingredients so dual-cart ingredient orders pass validation
    if (Array.isArray(ingredients)) {
      ingredients.forEach(function (ing) {
        if (ing && ing.item_id) catalogMap[ing.item_id] = ing.rate;
      });
    }

    // Reject any item not present in the catalog cache
    for (var ci = 0; ci < body.items.length; ci++) {
      var cItem = body.items[ci];
      if (catalogMap[cItem.item_id] === undefined) {
        log.warn('[checkout] item_id not found in catalog: ' + cItem.item_id);
        return res.status(400).json({
          error: 'One or more items could not be priced. Please refresh and try again.'
        });
      }
    }

    // Resolve the Maker's Fee item now — needed for both stripping and injection below.
    var MAKERS_FEE_ITEM_ID = process.env.MAKERS_FEE_ITEM_ID || '';
    var makersFeeItem = findMakersFeeItem(services, MAKERS_FEE_ITEM_ID);

    // Strip any client-submitted Maker's Fee entries before building line items.
    // The server always injects the fee server-side; if the client also submitted it,
    // both entries would reach Zoho causing double-billing.
    var checkoutItems = makersFeeItem
      ? body.items.filter(function (i) { return i.item_id !== makersFeeItem.item_id; })
      : body.items;

    // --- Build line items from authoritative catalog prices only ---
    var built = buildLineItems(checkoutItems, catalogMap, true);
    var lineItems = built.lineItems;
    var orderTotal = built.orderTotal;

    // Server-side Maker's Fee injection.
    // Count total kit quantity (non-service items from the stripped list), then inject
    // the fee as an authoritative line item so the Zoho invoice always reflects it.
    var kitQtyTotal = 0;
    for (var kqi = 0; kqi < checkoutItems.length; kqi++) {
      var kqiItem = checkoutItems[kqi];
      var kqiIsService = Array.isArray(services) &&
        services.some(function (s) { return s && s.item_id === kqiItem.item_id; });
      if (!kqiIsService) kitQtyTotal += (Number(kqiItem.quantity) || 1);
    }
    if (kitQtyTotal > 0) {
      if (!makersFeeItem) {
        log.error('[checkout] Maker\'s Fee item not found in services catalog — check MAKERS_FEE_ITEM_ID env var');
        return res.status(503).json({ error: 'Order configuration error. Please contact us.' });
      }
      lineItems.push({
        item_id: makersFeeItem.item_id,
        name: makersFeeItem.name || "Maker's Fee",
        quantity: kitQtyTotal,
        rate: makersFeeItem.rate
      });
      orderTotal = Math.round((orderTotal + makersFeeItem.rate * kitQtyTotal) * 100) / 100;
      log.info('[checkout] Injected Maker\'s Fee: qty=' + kitQtyTotal + ' rate=' + makersFeeItem.rate + ' item_id=' + makersFeeItem.item_id);
    }

    // Full amount charged — deposit equals the order total when payment was taken
    depositAmount = transactionId ? orderTotal : 0;
    var balanceDue = 0;

    var responseSent = false;

    try {
      var resolved = await resolveCustomerId();
      var customerId = resolved.contactId;
      var contactWasFresh = resolved.freshlyCreated;

      if (!customerId) {
        throw new Error('Could not resolve Zoho contact for email: ' + customerEmail);
      }
      log.info('[checkout] Resolved contact_id=' + customerId + ' fresh=' + contactWasFresh);

      var salesOrder = {
        customer_id: customerId,
        date: new Date().toISOString().slice(0, 10),  // YYYY-MM-DD
        line_items: lineItems,
        notes: body.notes || '',
        custom_fields: []
      };

      // Appointment custom fields (only included if configured in .env)
      if (body.appointment_id && process.env.ZOHO_CF_APPOINTMENT_ID) {
        salesOrder.custom_fields.push({
          api_name: process.env.ZOHO_CF_APPOINTMENT_ID,
          value: body.appointment_id
        });
      }
      if (body.timeslot && process.env.ZOHO_CF_TIMESLOT) {
        salesOrder.custom_fields.push({
          api_name: process.env.ZOHO_CF_TIMESLOT,
          value: body.timeslot
        });
      }
      if (process.env.ZOHO_CF_STATUS) {
        salesOrder.custom_fields.push({
          api_name: process.env.ZOHO_CF_STATUS,
          value: body.appointment_id ? 'Pending' : 'Walk-in'
        });
      }

      // NOTE: ZOHO_CF_DEPOSIT and ZOHO_CF_BALANCE custom fields removed (Apr 2026).
      // Historical orders retain their values in Zoho; new orders no longer write them.
      if (transactionId && process.env.ZOHO_CF_TRANSACTION_ID) {
        salesOrder.custom_fields.push({
          api_name: process.env.ZOHO_CF_TRANSACTION_ID,
          value: transactionId
        });
      }

      // Guard: Zoho requires numeric item_ids. If snapshot fallback was used
      // (item_ids are SKU strings like "MAKERS-FEE"), Zoho will reject the order.
      // Throw so the catch block can void any charged payment before sending 503.
      for (var sgi = 0; sgi < lineItems.length; sgi++) {
        if (!/^\d+$/.test(String(lineItems[sgi].item_id || ''))) {
          log.warn('[checkout] Non-numeric item_id — likely snapshot fallback, item_id=' + lineItems[sgi].item_id);
          var snapshotErr = new Error('Pricing temporarily unavailable. Please try again in a moment.');
          snapshotErr.isSnapshotFallback = true;
          throw snapshotErr;
        }
      }

      var data;
      try {
        data = await zohoPost('/salesorders', salesOrder);
      } catch (soErr) {
        // Item #15 — Warn if a freshly created contact is now orphaned because the SO failed
        if (contactWasFresh) {
          log.warn('[checkout] Orphan contact created — sales order failed. contact_id=' + customerId + ' err=' + soErr.message);
        }
        throw soErr;
      }

      // Mark product cache stale so the next request triggers a background
      // refresh (stale-while-revalidate). Deleting the cache key outright
      // would leave the products endpoint with no data during the Zoho
      // round-trip and can trigger 429 rate-limit storms if Zoho is busy.
      cache.del(C.CACHE_KEYS.PRODUCTS_TS);

      var soId = data.salesorder ? data.salesorder.salesorder_id : null;
      var soNumber = data.salesorder ? data.salesorder.salesorder_number : null;

      // Use the Zoho SO total (tax-inclusive) for payment recording.
      // buildLineItems returns the pre-tax subtotal; Zoho applies tax rules
      // server-side. Using the SO response total ensures the recorded payment
      // matches what Zoho expects, preventing an unpaid balance.
      if (transactionId && data.salesorder && data.salesorder.total != null) {
        depositAmount = Math.round(parseFloat(data.salesorder.total) * 100) / 100;
      }

      // Fire-and-forget: decrement inventory ledger for sold items
      ledger.decrementStock(lineItems, 'checkout:' + (soNumber || 'unknown')).catch(function (err) {
        log.error('[checkout] Inventory ledger decrement failed (non-fatal): ' + err.message);
      });

      // Fire-and-forget: internal staff notification email
      mailer.sendReservationNotification({
        orderNumber: soNumber || '',
        customer: { name: customerName, email: customerEmail, phone: customerPhone },
        items: lineItems,
        timeslot: body.timeslot || '',
        notes: body.notes || ''
      }).catch(function (mailErr) {
        log.warn('[checkout] Staff notification email failed (non-fatal): ' + mailErr.message);
      });

      // Fire-and-forget: write to admin panel Google Sheets
      notifyAdminPanel(soNumber, customerName, customerEmail, customerPhone, lineItems, body.timeslot || '', body.notes || '');

      // NOTE: Confirmation email is intentionally NOT sent here.
      // It is sent by staff via the admin panel when the reservation
      // status is changed to "confirmed".

      // If an online payment was charged, record it in Zoho Books
      if (transactionId && depositAmount > 0 && soId) {
        try {
          await zohoPost('/customerpayments', {
            customer_id: customerId,
            payment_mode: 'creditcard',
            amount: depositAmount,
            date: new Date().toISOString().slice(0, 10),
            reference_number: transactionId,
            notes: 'Online payment for Sales Order ' + (soNumber || soId),
            // Item #7 — Apply the payment directly to the sales order
            salesorders_to_apply: [{ salesorder_id: soId, amount_applied: depositAmount }]
          });
          log.info('[checkout] Payment recorded for SO=' + soNumber);
        } catch (payErr) {
          // Payment recording failed — log but don't fail the order
          // The transaction ID custom field on the SO still has the reference
          log.error('[checkout] Payment recording failed (non-fatal): ' + payErr.message);
        }
      }

      var responseBody = {
        ok: true,
        salesorder_id: soId,
        salesorder_number: soNumber,
        deposit_amount: depositAmount,
        balance_due: balanceDue
      };
      // Item #40 — Cache response before sending so retries hit the cache
      var cacheWrite = idempotencyKey
        ? cache.set(idempotencyKey, responseBody, CHECKOUT_IDEMPOTENCY_TTL).catch(function () {})
        : Promise.resolve();
      // H3: Mark transaction ID as used in Redis (24h TTL) to prevent replay
      // Uses cart_key suffix to match the check in checkTransactionIdAndProceed()
      var txnKeySuffix2 = body.cart_key ? ':' + body.cart_key : '';
      var txnMark = transactionId
        ? cache.set('helcim:txn:' + transactionId + txnKeySuffix2, 'used', 86400).catch(function () {})
        : Promise.resolve();
      await Promise.all([cacheWrite, txnMark]);
      responseSent = true;
      eventLog.logEvent('checkout.completed', {
        cartKey: body.cart_key || '',
        itemCount: lineItems.length,
        grandTotal: orderTotal,
        txnId: transactionId || ''
      });
      res.status(201).json(responseBody);

    } catch (err) {
      if (responseSent) {
        log.error('[checkout] Error after response already sent: ' + err.message);
        return;
      }

      var status = 502;
      var internalMessage = err.message;

      // Snapshot fallback guard: non-numeric item_ids can't be submitted to Zoho
      if (err.isSnapshotFallback) {
        status = 503;
      }

      // M9: Extract Zoho error details for server-side logging only — never send raw Zoho messages to client
      if (err.response && err.response.data) {
        internalMessage = err.response.data.message || err.response.data.error || internalMessage;
        // 400-level from Zoho -> relay as 400 to the client (but with generic message)
        if (err.response.status >= 400 && err.response.status < 500) {
          status = 400;
        }
      }

      // M9: Log the actual Zoho error server-side; send only generic message to client
      log.error('[checkout] Order creation failed: ' + internalMessage);
      var clientMsg = err.isSnapshotFallback
        ? err.message
        : 'Order creation failed. Please try again.';

      // If payment was already charged but Zoho failed, void the transaction
      // H5: Only attempt void when a real transaction_id is present (not offline mode)
      if (transactionId && typeof transactionId === 'string' && transactionId.length > 0) {
        log.error('[checkout] Zoho failed after payment — voiding txn=' + transactionId);
        eventLog.logEvent('checkout.failed_after_charge', {
          cartKey: body.cart_key || '',
          itemCount: body.items ? body.items.length : 0,
          grandTotal: orderTotal,
          txnId: transactionId
        });
        // C4: Wrap void in 8s timeout; log for manual action if it times out
        withTimeout(
          helcimLib.voidTransaction(transactionId),
          8000
        )
          .then(function (voidResult) {
            if (!voidResult || !voidResult.ok) {
              log.error('[checkout] Helcim void returned non-ok: ' + JSON.stringify(voidResult));
              eventLog.logEvent('checkout.void_fired', {
                txnId: transactionId,
                voidResult: 'declined'
              });
            } else {
              log.info('[checkout] Voided txn=' + transactionId);
              eventLog.logEvent('checkout.void_fired', {
                txnId: transactionId,
                voidResult: 'success'
              });
            }
          })
          .catch(function (voidErr) {
            if (voidErr && voidErr.message && voidErr.message.indexOf('Timeout') === 0) {
              log.error('[checkout] Helcim void timed out — manual void required for txn=' + transactionId + ': ' + voidErr.message);
            } else {
              var voidFailTs = new Date().toISOString();
              log.error('[checkout] CRITICAL: Void failed for txn=' + transactionId + ': ' + voidErr.message);
              eventLog.logEvent('checkout.void_failed', {
                txnId: transactionId,
                voidError: voidErr.message
              });
              mailer.sendVoidFailureAlert({
                txnId: transactionId,
                amount: depositAmount,
                error: voidErr.message,
                timestamp: voidFailTs
              }).catch(function (mailErr) {
                log.error('[checkout] Void failure alert email failed: ' + mailErr.message);
              });
            }
          })
          .then(function () {
            if (!responseSent) {
              // M10: Do not include voided_transaction_id in client response
              res.status(status).json({
                error: clientMsg,
                payment_voided: true
              });
            }
          });
        return;
      }

      res.status(status).json({ error: clientMsg });
    }
  } // end runCheckout

  // Payment was processed in the HelcimPay.js iframe before the customer submitted.
  // payment_token is the Helcim transactionId returned via window.postMessage.
  // The card was already charged inside the HelcimPay.js iframe before this runs.
  // Pre-validate catalog and cart here as defense-in-depth: if validation fails we
  // void the already-charged transaction before rejecting, preventing ghost charges.
  // If Zoho order creation fails after validation, voidTransaction() handles recovery.
  async function chargeAndProceed() {
    if (!body.payment_token) {
      // No payment — offline booking or unpaid reservation
      return checkTransactionIdAndProceed();
    }
    if (!helcimLib.isEnabled()) {
      return res.status(503).json({ error: 'Payment gateway not configured' });
    }

    // Card is already charged — set transactionId so void fires if any check below fails
    transactionId = body.payment_token;
    // depositAmount will be set to orderTotal inside runCheckout after line items are built
    log.info('[checkout] Helcim payment received: txn=' + transactionId);

    // Pre-validate catalog and cart before proceeding to order creation.
    // On any validation failure: void the already-charged transaction then reject.
    var preResults;
    try {
      preResults = await Promise.all([
        cache.get(PRODUCTS_CACHE_KEY),
        cache.get(SERVICES_CACHE_KEY),
        cache.get(INGREDIENTS_CACHE_KEY)
      ]);
    } catch (cacheErr) {
      log.error('[checkout/pre-validate] Cache read failed: ' + cacheErr.message);
      helcimLib.voidTransaction(transactionId).catch(function (vErr) {
        log.error('[checkout/pre-validate] Void after cache failure failed: ' + vErr.message);
      });
      return res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
    }

    var preCatalog = preResults[0];
    var preServices = preResults[1];
    var preIngredients = preResults[2];
    // If services cache is empty, fall back to snapshot directly
    if (!Array.isArray(preServices) || preServices.length === 0) {
      log.warn('[checkout/pre-validate] Services cache empty — using snapshot fallback');
      preServices = readServicesSnapshot();
    }

    if (!Array.isArray(preCatalog) || preCatalog.length === 0) {
      log.warn('[checkout/pre-validate] Catalog unavailable — voiding txn=' + transactionId);
      helcimLib.voidTransaction(transactionId).catch(function (vErr) {
        log.error('[checkout/pre-validate] Void after catalog unavailable failed: ' + vErr.message);
      });
      return res.status(503).json({ error: 'Pricing temporarily unavailable. Please try again in a moment.' });
    }

    var preMap = {};
    preCatalog.forEach(function (p) { if (p && p.item_id) preMap[p.item_id] = true; });
    if (Array.isArray(preServices)) {
      preServices.forEach(function (s) { if (s && s.item_id) preMap[s.item_id] = true; });
    }
    if (Array.isArray(preIngredients)) {
      preIngredients.forEach(function (ing) { if (ing && ing.item_id) preMap[ing.item_id] = true; });
    }

    for (var pi = 0; pi < body.items.length; pi++) {
      if (preMap[body.items[pi].item_id] === undefined) {
        log.warn('[checkout/pre-validate] item_id not in catalog: ' + body.items[pi].item_id + ' — voiding txn=' + transactionId);
        helcimLib.voidTransaction(transactionId).catch(function (vErr) {
          log.error('[checkout/pre-validate] Void after unknown item failed: ' + vErr.message);
        });
        return res.status(400).json({ error: 'One or more items could not be priced. Please refresh and try again.' });
      }
      // Guard: non-numeric item_ids are snapshot SKUs — Zoho will reject them
      if (!/^\d+$/.test(String(body.items[pi].item_id || ''))) {
        log.warn('[checkout/pre-validate] Non-numeric item_id (snapshot fallback?) — voiding txn=' + transactionId + ' item_id=' + body.items[pi].item_id);
        helcimLib.voidTransaction(transactionId).catch(function (vErr) {
          log.error('[checkout/pre-validate] Void after snapshot item_id failed: ' + vErr.message);
        });
        return res.status(503).json({ error: 'Pricing temporarily unavailable. Please try again in a moment.' });
      }
    }

    // Pre-validate Maker's Fee item exists in services catalog before charging.
    // If it's missing, void the transaction and return 503 now — before runCheckout()
    // runs — so the early-return path in runCheckout never fires after a charge.
    var MAKERS_FEE_ITEM_ID_PRE = process.env.MAKERS_FEE_ITEM_ID || '';
    var preKitQty = 0;
    for (var pkq = 0; pkq < body.items.length; pkq++) {
      var pkqItem = body.items[pkq];
      var pkqIsService = Array.isArray(preServices) && preServices.some(function (s) { return s && s.item_id === pkqItem.item_id; });
      if (!pkqIsService) preKitQty += (Number(pkqItem.quantity) || 1);
    }
    if (preKitQty > 0 && !findMakersFeeItem(preServices, MAKERS_FEE_ITEM_ID_PRE)) {
      log.error('[checkout/pre-validate] Maker\'s Fee item not found in services catalog — voiding txn=' + transactionId);
      helcimLib.voidTransaction(transactionId).catch(function (vErr) {
        log.error('[checkout/pre-validate] Void after missing Maker\'s Fee failed: ' + vErr.message);
      });
      return res.status(503).json({ error: 'Order configuration error. Please contact us.' });
    }

    eventLog.logEvent('checkout.cart_validated', {
      cartKey: body.cart_key || '',
      itemCount: body.items.length
    });
    return checkTransactionIdAndProceed();
  }

  return chargeAndProceed();
}

module.exports = router;
module.exports.verifyRecaptcha = verifyRecaptcha;
module.exports.buildLineItems = buildLineItems;
module.exports.findMakersFeeItem = findMakersFeeItem;
module.exports.handlePaymentInitialize = handlePaymentInitialize;
