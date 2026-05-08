var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var helcimLib = require('../lib/helcim');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');
var helpers = require('../lib/checkout-helpers');

var readServicesSnapshot = helpers.readServicesSnapshot;
var readIngredientsFileCache = helpers.readIngredientsFileCache;
var withTimeout = helpers.withTimeout;
var verifyRecaptcha = helpers.verifyRecaptcha;
var notifyAdminPanel = helpers.notifyAdminPanel;
var buildLineItems = helpers.buildLineItems;
var findMakersFeeItem = helpers.findMakersFeeItem;
var findMaterialsFeeItem = helpers.findMaterialsFeeItem;

var zohoPost = zohoApi.zohoPost;
var zohoGet = zohoApi.zohoGet;
var mailer = require('../lib/mailer');

// #6: Warn at startup when reCAPTCHA is not configured — bot protection bypassed on /api/checkout
if (!process.env.RECAPTCHA_SECRET_KEY) {
  log.warn('[checkout] RECAPTCHA_SECRET_KEY is not set — bot protection disabled on /api/checkout');
}

var PRODUCTS_CACHE_KEY = C.CACHE_KEYS.PRODUCTS;
var SERVICES_CACHE_KEY = C.CACHE_KEYS.SERVICES;
var INGREDIENTS_CACHE_KEY = C.CACHE_KEYS.INGREDIENTS;
var CHECKOUT_IDEMPOTENCY_TTL = 600; // 10 minutes in seconds

var router = express.Router();

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
        // H1: Atomic lock prevents TOCTOU race on concurrent duplicate requests
        var lockAcquired = await cache.acquireLock(idempotencyKey, CHECKOUT_IDEMPOTENCY_TTL);
        if (!lockAcquired) {
          return res.status(409).json({ error: 'Checkout already in progress' });
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
      // Void any already-charged Helcim payment before rejecting
      if (body.payment_token && helcimLib.isEnabled()) {
        log.error('[checkout] Voiding txn=' + body.payment_token + ' after reCAPTCHA rejection');
        helcimLib.voidTransaction(body.payment_token).catch(function (vErr) {
          log.error('[checkout] Void after reCAPTCHA rejection failed: ' + vErr.message);
          mailer.sendVoidFailureAlert({
            txnId: body.payment_token,
            amount: 0,
            error: 'reCAPTCHA rejected (score=' + (captcha.score || 0) + ') — void failed: ' + vErr.message,
            timestamp: new Date().toISOString()
          }).catch(function () {});
        });
      }
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
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      log.warn('[checkout] Ingredients cache empty — using file cache fallback');
      ingredients = readIngredientsFileCache();
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

    // --- Promo code re-validation (server-authoritative) ---
    // Acquire lock to prevent concurrent double-burn (Pitfall 1 from RESEARCH.md)
    var promoDiscount = 0;
    if (body.promo_code === 'FIRSTBATCH' && customerEmail) {
      var promoKey = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + customerEmail.toLowerCase();

      // Acquire per-email lock to prevent two simultaneous checkout requests burning the same code
      var lockAcquired = false;
      try {
        lockAcquired = await cache.acquireLock(promoKey, 30);
      } catch (lockErr) {
        // Lock acquisition failed — fail open (allow through)
        lockAcquired = true;
        log.warn('[checkout] Promo lock acquisition failed, proceeding: ' + lockErr.message);
      }

      // Re-validate: check Redis to confirm not already redeemed
      try {
        var promoExisting = await cache.get(promoKey);
        if (!promoExisting) {
          promoDiscount = 20;
          log.info('[checkout] Promo FIRSTBATCH validated for checkout by ' + customerEmail);
        } else {
          log.warn('[checkout] Promo code FIRSTBATCH rejected — already redeemed by ' + customerEmail);
        }
      } catch (promoCheckErr) {
        // Fail open — allow discount if Redis unavailable
        promoDiscount = 20;
        log.warn('[checkout] Promo Redis check failed, allowing discount: ' + promoCheckErr.message);
      }
    }

    // C3 enforcement: strip unauthorized item discounts if no valid promo code
    // This prevents clients from injecting discount fields on items without a valid promo
    if (promoDiscount === 0) {
      (body.items || []).forEach(function (item) {
        if (item.discount && parseFloat(item.discount) > 0) {
          log.warn('[checkout] Stripped unauthorized discount on item ' + (item.name || item.item_id));
          item.discount = 0;
        }
      });
    }

    // Resolve the Maker's Fee and Materials Fee items now — needed for both stripping and injection below.
    var MAKERS_FEE_ITEM_ID = process.env.MAKERS_FEE_ITEM_ID || '';
    var makersFeeItem = findMakersFeeItem(services, MAKERS_FEE_ITEM_ID);
    var MATERIALS_FEE_ITEM_ID = process.env.MATERIALS_FEE_ITEM_ID || '';
    var materialsFeeItem = findMaterialsFeeItem(services, MATERIALS_FEE_ITEM_ID);

    // Strip any client-submitted Maker's Fee and Materials Fee entries before building line items.
    // The server always injects fee items server-side; if the client also submitted them,
    // both entries would reach Zoho causing double-billing.
    var feeItemIds = {};
    if (makersFeeItem) feeItemIds[makersFeeItem.item_id] = true;
    if (materialsFeeItem) feeItemIds[materialsFeeItem.item_id] = true;
    var checkoutItems = (makersFeeItem || materialsFeeItem)
      ? body.items.filter(function (i) { return !feeItemIds[i.item_id]; })
      : body.items;

    // --- Build line items from authoritative catalog prices only ---
    var built = buildLineItems(checkoutItems, catalogMap, true);
    var lineItems = built.lineItems;
    var orderTotal = built.orderTotal;

    // Server-side Maker's Fee injection.
    // Count total kit quantity (non-service, non-ingredient items), then inject
    // the fee as an authoritative line item so the Zoho invoice always reflects it.
    // Per D-11: when promo is active, apply 20% discount to Maker's Fee rate.
    // Ingredient-only carts (cart_key=sv-cart-ingredients) never have kits.
    var kitQtyTotal = 0;
    var isIngredientCart = body.cart_key === 'sv-cart-ingredients';
    if (!isIngredientCart) {
      for (var kqi = 0; kqi < checkoutItems.length; kqi++) {
        var kqiItem = checkoutItems[kqi];
        var kqiIsService = Array.isArray(services) &&
          services.some(function (s) { return s && s.item_id === kqiItem.item_id; });
        var kqiIsIngredient = Array.isArray(ingredients) &&
          ingredients.some(function (ing) { return ing && ing.item_id === kqiItem.item_id; });
        if (!kqiIsService && !kqiIsIngredient) kitQtyTotal += (Number(kqiItem.quantity) || 1);
      }
    }
    if (kitQtyTotal > 0) {
      if (!makersFeeItem) {
        log.error('[checkout] Maker\'s Fee item not found in services catalog — check MAKERS_FEE_ITEM_ID env var');
        return res.status(503).json({ error: 'Order configuration error. Please contact us.' });
      }
      var makersFeeRate = makersFeeItem.rate;
      if (promoDiscount > 0) {
        makersFeeRate = Math.round(makersFeeItem.rate * (1 - promoDiscount / 100) * 100) / 100;
        log.info('[checkout] Promo applied to Maker\'s Fee: original=' + makersFeeItem.rate + ' discounted=' + makersFeeRate);
      }
      lineItems.push({
        item_id: makersFeeItem.item_id,
        name: makersFeeItem.name || "Maker's Fee",
        quantity: kitQtyTotal,
        rate: makersFeeRate
      });
      orderTotal = Math.round((orderTotal + makersFeeRate * kitQtyTotal) * 100) / 100;
      log.info('[checkout] Injected Maker\'s Fee: qty=' + kitQtyTotal + ' rate=' + makersFeeRate + ' item_id=' + makersFeeItem.item_id);

      // Materials Fee injection — same pattern as Maker's Fee but graceful degradation (non-blocking)
      if (materialsFeeItem) {
        var materialsFeeRate = materialsFeeItem.rate;
        if (promoDiscount > 0) {
          materialsFeeRate = Math.round(materialsFeeItem.rate * (1 - promoDiscount / 100) * 100) / 100;
          log.info('[checkout] Promo applied to Materials Fee: original=' + materialsFeeItem.rate + ' discounted=' + materialsFeeRate);
        }
        lineItems.push({
          item_id: materialsFeeItem.item_id,
          name: materialsFeeItem.name || 'Materials Fee',
          quantity: kitQtyTotal,
          rate: materialsFeeRate
        });
        orderTotal = Math.round((orderTotal + materialsFeeRate * kitQtyTotal) * 100) / 100;
        log.info('[checkout] Injected Materials Fee: qty=' + kitQtyTotal + ' rate=' + materialsFeeRate + ' item_id=' + materialsFeeItem.item_id);
      } else {
        log.warn('[checkout] Materials Fee item not found in services catalog — skipping (non-fatal)');
      }
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

      // Paid orders → Zoho Invoice; unpaid reservations → Zoho Sales Order
      var useInvoice = !!transactionId;
      var data;
      try {
        if (useInvoice) {
          data = await zohoPost('/invoices', salesOrder);
        } else {
          data = await zohoPost('/salesorders', salesOrder);
        }
      } catch (createErr) {
        if (contactWasFresh) {
          log.warn('[checkout] Orphan contact created — ' + (useInvoice ? 'invoice' : 'sales order') + ' failed. contact_id=' + customerId + ' err=' + createErr.message);
        }
        throw createErr;
      }

      cache.del(C.CACHE_KEYS.PRODUCTS_TS);

      var zohoEntity = useInvoice ? data.invoice : data.salesorder;
      var soId = zohoEntity ? (zohoEntity.invoice_id || zohoEntity.salesorder_id) : null;
      var soNumber = zohoEntity ? (zohoEntity.invoice_number || zohoEntity.salesorder_number) : null;
      log.info('[checkout] Created ' + (useInvoice ? 'Invoice' : 'Sales Order') + ' ' + soNumber + ' id=' + soId);

      if (soId && promoDiscount > 0 && customerEmail) {
        var burnKey = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + customerEmail.toLowerCase();
        cache.set(burnKey, { redeemedAt: new Date().toISOString(), soId: soId }, 5 * 365 * 24 * 60 * 60)
          .catch(function (burnErr) { log.error('[promo] Failed to burn redemption: ' + burnErr.message); });
        log.info('[promo] Redemption burned for FIRSTBATCH, email=' + customerEmail + ' soId=' + soId);
      }

      // Use the Zoho response total (tax-inclusive) for payment recording.
      if (transactionId && zohoEntity && zohoEntity.total != null) {
        var zohoTotal = parseFloat(zohoEntity.total);
        if (!isNaN(zohoTotal)) {
          depositAmount = Math.round(zohoTotal * 100) / 100;
        }
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
        eventLog.logEvent('checkout.staff_email_failed', {
          orderNumber: soNumber || '',
          errorMsg: (mailErr.message || '').substring(0, 100)
        });
      });

      // Fire-and-forget: write to admin panel Google Sheets
      notifyAdminPanel(soNumber, customerName, customerEmail, customerPhone, lineItems, body.timeslot || '', body.notes || '');

      // NOTE: Confirmation email is intentionally NOT sent here.
      // It is sent by staff via the admin panel when the reservation
      // status is changed to "confirmed".

      // If an online payment was charged, record it in Zoho Books
      if (transactionId && depositAmount > 0 && soId) {
        try {
          var paymentBody = {
            customer_id: customerId,
            payment_mode: 'creditcard',
            amount: depositAmount,
            date: new Date().toISOString().slice(0, 10),
            reference_number: transactionId,
            notes: 'Online payment for ' + (useInvoice ? 'Invoice' : 'Sales Order') + ' ' + (soNumber || soId)
          };
          if (useInvoice) {
            paymentBody.invoices = [{ invoice_id: soId, amount_applied: depositAmount }];
          } else {
            paymentBody.salesorders_to_apply = [{ salesorder_id: soId, amount_applied: depositAmount }];
          }
          await zohoPost('/customerpayments', paymentBody);
          log.info('[checkout] Payment recorded for ' + (useInvoice ? 'INV' : 'SO') + '=' + soNumber);
        } catch (payErr) {
          log.error('[checkout] Payment recording failed (non-fatal): ' + payErr.message);
        }
      }

      // Fire-and-forget: email confirmation to the customer
      // Only for paid orders — unpaid reservations are confirmed manually by staff
      if (transactionId && soId && customerEmail) {
        var emailEndpoint = useInvoice
          ? '/invoices/' + soId + '/email'
          : '/salesorders/' + soId + '/email';
        zohoPost(emailEndpoint, {
          to_mail_ids: [customerEmail],
          subject: 'Steins & Vines — Order Confirmation ' + (soNumber || ''),
          body: 'Thank you for your order! Please find your order confirmation attached.\n\nIf you have any questions, reply to this email or call us at (604) 567-4565.'
        }).then(function () {
          log.info('[checkout] Order confirmation email sent to customer for ' + soNumber);
        }).catch(function (emailErr) {
          log.warn('[checkout] Zoho email failed, sending SMTP fallback: ' + emailErr.message);
          mailer.sendCustomerConfirmation({
            email: customerEmail,
            orderNumber: soNumber || '',
            items: lineItems,
            timeslot: body.timeslot || ''
          }).then(function () {
            log.info('[checkout] Fallback SMTP confirmation sent for ' + soNumber);
          }).catch(function (fallbackErr) {
            log.error('[checkout] Fallback SMTP email also failed: ' + fallbackErr.message);
            eventLog.logEvent('checkout.customer_email_failed', {
              orderNumber: soNumber || '',
              errorMsg: (fallbackErr.message || '').substring(0, 100)
            });
          });
        });
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
        // Dual-cart guard: if this transactionId was already used for another
        // cart_key (e.g. ferment succeeded, ingredient failed), voiding would
        // reverse the ENTIRE shared charge — including the successful order.
        // Skip the void and log for manual reconciliation instead.
        var otherCartKey = '';
        if (body.cart_key === 'sv-cart-ferment') otherCartKey = 'sv-cart-ingredients';
        else if (body.cart_key === 'sv-cart-ingredients') otherCartKey = 'sv-cart-ferment';

        var otherUsedKey = otherCartKey
          ? 'helcim:txn:' + transactionId + ':' + otherCartKey
          : null;

        var skipVoid = false;
        if (otherUsedKey) {
          try {
            var otherUsed = await cache.get(otherUsedKey);
            if (otherUsed) {
              skipVoid = true;
              log.error('[checkout] Dual-cart: skipping void for txn=' + transactionId +
                ' — already used by ' + otherCartKey + '. Manual partial refund required for cart_key=' + body.cart_key);
              eventLog.logEvent('checkout.void_skipped_dual_cart', {
                cartKey: body.cart_key,
                otherCartKey: otherCartKey,
                txnId: transactionId,
                failedOrderTotal: orderTotal
              });
              mailer.sendVoidFailureAlert({
                txnId: transactionId,
                amount: orderTotal,
                error: 'Dual-cart partial failure — void skipped because ' + otherCartKey + ' already succeeded. Manual partial refund needed.',
                timestamp: new Date().toISOString()
              }).catch(function (mailErr) {
                log.error('[checkout] Dual-cart alert email failed: ' + mailErr.message);
              });
            }
          } catch (cacheCheckErr) {
            // Redis unavailable — can't confirm, safer to skip void than destroy the other order
            skipVoid = true;
            log.error('[checkout] Dual-cart void guard: Redis unavailable, skipping void for safety. txn=' + transactionId);
          }
        }

        if (skipVoid) {
          if (!responseSent) {
            res.status(status).json({
              error: clientMsg,
              payment_voided: false
            });
          }
          return;
        }

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
    if (!Array.isArray(preIngredients) || preIngredients.length === 0) {
      log.warn('[checkout/pre-validate] Ingredients cache empty — using file cache fallback');
      preIngredients = readIngredientsFileCache();
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
    var preIsIngredientCart = body.cart_key === 'sv-cart-ingredients';
    if (!preIsIngredientCart) {
      for (var pkq = 0; pkq < body.items.length; pkq++) {
        var pkqItem = body.items[pkq];
        var pkqIsService = Array.isArray(preServices) && preServices.some(function (s) { return s && s.item_id === pkqItem.item_id; });
        var pkqIsIngredient = Array.isArray(preIngredients) && preIngredients.some(function (ing) { return ing && ing.item_id === pkqItem.item_id; });
        if (!pkqIsService && !pkqIsIngredient) preKitQty += (Number(pkqItem.quantity) || 1);
      }
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
module.exports.findMaterialsFeeItem = findMaterialsFeeItem;
