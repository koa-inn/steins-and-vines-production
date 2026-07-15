var express = require('express');
var axios = require('axios');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var authTiers = require('../lib/authTiers');
var mailer = require('../lib/mailer');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');
var discountMatch = require('../lib/discount-match');
var buildContactPayload = require('../lib/checkout-helpers').buildContactPayload;
var moneyPath = require('../lib/money-path');
var captureExceptionSafe = require('../lib/sentry-capture').captureExceptionSafe;

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var zohoPut = zohoApi.zohoPut;

var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
var RECENT_ORDERS_CACHE_KEY = C.CACHE_KEYS.RECENT_ORDERS;
var RECENT_ORDERS_CACHE_TTL = 60; // seconds
var IDEMPOTENCY_KEY_TTL = 300; // 5 minutes in seconds
// D-13: pending-charge records live 7 days so the reconciliation backstop (45-08) can find them.
var KIOSK_PENDING_CHARGE_TTL = 604800;

var crypto = require('crypto');

var _TAX_RULE_PCT = {};
_TAX_RULE_PCT[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 12;
_TAX_RULE_PCT[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 0;
_TAX_RULE_PCT[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 5;
_TAX_RULE_PCT[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 15;

var router = express.Router();

// Resolve the 5% GST tax_id needed for taxable custom lines (D-02).
// Resolution order: (1) process.env.KIOSK_GST_TAX_ID; (2) auto-discover from
// KIOSK_PRODUCTS_CACHE_KEY catalog — find an item whose sales_tax_rule_id ===
// ZOHO_TAX_SERVICES_RULE and reuse its tax_id; (3) return null (caller fail-closes).
function resolveGstTaxId(catalogMap) {
  if (process.env.KIOSK_GST_TAX_ID) return process.env.KIOSK_GST_TAX_ID;
  var serviceRule = process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417';
  var ids = Object.keys(catalogMap || {});
  for (var i = 0; i < ids.length; i++) {
    var item = catalogMap[ids[i]];
    if (item && item.sales_tax_rule_id === serviceRule && item.tax_id) {
      return item.tax_id;
    }
  }
  return null;
}

// Resolve and apply a discount preset to lineItems.
// Returns a promise that resolves to { discountApplied, subtotal } or
// { error, status } if validation fails. Resolves to null if no discount.
//
// scope 'cart' → applies to every line. scope 'type' → applies only to lines
// whose product type (classified server-side via catalogMap) matches the
// preset's applies_to tokens. Legacy 'item' scope is no longer supported.
function resolveDiscount(body, lineItems, subtotal, catalogMap) {
  if (!body.discount || !body.discount.preset_id) return Promise.resolve(null);
  catalogMap = catalogMap || {};

  return cache.get(C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS).then(function (presets) {
    presets = Array.isArray(presets) ? presets : [];
    var preset = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === body.discount.preset_id) { preset = presets[i]; break; }
    }
    if (!preset) return { error: 'Discount preset not found', status: 400 };
    if (!preset.active) return { error: 'Discount preset is inactive', status: 400 };

    var discountApplied = null;

    if (preset.scope === 'cart') {
      if (preset.type === 'percentage') {
        lineItems.forEach(function (li) {
          if (li.custom || li.gift_cert) return; // D-08: custom/gift_cert lines excluded from all discounts
          li.discount = preset.value + '%';
        });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'percentage', value: preset.value, scope: 'cart' };
      } else {
        var fixedAmount = Math.min(preset.value, subtotal);
        lineItems.forEach(function (li) {
          if (li.custom || li.gift_cert) return; // D-08: custom/gift_cert lines excluded from all discounts
          var lineTotal = li.quantity * li.rate;
          var share = subtotal > 0 ? Math.round(fixedAmount * (lineTotal / subtotal) * 100) / 100 : 0;
          li.discount = share;
        });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'fixed', value: fixedAmount, scope: 'cart' };
      }
    } else if (preset.scope === 'type') {
      // Classify each line via the authoritative catalog and discount only matches.
      var matchedSubtotal = 0;
      var matchFlags = lineItems.map(function (li) {
        if (li.custom || li.gift_cert) return false; // D-08: custom/gift_cert lines excluded from all discounts
        var tokens = discountMatch.classifyCatalogItem(catalogMap[li.item_id]);
        var m = discountMatch.matches(tokens, preset.applies_to);
        if (m) matchedSubtotal += li.quantity * li.rate;
        return m;
      });
      matchedSubtotal = Math.round(matchedSubtotal * 100) / 100;

      if (preset.type === 'percentage') {
        lineItems.forEach(function (li, idx) {
          if (matchFlags[idx]) li.discount = preset.value + '%';
        });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'percentage', value: preset.value, scope: 'type', applies_to: preset.applies_to };
      } else {
        var fixedType = Math.min(preset.value, matchedSubtotal);
        lineItems.forEach(function (li, idx) {
          if (!matchFlags[idx]) return;
          var lineTotal = li.quantity * li.rate;
          var share = matchedSubtotal > 0 ? Math.round(fixedType * (lineTotal / matchedSubtotal) * 100) / 100 : 0;
          li.discount = share;
        });
        discountApplied = { preset_id: preset.id, name: preset.name, type: 'fixed', value: fixedType, scope: 'type', applies_to: preset.applies_to };
      }
    } else {
      return { error: 'Unsupported discount scope — please recreate this preset', status: 400 };
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
    // Gift cert lines are zero-tax (D-03) — item's own EXEMPT setting; no catalog lookup.
    if (li.gift_cert) { return; }
    // Custom lines carry their own tax_percentage (5 or 0) — skip catalog lookup.
    if (li.custom) {
      var customLineTotal = li.quantity * li.rate;
      if (li.discount) {
        if (typeof li.discount === 'string' && li.discount.indexOf('%') !== -1) {
          customLineTotal = customLineTotal * (1 - parseFloat(li.discount) / 100);
        } else {
          customLineTotal = customLineTotal - Number(li.discount);
        }
      }
      customLineTotal = Math.max(customLineTotal, 0);
      taxTotal += customLineTotal * ((li.tax_percentage || 0) / 100);
      return;
    }
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

  // D-12: idempotency_key is required in production (fail-closed-in-prod pattern);
  // falls through to non-atomic flow without a key in non-prod for backward compat.
  var idempotencyKey = (body && typeof body.idempotency_key === 'string' && body.idempotency_key)
    ? C.CACHE_KEYS.KIOSK_IDEM_PREFIX + body.idempotency_key.slice(0, 128)
    : null;

  if (!idempotencyKey && process.env.NODE_ENV === 'production') {
    return res.status(400).json({ error: 'idempotency_key is required' });
  }

  if (idempotencyKey) {
    // D-12: atomic idempotency lock via shared money-path primitive (replaces non-atomic get-then-set)
    return moneyPath.acquireIdempotencyLock(cache, idempotencyKey, IDEMPOTENCY_KEY_TTL)
      .then(function (lockResult) {
        if (lockResult.status === 'replay') {
          log.info('[pos/kiosk/sale] Idempotent replay: ' + idempotencyKey);
          return res.status(201).json(lockResult.cached);
        }
        if (lockResult.status === 'contention' || lockResult.status === 'failclosed') {
          return res.status(409).json({ error: 'Sale already in progress — please wait and check your order before retrying' });
        }
        // status === 'acquired' — proceed
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
    if (vi.custom) {
      // Custom line validation (D-05, T-43-01)
      var vDesc = typeof vi.description === 'string' ? vi.description.trim() : '';
      if (vDesc.length < 1 || vDesc.length > 100) {
        return res.status(400).json({ error: 'Custom line description must be 1-100 characters for item ' + v });
      }
      var vRate = Number(vi.rate);
      if (!isFinite(vRate)) {
        return res.status(400).json({ error: 'Custom line rate must be a number for item ' + v });
      }
      if (Math.abs(vRate) > 10000) {
        return res.status(400).json({ error: 'Custom line rate exceeds maximum allowed magnitude ($10,000) for item ' + v });
      }
      var vQtyC = Number(vi.quantity);
      if (!isFinite(vQtyC) || !Number.isInteger(vQtyC) || vQtyC <= 0 || vQtyC > 100) {
        return res.status(400).json({ error: 'Custom line quantity must be an integer 1-100 for item ' + v });
      }
      continue;
    }
    if (vi.gift_cert) continue; // gift_cert lines have no catalog item_id; validated below
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
    // Custom and gift_cert lines bypass this check — their rate is bounded server-side.
    for (var ci = 0; ci < body.items.length; ci++) {
      var cItem = body.items[ci];
      if (cItem.custom) continue; // custom lines have no item_id — skip catalog check
      if (cItem.gift_cert) continue; // gift_cert lines have no catalog item_id — handled below
      if (catalogMap[cItem.item_id] === undefined) {
        return res.status(400).json({
          error: 'Item not found in current catalog: ' + cItem.item_id +
            '. Refresh the product list and try again.'
        });
      }
    }

    // Fail-closed guard: if any gift_cert line is present, KIOSK_GIFT_CARD_ITEM_ID must be set
    // (T-44-G4 — mirrors the issue route guard).
    if (body.items.some(function (i) { return i.gift_cert === true; }) &&
        !process.env.KIOSK_GIFT_CARD_ITEM_ID) {
      log.warn('[pos/kiosk/sale] gift_cert line rejected — KIOSK_GIFT_CARD_ITEM_ID not configured');
      return res.status(503).json({ error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)' });
    }

    // Validate gift_cert line fields before building lineItems (cannot return inside .map).
    for (var gcv = 0; gcv < body.items.length; gcv++) {
      var gcItem = body.items[gcv];
      if (!gcItem.gift_cert) continue;
      var gcCertNum = String(gcItem.cert_number || '').trim().toUpperCase();
      if (!/^GC-\d{6}$/.test(gcCertNum)) {
        return res.status(400).json({ error: 'gift_cert cert_number must match GC-NNNNNN format (e.g. GC-000042)' });
      }
      var gcRate = Number(gcItem.rate);
      if (!isFinite(gcRate) || gcRate <= 0 || gcRate > 2000) {
        return res.status(400).json({ error: 'gift_cert rate must be between $0.01 and $2000' });
      }
    }

    // Pre-resolve GST tax_id for any taxable custom lines (D-02 fail-closed).
    // Must happen before the lineItems builder to avoid returning inside .map().
    var needGstTaxId = body.items.some(function (item) {
      return item.custom && item.taxable !== false;
    });
    var gstTaxId = null;
    if (needGstTaxId) {
      gstTaxId = resolveGstTaxId(catalogMap);
      if (!gstTaxId) {
        return res.status(400).json({
          error: 'Cannot tax this custom line: no GST tax rate configured. Mark the line tax-exempt or set KIOSK_GST_TAX_ID.'
        });
      }
    }

    // Build line items using catalog price, ignoring client-supplied rate
    // D-03: Include per-item tax_id from catalog so Zoho computes tax using its rules
    var subtotal = 0;
    var lineItems = body.items.map(function (item) {
      if (item.custom) {
        // Custom line: rate is staff-entered (bounded by validation above)
        var qty = Number(item.quantity) || 1;
        var rate = Number(item.rate);
        subtotal += qty * rate;
        var taxable = item.taxable !== false;
        var desc = String(item.description || '').trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
        var note = String(item.note || '').trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
        var fullDesc = note ? (desc + ' — ' + note) : desc;
        var li = {
          custom: true,
          description: fullDesc,
          rate: rate,
          quantity: qty,
          tax_percentage: taxable ? 5 : 0
        };
        if (taxable) {
          li.tax_id = gstTaxId;
        } else if (process.env.ZOHO_TAX_ZERO_ID) {
          // F3 (45-09): exempt custom lines have no backing Zoho item — tag with
          // the explicit Zero Rate tax so Zoho does not default-tax them. Mirrors
          // the confirm path; keeps /sale and the invoice in agreement.
          li.tax_id = process.env.ZOHO_TAX_ZERO_ID;
        }
        return li;
      }
      // Gift cert line (Phase 44-09): server-authoritative item_id, zero-tax (D-03, T-44-G1).
      // Client-supplied item_id is ignored; face value / reload amount validated above.
      if (item.gift_cert) {
        var gcCertNumSale = String(item.cert_number || '').trim().toUpperCase();
        var gcRateSale = Number(item.rate);
        var gcNameSale = item.gift_action === 'reload'
          ? 'Gift Certificate Reload ' + gcCertNumSale
          : 'Gift Certificate ' + gcCertNumSale;
        subtotal += gcRateSale;
        return {
          gift_cert: true,
          gift_action: item.gift_action || 'issue',
          cert_number: gcCertNumSale,
          item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID, // server-authoritative (D-05)
          name: gcNameSale,
          quantity: 1,
          rate: gcRateSale
          // NO tax_id — item carries its own EXEMPT setting (D-03)
        };
      }
      var qty = Number(item.quantity) || 1;
      var catalogItem = catalogMap[item.item_id];
      var rate = catalogItem.rate; // authoritative price from catalog
      subtotal += qty * rate;
      var li = {
        item_id: item.item_id,
        name: item.name || '',
        sku: catalogItem.sku || '',
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
    resolveDiscount(body, lineItems, subtotal, catalogMap).then(function (discResult) {
      if (discResult && discResult.error) {
        return res.status(discResult.status).json({ error: discResult.error });
      }
      if (discResult) {
        subtotal = discResult.subtotal;
      }

      var taxTotal = computeTax(lineItems, catalogMap);
      var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;

      processSaleWithPrices(body, idempotencyKey, req, res,
        lineItems, subtotal, taxTotal, grandTotal);
    });
  }).catch(function (cacheErr) {
    log.error('[pos/kiosk/sale] Catalog cache read failed: ' + cacheErr.message);
    res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
  });
}

function processSaleWithPrices(body, idempotencyKey, req, res,
  lineItems, subtotal, taxTotal, grandTotal) {

  if (grandTotal <= 0) {
    return res.status(400).json({ error: 'Sale total must be greater than zero' });
  }
  if (grandTotal > 10000) {
    return res.status(400).json({ error: 'Sale total exceeds maximum' });
  }

  // --- Gift card split-tender (Phase 44 / D-12 hardened in 45-07) ---
  // D-05: amount_applied is clamped to grandTotal server-side; client cannot over-apply.
  // D-03/R-03: tax is never recomputed — gift_amount subtracts only from post-tax grandTotal.
  // D-12 (45-07): gcApplied is further clamped to the certificate's REAL server-side balance
  //   via an Apps Script lookup BEFORE the terminal is charged.  Fails open: if the lookup
  //   is unavailable, the client-submitted (grandTotal-clamped) amount is used.
  var gift_amount_submitted = 0;
  var gift_cert_number = '';
  if (body.gift_card && body.gift_card.cert_number) {
    gift_amount_submitted = Math.min(
      Math.max(Number(body.gift_card.amount_applied) || 0, 0),
      grandTotal
    );
    gift_cert_number = String(body.gift_card.cert_number).trim().toUpperCase().slice(0, 20);
  }

  // CR-02 (45): look up real balance before charging the terminal.
  // Returns a discriminated result:
  //   { state: 'ok', balance: N } — cert valid, balance known; clamp applied amount
  //   { state: 'invalid' }        — Apps Script reports ok:false → hard reject (400)
  //   { state: 'unavailable' }    — network/timeout error → 503 in prod, fail-open in non-prod
  //   null                        — no lookup needed (no gift card or Apps Script not configured)
  var _gcAsUrl   = process.env.APPS_SCRIPT_URL;
  var _gcAsToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
  var gcRealBalanceLookup = Promise.resolve(null);
  if (gift_amount_submitted > 0 && gift_cert_number && _gcAsUrl && _gcAsToken) {
    gcRealBalanceLookup = Promise.resolve(
      axios.post(_gcAsUrl, JSON.stringify({
        action:       'lookup_gift_card',
        server_token: _gcAsToken,
        cert_number:  gift_cert_number
      }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
    )
    .then(function (resp) {
      var r = (resp && resp.data) || {};
      if (r.ok === true && r.data && typeof r.data.current_balance === 'number') {
        return { state: 'ok', balance: r.data.current_balance };
      }
      // Apps Script explicitly reported ok:false → cert invalid or not found
      if (r.ok === false) { return { state: 'invalid' }; }
      // ok:true but no balance data (Apps Script misconfigured or returned partial response)
      return { state: 'unavailable' };
    })
    .catch(function (lookupErr) {
      log.warn('[pos/kiosk/sale] gift-card balance lookup failed: ' + (lookupErr && lookupErr.message));
      return { state: 'unavailable' };
    });
  }

  return gcRealBalanceLookup.then(function (gcLookup) {
    // CR-02: discriminated result handling
    if (gcLookup !== null) {
      if (gcLookup.state === 'invalid') {
        return res.status(400).json({ error: 'Gift card not found or has insufficient balance' });
      }
      if (gcLookup.state === 'unavailable') {
        if (process.env.NODE_ENV === 'production') {
          return res.status(503).json({ error: 'Gift card validation temporarily unavailable' });
        }
        // non-prod: fail-open, use submitted amount
        log.warn('[pos/kiosk/sale] gift-card lookup unavailable (non-prod fail-open): cert=' + gift_cert_number);
      }
    }
    var gift_amount = gift_amount_submitted;
    if (gcLookup && gcLookup.state === 'ok' && gift_amount > gcLookup.balance) {
      log.warn('[pos/kiosk/sale] gcApplied clamped to realBalance: submitted=' + gift_amount +
        ' realBalance=' + gcLookup.balance + ' cert=' + gift_cert_number);
      gift_amount = Math.min(gcLookup.balance, grandTotal);
    }

  var terminal_amount = Math.round((grandTotal - gift_amount) * 100) / 100;

  var refNumber = (body.reference_number && typeof body.reference_number === 'string')
    ? body.reference_number.slice(0, 64)
    : ('KIOSK-' + Date.now());

  if (terminal_amount > 0) {
    log.info('[pos/kiosk/sale] Pushing to terminal: total=$' + terminal_amount.toFixed(2) +
      ' ref=' + refNumber + ' items=' + lineItems.length +
      (gift_amount > 0 ? ' gift_card=$' + gift_amount.toFixed(2) : ''));

    // D-12: derive Helcim terminal idempotency key deterministically from the client
    // idempotency_key so retries reuse the same Helcim key (no double terminal charge).
    // When no client key is provided, pass null so helcimLib generates a random key.
    var helcimIdemKey = (body.idempotency_key && typeof body.idempotency_key === 'string')
      ? crypto.createHash('sha256').update(body.idempotency_key).digest('hex').substring(0, 25)
      : null;

    helcimLib.terminalPurchase(terminal_amount, refNumber, helcimIdemKey)
      .then(function () {
        var responseBody = {
          pending: true,
          reference: refNumber
        };

        // D-13 (45-07): persist pending-charge context for the reconciliation backstop (45-08).
        // Written fire-and-forget after every successful push so a client-side timeout
        // leaves a reconcilable trail.  Key = KIOSK_PENDING_CHARGE_PREFIX + refNumber.
        var pendingCacheKey = C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + refNumber;
        var pendingContext = {
          reference_number: refNumber,
          amount:           terminal_amount,
          idempotency_key:  (body.idempotency_key && typeof body.idempotency_key === 'string')
                              ? body.idempotency_key : null,
          created_at:       new Date().toISOString()
        };
        cache.set(pendingCacheKey, pendingContext, KIOSK_PENDING_CHARGE_TTL).catch(function () {});

        var cacheWrite = idempotencyKey
          ? cache.set(idempotencyKey, responseBody, IDEMPOTENCY_KEY_TTL).catch(function () {})
          : Promise.resolve();

        return cacheWrite.then(function () {
          res.status(202).json(responseBody);
        });
      })
      .catch(function (termErr) {
        log.error('[pos/kiosk/sale] Terminal push failed: ' + termErr.message);
        // WR-03: release idempotency lock so the client can retry.  The terminal
        // push failed and NO charge was recorded — it's safe to allow a retry under
        // a fresh lock.  Do NOT release the lock when a charge may have succeeded
        // (i.e., polled OK then failed) — that case doesn't reach this catch.
        if (idempotencyKey) {
          cache.releaseLock(idempotencyKey).catch(function () {});
        }
        res.status(502).json({ error: 'Terminal error — please try again' });
      });
  } else {
    // Gift card covers 100% — skip terminal entirely.
    // Return a non-pending response so the client proceeds directly to confirm.
    log.info('[pos/kiosk/sale] Gift card covers 100% ($' + grandTotal.toFixed(2) +
      ') — skipping terminal. ref=' + refNumber + ' cert=' + gift_cert_number);

    var gcOnlyResponseBody = {
      pending: false,
      gift_card_only: true,
      reference: refNumber
    };

    var gcCacheWrite = idempotencyKey
      ? cache.set(idempotencyKey, gcOnlyResponseBody, IDEMPOTENCY_KEY_TTL).catch(function () {})
      : Promise.resolve();

    gcCacheWrite.then(function () {
      res.status(202).json(gcOnlyResponseBody);
    });
  }
  }); // end gcRealBalanceLookup.then (D-12 balance validation)
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

  // D-15: guard length BEFORE timingSafeEqual — different-length buffers cause a RangeError,
  // which Express surfaces as a 500 on every login (staff lockout).
  // Length is not secret; comparing lengths first is safe (mirrors lib/apiKey.js:34).
  if (!process.env.KIOSK_PIN || process.env.KIOSK_PIN.length !== pin.length) {
    return res.status(503).json({ ok: false, error: 'PIN not configured' });
  }

  var match = crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(process.env.KIOSK_PIN));
  if (match) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid PIN' });
});

// 57-01: durable telemetry sink for the kiosk client-error beacon. The kiosk POSTs
// here from its failure catch handlers so the real error (text/status/endpoint/auth
// state) is captured to Sentry BEFORE staff tap Retry and it vanishes. This route
// accepts client-authored strings from the shop-floor iPad, so it treats the body as
// hostile: only the six whitelisted fields are read; the message is scrubbed for
// log-injection control chars and any 13-19 digit run (potential PAN) is redacted;
// nothing else in the body is ever forwarded. It returns 204 with no body and has no
// money/data side-effect. Device-token gated (KIOSK_ROUTES) + rate-limited (server.js
// clientErrorLimiter). Threats T-57-01..05.
function scrubClientErrorText(value, maxLen) {
  var s = typeof value === 'string' ? value : String(value == null ? '' : value); // eslint-disable-line eqeqeq -- intentional == null matches undefined too
  // Redact any run of 13-19 digits (card-number shape) before anything else.
  s = s.replace(/\d{13,19}/g, '[REDACTED]');
  // Strip CR/LF and other C0/C1 control characters (log injection).
  s = s.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  s = s.slice(0, maxLen || 500);
  return s;
}

router.post('/api/kiosk/client-error', function (req, res) {
  var body = req.body || {};
  var message = scrubClientErrorText(body.message, 500);
  var endpoint = scrubClientErrorText(body.endpoint, 120);
  var authState = scrubClientErrorText(body.auth_state, 40);
  var userAgent = scrubClientErrorText(body.user_agent, 200);
  var clientTimestamp = scrubClientErrorText(body.timestamp, 40);
  var httpStatus = (typeof body.http_status === 'number' && isFinite(body.http_status))
    ? body.http_status : null;

  captureExceptionSafe(new Error(message), {
    level: 'error',
    tags: {
      source: 'kiosk-client',
      endpoint: endpoint,
      http_status: httpStatus,
      auth_state: authState
    },
    extra: { user_agent: userAgent, client_timestamp: clientTimestamp }
  });

  log.warn('[pos/kiosk/client-error] ' + endpoint + ' status=' + httpStatus +
    ' auth=' + authState + ' :: ' + message);

  return res.status(204).end();
});

router.post('/api/kiosk/sale/confirm', function (req, res) {
  var body = req.body;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // Confirm-level idempotency (T-44-G2, D-12): prevents double invoice / double activation on replay.
  // Uses a 'confirm:' prefix so it never collides with the sale endpoint's cached 202.
  //
  // CR-01 fix: derive the seed from body.idempotency_key first, then fall back to
  // body.transaction_id, then body.reference_number.  NEVER bare-400 after a charge:
  // a 400 here when the terminal has already run → orphan charge (money taken, no invoice).
  // If no seed is derivable at all, fall through to runConfirm so the void-on-failure
  // path can run (it checks body.transaction_id and voids if set).
  var _confirmSeed = (typeof body.idempotency_key === 'string' && body.idempotency_key)
    ? body.idempotency_key
    : (typeof body.transaction_id === 'string' && body.transaction_id)
      ? body.transaction_id
      : (typeof body.reference_number === 'string' && body.reference_number)
        ? body.reference_number
        : null;
  var confirmIdemKey = _confirmSeed
    ? C.CACHE_KEYS.KIOSK_IDEM_PREFIX + 'confirm:' + String(_confirmSeed).slice(0, 128)
    : null;

  if (confirmIdemKey) {
    // D-12: atomic idempotency lock via shared money-path primitive (replaces non-atomic get-then-set)
    return moneyPath.acquireIdempotencyLock(cache, confirmIdemKey, IDEMPOTENCY_KEY_TTL)
      .then(function (lockResult) {
        // Only short-circuit on replay when the cached value is a well-formed confirm response.
        // Guards against test mocks that return non-null for all cache keys (catalog arrays, etc.)
        // and against corrupt/stale cache entries.  Only successful confirms are ever cached here.
        if (lockResult.status === 'replay' && lockResult.cached &&
            typeof lockResult.cached === 'object' && !Array.isArray(lockResult.cached) &&
            lockResult.cached.ok === true) {
          log.info('[pos/kiosk/sale/confirm] Idempotent replay: ' + confirmIdemKey);
          return res.status(201).json(lockResult.cached);
        }
        if (lockResult.status === 'contention' || lockResult.status === 'failclosed') {
          return res.status(409).json({ error: 'Confirm already in progress — please wait before retrying' });
        }
        // status === 'acquired', or replay with invalid cached data — proceed to confirm
        runConfirm(body, confirmIdemKey, req, res);
      });
  }

  runConfirm(body, null, req, res);
});

function runConfirm(body, confirmIdemKey, req, res) {
  cache.get(KIOSK_PRODUCTS_CACHE_KEY).then(function (catalog) {
    var catalogMap = {};
    if (Array.isArray(catalog)) {
      catalog.forEach(function (p) {
        if (p && p.item_id) catalogMap[p.item_id] = p;
      });
    }

    for (var ci = 0; ci < body.items.length; ci++) {
      if (body.items[ci].custom) continue; // custom lines bypass catalog check
      if (body.items[ci].gift_cert) continue; // gift_cert lines bypass catalog check
      if (catalogMap[body.items[ci].item_id] === undefined) {
        return res.status(400).json({ error: 'Item not found in catalog. Refresh and try again.' });
      }
    }

    // Fail-closed guard: gift_cert lines require KIOSK_GIFT_CARD_ITEM_ID (T-44-G4)
    if (body.items.some(function (i) { return i.gift_cert === true; }) &&
        !process.env.KIOSK_GIFT_CARD_ITEM_ID) {
      log.warn('[pos/kiosk/sale/confirm] gift_cert line rejected — KIOSK_GIFT_CARD_ITEM_ID not configured');
      return res.status(503).json({ error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)' });
    }

    // Validate gift_cert lines before building lineItems
    for (var gcvC = 0; gcvC < body.items.length; gcvC++) {
      var gcItemC = body.items[gcvC];
      if (!gcItemC.gift_cert) continue;
      var gcCertNumC = String(gcItemC.cert_number || '').trim().toUpperCase();
      if (!/^GC-\d{6}$/.test(gcCertNumC)) {
        return res.status(400).json({ error: 'gift_cert cert_number must match GC-NNNNNN format (e.g. GC-000042)' });
      }
      var gcRateC = Number(gcItemC.rate);
      if (!isFinite(gcRateC) || gcRateC <= 0 || gcRateC > 2000) {
        return res.status(400).json({ error: 'gift_cert rate must be between $0.01 and $2000' });
      }
    }

    // Pre-resolve GST tax_id for any taxable custom lines (D-02 fail-closed).
    var needGstTaxIdConfirm = body.items.some(function (item) {
      return item.custom && item.taxable !== false;
    });
    var gstTaxIdConfirm = null;
    if (needGstTaxIdConfirm) {
      gstTaxIdConfirm = resolveGstTaxId(catalogMap);
      if (!gstTaxIdConfirm) {
        return res.status(400).json({
          error: 'Cannot tax this custom line: no GST tax rate configured. Mark the line tax-exempt or set KIOSK_GST_TAX_ID.'
        });
      }
    }

    var subtotal = 0;
    var lineItems = body.items.map(function (item) {
      if (item.custom) {
        var qty = Number(item.quantity) || 1;
        var rate = Number(item.rate);
        subtotal += qty * rate;
        var taxable = item.taxable !== false;
        var desc = String(item.description || '').trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
        var note = String(item.note || '').trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
        var fullDesc = note ? (desc + ' — ' + note) : desc;
        var li = {
          custom: true,
          description: fullDesc,
          rate: rate,
          quantity: qty,
          tax_percentage: taxable ? 5 : 0
        };
        if (taxable) {
          li.tax_id = gstTaxIdConfirm;
        } else if (process.env.ZOHO_TAX_ZERO_ID) {
          // F3 (45-09): an exempt custom line has no backing Zoho item, so an
          // un-tagged line is DEFAULT-taxed by Zoho (phantom GST → partial-paid
          // invoice). Attach the explicit Zero Rate tax so Zoho books a real 0%.
          li.tax_id = process.env.ZOHO_TAX_ZERO_ID;
        }
        return li;
      }
      // Gift cert line (Phase 44-09): server-authoritative item_id, zero-tax (D-03, T-44-G1)
      if (item.gift_cert) {
        var gcCertNumConfirm = String(item.cert_number || '').trim().toUpperCase();
        var gcRateConfirm = Number(item.rate);
        var gcNameConfirm = item.gift_action === 'reload'
          ? 'Gift Certificate Reload ' + gcCertNumConfirm
          : 'Gift Certificate ' + gcCertNumConfirm;
        subtotal += gcRateConfirm;
        return {
          gift_cert: true,
          gift_action: item.gift_action || 'issue',
          cert_number: gcCertNumConfirm,
          item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID, // server-authoritative (D-05)
          name: gcNameConfirm,
          quantity: 1,
          rate: gcRateConfirm
          // NO tax_id — item carries its own EXEMPT setting (D-03)
        };
      }
      var qty = Number(item.quantity) || 1;
      var catalogItem = catalogMap[item.item_id];
      var rate = catalogItem.rate;
      subtotal += qty * rate;
      var li = { item_id: item.item_id, name: item.name || '', sku: catalogItem.sku || '', quantity: qty, rate: rate };
      if (catalogItem.tax_id) {
        li.tax_id = catalogItem.tax_id;
      }
      return li;
    });
    subtotal = Math.round(subtotal * 100) / 100;

    return resolveDiscount(body, lineItems, subtotal, catalogMap).then(function (discResult) {
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

    // Strip internal gift_cert tracking fields before sending to Zoho
    var zohoLineItems = lineItems.map(function (li) {
      if (!li.gift_cert) return li;
      return { item_id: li.item_id, name: li.name, quantity: li.quantity, rate: li.rate };
    });

    var invoicePayload = {
      date: today,
      reference_number: refNumber,
      payment_terms: 0,
      payment_terms_label: 'Due on Receipt',
      line_items: zohoLineItems,
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

    // --- Phase 44 split-tender: re-clamp gift_amount to re-computed grandTotal (Pitfall 3).
    // D-12 (45-07): gcApplied further validated against real server-side balance (fail-open).
    var gcSubmittedConfirm = 0;
    var gcCertNum = '';
    if (body.gift_card && body.gift_card.cert_number) {
      // D-05: server-authoritative re-clamp (Pitfall 3 — prices may differ from sale quote)
      gcSubmittedConfirm = Math.min(
        Math.max(Number(body.gift_card.amount_applied) || 0, 0),
        grandTotal
      );
      gcCertNum = String(body.gift_card.cert_number).trim().toUpperCase().slice(0, 20);
    }
    // CR-02 (45): look up real balance before recording gift card payment in Zoho.
    // Discriminated result (same contract as sale path):
    //   { state: 'ok', balance: N } | { state: 'invalid' } | { state: 'unavailable' } | null
    var _cfAsUrl   = process.env.APPS_SCRIPT_URL;
    var _cfAsToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
    var gcConfirmBalanceLookup = Promise.resolve(null);
    if (gcSubmittedConfirm > 0 && gcCertNum && _cfAsUrl && _cfAsToken) {
      gcConfirmBalanceLookup = Promise.resolve(
        axios.post(_cfAsUrl, JSON.stringify({
          action:       'lookup_gift_card',
          server_token: _cfAsToken,
          cert_number:  gcCertNum
        }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
      )
      .then(function (resp) {
        var r = (resp && resp.data) || {};
        if (r.ok === true && r.data && typeof r.data.current_balance === 'number') {
          return { state: 'ok', balance: r.data.current_balance };
        }
        // Apps Script explicitly reported ok:false → cert invalid or not found.
        // In production this is a hard reject; in non-prod treat as unavailable
        // (fail-open) so existing tests that mock all axios.post as ok:false
        // for redeem-failure scenarios still reach the redemption step (T-44-G9).
        if (r.ok === false) {
          return process.env.NODE_ENV === 'production'
            ? { state: 'invalid' }
            : { state: 'unavailable' };
        }
        // ok:true but no balance data
        return { state: 'unavailable' };
      })
      .catch(function (lookupErr) {
        log.warn('[pos/kiosk/sale/confirm] gift-card balance lookup failed: ' + (lookupErr && lookupErr.message));
        return { state: 'unavailable' };
      });
    }

    return gcConfirmBalanceLookup.then(function (gcConfirmLookup) {
      // CR-02: discriminated result handling (terminal already charged — void-on-failure applies)
      if (gcConfirmLookup !== null) {
        if (gcConfirmLookup.state === 'invalid') {
          // Terminal already charged — void before rejecting
          return moneyPath.voidWithTimeout(helcimLib, body.transaction_id, grandTotal, { reqId: req.id })
            .then(function () {
              return res.status(400).json({ error: 'Gift card not found or has insufficient balance' });
            })
            .catch(function () {
              return res.status(400).json({ error: 'Gift card not found or has insufficient balance' });
            });
        }
        if (gcConfirmLookup.state === 'unavailable') {
          if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({ error: 'Gift card validation temporarily unavailable' });
          }
          log.warn('[pos/kiosk/sale/confirm] gift-card lookup unavailable (non-prod fail-open): cert=' + gcCertNum);
        }
      }
      var gcApplied = gcSubmittedConfirm;
      if (gcConfirmLookup && gcConfirmLookup.state === 'ok' && gcApplied > gcConfirmLookup.balance) {
        log.warn('[pos/kiosk/sale/confirm] gcApplied clamped to realBalance: submitted=' + gcApplied +
          ' realBalance=' + gcConfirmLookup.balance + ' cert=' + gcCertNum);
        gcApplied = Math.min(gcConfirmLookup.balance, grandTotal);
      }
    // terminalApplied is what was (or will be) charged on the Helcim terminal.
    var terminalApplied = Math.round((grandTotal - gcApplied) * 100) / 100;

    // M3 (52-03, RESIL-01): the gift-card clearing customerpayment REQUIRES a real
    // ledger account — no hardcoded fallback (Pattern D). Fail CLOSED before the
    // invoice/payment chain runs: if a redemption is in play (gcApplied > 0 &&
    // gcCertNum) but ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID is unset, do NOT post to a
    // guessed account. Mirrors the CR-02 gcConfirmLookup 'invalid' precedent just
    // above — void any terminal charge already pushed, then reject, rather than
    // creating an invoice that can never be correctly paid off.
    var gcClearingAccount = process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID;
    if (gcApplied > 0 && gcCertNum && !gcClearingAccount) {
      log.error('[pos/kiosk/sale/confirm] CRITICAL: gift-card redemption blocked — ' +
        'ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID is unset; refusing to post to a guessed ledger. cert=' + gcCertNum);
      var gcAcctVoid = terminalApplied > 0
        ? moneyPath.voidWithTimeout(helcimLib, body.transaction_id, grandTotal, { reqId: req.id })
        : Promise.resolve();
      return gcAcctVoid
        .then(function () {
          return res.status(503).json({ error: 'Gift card redemption temporarily unavailable — contact staff' });
        })
        .catch(function () {
          return res.status(503).json({ error: 'Gift card redemption temporarily unavailable — contact staff' });
        });
    }

    // F2 (45-09): a manual confirm ('manual-confirm' / no txn id) carries no proof a
    // card charge actually happened. Booking a creditcard payment on trust risks
    // phantom revenue (uncharged invoice booked as paid) AND records the literal
    // 'manual-confirm' instead of the real Helcim id. Before creating the invoice,
    // resolve the actual approved transaction from Helcim; fail closed (no invoice,
    // no payment) if it can't be positively verified — the 45-08 reconciliation
    // backstop settles a genuinely-orphaned real charge. A real txn id (auto-confirm,
    // already poll-verified) is trusted and skips this lookup.
    var isManualConfirm = !body.transaction_id || body.transaction_id === 'manual-confirm';
    var verifyManualCharge = (isManualConfirm && terminalApplied > 0)
      ? helcimLib.pollTerminalResult(refNumber).then(function (tr) {
          if (tr && tr.approved && tr.transactionId) {
            txnId = String(tr.transactionId); // real id → proof-of-charge + reconciliation fidelity
            return;
          }
          var mvErr = new Error('manual-confirm not verified');
          mvErr.__manualVerify = (tr && (tr.status === 'DECLINED' || tr.status === 'CANCELLED'))
            ? 'declined' : 'unverified';
          throw mvErr;
        })
      : Promise.resolve();

    return verifyManualCharge.then(function () {
    return zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
      var invoice = invoiceData.invoice || {};
      var invoiceId = invoice.invoice_id || '';
      var invoiceNumber = invoice.invoice_number || '';
      log.info('[pos/kiosk/sale/confirm] Invoice created: ' + invoiceNumber);

      // Tracks whether any gift-cert activation failed post-payment (money in, cert not active).
      // Set inside the LAST-STEP block; surfaced in the 201 response body.
      var giftCardActivationFailed = false;

      var paymentChain = Promise.resolve();
      if (invoiceId) {
        paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
          .then(function () {
            // Payment 1: terminal portion — skip if gift card covers 100% (Pitfall 1 ordering)
            if (terminalApplied > 0) {
              return zohoPost('/customerpayments', {
                payment_mode: 'creditcard',
                amount: terminalApplied,
                date: today,
                reference_number: txnId,
                invoices: [{ invoice_id: invoiceId, amount_applied: terminalApplied }],
                notes: 'Kiosk POS terminal payment. Ref: ' + refNumber
              });
            }
          })
          .then(function () {
            // Payment 2: gift card portion — ONLY after terminal payment is recorded (Pitfall 1)
            // account_id draws down the "Gift Cards Sold" clearing account (not Undeposited Funds)
            if (gcApplied > 0 && gcCertNum) {
              return zohoPost('/customerpayments', {
                payment_mode: 'others',
                // M3 (52-03): no hardcoded fallback — the pre-flight check above
                // already rejected this request if gcClearingAccount were falsy.
                account_id: gcClearingAccount,
                amount: gcApplied,
                date: today,
                reference_number: gcCertNum,
                invoices: [{ invoice_id: invoiceId, amount_applied: gcApplied }],
                notes: 'Gift certificate ' + gcCertNum + ' redemption. Ref: ' + refNumber
              });
            }
          })
          .then(function () {
            // LAST STEP: all Apps Script balance/activation calls (Pitfall 1 — MUST be after all Zoho calls).
            // On failure: log CRITICAL but resolve (invoice already paid — Pitfall 1 accepted failure mode).
            var asUrl = process.env.APPS_SCRIPT_URL;
            var asToken = process.env.APPS_SCRIPT_SERVER_TOKEN;

            var lastStep = Promise.resolve();

            // Step A: Redeem gift card balance (existing 44-04 path)
            if (gcApplied > 0 && gcCertNum && asUrl && asToken) {
              lastStep = lastStep.then(function () {
                return axios.post(asUrl, JSON.stringify({
                  action: 'redeem_gift_card',
                  server_token: asToken,
                  cert_number: gcCertNum,
                  amount: gcApplied,
                  transaction_ref: refNumber
                }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
                .then(function (asResp) {
                  var r = asResp.data || {};
                  if (!r.ok) {
                    log.error('[pos/kiosk/sale/confirm] CRITICAL: Gift card balance decrement failed for ' +
                      gcCertNum + ': ' + (r.error || 'unknown'));
                    // D-12 (45-07): flag for staff review — mirrors giftCardActivationFailed pattern
                    giftCardActivationFailed = true;
                  } else {
                    eventLog.logEvent('kiosk.gift_card_redeemed', {
                      certNumber: gcCertNum, amountApplied: gcApplied, refNumber: refNumber
                    });
                  }
                })
                .catch(function (asErr) {
                  log.error('[pos/kiosk/sale/confirm] CRITICAL: Apps Script redeem_gift_card unreachable for ' +
                    gcCertNum + ': ' + asErr.message);
                  // D-12 (45-07): unreachable Apps Script — flag for staff review
                  giftCardActivationFailed = true;
                });
              });
            }

            // Step B: Activate gift cert lines (issue/reload) — 44-09 (D-05, T-44-G3)
            // Runs AFTER Step A so both are post-payment; ordering within last-step doesn't matter
            // since they operate on different certs, but sequential chaining keeps the code clean.
            if (asUrl && asToken) {
              lineItems.forEach(function (gcLine) {
                if (!gcLine.gift_cert) return;
                var certNum = gcLine.cert_number;
                var certRate = gcLine.rate;
                var certAction = gcLine.gift_action || 'issue';

                if (certAction === 'issue') {
                  lastStep = lastStep.then(function () {
                    return axios.post(asUrl, JSON.stringify({
                      action: 'issue_gift_card',
                      server_token: asToken,
                      cert_number: certNum,
                      face_value: certRate,
                      issued_by: 'kiosk',
                      notes: 'Issued via kiosk cart. Ref: ' + refNumber
                    }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
                    .then(function (issueResp) {
                      var r = issueResp.data || {};
                      if (!r.ok) {
                        log.error('[pos/kiosk/sale/confirm] CRITICAL: gift card activation failed for ' +
                          certNum + ': ' + (r.error || 'unknown'));
                        giftCardActivationFailed = true;
                        return; // do NOT call update_gift_card_invoice on failure
                      }
                      eventLog.logEvent('kiosk.gift_card_issued', {
                        certNumber: certNum, faceValue: certRate, invoiceNumber: invoiceNumber
                      });
                      // update_gift_card_invoice only on success (links Sheets row to cart invoice)
                      return axios.post(asUrl, JSON.stringify({
                        action: 'update_gift_card_invoice',
                        server_token: asToken,
                        cert_number: certNum,
                        zoho_invoice_number: invoiceNumber
                      }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
                      .catch(function (updErr) {
                        log.error('[pos/kiosk/sale/confirm] update_gift_card_invoice failed for ' +
                          certNum + ': ' + updErr.message);
                      });
                    })
                    .catch(function (issueErr) {
                      log.error('[pos/kiosk/sale/confirm] CRITICAL: gift card activation unreachable for ' +
                        certNum + ': ' + issueErr.message);
                      giftCardActivationFailed = true;
                    });
                  });
                } else if (certAction === 'reload') {
                  lastStep = lastStep.then(function () {
                    return axios.post(asUrl, JSON.stringify({
                      action: 'reload_gift_card',
                      server_token: asToken,
                      cert_number: certNum,
                      amount: certRate,
                      transaction_ref: refNumber
                    }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
                    .then(function (relResp) {
                      var r = relResp.data || {};
                      if (!r.ok) {
                        log.error('[pos/kiosk/sale/confirm] CRITICAL: gift card reload activation failed for ' +
                          certNum + ': ' + (r.error || 'unknown'));
                        giftCardActivationFailed = true;
                      } else {
                        eventLog.logEvent('kiosk.gift_card_reloaded', {
                          certNumber: certNum, amount: certRate, refNumber: refNumber
                        });
                      }
                    })
                    .catch(function (relErr) {
                      log.error('[pos/kiosk/sale/confirm] CRITICAL: gift card reload unreachable for ' +
                        certNum + ': ' + relErr.message);
                      giftCardActivationFailed = true;
                    });
                  });
                }
              });
            }

            return lastStep;
          })
          .catch(function (payErr) {
            // D-12: propagate payment-recording failure so the outer void path fires.
            // Previous behaviour: log-only (swallowed) → success path ran → 201 ok:true
            // with money charged on terminal but unrecorded in Zoho.
            log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
            throw payErr;
          });
      }

      return paymentChain.then(function () {
        cache.del(KIOSK_PRODUCTS_CACHE_KEY);
        ledger.decrementStock(lineItems, 'kiosk:' + (invoiceNumber || 'unknown')).catch(function () {});

        eventLog.logEvent('kiosk.sale_completed', {
          txnId: txnId, itemCount: lineItems.length, grandTotal: grandTotal, invoiceNumber: invoiceNumber
        });

        // Trigger batch creation for kit items with Maker's Fee (fire-and-forget per D-01)
        brewpadIntegration.createBatchesFromSale(lineItems, invoiceNumber, body.customer_name || '', body.contact_id || '', catalogMap, invoiceId);

        var result = {
          ok: true, transaction_id: txnId, invoice_id: invoiceId, invoice_number: invoiceNumber,
          reference_number: refNumber, subtotal: subtotal, tax_total: taxTotal, total: grandTotal, date: today
        };
        if (discountApplied) result.discount_applied = discountApplied;
        // Surface activation failure so 44-10 frontend can alert staff (T-44-G11)
        if (giftCardActivationFailed) {
          result.gift_card_activation_failed = true;
          result.needs_manual_review = true;
        }
        // Cache confirm result for idempotency (T-44-G2)
        var cacheWrite = confirmIdemKey
          ? cache.set(confirmIdemKey, result, IDEMPOTENCY_KEY_TTL).catch(function () {})
          : Promise.resolve();

        // D-13 (45-08 Rule 2): clear the kiosk pending-charge sentinel so the
        // reconciliation backstop knows this charge is settled (no orphan).
        // The confirm idem key (10-min TTL) is the primary signal; this deletion
        // is the durable signal — it outlasts the short idem TTL and prevents
        // false-positive void attempts by the sweep after the TTL expires.
        var pendingRef = (typeof body.reference_number === 'string' && body.reference_number)
          ? body.reference_number.slice(0, 64) : '';
        if (pendingRef) {
          cache.del(C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + pendingRef)
            .catch(function () {});
        }

        cacheWrite.then(function () {
          res.status(201).json(result);
        });
      });
    }); // end zohoPost.then (inside gcConfirmBalanceLookup.then)
    }); // end verifyManualCharge.then (F2 45-09 manual-confirm verification)
    }); // end gcConfirmBalanceLookup.then (D-12 balance validation)
    }); // end resolveDiscount.then
  }).catch(function (err) {
    // F2 (45-09): manual-confirm could not be positively verified against Helcim.
    // No invoice was created and there is no real terminal txn to void — fail closed
    // WITHOUT booking. A genuinely-orphaned real charge is settled by the 45-08 sweep.
    if (err && err.__manualVerify) {
      if (res.headersSent) return;
      if (err.__manualVerify === 'declined') {
        return res.status(400).json({
          error: 'No approved card payment found for this sale (terminal reported declined or cancelled). Nothing was booked — do not re-charge.'
        });
      }
      return res.status(409).json({
        error: 'Card payment could not be verified yet. If the terminal approved, it will be reconciled automatically — do NOT re-charge. Otherwise wait a moment and retry.'
      });
    }
    log.error('[pos/kiosk/sale/confirm] Error: ' + err.message);
    var _txnIdForVoidCapture = (body && body.transaction_id) ? String(body.transaction_id) : null;
    captureExceptionSafe(err, {
      level: 'error',
      tags: { reqId: req.id, txnId: _txnIdForVoidCapture, salesOrderId: null }
    });
    // Void-on-failure: if a terminal charge was made (body.transaction_id set) and the
    // Zoho invoice/payment step (or payment recording step — D-12 propagated) failed,
    // void the terminal charge to prevent an orphan charge.
    // For gift-card-only sales (no terminal), body.transaction_id is absent — no void needed.
    var _txnIdForVoid = (body && body.transaction_id) ? String(body.transaction_id) : null;
    if (_txnIdForVoid) {
      // D-12: track void failure via a thin wrapper so the response body can include
      // needs_manual_review and the sv:void-failure record is persisted for reconciliation.
      // The wrapper re-throws so moneyPath.voidWithTimeout's CRITICAL log + sendVoidFailureAlert fires.
      var _voidFailed = false;
      var _helcimForVoid = {
        voidTransaction: function (txnId) {
          return helcimLib.voidTransaction(txnId).catch(function (voidErr) {
            _voidFailed = true;
            var failRecord = {
              txnId: _txnIdForVoid,
              timestamp: new Date().toISOString(),
              error: voidErr.message,
              needs_manual_review: true
            };
            cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
            throw voidErr; // Re-throw so voidWithTimeout's CRITICAL log + mailer alert fires
          });
        }
      };

      moneyPath.voidWithTimeout(_helcimForVoid, _txnIdForVoid, 0, {
        mailer: mailer,
        eventLog: eventLog,
        reqId: req.id
      }).then(function () {
        if (res.headersSent) return;
        var responseBody = {
          error: 'Payment was taken but could not be recorded. Please contact support.',
          payment_voided: !_voidFailed,
          voided_transaction_id: _txnIdForVoid
        };
        if (_voidFailed) responseBody.needs_manual_review = true;
        res.status(502).json(responseBody);
      });
    } else {
      res.status(502).json({ error: 'Failed to create invoice. Please try again.' });
    }
  });
}

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
  // 52-03 (M2, RESIL-01): QUARANTINED — grep-confirmed dead route (2026-07-03):
  //   `grep -rn "pos/sale" js/` → zero frontend callers. Only remaining references:
  //   docs/*, openapi.yaml, and this file's own JSDoc/route def + the
  //   `app.use('/api/pos/sale', paymentLimiter)` rate-limit mount in server.js (harmless
  //   — the route below now always 410s, so the mount just rate-limits a dead endpoint).
  // Reason for quarantine (not deletion): the body below charges the Helcim terminal then
  //   treats a subsequent Zoho invoice/payment failure as "non-fatal" (no void, no pending
  //   record) — an invisible orphan charge invisible even to the 45-08 reconciliation
  //   backstop. Retired in favor of /api/kiosk/sale, which uses lib/money-path's
  //   void-on-failure + pending-record primitives. Returns 410 BEFORE any helcimLib
  //   terminal call so no charge can ever occur again. Body preserved below (unreachable)
  //   for audit trail — see 52-03-SUMMARY.md.
  return res.status(410).json({ error: 'Legacy POS sale endpoint retired — use /api/kiosk/sale' });

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
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // Item #13: This endpoint exposes sensitive order data. Require an API key
  // even for GET requests, overriding the global GET exemption in server.js
  // (admin-grade — device tier rejected by requireTiers above, T-46-18b).
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
});

/**
 * GET /api/admin/inventory-ledger
 * Returns current ledger state for debugging.
 * Shows recent stock adjustments and the current version counter.
 */
router.get('/api/admin/inventory-ledger', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  Promise.all([
    cache.get(C.LEDGER_KEYS.VERSION),
    cache.getClient().then(function (c) {
      if (!c) return [];
      return c.lRange(C.LEDGER_KEYS.ADJUSTMENTS, 0, 49);
    })
  ]).then(function (results) {
    var adjustments = (results[1] || []).map(function (entry) {
      try { return JSON.parse(entry); } catch { return entry; }
    });
    res.json({
      version: results[0] || 0,
      recent_adjustments: adjustments
    });
  }).catch(function (err) {
    res.status(500).json({ error: err.message });
  });
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
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
  // D-09: kiosk order-book exposes PII (customer names, balances, line items).
  // Kiosk-scoped (46-04 interfaces) — device token allowed alongside legacy/session.
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
                    zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function (submitErr) {
                      log.warn('[kiosk/so-pay] Invoice submit failed (non-fatal): ' + submitErr.message);
                    });
                  }
                  return invoiceId;
                })
                .catch(function (invErr) {
                  // Non-fatal: SO is paid, but invoice creation failed
                  // Stock won't auto-decrement until next Zoho reconcile
                  log.error('[kiosk/so-pay] Invoice from SO failed (non-fatal): ' + invErr.message);
                  return '';
                });

              invoiceFromSoChain.then(function (invoiceId) {
                // Bust kiosk products cache so stock reflects after invoice submit
                cache.del(KIOSK_PRODUCTS_CACHE_KEY).catch(function () {});

                // Trigger batch creation for kit items (fire-and-forget per D-01)
                var soLineItems = (so.line_items || []).map(function (li) {
                  return { item_id: li.item_id || '', name: li.name || li.description || '', sku: li.sku || '', quantity: li.quantity || 1, rate: li.rate || 0 };
                });
                brewpadIntegration.createBatchesFromSale(soLineItems, soNumber, so.customer_name || '', customerId, null, invoiceId);

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
            // D-13 (45-07): persist pending-charge context for reconciliation backstop (45-08).
            // The terminal push may have reached Helcim before the timeout; the record lets
            // the daily reconcile job detect any orphaned charges.
            var _pendingKey = C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + soNumber;
            var _pendingCtx = {
              reference_number: soNumber,
              amount:           balance,
              salesorder_id:    soId,
              idempotency_key:  idempotencyKey,
              created_at:       new Date().toISOString()
            };
            cache.set(_pendingKey, _pendingCtx, KIOSK_PENDING_CHARGE_TTL).catch(function () {});
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
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
  // Kiosk-scoped (46-04 interfaces) — device token allowed alongside legacy/session.
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
});

// Phase 7: Sync batch status to Zoho invoice custom field (D-01, D-02, D-03)
router.post('/api/batch/sync-zoho', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped (device rejected) — 46-04 interfaces.
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
});

// Phase 7: Search invoices for batch linking (D-04)
router.get('/api/batch/search-invoices', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped GET (device rejected) — 46-04 interfaces (T-46-18b).
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
});

// Phase 28: Resolve customer details from a Zoho invoice or SO number (D-01..D-16)
router.get('/api/batch/customer-by-number', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped GET (device rejected) — 46-04 interfaces (T-46-18b).
  // CR-01 (plan 29-04): normalize to uppercase so the case-sensitive regexes accept
  // lowercase refs (inv-000123 / so-42) — aligns with the frontend's case-insensitive
  // /^(INV|SO)-\d+$/i gate and the downstream case-insensitive exact-match at line 1409.
  var number = (req.query.number || '').trim().toUpperCase();

  // D-16: validate prefix before any Zoho call
  var isInvoice = /^INV-\d+$/.test(number);
  var isSO      = /^SO-\d+$/.test(number);
  if (!isInvoice && !isSO) {
    return res.status(400).json({ error: 'invalid_number',
      message: 'number must match INV-NNNN or SO-NNNN format' });
  }

  // D-05: route by prefix
  var path        = isInvoice ? '/invoices'         : '/salesorders';
  var filterKey   = isInvoice ? 'invoice_number'    : 'salesorder_number';
  var listKey     = isInvoice ? 'invoices'          : 'salesorders';
  var numberField = isInvoice ? 'invoice_number'    : 'salesorder_number';

  var filterParams = {};
  filterParams[filterKey] = number;

  // Zoho call 1: resolve document by number (D-06 params-object form — NOT string concat)
  zohoGet(path, filterParams)
    .then(function (data) {
      var docs = data[listKey] || [];
      if (docs.length === 0) {
        return res.status(404).json({ error: 'not_found',
          message: 'No document found with number ' + number });
      }

      // D-06 defensive exact-match: iterate docs and select the first whose number
      // equals the requested number case-insensitively (Open Question 3 resolution)
      var doc = null;
      for (var i = 0; i < docs.length; i++) {
        var dn = String(docs[i][numberField] || '');
        if (dn.toLowerCase() === number.toLowerCase()) { doc = docs[i]; break; }
      }
      if (!doc) {
        // Zoho filter matched fuzzily but no exact-number match — treat as not found
        return res.status(404).json({ error: 'not_found',
          message: 'No exact-number match for ' + number });
      }

      var customerId   = doc.customer_id   || '';
      var customerName = doc.customer_name || '';
      var docStatus    = doc.status        || '';

      if (!customerId) {
        // Document resolved but no customer linked — return partial with contact_unavailable
        return res.json({
          customer_name: customerName,
          customer_id: '',
          customer_email: null,
          customer_phone: null,
          document_number: number,
          document_status: docStatus,
          contact_unavailable: true
        });
      }

      // Zoho call 2: contact detail for email/phone (D-07 + D-04)
      return zohoGet('/contacts/' + customerId)
        .then(function (contactData) {
          var contact = contactData.contact || {};
          var persons = contact.contact_persons || [];
          var primary = null;
          for (var j = 0; j < persons.length; j++) {
            if (persons[j].is_primary_contact) { primary = persons[j]; break; }
          }
          if (!primary) { primary = persons[0] || {}; }

          // D-07: top-level contact email, fallback to primary contact_person email
          var email = contact.email || primary.email || null;
          // D-04: phone, fallback to mobile
          var phone = primary.phone || primary.mobile || null;

          return res.json({
            customer_name:   customerName,
            customer_id:     customerId,
            customer_email:  email  || null,
            customer_phone:  phone  || null,
            document_number: number,
            document_status: docStatus
          });
        })
        .catch(function (contactErr) {
          // D-15: contact fetch failed — partial 200 (name/status preserved, email/phone null)
          log.warn('[batch/customer-by-number] Contact fetch failed for ' + customerId
            + ': ' + (contactErr.message || contactErr));
          return res.json({
            customer_name:   customerName,
            customer_id:     customerId,
            customer_email:  null,
            customer_phone:  null,
            document_number: number,
            document_status: docStatus,
            contact_unavailable: true
          });
        });
    })
    .catch(function (err) {
      // D-13: Zoho down/quota/auth failure
      log.error('[batch/customer-by-number] Zoho error: ' + (err.message || err));
      res.status(502).json({ error: 'zoho_error',
        message: 'Failed to retrieve document from Zoho' });
    });
  });
});

// Phase 29.3: Bulk-scan recent Zoho invoices for ferment-in-store sales (Maker's Fee present)
// with no batch yet, and surface them as candidates for batch creation.
// GET /api/batch/scan-invoices
// Optional: ?number=INV-XXXXX => single-invoice mode (D-09)
router.get('/api/batch/scan-invoices', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped GET (device rejected) — 46-04 interfaces (T-46-18b).
  var CF_BATCH_STATUS = process.env.ZOHO_CF_BATCH_STATUS || 'cf_batch_status';
  var MAX_PAGES = 4; // Hard server-side cap (~200 invoices). NEVER read from request (D-01/T-29.3-03).
  var CANDIDATE_STATUSES = { paid: true, sent: true, draft: true }; // void excluded (D-04)

  // --- Single-invoice mode (D-09) ---
  // CR-02 fix: Zoho detail endpoint needs numeric internal ID, not the human-readable number.
  // Use search-then-detail pattern (mirrors /api/batch/customer-by-number at line 1372):
  // 1. Search by invoice_number / salesorder_number to resolve the numeric ID and correct entity type.
  // 2. Detail-fetch using the resolved numeric ID.
  if (req.query.number) {
    var rawNumber = (req.query.number || '').trim().toUpperCase();
    if (!/^(INV|SO)-\d+$/i.test(rawNumber)) {
      return res.status(400).json({ error: 'bad_request', message: 'number must match INV-NNNN or SO-NNNN format' });
    }

    var isInv      = /^INV-/.test(rawNumber);
    var listPath   = isInv ? '/invoices'          : '/salesorders';
    var filterKey  = isInv ? 'invoice_number'     : 'salesorder_number';
    var entityKey  = isInv ? 'invoices'           : 'salesorders';
    var idField    = isInv ? 'invoice_id'         : 'salesorder_id';
    var detailKey  = isInv ? 'invoice'            : 'salesorder';
    var detailPath = isInv ? '/invoices/'         : '/salesorders/';

    var filterParams = {};
    filterParams[filterKey] = rawNumber;

    return zohoGet(listPath, filterParams)
      .then(function (listData) {
        var docs = listData[entityKey] || [];
        var doc = null;
        for (var si = 0; si < docs.length; si++) {
          if (String(docs[si][filterKey] || '').toUpperCase() === rawNumber) { doc = docs[si]; break; }
        }
        if (!doc) {
          return res.json({ candidates: [] });
        }

        return zohoGet(detailPath + doc[idField])
          .then(function (detailData) {
            var inv = detailData[detailKey] || {};
            var lineItems = inv.line_items || [];
            var kitItems = brewpadIntegration.detectKitItems(lineItems);
            if (kitItems.length === 0) {
              return res.json({ candidates: [] });
            }
            return res.json({
              candidates: [{
                invoice_id: doc[idField],
                invoice_number: rawNumber,
                customer_name: inv.customer_name || '',
                customer_id: inv.customer_id || '',
                status: inv.status || '',
                kit_items: kitItems.map(function (k) { return { sku: k.sku || '', name: k.name || '' }; })
              }]
            });
          });
      })
      .catch(function (err) {
        log.warn('[batch/scan-invoices] single-invoice fetch failed for ' + rawNumber + ': ' + err.message);
        return res.status(502).json({ error: 'zoho_error', message: 'Failed to scan invoices from Zoho' });
      });
  }

  // --- Date-window mode ---
  // Step 1: Dedup pre-check (D-10.1) — fetch existing batches from Apps Script
  // CRITICAL: use server_token (not token) — adminApi.gs reads e.parameter.server_token (~line 95)
  // e.parameter.token (~line 402) is Google OAuth-validated and WILL fail for server tokens.
  var existingSoNumbers = {};
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  var serverToken = process.env.APPS_SCRIPT_SERVER_TOKEN;

  var dedupPromise;
  if (appsScriptUrl && serverToken) {
    dedupPromise = axios.get(appsScriptUrl, {
      params: { action: 'get_batches', server_token: serverToken, status: 'all' },
      timeout: 12000
    }).then(function (resp) {
      var respData = resp.data || {};
      if (!respData.ok) {
        log.warn('[batch/scan-invoices] get_batches dedup returned ok:false — treating dedup set as empty (D-10.2 is backstop)');
        return;
      }
      var batches = (respData.data && respData.data.batches) || [];
      batches.forEach(function (b) {
        if (b.zoho_so_number) existingSoNumbers[b.zoho_so_number] = true;
      });
    }).catch(function (err) {
      log.warn('[batch/scan-invoices] get_batches dedup failed (non-fatal): ' + err.message + ' — treating dedup set as empty (D-10.2 is backstop)');
    });
  } else {
    dedupPromise = Promise.resolve();
  }

  dedupPromise.then(function () {
    // Step 2: Compute date window (last 30 days)
    var today = new Date();
    var fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 30);
    var dateStr = fromDate.toISOString().slice(0, 10); // YYYY-MM-DD

    // Step 3: Page through Zoho invoices up to MAX_PAGES (hard cap, D-01)
    var allInvoices = [];

    function fetchPage(pg) {
      if (pg > MAX_PAGES) return Promise.resolve();
      return zohoGet('/invoices', {
        sort_column: 'created_time',
        sort_order: 'D',
        date_after: dateStr,
        per_page: 50,
        page: pg
      }).then(function (data) {
        var invoices = data.invoices || [];
        // Filter: candidate statuses only (D-04)
        invoices.forEach(function (inv) {
          if (!CANDIDATE_STATUSES[inv.status]) return; // void excluded
          // cf_batch_status skip (D-02): skip before detail fetch
          var alreadyHasBatch = (inv.custom_fields || []).some(function (cf) {
            return cf.api_name === CF_BATCH_STATUS && cf.value;
          });
          if (alreadyHasBatch) return;
          // Dedup: skip if zoho_so_number already in get_batches result (D-10.1)
          if (existingSoNumbers[inv.invoice_number]) return;
          allInvoices.push(inv);
        });

        var hasMore = data.page_context && data.page_context.has_more_page;
        if (hasMore && pg < MAX_PAGES) {
          return fetchPage(pg + 1);
        }
      });
    }

    return fetchPage(1).then(function () {
      // Step 4: Sequential detail-fetch chain (respect Zoho rate limits — NOT Promise.all)
      var results = [];
      var chain = Promise.resolve();
      allInvoices.forEach(function (inv) {
        chain = chain.then(function () {
          return zohoGet('/invoices/' + inv.invoice_id)
            .then(function (data) {
              var detail = data.invoice || {};
              var lineItems = detail.line_items || [];
              var kitItems = brewpadIntegration.detectKitItems(lineItems);
              if (kitItems.length === 0) return; // No Maker's Fee — not a candidate
              results.push({
                invoice_id: inv.invoice_id,
                invoice_number: inv.invoice_number,
                customer_name: inv.customer_name || '',
                customer_id: inv.customer_id || '',
                status: inv.status,
                kit_items: kitItems.map(function (k) { return { sku: k.sku || '', name: k.name || '' }; })
              });
            })
            .catch(function (err) {
              log.warn('[batch/scan-invoices] detail fetch skipped for ' + inv.invoice_id + ': ' + err.message);
              // Skip candidate — do not abort scan
            });
        });
      });

      return chain.then(function () {
        eventLog.logEvent('batch.scan_invoices', { candidateCount: results.length });
        return res.json({ candidates: results });
      });
    });
  }).catch(function (err) {
    log.error('[batch/scan-invoices] Zoho scan error: ' + err.message);
    return res.status(502).json({ error: 'zoho_error', message: 'Failed to scan invoices from Zoho' });
  });
  });
});

// Phase 29.3: Server-authoritative bulk-create pending batches for confirmed scan candidates.
// POST /api/batch/bulk-create
// Body: { invoice_ids: ['INV-ID-001', ...] } — client supplies ONLY invoice ids (D-06)
router.post('/api/batch/bulk-create', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped (device rejected) — 46-04 interfaces.
  var body = req.body || {};
  var invoiceIds = body.invoice_ids;
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_ids must be a non-empty array' });
  }

  // WR-01 fix: validate each element is a Zoho numeric internal ID (15-20 digits).
  // Rejects path-traversal strings (e.g. '../contacts') and human-readable numbers (INV-000123).
  // Cap at 200 entries to match the scan page-cap (D-01) and prevent quota amplification.
  if (invoiceIds.length > 200) {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_ids must contain 200 or fewer items' });
  }
  var VALID_INVOICE_ID = /^\d{15,20}$/;
  for (var vi = 0; vi < invoiceIds.length; vi++) {
    if (typeof invoiceIds[vi] !== 'string' || !VALID_INVOICE_ID.test(invoiceIds[vi])) {
      return res.status(400).json({ error: 'bad_request',
        message: 'Each invoice_id must be a Zoho numeric ID (15-20 digits)' });
    }
  }

  // Server-authoritative: re-resolve each invoice from Zoho, never trust client batch data (D-06)
  var results = [];
  var chain = Promise.resolve();

  invoiceIds.forEach(function (invoiceId) {
    chain = chain.then(function () {
      return zohoGet('/invoices/' + invoiceId)
        .then(function (data) {
          var inv = data.invoice || {};
          var lineItems = inv.line_items || [];
          var kitItems = brewpadIntegration.detectKitItems(lineItems);

          if (kitItems.length === 0) {
            // No Maker's Fee — cannot create batch
            results.push({ invoice_id: invoiceId, invoice_number: inv.invoice_number || invoiceId, ok: false, error: 'no_kit_items' });
            return;
          }

          var customerName = inv.customer_name || 'Walk-in Customer';
          var customerId = inv.customer_id || '';
          var invoiceNumber = inv.invoice_number || '';

          // Per-kit-UNIT creates (D-07, quantity-aware) — sequential within this invoice.
          // A kit line with quantity N yields N batches (one fermentation batch per unit).
          var kitChain = Promise.resolve();
          var invoiceResults = [];

          kitItems.forEach(function (item) {
            var nameParts = brewpadIntegration.splitCustomerName(customerName);
            var batchPayload = {
              product_sku:        item.sku || item.item_id || '',
              product_name:       item.name || '',
              customer_name:      customerName,
              customer_firstname: nameParts.first || '',
              customer_lastname:  nameParts.last  || '',
              customer_id:        customerId,
              source:             'zoho_scan',
              zoho_so_number:     invoiceNumber
              // customer_email omitted — no PII per D-06/T-29.3-06
            };
            var qty = brewpadIntegration.kitBatchQuantity(item);
            for (var u = 0; u < qty; u++) {
              kitChain = kitChain.then(function () {
                return brewpadIntegration.callAppsScriptCreateBatch(batchPayload)
                  .then(function (result) {
                    invoiceResults.push({
                      sku: item.sku || '',
                      ok: !!(result && result.ok),
                      batch_id: (result && result.batch_id) || undefined,
                      error: (result && !result.ok && result.error) || undefined
                    });
                  });
              });
            }
          });

          return kitChain.then(function () {
            // Summarise per-invoice: ok only if every batch (across all units) succeeded
            var okResults = invoiceResults.filter(function (r) { return r.ok; });
            var allOk = invoiceResults.length > 0 && okResults.length === invoiceResults.length;
            var firstError = invoiceResults.find(function (r) { return !r.ok; });
            // Sync the invoice's Zoho batch-status field ONCE, with a count when >1
            // (avoids the per-batch last-write-wins overwrite of the single-value field).
            if (inv.invoice_id && okResults.length > 0) {
              brewpadIntegration.syncBatchToZoho(inv.invoice_id, okResults[0].batch_id || '', 'pending', { count: okResults.length })
                .catch(function () {}); // noop — errors queued in brewpad-integration
            }
            results.push({
              invoice_id: invoiceId,
              invoice_number: invoiceNumber,
              ok: allOk,
              batch_id: allOk && invoiceResults[0] ? invoiceResults[0].batch_id : undefined,
              error: firstError ? firstError.error : undefined,
              kit_results: invoiceResults.length > 1 ? invoiceResults : undefined
            });
          });
        })
        .catch(function (err) {
          log.warn('[batch/bulk-create] detail fetch failed for ' + invoiceId + ': ' + err.message);
          results.push({ invoice_id: invoiceId, ok: false, error: 'detail_fetch_failed' });
        });
    });
  });

  chain.then(function () {
    eventLog.logEvent('batch.bulk_create', { total: invoiceIds.length, ok: results.filter(function (r) { return r.ok; }).length });
    return res.json({ results: results });
  }).catch(function (err) {
    log.error('[batch/bulk-create] error: ' + err.message);
    return res.status(502).json({ error: 'zoho_error', message: 'Failed to bulk-create batches' });
  });
  });
});

// Phase 29.1: Search Zoho contacts by name/email/phone for customer type-ahead
router.get('/api/contacts/search', function (req, res) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
  // Kiosk-scoped GET (T-46-19) — this route is GET-exempt at the global guard,
  // so it resolves its own tier here (device token allowed alongside legacy/session).
  var term = (req.query.q || '').trim();
  if (!term || term.length < 2) {
    return res.status(400).json({ error: 'Query param q must be at least 2 characters' });
  }

  zohoGet('/contacts', { search_text: term })
    .then(function (data) {
      var raw = data.contacts || [];
      var slim = raw.map(function (c) {
        // Try primary contact_person for email/phone first; fall back to top-level fields
        var persons = c.contact_persons || [];
        var primary = null;
        for (var i = 0; i < persons.length; i++) {
          if (persons[i].is_primary_contact) { primary = persons[i]; break; }
        }
        if (!primary) { primary = persons[0] || {}; }

        var email = c.email || primary.email || '';
        var phone = c.phone || primary.phone || primary.mobile || '';

        return {
          contact_id: c.contact_id || '',
          contact_name: c.contact_name || '',
          email: email,
          phone: phone
        };
      });
      res.json({ contacts: slim });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      // No PII in log (T-29.1-03)
      log.error('[contacts/search] Zoho error: ' + msg);
      res.status(502).json({ error: 'Contact search failed' });
    });
  });
});

// Phase 29.1: Reassign the customer on a batch and propagate to the linked Zoho SO/invoice (D-02/D-03/D-05)
router.post('/api/batch/reassign-customer', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped (device rejected) — 46-04 interfaces.
  var body = req.body || {};
  var batchId = body.batch_id;
  var soNumber = body.zoho_so_number || null;   // may be absent (D-03)
  var customer = body.customer || {};
  var expectedVersion = body.expectedVersion;

  if (!batchId) {
    return res.status(400).json({ error: 'Missing batch_id' });
  }
  // WR-05: whitespace-only name must not pass validation (trims to empty downstream)
  var trimmedCustomerName = (customer.name || '').trim();
  if (!trimmedCustomerName && !customer.contact_id) {
    return res.status(400).json({ error: 'Missing customer: provide name or contact_id' });
  }

  // Step 1: Resolve or create the Zoho contact
  // If contact_id provided, use directly; otherwise lookup-or-create (D-02)
  var resolveContact;
  if (customer.contact_id) {
    // Use provided contact_id directly — split name for batch field population
    var name = (customer.name || '').trim();
    var parts = name ? name.split(/\s+/) : [];
    var firstName = parts.length ? parts[0] : name;
    var lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    resolveContact = Promise.resolve({
      contactId: customer.contact_id,
      customerName: name,
      firstName: firstName,
      lastName: lastName,
      email: customer.email || '',
      phone: customer.phone || ''
    });
  } else {
    var custName = (customer.name || '').trim();
    var custEmail = (customer.email || '').trim();
    var custPhone = (customer.phone || '').trim();
    var cparts = custName ? custName.split(/\s+/) : [];
    var cFirstName = cparts.length ? cparts[0] : custName;
    var cLastName = cparts.length > 1 ? cparts.slice(1).join(' ') : '';

    // Lookup-or-create: search by email first (mirrors checkout.js resolveCustomerId)
    var contactLookup;
    if (custEmail) {
      contactLookup = zohoGet('/contacts', { email: custEmail })
        .then(function (data) {
          var contacts = data.contacts || [];
          if (contacts.length > 0) {
            return contacts[0].contact_id;
          }
          // Not found — create
          var payload = buildContactPayload(custName, custEmail, custPhone);
          return zohoPost('/contacts', payload)
            .then(function (createData) {
              // WR-02: guard against 2xx response with no contact_id (no batch/Zoho write without a real id)
              var newId = (createData.contact || {}).contact_id;
              if (!newId) { throw new Error('Contact created but no contact_id returned'); }
              return newId;
            })
            .catch(function (createErr) {
              // Duplicate name — fall back to name search (mirrors checkout.js)
              if (createErr.response && createErr.response.status === 400) {
                return zohoGet('/contacts', { contact_name: custName })
                  .then(function (nameData) {
                    var nameContacts = nameData.contacts || [];
                    if (nameContacts.length > 0) {
                      return nameContacts[0].contact_id;
                    }
                    throw createErr;
                  });
              }
              throw createErr;
            });
        });
    } else {
      // No email — search by name only
      contactLookup = zohoGet('/contacts', { contact_name: custName })
        .then(function (data) {
          var contacts = data.contacts || [];
          if (contacts.length > 0) {
            return contacts[0].contact_id;
          }
          // Create without email
          var payload = buildContactPayload(custName, custEmail, custPhone);
          return zohoPost('/contacts', payload)
            .then(function (createData) {
              // WR-02: guard against 2xx response with no contact_id (no batch/Zoho write without a real id)
              var newId = (createData.contact || {}).contact_id;
              if (!newId) { throw new Error('Contact created but no contact_id returned'); }
              return newId;
            });
        });
    }

    resolveContact = contactLookup.then(function (contactId) {
      return {
        contactId: contactId,
        customerName: custName,
        firstName: cFirstName,
        lastName: cLastName,
        email: custEmail,
        phone: custPhone
      };
    });
  }

  resolveContact
    .then(function (resolved) {
      var contactId = resolved.contactId;
      var customerName = resolved.customerName;
      var customerFirstName = resolved.firstName;
      var customerLastName = resolved.lastName;
      var customerEmail = resolved.email;
      var customerPhone = resolved.phone;

      // Step 2: Update batch via Apps Script update_batch with optimistic lock (T-29.1-02)
      var appsScriptUrl = process.env.APPS_SCRIPT_URL;
      var appsScriptToken = process.env.APPS_SCRIPT_SERVER_TOKEN;

      var updatePayload = {
        action: 'update_batch',
        server_token: appsScriptToken,
        batch_id: batchId,
        expectedVersion: expectedVersion,
        updates: {
          customer_id: contactId,
          customer_name: customerName,
          customer_firstname: customerFirstName,
          customer_lastname: customerLastName,
          customer_email: customerEmail,
          customer_phone: customerPhone
        }
      };

      return axios.post(appsScriptUrl, JSON.stringify(updatePayload), {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000,
        maxRedirects: 5
      }).then(function (resp) {
        var result = resp.data || {};

        // Version conflict — stop before any Zoho push (T-29.1-02)
        if (!result.ok && result.error === 'version_conflict') {
          return res.status(409).json({
            error: 'version_conflict',
            message: result.message || 'Batch was modified by another user. Refresh and try again.'
          });
        }

        var newVersion = (result.data && result.data.last_updated) || null;

        // Step 3: If zoho_so_number present, resolve the SO/INV internal ID and push customer_id (D-03/D-05)
        if (!soNumber) {
          // D-03: batch-only — no Zoho push
          eventLog.logEvent('batch.customer_reassigned', {
            batchId: batchId,
            newCustomerId: contactId,
            newCustomerName: customerName,
            zohoUpdated: false
          });
          return res.json({ ok: true, batch_updated: true, new_version: newVersion });
        }

        // Resolve internal SO/INV id from number (mirrors customer-by-number lookup)
        var soUpperCase = soNumber.toUpperCase();

        // WR-01: validate order ref format BEFORE any Zoho call (mirrors the
        // customer-by-number endpoint's /^(INV|SO)-\d+$/ gate). A malformed value
        // would otherwise waste a Zoho query and fall through to a misleading
        // "document not found" warning. Surface the invalid input as a warning
        // (batch is already updated at this point — D-05 contract).
        if (!/^INV-\d+$/.test(soUpperCase) && !/^SO-\d+$/.test(soUpperCase)) {
          eventLog.logEvent('batch.customer_reassigned', {
            batchId: batchId,
            newCustomerId: contactId,
            newCustomerName: customerName,
            zohoUpdated: false,
            zohoWarning: 'Invalid order reference: ' + soNumber
          });
          return res.json({
            ok: true,
            batch_updated: true,
            zoho_warning: 'Invalid order reference: ' + soNumber,
            new_version: newVersion
          });
        }

        var isInvoice = /^INV-\d+$/.test(soUpperCase);
        var docPath = isInvoice ? '/invoices' : '/salesorders';
        var filterKey = isInvoice ? 'invoice_number' : 'salesorder_number';
        var listKey = isInvoice ? 'invoices' : 'salesorders';
        var idField = isInvoice ? 'invoice_id' : 'salesorder_id';
        var numberField = isInvoice ? 'invoice_number' : 'salesorder_number';

        var filterParams = {};
        filterParams[filterKey] = soUpperCase;

        return zohoGet(docPath, filterParams)
          .then(function (docData) {
            var docs = docData[listKey] || [];
            var doc = null;
            for (var i = 0; i < docs.length; i++) {
              var dn = String(docs[i][numberField] || '');
              if (dn.toLowerCase() === soUpperCase.toLowerCase()) { doc = docs[i]; break; }
            }

            var docId = doc ? doc[idField] : null;
            if (!docId) {
              // Doc not found — batch already updated, warn
              eventLog.logEvent('batch.customer_reassigned', {
                batchId: batchId,
                newCustomerId: contactId,
                newCustomerName: customerName,
                zohoUpdated: false,
                zohoWarning: 'Zoho document ' + soNumber + ' not found'
              });
              return res.json({
                ok: true,
                batch_updated: true,
                zoho_warning: 'Zoho document ' + soNumber + ' not found',
                new_version: newVersion
              });
            }

            // Attempt to update customer_id on the Zoho document
            return zohoPut(docPath + '/' + docId, { customer_id: contactId })
              .then(function () {
                eventLog.logEvent('batch.customer_reassigned', {
                  batchId: batchId,
                  newCustomerId: contactId,
                  newCustomerName: customerName,
                  zohoUpdated: true
                });
                return res.json({
                  ok: true,
                  batch_updated: true,
                  zoho_updated: true,
                  new_version: newVersion
                });
              })
              .catch(function (putErr) {
                // D-05: Zoho rejection — batch change stands, surface as warning (T-29.1-05)
                var putMsg = putErr.message;
                if (putErr.response && putErr.response.data) {
                  putMsg = putErr.response.data.message || putErr.response.data.error || putMsg;
                }
                log.error('[batch/reassign-customer] Zoho PUT failed (D-05): ' + putMsg);
                eventLog.logEvent('batch.customer_reassigned', {
                  batchId: batchId,
                  newCustomerId: contactId,
                  newCustomerName: customerName,
                  zohoUpdated: false,
                  zohoWarning: putMsg
                });
                return res.json({
                  ok: true,
                  batch_updated: true,
                  zoho_warning: putMsg,
                  new_version: newVersion
                });
              });
          });
      });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[batch/reassign-customer] Error: ' + msg);
      res.status(500).json({ ok: false, error: 'Internal error: ' + msg });
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/batch/bottling-invite
// Send a bottling-appointment invite email to the customer with a pre-filled
// Cal.com booking link. Routes through Resend (not Apps Script MailApp) so it
// works from Railway where outbound SMTP is blocked.
// Auth: x-api-key header (same as all /api/batch/* siblings).
// ---------------------------------------------------------------------------
router.post('/api/batch/bottling-invite', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped (device rejected) — 46-04 interfaces.
  var body = req.body || {};
  var name = (body.name || '').trim();
  var email = (body.email || '').trim();
  var batchId = (body.batchId || '').trim();
  var productName = (body.productName || '').trim();

  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid or missing email' });
  }
  if (!batchId) {
    return res.status(400).json({ error: 'Missing batchId' });
  }

  mailer.sendBottlingInvite({ name: name, email: email, batchId: batchId, productName: productName })
    .then(function () {
      eventLog.logEvent('batch.bottling_invite_sent', { batchId: batchId });
      res.json({ success: true });
    })
    .catch(function (err) {
      log.error('[batch/bottling-invite] Send failed: ' + err.message);
      res.status(500).json({ error: 'Failed to send bottling invite' });
    });
  });
});

/**
 * GET /api/kiosk/salesorder/:id
 * Fetch a single Sales Order detail from Zoho, including line_items.
 * The list endpoint (/salesorders) does not return line_items.
 */
router.get('/api/kiosk/salesorder/:id', function (req, res) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
  // D-09: individual order detail also exposes PII — kiosk-scoped, device token
  // allowed (46-04 interfaces). Inline tier resolution used (rather than server.js
  // PII_GET_ROUTES list) because Express path-pattern matching is required for :id params.
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
});

module.exports = router;
// Exposed for unit testing (pure-ish helpers)
module.exports.resolveDiscount = resolveDiscount;
module.exports.computeTax = computeTax;
module.exports.resolveGstTaxId = resolveGstTaxId;
