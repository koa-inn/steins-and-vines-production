var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var zohoPut = zohoApi.zohoPut;

var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
var RECENT_ORDERS_CACHE_KEY = C.CACHE_KEYS.RECENT_ORDERS;
var RECENT_ORDERS_CACHE_TTL = 60; // seconds
var IDEMPOTENCY_KEY_TTL = 300; // 5 minutes in seconds

var crypto = require('crypto');

var _TAX_RULE_PCT = {};
_TAX_RULE_PCT[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 12;
_TAX_RULE_PCT[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 0;
_TAX_RULE_PCT[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 5;
_TAX_RULE_PCT[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 15;

var router = express.Router();

// Resolve and apply a discount preset to lineItems.
// Returns a promise that resolves to { discountApplied, subtotal } or
// { error, status } if validation fails. Resolves to null if no discount.
function resolveDiscount(body, lineItems, subtotal) {
  if (!body.discount || !body.discount.preset_id) return Promise.resolve(null);

  return cache.get(C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS).then(function (presets) {
    presets = Array.isArray(presets) ? presets : [];
    var preset = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === body.discount.preset_id) { preset = presets[i]; break; }
    }
    if (!preset) return { error: 'Discount preset not found', status: 400 };
    if (!preset.active) return { error: 'Discount preset is inactive', status: 400 };
    if (preset.scope === 'item' && !body.discount.target_item_id) {
      return { error: 'target_item_id required for item-level discount', status: 400 };
    }
    if (preset.scope === 'item') {
      var found = false;
      for (var j = 0; j < lineItems.length; j++) {
        if (lineItems[j].item_id === body.discount.target_item_id) { found = true; break; }
      }
      if (!found) return { error: 'target_item_id not found in cart', status: 400 };
    }

    var discountApplied = null;
    if (preset.scope === 'cart') {
      if (preset.type === 'percentage') {
        lineItems.forEach(function (li) { li.discount = preset.value + '%'; });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'percentage', value: preset.value, scope: 'cart' };
      } else {
        var fixedAmount = Math.min(preset.value, subtotal);
        lineItems.forEach(function (li) {
          var lineTotal = li.quantity * li.rate;
          var share = subtotal > 0 ? Math.round(fixedAmount * (lineTotal / subtotal) * 100) / 100 : 0;
          li.discount = share;
        });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'fixed', value: fixedAmount, scope: 'cart' };
      }
    } else {
      var targetId = body.discount.target_item_id;
      lineItems.forEach(function (li) {
        if (li.item_id === targetId) {
          if (preset.type === 'percentage') {
            li.discount = preset.value + '%';
          } else {
            var itemTotal = li.quantity * li.rate;
            li.discount = Math.min(preset.value, itemTotal);
          }
        }
      });
      discountApplied = { preset_id: preset.id, name: preset.name, type: preset.type, value: preset.value, scope: 'item', target_item_id: targetId };
    }

    var newSubtotal = 0;
    lineItems.forEach(function (li) {
      var lt = li.quantity * li.rate;
      if (li.discount) {
        if (typeof li.discount === 'string' && li.discount.indexOf('%') !== -1) {
          lt = lt * (1 - parseFloat(li.discount) / 100);
        } else {
          lt = lt - Number(li.discount);
        }
      }
      newSubtotal += Math.max(lt, 0);
    });
    return { discountApplied: discountApplied, subtotal: Math.round(newSubtotal * 100) / 100 };
  });
}

// Compute per-line-item tax total, respecting discounts already on lineItems.
function computeTax(lineItems, catalogMap) {
  var taxTotal = 0;
  var defaultTaxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
  lineItems.forEach(function (li) {
    var catalogItem = catalogMap[li.item_id];
    var lineTotal = li.quantity * li.rate;
    if (li.discount) {
      if (typeof li.discount === 'string' && li.discount.indexOf('%') !== -1) {
        lineTotal = lineTotal * (1 - parseFloat(li.discount) / 100);
      } else {
        lineTotal = lineTotal - Number(li.discount);
      }
    }
    lineTotal = Math.max(lineTotal, 0);
    var pct = catalogItem.tax_percentage || 0;
    if (catalogItem.sales_tax_rule_id && _TAX_RULE_PCT[catalogItem.sales_tax_rule_id] !== undefined) {
      pct = _TAX_RULE_PCT[catalogItem.sales_tax_rule_id];
    } else if (!pct && !catalogItem.tax_id) {
      pct = defaultTaxRate * 100;
    }
    taxTotal += lineTotal * ((pct || 0) / 100);
  });
  return Math.round(taxTotal * 100) / 100;
}

function isConsignmentItem(catalogItem) {
  if (!catalogItem) return false;
  if ((catalogItem.cf_type || '').toLowerCase() === 'consignment') return true;
  var fields = catalogItem.custom_fields || [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].label === 'Type' && (fields[i].value || '').toLowerCase() === 'consignment') return true;
  }
  return false;
}

function extractConsignmentInfo(catalogItem) {
  if (!isConsignmentItem(catalogItem)) return null;
  var fields = catalogItem.custom_fields || [];
  var artisanName = '';
  var commissionRate = 0;
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].label === 'Artisan Name') artisanName = fields[i].value || '';
    if (fields[i].label === 'Commission Rate') commissionRate = parseFloat(fields[i].value) || 0;
  }
  if (!artisanName || !commissionRate) return null;
  return { artisan_name: artisanName, commission_rate: commissionRate };
}

/**
 * POST /api/kiosk/sale
 * Process a complete kiosk (in-store POS) sale.
 *
 * Flow:
 *   1. Validate cart items against Zoho live prices/stock
 *   2. Send payment to GP POS terminal
 *   3. On payment success: create a Zoho Books Invoice (auto-marks as paid)
 *   4. Invalidate kiosk products cache so stock refreshes
 *   5. Return receipt data
 *
 * If invoice creation fails after payment, void the GP transaction.
 *
 * Expected body:
 * {
 *   items: [
 *     { item_id: "zoho_item_id", name: "Product Name", quantity: 2, rate: 14.99 }
 *   ],
 *   tax_total: 3.00,          // ignored — tax is computed server-side (KIOSK_TAX_RATE, default 5%)
 *   reference_number: "KIOSK-001"  // optional reference for the invoice
 * }
 *
 * Note: client-supplied `rate` and `tax_total` are both ignored for all financial
 * calculations. Prices are anchored to the zoho:kiosk-products cache. Any item_id
 * not present in that cache causes an immediate 400 rejection.
 */
router.post('/api/kiosk/sale', function (req, res) {
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  var body = req.body;

  // Idempotency: if client supplies a key, return cached result on retry
  var idempotencyKey = (body && typeof body.idempotency_key === 'string' && body.idempotency_key)
    ? C.CACHE_KEYS.KIOSK_IDEM_PREFIX + body.idempotency_key.slice(0, 128)
    : null;

  if (idempotencyKey) {
    return cache.get(idempotencyKey).then(function (cached) {
      if (cached) {
        log.info('[pos/kiosk/sale] Idempotent replay: ' + idempotencyKey);
        return res.status(201).json(cached);
      }
      processSale(body, idempotencyKey, req, res);
    }).catch(function () {
      processSale(body, idempotencyKey, req, res);
    });
  }

  processSale(body, null, req, res);
});

function processSale(body, idempotencyKey, req, res) {
  // Validate required fields
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  if (body.items.length > 50) {
    return res.status(400).json({ error: 'Too many items in cart' });
  }

  // Validate each line item (structural validation only — price comes from catalog)
  for (var v = 0; v < body.items.length; v++) {
    var vi = body.items[v];
    if (!vi.item_id || typeof vi.item_id !== 'string' || vi.item_id.length > 64) {
      return res.status(400).json({ error: 'Invalid item_id for item ' + v });
    }
    var vQty = Number(vi.quantity);
    if (!isFinite(vQty) || vQty <= 0 || vQty > 100) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + v });
    }
  }

  // Item #1: Anchor prices to the server-side catalog cache.
  // Client-supplied rate values are ignored for all financial calculations.
  cache.get(KIOSK_PRODUCTS_CACHE_KEY).then(function (catalog) {
    // Build item_id → catalog entry lookup from the authoritative catalog
    var catalogMap = {};
    if (Array.isArray(catalog)) {
      catalog.forEach(function (p) {
        if (p && p.item_id) catalogMap[p.item_id] = p;
      });
    }

    // Reject immediately if any requested item is not in the catalog cache.
    // Do not fall back to client-supplied rates — that would defeat the anchoring.
    for (var ci = 0; ci < body.items.length; ci++) {
      var cItem = body.items[ci];
      if (catalogMap[cItem.item_id] === undefined) {
        return res.status(400).json({
          error: 'Item not found in current catalog: ' + cItem.item_id +
            '. Refresh the product list and try again.'
        });
      }
    }

    // Build line items using catalog price, ignoring client-supplied rate
    // D-03: Include per-item tax_id from catalog so Zoho computes tax using its rules
    var subtotal = 0;
    var lineItems = body.items.map(function (item) {
      var qty = Number(item.quantity) || 1;
      var catalogItem = catalogMap[item.item_id];
      var rate = catalogItem.rate; // authoritative price from catalog
      subtotal += qty * rate;
      var li = {
        item_id: item.item_id,
        name: item.name || '',
        quantity: qty,
        rate: rate
      };
      if (catalogItem.tax_id) {
        li.tax_id = catalogItem.tax_id;
      }
      return li;
    });
    subtotal = Math.round(subtotal * 100) / 100;

    // Apply discount (if any) before computing tax and terminal charge
    resolveDiscount(body, lineItems, subtotal).then(function (discResult) {
      if (discResult && discResult.error) {
        return res.status(discResult.status).json({ error: discResult.error });
      }
      if (discResult) {
        subtotal = discResult.subtotal;
      }

      var taxTotal = computeTax(lineItems, catalogMap);
      var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;

      processSaleWithPrices(body, idempotencyKey, req, res,
        lineItems, subtotal, taxTotal, grandTotal, catalogMap);
    });
  }).catch(function (cacheErr) {
    log.error('[pos/kiosk/sale] Catalog cache read failed: ' + cacheErr.message);
    res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
  });
}

function processSaleWithPrices(body, idempotencyKey, req, res,
  lineItems, subtotal, taxTotal, grandTotal, catalogMap) {

  if (grandTotal <= 0) {
    return res.status(400).json({ error: 'Sale total must be greater than zero' });
  }
  if (grandTotal > 10000) {
    return res.status(400).json({ error: 'Sale total exceeds maximum' });
  }

  var refNumber = (body.reference_number && typeof body.reference_number === 'string')
    ? body.reference_number.slice(0, 64)
    : ('KIOSK-' + Date.now());

  log.info('[pos/kiosk/sale] Pushing to terminal: total=$' + grandTotal.toFixed(2) +
    ' ref=' + refNumber + ' items=' + lineItems.length);

  helcimLib.terminalPurchase(grandTotal, refNumber)
    .then(function () {
      var responseBody = {
        pending: true,
        reference: refNumber
      };

      var cacheWrite = idempotencyKey
        ? cache.set(idempotencyKey, responseBody, IDEMPOTENCY_KEY_TTL).catch(function () {})
        : Promise.resolve();

      return cacheWrite.then(function () {
        res.status(202).json(responseBody);
      });
    })
    .catch(function (termErr) {
      log.error('[pos/kiosk/sale] Terminal push failed: ' + termErr.message);
      res.status(502).json({ error: 'Terminal error — please try again' });
    });
}

/**
 * GET /api/kiosk/sale/status
 * Poll for terminal payment result. Single Redis/API check, no long polling.
 * Query: ?ref=KIOSK-xxxxx
 */
router.get('/api/kiosk/sale/status', function (req, res) {
  var ref = req.query.ref;
  if (!ref || typeof ref !== 'string') {
    return res.status(400).json({ error: 'Missing ref parameter' });
  }

  helcimLib.pollTerminalResult(ref)
    .then(function (result) {
      if (result.approved) {
        return res.json({
          status: 'approved',
          transaction_id: result.transactionId || '',
          card_type: result.cardType || ''
        });
      }
      if (result.status === 'DECLINED' || result.status === 'CANCELLED') {
        return res.json({ status: 'declined' });
      }
      res.json({ status: 'pending' });
    })
    .catch(function (err) {
      log.error('[pos/kiosk/sale/status] Poll error: ' + err.message);
      res.json({ status: 'pending' });
    });
});

/**
 * GET /api/pos/status
 * Check if the POS terminal is enabled and configured.
 */
router.get('/api/pos/status', function (req, res) {
  var diag = helcimLib.getTerminalDiagnostics();
  res.json({
    enabled: helcimLib.isTerminalEnabled(),
    terminal_type: helcimLib.isTerminalEnabled() ? 'Helcim Smart Terminal' : 'none',
    diagnostics: diag,
    _v: '20260312-1'
  });
});

/**
 * POST /api/kiosk/verify-pin
 * Verify a 4-digit kiosk access PIN.
 */
router.post('/api/kiosk/verify-pin', function (req, res) {
  var pin = req.body && req.body.pin;

  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ ok: false, error: 'PIN must be exactly 4 digits' });
  }

  if (!process.env.KIOSK_PIN) {
    return res.status(503).json({ ok: false, error: 'PIN not configured' });
  }

  var match = crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(process.env.KIOSK_PIN));
  if (match) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid PIN' });
});

router.post('/api/kiosk/sale/confirm', function (req, res) {
  var body = req.body;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  cache.get(KIOSK_PRODUCTS_CACHE_KEY).then(function (catalog) {
    var catalogMap = {};
    if (Array.isArray(catalog)) {
      catalog.forEach(function (p) {
        if (p && p.item_id) catalogMap[p.item_id] = p;
      });
    }

    for (var ci = 0; ci < body.items.length; ci++) {
      if (catalogMap[body.items[ci].item_id] === undefined) {
        return res.status(400).json({ error: 'Item not found in catalog. Refresh and try again.' });
      }
    }

    var subtotal = 0;
    var lineItems = body.items.map(function (item) {
      var qty = Number(item.quantity) || 1;
      var catalogItem = catalogMap[item.item_id];
      var rate = catalogItem.rate;
      subtotal += qty * rate;
      var li = { item_id: item.item_id, name: item.name || '', quantity: qty, rate: rate };
      if (catalogItem.tax_id) {
        li.tax_id = catalogItem.tax_id;
      }
      return li;
    });
    subtotal = Math.round(subtotal * 100) / 100;

    return resolveDiscount(body, lineItems, subtotal).then(function (discResult) {
      if (discResult && discResult.error) {
        return res.status(discResult.status).json({ error: discResult.error });
      }

      var discountApplied = null;
      if (discResult) {
        subtotal = discResult.subtotal;
        discountApplied = discResult.discountApplied;
      }

    var taxTotal = computeTax(lineItems, catalogMap);
    var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
    var refNumber = (body.reference_number || 'KIOSK-' + Date.now()).slice(0, 64);
    var txnId = body.transaction_id || 'manual-confirm';
    var today = new Date().toISOString().slice(0, 10);

    var invoiceNotes = 'In-store kiosk sale (manual confirm). Ref: ' + refNumber;
    if (discountApplied) {
      invoiceNotes += '\nDiscount: ' + discountApplied.name + ' (' + discountApplied.type + ' ' + discountApplied.value + (discountApplied.type === 'percentage' ? '%' : '') + ')';
    }

    var invoicePayload = {
      date: today,
      reference_number: refNumber,
      payment_terms: 0,
      payment_terms_label: 'Due on Receipt',
      line_items: lineItems,
      notes: invoiceNotes,
      custom_fields: []
    };

    var contactId = process.env.KIOSK_CONTACT_ID || '';
    if (body.contact_id) invoicePayload.customer_id = body.contact_id;
    else if (contactId) invoicePayload.customer_id = contactId;

    var consignmentDetails = [];
    lineItems.forEach(function (li) {
      var info = extractConsignmentInfo(catalogMap[li.item_id]);
      if (info) {
        consignmentDetails.push({
          item_id: li.item_id, item_name: li.name, quantity: li.quantity,
          sale_amount: Math.round(li.quantity * li.rate * 100) / 100,
          artisan_name: info.artisan_name, commission_rate: info.commission_rate,
          artisan_payout: Math.round(li.quantity * li.rate * (info.commission_rate / 100) * 100) / 100
        });
      }
    });
    if (consignmentDetails.length > 0 && process.env.ZOHO_CF_CONSIGNMENT_SALE) {
      invoicePayload.custom_fields.push({ api_name: process.env.ZOHO_CF_CONSIGNMENT_SALE, value: true });
    }
    if (consignmentDetails.length > 0 && process.env.ZOHO_CF_CONSIGNMENT_DETAILS) {
      invoicePayload.custom_fields.push({ api_name: process.env.ZOHO_CF_CONSIGNMENT_DETAILS, value: JSON.stringify(consignmentDetails) });
    }

    return zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
      var invoice = invoiceData.invoice || {};
      var invoiceId = invoice.invoice_id || '';
      var invoiceNumber = invoice.invoice_number || '';
      log.info('[pos/kiosk/sale/confirm] Invoice created: ' + invoiceNumber);

      var paymentChain = Promise.resolve();
      if (invoiceId) {
        paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
          .then(function () {
            return zohoPost('/customerpayments', {
              payment_mode: 'creditcard',
              amount: grandTotal,
              date: today,
              reference_number: txnId,
              invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
              notes: 'Kiosk POS payment (manual confirm). Ref: ' + refNumber
            });
          }).catch(function (payErr) {
            log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
          });
      }

      return paymentChain.then(function () {
        cache.del(KIOSK_PRODUCTS_CACHE_KEY);
        ledger.decrementStock(lineItems, 'kiosk:' + (invoiceNumber || 'unknown')).catch(function () {});

        eventLog.logEvent('kiosk.sale_completed', {
          txnId: txnId, itemCount: lineItems.length, grandTotal: grandTotal, invoiceNumber: invoiceNumber
        });

        // Trigger batch creation for kit items with Maker's Fee (fire-and-forget per D-01)
        brewpadIntegration.createBatchesFromSale(lineItems, invoiceNumber, body.customer_name || '', body.contact_id || '', catalogMap);

        var result = {
          ok: true, transaction_id: txnId, invoice_id: invoiceId, invoice_number: invoiceNumber,
          reference_number: refNumber, subtotal: subtotal, tax_total: taxTotal, total: grandTotal, date: today
        };
        if (discountApplied) result.discount_applied = discountApplied;
        res.status(201).json(result);
      });
    });
    }); // end resolveDiscount.then
  }).catch(function (err) {
    log.error('[pos/kiosk/sale/confirm] Error: ' + err.message);
    res.status(502).json({ error: 'Failed to create invoice. Please try again.' });
  });
});

router.post('/api/pos/cancel', function (req, res) {
  helcimLib.cancelTerminal().then(function (result) {
    res.json(result);
  });
});

/**
 * POST /api/pos/sale
 * Push a sale to the GP terminal via Meet in the Cloud.
 * The terminal displays the amount and waits for card tap/insert/swipe.
 *
 * Expected body:
 * {
 *   amount: 99.99,
 *   salesorder_number: "SO-00123",
 *   items: [{ name: "Product Name", price: "49.99", qty: 2 }],
 *   customer_name: "John Doe"
 * }
 *
 * Returns: { transaction_id, status, auth_code } on success
 */
router.post('/api/pos/sale', function (req, res) {
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  var body = req.body;
  if (!body || !body.amount) {
    return res.status(400).json({ error: 'Missing amount' });
  }

  var amount = parseFloat(body.amount);
  if (isNaN(amount) || amount <= 0 || amount > 10000) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  var soNumber = body.salesorder_number || '';

  log.info('[pos/sale] Initiating terminal sale: $' + amount.toFixed(2) + ' SO=' + soNumber);

  var posRefNumber = soNumber || ('POS-' + Date.now());
  var LEGACY_TIMEOUT_MS = 90000;
  var LEGACY_POLL_MS = 5000;

  helcimLib.terminalPurchase(amount, posRefNumber)
    .then(function () {
      var pollStart = Date.now();
      function pollLegacy() {
        return helcimLib.pollTerminalResult(posRefNumber).then(function (result) {
          if (result.approved) return result;
          if (result.status === 'DECLINED') { var e = new Error('declined'); e.isDeclined = true; throw e; }
          if (Date.now() - pollStart >= LEGACY_TIMEOUT_MS) throw new Error('Terminal timeout after 90s');
          return new Promise(function (resolve) { setTimeout(function () { resolve(pollLegacy()); }, LEGACY_POLL_MS); });
        });
      }
      return pollLegacy();
    })
    .then(function (response) {
      if (!response.approved) {
        return res.status(402).json({ error: 'Terminal payment declined', code: 'DECLINED' });
      }
      var txnId = response.transactionId || '';
      log.info('[pos/sale] Terminal sale approved: txn=' + txnId);
      res.json({
        ok: true,
        transaction_id: txnId,
        status: 'approved',
        auth_code: '',
        amount: amount
      });

      // Item #9: Record the sale in Zoho Books as a background operation.
      // Create a one-line invoice then record a customer payment against it.
      // Errors are non-fatal — the Helcim terminal charge has already succeeded.
      var today = new Date().toISOString().slice(0, 10);
      var refNumber = posRefNumber;

        var invoicePayload = {
          date: today,
          reference_number: refNumber,
          payment_terms: 0,
          payment_terms_label: 'Due on Receipt',
          line_items: [{
            // Zoho Books accepts a description-only line item when no item_id is available.
            description: soNumber ? ('POS sale — ' + soNumber) : 'In-store POS sale',
            rate: amount,
            quantity: 1
          }],
          notes: 'Legacy POS sale. Terminal txn: ' + txnId,
          custom_fields: []
        };

        // Attach walk-in customer contact if configured
        var contactId = process.env.KIOSK_CONTACT_ID || '';
        if (contactId) invoicePayload.customer_id = contactId;

        // Attach GP transaction ID to custom field if configured
        if (txnId && process.env.ZOHO_CF_TRANSACTION_ID) {
          invoicePayload.custom_fields.push({
            api_name: process.env.ZOHO_CF_TRANSACTION_ID,
            value: txnId
          });
        }

        zohoPost('/invoices', invoicePayload)
          .then(function (invoiceData) {
            var invoice = invoiceData.invoice || {};
            var invoiceId = invoice.invoice_id || '';
            var invoiceNumber = invoice.invoice_number || '';
            log.info('[pos/sale] Invoice created: ' + invoiceNumber + ' id=' + invoiceId);

            if (!invoiceId) return;

            // Submit invoice then record payment
            return zohoPost('/invoices/' + invoiceId + '/submit', {})
              .catch(function (submitErr) {
                log.warn('[pos/sale] Invoice submit failed (non-fatal): ' + submitErr.message);
              })
              .then(function () {
                // Match kiosk/sale: detect debit vs credit from terminal response
                var cardType = (response.cardType || '').toLowerCase();
                var posPaymentMode = (cardType.indexOf('debit') !== -1) ? 'debitcard' : 'creditcard';
                return zohoPost('/customerpayments', {
                  payment_mode: posPaymentMode,
                  amount: amount,
                  date: today,
                  reference_number: txnId || refNumber,
                  invoices: [{ invoice_id: invoiceId, amount_applied: amount }],
                  notes: 'Legacy POS payment. Terminal txn: ' + txnId
                });
              })
              .then(function () {
                log.info('[pos/sale] Payment recorded for invoice ' + invoiceNumber);
              })
              .catch(function (payErr) {
                log.error('[pos/sale] Payment recording failed (non-fatal): ' + payErr.message);
              });
          })
          .catch(function (invoiceErr) {
            var msg = invoiceErr.message;
            if (invoiceErr.response && invoiceErr.response.data) {
              msg = invoiceErr.response.data.message || invoiceErr.response.data.error || msg;
            }
            log.error('[pos/sale] Zoho invoice creation failed (non-fatal, txn=' + txnId + '): ' + msg);
          });
    })
    .catch(function (err) {
      if (err && err.isDeclined) {
        if (!res.headersSent) res.status(402).json({ error: 'Terminal payment declined' });
        return;
      }
      log.error('[pos/sale] Terminal error: ' + err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Terminal error' });
    });
});

/**
 * GET /api/orders/recent
 * Returns the last 20 sales orders, sorted by most recent.
 * Used by the admin panel's "Recent Kiosk Orders" section.
 */
router.get('/api/orders/recent', function (req, res) {
  // Item #13: This endpoint exposes sensitive order data. Require an API key
  // even for GET requests, overriding the global GET exemption in server.js.
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Item #47: Cap at 50 regardless of caller-supplied value.
  var limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  var cacheKey = RECENT_ORDERS_CACHE_KEY + ':' + limit;

  Promise.resolve()
    .then(function () { return cache.get(cacheKey); })
    .then(function (cached) {
      if (cached) {
        return res.json({ orders: cached, cached: true });
      }

      return zohoGet('/salesorders', {
        sort_column: 'created_time',
        sort_order: 'D',
        per_page: limit
      })
        .then(function (data) {
          var orders = (data.salesorders || []).map(function (so) {
            // Extract custom field values
            var customFields = so.custom_fields || [];
            var status = '';
            var timeslot = '';
            var deposit = '';
            var txnId = '';

            customFields.forEach(function (cf) {
              if (cf.api_name === process.env.ZOHO_CF_STATUS) status = cf.value || '';
              if (cf.api_name === process.env.ZOHO_CF_TIMESLOT) timeslot = cf.value || '';
              if (cf.api_name === process.env.ZOHO_CF_DEPOSIT) deposit = cf.value || '';
              if (cf.api_name === process.env.ZOHO_CF_TRANSACTION_ID) txnId = cf.value || '';
            });

            return {
              salesorder_number: so.salesorder_number || '',
              customer_name: so.customer_name || '',
              total: so.total || 0,
              status: status,
              timeslot: timeslot,
              deposit: deposit,
              transaction_id: txnId,
              date: so.date || '',
              items: (so.line_items || []).map(function (li) {
                return {
                  name: li.name || li.description || '',
                  quantity: li.quantity || 1,
                  rate: li.rate || 0
                };
              })
            };
          });

          cache.set(cacheKey, JSON.stringify(orders), RECENT_ORDERS_CACHE_TTL).catch(function () {});
          res.json({ orders: orders });
        });
    })
    .catch(function (err) {
      log.error('[api/orders/recent] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch orders' });
    });
});

/**
 * GET /api/admin/inventory-ledger
 * Returns current ledger state for debugging.
 * Shows recent stock adjustments and the current version counter.
 */
router.get('/api/admin/inventory-ledger', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  Promise.all([
    cache.get(C.LEDGER_KEYS.VERSION),
    cache.getClient().then(function (c) {
      if (!c) return [];
      return c.lRange(C.LEDGER_KEYS.ADJUSTMENTS, 0, 49);
    })
  ]).then(function (results) {
    var adjustments = (results[1] || []).map(function (entry) {
      try { return JSON.parse(entry); } catch (e) { return entry; }
    });
    res.json({
      version: results[0] || 0,
      recent_adjustments: adjustments
    });
  }).catch(function (err) {
    res.status(500).json({ error: err.message });
  });
});

// ---------------------------------------------------------------------------
// Kiosk Sales Order management
// ---------------------------------------------------------------------------

var KIOSK_SO_CACHE_KEY = C.CACHE_KEYS.KIOSK_SALESORDERS;
var KIOSK_SO_CACHE_TTL = 120; // seconds

/**
 * GET /api/kiosk/salesorders
 * List open/unfulfilled sales orders from Zoho for the kiosk UI.
 *
 * Query params:
 *   status  - Zoho SO status filter (default 'open')
 *   search  - Case-insensitive customer name filter (applied after cache)
 *
 * Response: { salesorders: [...] }
 */
router.get('/api/kiosk/salesorders', function (req, res) {
  var status = req.query.status || 'open';
  var search = req.query.search || '';

  cache.get(KIOSK_SO_CACHE_KEY)
    .then(function (cached) {
      if (cached) {
        log.info('[kiosk/salesorders] Cache hit');
        return cached;
      }

      log.info('[kiosk/salesorders] Cache miss — fetching from Zoho (all statuses)');
      var fetchParams = { sort_column: 'date', sort_order: 'D' };
      return Promise.all([
        zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'open' })),
        zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'draft' })),
        zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'closed' })),
        zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'confirmed' })),
        zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'invoiced' }))
      ]).then(function (results) {
        var all = results.reduce(function (acc, r) {
          return acc.concat(r.salesorders || []);
        }, []);
        var seen = {};
        var combined = all.filter(function (so) {
          if (seen[so.salesorder_id]) return false;
          seen[so.salesorder_id] = true;
          return true;
        });
        combined.sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        });
        var orders = combined.map(function (so) {
          return {
            salesorder_id: so.salesorder_id || '',
            salesorder_number: so.salesorder_number || '',
            customer_name: so.customer_name || '',
            customer_id: so.customer_id || '',
            balance: so.balance || 0,
            total: so.total || 0,
            status: so.status || '',
            date: so.date || '',
            line_items: (so.line_items || []).map(function (li) {
              return {
                item_id: li.item_id || '',
                name: li.name || li.description || '',
                quantity: li.quantity || 1,
                rate: li.rate || 0,
                amount: li.amount || 0
              };
            })
          };
        });

        // Cache the full result (before search filtering)
        cache.set(KIOSK_SO_CACHE_KEY, orders, KIOSK_SO_CACHE_TTL).catch(function () {});

        return orders;
      });
    })
    .then(function (orders) {
      // Apply client-side search filter if provided
      if (search) {
        var needle = search.toLowerCase();
        orders = orders.filter(function (so) {
          return (so.customer_name || '').toLowerCase().indexOf(needle) !== -1;
        });
      }

      res.json({ salesorders: orders });
    })
    .catch(function (err) {
      log.error('[kiosk/salesorders] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch sales orders' });
    });
});

/**
 * POST /api/kiosk/salesorder-create
 * Create a new Sales Order in Zoho from the kiosk.
 *
 * Expected body:
 * {
 *   customer_id: "zoho_customer_id",
 *   items: [{ item_id: "id", name: "Name", quantity: 2, rate: 14.99 }],
 *   notes: "optional notes"
 * }
 *
 * Response: { ok, salesorder_id, salesorder_number, total, balance }
 */
router.post('/api/kiosk/salesorder-create', function (req, res) {
  var body = req.body || {};

  // Validate customer_id
  if (!body.customer_id || typeof body.customer_id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid customer_id' });
  }

  // Validate items array
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Items array is required and must not be empty' });
  }

  for (var i = 0; i < body.items.length; i++) {
    var item = body.items[i];
    if (!item.item_id || typeof item.item_id !== 'string') {
      return res.status(400).json({ error: 'Invalid item_id for item ' + i });
    }
    var qty = Number(item.quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + i });
    }
    var rate = Number(item.rate);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: 'Invalid rate for item ' + i });
    }
  }

  var payload = {
    customer_id: body.customer_id,
    date: new Date().toISOString().slice(0, 10),
    line_items: body.items.map(function (item) {
      return {
        item_id: item.item_id,
        quantity: item.quantity,
        rate: item.rate,
        name: item.name || ''
      };
    }),
    notes: body.notes || ''
  };

  log.info('[kiosk/so-create] Creating SO for customer=' + body.customer_id +
    ' items=' + body.items.length);

  zohoPost('/salesorders', payload)
    .then(function (data) {
      var so = data.salesorder || {};
      var soId = so.salesorder_id || '';
      var soNumber = so.salesorder_number || '';
      var total = so.total || 0;
      var balance = so.balance || 0;

      log.info('[kiosk/so-create] Created: ' + soNumber + ' id=' + soId);

      // Invalidate the salesorders cache
      cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});

      eventLog.logEvent('kiosk.salesorder_created', {
        soId: soId,
        soNumber: soNumber,
        itemCount: body.items.length,
        total: total
      });

      res.status(201).json({
        ok: true,
        salesorder_id: soId,
        salesorder_number: soNumber,
        total: total,
        balance: balance
      });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[kiosk/so-create] Zoho error: ' + msg);
      res.status(502).json({ error: 'Failed to create sales order' });
    });
});

/**
 * POST /api/kiosk/salesorder-pay
 * Collect payment on an existing Sales Order via the Helcim terminal.
 * Synchronous: pushes to terminal, polls for result, records payment in Zoho.
 *
 * Expected body:
 * {
 *   salesorder_id: "zoho_salesorder_id"
 * }
 *
 * Response: { ok, transaction_id, salesorder_number, amount, card_type }
 */
router.post('/api/kiosk/salesorder-pay', function (req, res) {
  var body = req.body || {};
  var soId = body.salesorder_id;

  // Validate salesorder_id
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
  }

  // Check terminal is available
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  // Fetch the Sales Order from Zoho
  zohoGet('/salesorders/' + soId)
    .then(function (data) {
      var so = data.salesorder || {};
      var balance = parseFloat(so.balance);
      var soNumber = so.salesorder_number || '';
      var customerId = so.customer_id || '';
      var orderStatus = (so.order_status || so.status || '').toLowerCase();

      // Guard: balance must be positive
      if (isNaN(balance) || balance <= 0) {
        return res.status(400).json({ error: 'No balance due on this order' });
      }

      // Guard: reject void/closed orders
      if (orderStatus === 'void' || orderStatus === 'closed') {
        return res.status(400).json({ error: 'Order is ' + orderStatus });
      }

      log.info('[kiosk/so-pay] Starting payment: soNumber=' + soNumber +
        ' amount=$' + balance.toFixed(2));

      // Push payment to terminal
      var TERMINAL_TIMEOUT_MS = 90000;
      var POLL_INTERVAL_MS = 5000;
      var idempotencyKey = helcimLib.generateIdempotencyKey();

      helcimLib.terminalPurchase(balance, soNumber, idempotencyKey)
        .then(function () {
          log.info('[kiosk/so-pay] Terminal push sent: soNumber=' + soNumber);

          // Poll for result — same pattern as /api/kiosk/sale
          var pollStart = Date.now();
          function poll() {
            return helcimLib.pollTerminalResult(soNumber).then(function (result) {
              if (result.approved) {
                return result;
              }
              if (result.status === 'DECLINED') {
                var declineErr = new Error('Payment declined');
                declineErr.isDeclined = true;
                throw declineErr;
              }
              if (Date.now() - pollStart >= TERMINAL_TIMEOUT_MS) {
                throw new Error('Terminal timeout after 90s');
              }
              // Still pending — wait and retry
              return new Promise(function (resolve) {
                setTimeout(function () { resolve(poll()); }, POLL_INTERVAL_MS);
              });
            });
          }

          return poll();
        })
        .then(function (termResponse) {
          if (!termResponse.approved) {
            log.warn('[kiosk/so-pay] Terminal declined: soNumber=' + soNumber);
            return res.status(402).json({
              error: 'Payment declined',
              code: 'DECLINED'
            });
          }

          var txnId = termResponse.transactionId || '';
          log.info('[kiosk/so-pay] Terminal approved: txn=' + txnId +
            ' soNumber=' + soNumber);

          // Record payment in Zoho
          var today = new Date().toISOString().slice(0, 10);
          var cardType = (termResponse.cardType || '').toLowerCase();
          var paymentMode = (cardType.indexOf('debit') !== -1) ? 'debitcard' : 'creditcard';

          zohoPost('/customerpayments', {
            customer_id: customerId,
            payment_mode: paymentMode,
            amount: balance,
            date: today,
            reference_number: txnId || soNumber,
            salesorders_to_apply: [{ salesorder_id: soId, amount_applied: balance }],
            notes: 'Kiosk SO payment. Terminal txn: ' + txnId
          })
            .then(function () {
              log.info('[kiosk/so-pay] Payment recorded for ' + soNumber);

              // Invalidate SO cache
              cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});

              eventLog.logEvent('kiosk.salesorder_payment', {
                soId: soId,
                soNumber: soNumber,
                txnId: txnId,
                amount: balance
              });

              // D-02: Create invoice from SO for stock deduction
              var invoiceFromSoChain = zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})
                .then(function (invoiceData) {
                  var invoice = (invoiceData && invoiceData.invoice) || {};
                  var invoiceId = invoice.invoice_id || '';
                  log.info('[kiosk/so-pay] Invoice created from SO: ' + (invoice.invoice_number || '') + ' id=' + invoiceId);
                  if (invoiceId) {
                    return zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function (submitErr) {
                      log.warn('[kiosk/so-pay] Invoice submit failed (non-fatal): ' + submitErr.message);
                    });
                  }
                })
                .catch(function (invErr) {
                  // Non-fatal: SO is paid, but invoice creation failed
                  // Stock won't auto-decrement until next Zoho reconcile
                  log.error('[kiosk/so-pay] Invoice from SO failed (non-fatal): ' + invErr.message);
                });

              invoiceFromSoChain.then(function () {
                // Bust kiosk products cache so stock reflects after invoice submit
                cache.del(KIOSK_PRODUCTS_CACHE_KEY).catch(function () {});

                res.json({
                  ok: true,
                  transaction_id: txnId,
                  salesorder_number: soNumber,
                  amount: balance,
                  card_type: paymentMode
                });
              });
            })
            .catch(function (payErr) {
              // Zoho payment recording failed after terminal approval — void
              var payMsg = payErr.message;
              if (payErr.response && payErr.response.data) {
                payMsg = payErr.response.data.message || payErr.response.data.error || payMsg;
              }
              log.error('[kiosk/so-pay] Payment recording failed after terminal approval — voiding txn=' + txnId + ': ' + payMsg);

              eventLog.logEvent('kiosk.so_pay_failed_after_charge', {
                soId: soId,
                soNumber: soNumber,
                txnId: txnId,
                amount: balance
              });

              helcimLib.voidTransaction(txnId)
                .then(function () {
                  log.info('[kiosk/so-pay] Voided txn=' + txnId + ' after payment recording failure');
                })
                .catch(function (voidErr) {
                  log.error('[kiosk/so-pay] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
                  var failRecord = {
                    txnId: txnId,
                    amount: balance,
                    timestamp: new Date().toISOString(),
                    error: voidErr.message,
                    needs_manual_review: true
                  };
                  cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30)
                    .catch(function (redisErr) {
                      log.error('[kiosk/so-pay] CRITICAL: Failed to persist void-failure record: ' + redisErr.message);
                    });
                  mailer.sendVoidFailureAlert({
                    txnId: txnId,
                    amount: balance,
                    error: voidErr.message,
                    timestamp: failRecord.timestamp
                  }).catch(function (mailErr) {
                    log.error('[kiosk/so-pay] Void failure alert email failed: ' + mailErr.message);
                  });
                })
                .then(function () {
                  if (res.headersSent) return;
                  res.status(502).json({
                    error: 'Payment was taken but could not be recorded against the order. Please contact support.',
                    payment_voided: true,
                    voided_transaction_id: txnId
                  });
                });
            });
        })
        .catch(function (termErr) {
          if (termErr.message === 'Terminal timeout after 90s') {
            log.warn('[kiosk/so-pay] Terminal timed out after 90s — no txn to void');
            return res.status(504).json({ error: 'Terminal did not respond in time. Please try again.' });
          }
          if (termErr.isDeclined) {
            return res.status(402).json({ error: 'Payment declined', code: 'DECLINED' });
          }
          log.error('[kiosk/so-pay] Terminal error: ' + termErr.message);
          if (!res.headersSent) {
            res.status(502).json({ error: 'Terminal error — please try again' });
          }
        });
    })
    .catch(function (err) {
      var status = err.status || (err.response && err.response.status) || 502;
      if (status === 404 || (err.response && err.response.status === 404)) {
        log.error('[kiosk/so-pay] Sales order not found: soId=' + soId);
        return res.status(404).json({ error: 'Sales order not found' });
      }
      log.error('[kiosk/so-pay] Failed to fetch SO: ' + err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to process sales order payment' });
      }
    });
});

/**
 * PUT /api/kiosk/salesorder-update
 * Update line items on an existing Sales Order in Zoho.
 * Called before terminal payment when cart was imported from an SO.
 *
 * Expected body:
 * {
 *   salesorder_id: "zoho_so_id",
 *   items: [{ item_id, name, quantity, rate }]
 * }
 *
 * Response: { ok, salesorder_id, salesorder_number, total, balance }
 */
router.put('/api/kiosk/salesorder-update', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var body = req.body || {};

  var soId = body.salesorder_id;
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Items array is required and must not be empty' });
  }
  for (var i = 0; i < body.items.length; i++) {
    var item = body.items[i];
    if (!item.item_id || typeof item.item_id !== 'string') {
      return res.status(400).json({ error: 'Invalid item_id for item ' + i });
    }
    var qty = Number(item.quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + i });
    }
    var rate = Number(item.rate);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: 'Invalid rate for item ' + i });
    }
  }

  var payload = {
    line_items: body.items.map(function (item) {
      return {
        item_id: item.item_id,
        quantity: item.quantity,
        rate: item.rate,
        name: item.name || ''
      };
    })
  };

  log.info('[kiosk/so-update] Updating SO=' + soId + ' items=' + body.items.length);

  zohoPut('/salesorders/' + soId, payload)
    .then(function (data) {
      var so = data.salesorder || {};
      cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});
      eventLog.logEvent('kiosk.salesorder_updated', {
        soId: soId,
        soNumber: so.salesorder_number || '',
        itemCount: body.items.length
      });
      res.json({
        ok: true,
        salesorder_id: soId,
        salesorder_number: so.salesorder_number || '',
        total: so.total || 0,
        balance: so.balance || 0
      });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[kiosk/so-update] Zoho error: ' + msg);
      res.status(502).json({ error: 'Failed to update sales order' });
    });
});

// Phase 7: Sync batch status to Zoho invoice custom field (D-01, D-02, D-03)
router.post('/api/batch/sync-zoho', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var body = req.body || {};
  var soId = body.so_id;
  var batchId = body.batch_id;
  var status = body.status;

  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid so_id' });
  }
  if (!batchId || typeof batchId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid batch_id' });
  }
  var validStatuses = ['pending', 'active', 'complete'];
  if (!status || validStatuses.indexOf(status) === -1) {
    return res.status(400).json({ error: 'Invalid status — must be one of: ' + validStatuses.join(', ') });
  }

  brewpadIntegration.syncBatchToZoho(soId, batchId, status)
    .then(function (result) {
      res.json(result);
    })
    .catch(function (err) {
      log.error('[batch/sync-zoho] Unexpected error: ' + err.message);
      res.status(500).json({ ok: false, error: 'Internal error' });
    });
});

// Phase 7: Search invoices for batch linking (D-04)
router.get('/api/batch/search-invoices', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var search = (req.query.search || '').trim();
  if (!search || search.length < 2) {
    return res.status(400).json({ error: 'Search term must be at least 2 characters' });
  }

  zohoGet('/invoices?search_text=' + encodeURIComponent(search))
    .then(function (data) {
      var invoices = (data.invoices || []).map(function (inv) {
        return {
          invoice_id: inv.invoice_id,
          invoice_number: inv.invoice_number,
          customer_name: inv.customer_name,
          customer_id: inv.customer_id || '',
          date: inv.date || '',
          line_items: inv.line_items || []
        };
      });
      res.json({ invoices: invoices });
    })
    .catch(function (err) {
      log.error('[batch/search-invoices] Zoho error: ' + (err.message || err));
      res.status(502).json({ error: 'Invoice search failed' });
    });
});

/**
 * GET /api/kiosk/salesorder/:id
 * Fetch a single Sales Order detail from Zoho, including line_items.
 * The list endpoint (/salesorders) does not return line_items.
 */
router.get('/api/kiosk/salesorder/:id', function (req, res) {
  var soId = req.params.id;
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
  }

  zohoGet('/salesorders/' + soId)
    .then(function (data) {
      var so = data.salesorder || {};
      res.json({
        salesorder_id: so.salesorder_id || '',
        salesorder_number: so.salesorder_number || '',
        customer_name: so.customer_name || '',
        customer_id: so.customer_id || '',
        balance: so.balance || 0,
        total: so.total || 0,
        status: so.status || '',
        date: so.date || '',
        line_items: (so.line_items || []).map(function (li) {
          return {
            item_id: li.item_id || '',
            name: li.name || li.description || '',
            quantity: li.quantity || 1,
            rate: li.rate || 0,
            amount: li.item_total || li.amount || 0
          };
        })
      });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[kiosk/so-detail] Zoho error: ' + msg);
      res.status(502).json({ error: 'Failed to fetch sales order' });
    });
});

module.exports = router;
