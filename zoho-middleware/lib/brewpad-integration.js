'use strict';

var axios = require('axios');
var log = require('./logger');
var eventLog = require('./eventLog');
var cache = require('./cache');
var C = require('./constants');
var checkoutHelpers = require('./checkout-helpers');
var zohoApi = require('./zoho-api');
var zohoPut = zohoApi.zohoPut;

var RETRY_TTL = 86400;   // 24 hours
var MAX_RETRIES = 3;
var RETRY_PREFIX = C.CACHE_KEYS.BATCH_RETRY_PREFIX;

var SYNC_RETRY_TTL = 86400;   // 24 hours
var SYNC_MAX_RETRIES = 3;
var SYNC_RETRY_PREFIX = C.CACHE_KEYS.BATCH_SYNC_RETRY_PREFIX;

/**
 * Split a full customer name into first and last name parts.
 * First word becomes firstname, everything after becomes lastname.
 *
 * @param {string} fullName - e.g. "Jane Doe", "Mary Jane Watson", "Jane"
 * @returns {{first: string, last: string}}
 */
function splitCustomerName(fullName) {
  var trimmed = (fullName || '').trim();
  if (!trimmed) return { first: '', last: '' };
  var parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Detect kit items that need batch creation.
 * Per D-02: only sales with a Maker's Fee trigger batch creation.
 * Per D-03: one batch per non-fee kit line item.
 *
 * @param {Array} lineItems - from the sale payload
 * @returns {Array} kit items (excluding all fee items: Maker's Fee + Materials Fee)
 */
function detectKitItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return [];

  var makersFeeItemId = process.env.MAKERS_FEE_ITEM_ID || '';
  var feeItem = checkoutHelpers.findMakersFeeItem(lineItems, makersFeeItemId);
  if (!feeItem) return [];  // No Maker's Fee = not a ferment-in-store sale

  // Also find Materials Fee to exclude it from kit items
  var materialsFeeItemId = process.env.MATERIALS_FEE_ITEM_ID || '';
  var matFeeItem = checkoutHelpers.findMaterialsFeeItem(lineItems, materialsFeeItemId);

  // Return all non-fee items (the actual kits), skipping truly-blank lines.
  return lineItems.filter(function (item) {
    if (item === feeItem || item === matFeeItem) return false;
    // A line with no sku, no item_id AND no name cannot form a real batch — creating
    // one previously errored on import with an empty product (INV-000137). Skip it.
    var hasId = ((item && (item.sku || item.item_id)) || '').toString().trim() !== '';
    var hasName = ((item && item.name) || '').toString().trim() !== '';
    if (!hasId && !hasName) return false;
    return true;
  });
}

// Number of batches to create for a kit line item — one fermentation batch per unit
// (D-03 revised: quantity-aware). Missing/invalid quantity defaults to 1; an absurd
// quantity is clamped as a fat-finger guard.
var MAX_BATCHES_PER_KIT_LINE = 100;
function kitBatchQuantity(item) {
  var q = Math.floor(Number(item && item.quantity));
  if (!isFinite(q) || q < 1) return 1;
  if (q > MAX_BATCHES_PER_KIT_LINE) {
    log.warn('[brewpad] kit line quantity ' + q + ' exceeds cap ' + MAX_BATCHES_PER_KIT_LINE + ' — clamping');
    return MAX_BATCHES_PER_KIT_LINE;
  }
  return q;
}

/**
 * Fermentation slots sold, taken from the Maker's Fee quantity.
 *
 * The catalog carries no marker distinguishing a kit from ordinary merchandise
 * (every item has a blank category and product_type "goods"), so the line items
 * alone cannot say which ones ferment. The Maker's Fee is charged once per
 * fermentation slot, which makes its quantity the authoritative batch count.
 *
 * Every real invoice carries it (verified back to INV-000001, Feb 2026: kit x3, fee x3).
 * A payload that omits it entirely is treated as unknown — see planKitBatches, which
 * then falls back to the pre-existing per-unit behaviour rather than guessing 1.
 *
 * @returns {number} slots sold; 0 when not a ferment-in-store sale; -1 when unknown
 */
function makersFeeSlots(lineItems) {
  var feeItem = checkoutHelpers.findMakersFeeItem(lineItems, process.env.MAKERS_FEE_ITEM_ID || '');
  if (!feeItem) return 0;
  if (feeItem.quantity === undefined || feeItem.quantity === null || feeItem.quantity === '') return -1;
  var q = Math.floor(Number(feeItem.quantity));
  if (!isFinite(q) || q < 1) return -1;  // unusable — fall back rather than under-create
  if (q > MAX_BATCHES_PER_KIT_LINE) {
    log.warn('[brewpad] makers fee quantity ' + q + ' exceeds cap ' + MAX_BATCHES_PER_KIT_LINE + ' — clamping');
    return MAX_BATCHES_PER_KIT_LINE;
  }
  return q;
}

/**
 * Expand a sale into the exact list of batches to create — one entry per batch.
 *
 * The Maker's Fee quantity caps the total, so merchandise on a ferment sale can
 * never inflate the batch count (INV-000067 sold 12 bottles beside one kit and
 * would otherwise have produced 13 batches).
 *
 * When the kit quantities already sum to the slots sold, every candidate line is a
 * real kit and all of them are used. When they exceed it, the sale mixes kits with
 * merchandise and the line data cannot tell them apart — we fill the slots from the
 * most expensive lines first (kits run $140–$230; merchandise is far cheaper) and
 * warn, so a mis-attributed batch is visible. Tagging kits with a Zoho item category
 * would make this exact.
 *
 * @returns {Array} one kit line item per batch to create
 */
function planKitBatches(lineItems) {
  var kits = detectKitItems(lineItems);
  if (kits.length === 0) return [];

  var slots = makersFeeSlots(lineItems);
  if (slots === 0) return [];  // no Maker's Fee = not a ferment-in-store sale

  var totalKitQty = 0;
  kits.forEach(function (item) { totalKitQty += kitBatchQuantity(item); });

  // Fee quantity unusable (legacy payload): keep the pre-existing per-unit behaviour.
  if (slots < 0) slots = totalKitQty;

  var ordered = kits;
  if (totalKitQty !== slots) {
    log.warn('[brewpad] kit quantities (' + totalKitQty + ') do not match makers fee slots (' +
      slots + ') — sale likely mixes kits with merchandise; filling slots by highest unit price');
    // Stable sort: price descending, original line order breaks ties.
    ordered = kits.map(function (item, idx) { return { item: item, idx: idx }; })
      .sort(function (a, b) {
        var rateDiff = (Number(b.item.rate) || 0) - (Number(a.item.rate) || 0);
        return rateDiff !== 0 ? rateDiff : a.idx - b.idx;
      })
      .map(function (entry) { return entry.item; });
  }

  var units = [];
  for (var i = 0; i < ordered.length && units.length < slots; i++) {
    var qty = kitBatchQuantity(ordered[i]);
    for (var n = 0; n < qty && units.length < slots; n++) units.push(ordered[i]);
  }
  return units;
}

/**
 * Call Apps Script to create a single batch.
 * Resolves to { ok: true/false } so callers can distinguish success from app-level error.
 *
 * @param {Object}  batchPayload   - { product_sku, product_name, customer_name, customer_id, source, zoho_so_number }
 * @param {boolean} skipRetryQueue - when true, do not auto-queue on failure (used by retry sweep)
 * @returns {Promise<{ok: boolean}>}
 */
function callAppsScriptCreateBatch(batchPayload, skipRetryQueue) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) {
    log.warn('[brewpad] APPS_SCRIPT_URL or APPS_SCRIPT_SERVER_TOKEN not configured -- skipping batch creation');
    return Promise.resolve({ ok: false });
  }

  var payload = Object.assign({}, batchPayload, {
    action: 'create_batch',
    server_token: token
  });

  return axios.post(url, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(function (resp) {
    var data = resp.data || {};
    if (data.ok) {
      log.info('[brewpad] Batch created: batch_id=' + (data.batch_id || '?') + ' invoice=' + (batchPayload.zoho_so_number || '?'));
      eventLog.logEvent('kiosk.batch_created', {
        invoiceNumber: batchPayload.zoho_so_number || '',
        batchId: data.batch_id || ''
      });
      return { ok: true, batch_id: data.batch_id };
    } else {
      log.warn('[brewpad] Apps Script returned error: ' + (data.message || data.error || JSON.stringify(data)));
      if (!skipRetryQueue) {
        return queueForRetry(batchPayload, 'apps_script_error: ' + (data.error || 'unknown')).then(function () {
          return { ok: false };
        });
      }
      return { ok: false };
    }
  }).catch(function (err) {
    log.warn('[brewpad] Apps Script call failed (non-fatal): ' + err.message);
    if (!skipRetryQueue) {
      return queueForRetry(batchPayload, 'http_error: ' + err.message).then(function () {
        return { ok: false };
      });
    }
    return { ok: false };
  });
}

/**
 * Store a failed batch creation payload in Redis for later retry.
 * Per D-04: sale still succeeds; batch creation is eventually consistent.
 *
 * @param {Object} payload - the batch creation payload
 * @param {string} reason  - why it failed
 */
function queueForRetry(payload, reason) {
  var key = RETRY_PREFIX + Date.now() + '-' + (payload.zoho_so_number || 'unknown');
  var retryData = {
    payload: payload,
    attempts: 0,
    reason: reason,
    queued_at: new Date().toISOString()
  };

  eventLog.logEvent('kiosk.batch_retry_queued', {
    invoiceNumber: payload.zoho_so_number || '',
    reason: reason
  });

  return cache.set(key, retryData, RETRY_TTL);
}

/**
 * Main entry point: create batches from a completed kiosk sale.
 * Called fire-and-forget from pos.js sale/confirm and salesorder-pay handlers.
 *
 * Per D-02: only fires when Maker's Fee is present.
 * Per D-03: one batch per kit line item.
 * Per D-08: customer info from sale body.
 * Per D-09: no email stored.
 *
 * @param {Array}  lineItems    - sale line items
 * @param {string} invoiceNumber - Zoho invoice/SO number
 * @param {string} customerName  - from body.customer_name
 * @param {string} contactId     - from body.contact_id
 * @param {Object} catalogMap    - product catalog lookup (may be used for SKU enrichment)
 */
function createBatchesFromSale(lineItems, invoiceNumber, customerName, contactId, catalogMap, invoiceId, source, customerEmail) {
  var kitItems = detectKitItems(lineItems);
  if (kitItems.length === 0) return;

  var nameParts = splitCustomerName(customerName);

  // One entry per batch to create, bounded by the Maker's Fee quantity so merchandise
  // on the sale cannot inflate the count.
  var batchUnits = planKitBatches(lineItems);
  if (batchUnits.length === 0) return;

  log.info('[brewpad] Detected ' + kitItems.length + ' kit line(s) / ' + batchUnits.length +
    ' batch(es) for invoice=' + invoiceNumber + ' source=' + (source || 'kiosk'));

  // How many batches this sale expects per (invoice + SKU). The Apps Script dedup
  // guard keys on exactly that pair, so without this it admits the first unit of a
  // kit line and rejects the rest as duplicates — which is how INV-000137 sold three
  // kits and kept one batch. unit_total tells the guard how many are legitimate.
  var unitTotalBySku = {};
  batchUnits.forEach(function (item) {
    var sku = item.sku || item.item_id || '';
    unitTotalBySku[sku] = (unitTotalBySku[sku] || 0) + 1;
  });

  // Creates fire in parallel (as before); a single first-created batch id is captured
  // for the single-batch label.
  var creates = [];
  var firstBatchId = '';
  batchUnits.forEach(function (item) {
    var sku = item.sku || item.item_id || '';
    var batchPayload = {
      product_sku: sku,
      product_name: item.name || '',
      customer_name: customerName || 'Walk-in Customer',
      customer_firstname: nameParts.first || (customerName ? '' : 'Walk-in'),
      customer_lastname: nameParts.last || (customerName ? '' : 'Customer'),
      customer_id: contactId || '',
      source: source || 'kiosk',
      zoho_so_number: invoiceNumber || '',
      unit_total: unitTotalBySku[sku]
    };
    // Online orders carry the customer's order email — store it so staff can later
    // send the Cal.com bottling invite. Kiosk callers omit it (privacy, D-09).
    if (customerEmail) batchPayload.customer_email = customerEmail;

    creates.push(callAppsScriptCreateBatch(batchPayload).then(function (result) {
      if (result && result.ok) {
        if (!firstBatchId && result.batch_id) firstBatchId = result.batch_id;
        return true;
      }
      return false;
    }));
  });

  // Sync the invoice's Zoho batch-status field ONCE, after all creates settle —
  // a count when >1 (avoids per-batch last-write-wins overwrite), else the batch id.
  if (invoiceId) {
    Promise.all(creates).then(function (oks) {
      var okCount = oks.filter(Boolean).length;
      if (okCount > 0) {
        syncBatchToZoho(invoiceId, firstBatchId, 'pending', { count: okCount })
          .catch(function () {}); // fire-and-forget; errors already queued for retry
      }
    });
  }
}

/**
 * Retry sweep: scan Redis for pending batch creation keys and retry them.
 * Called by setInterval in server.js every 5 minutes.
 * Max 3 attempts per item; after that, log error and delete key.
 */
function retryPendingBatches() {
  if (!cache.isConnected()) return Promise.resolve();

  return cache.getClient().then(function (c) {
    if (!c) return;
    return c.keys(RETRY_PREFIX + '*');
  }).then(function (keys) {
    if (!keys || keys.length === 0) return;

    log.info('[brewpad] Retry sweep: found ' + keys.length + ' pending batch(es)');

    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return cache.get(key).then(function (retryData) {
          if (!retryData || !retryData.payload) {
            return cache.del(key);
          }

          retryData.attempts = (retryData.attempts || 0) + 1;

          if (retryData.attempts > MAX_RETRIES) {
            log.error('[brewpad] Max retries exceeded for key=' + key + ' invoice=' + (retryData.payload.zoho_so_number || '?') + ' -- removing from queue');
            eventLog.logEvent('kiosk.batch_retry_exhausted', {
              invoiceNumber: retryData.payload.zoho_so_number || '',
              attempts: retryData.attempts
            });
            return cache.del(key);
          }

          log.info('[brewpad] Retrying batch creation: attempt ' + retryData.attempts + '/' + MAX_RETRIES + ' key=' + key);

          return callAppsScriptCreateBatch(retryData.payload, true).then(function (result) {
            if (result && result.ok) {
              return cache.del(key);
            }
            // Apps Script returned error -- update attempt count and re-queue
            return cache.set(key, retryData, RETRY_TTL);
          }).catch(function () {
            return cache.set(key, retryData, RETRY_TTL);
          });
        });
      });
    });

    return chain;
  }).catch(function (err) {
    log.error('[brewpad] Retry sweep error: ' + err.message);
  });
}

/**
 * Sync batch status to a Zoho invoice custom field.
 * Constructs the status label server-side from validated enum + batch_id.
 * Per T-07-01: status is validated against enum; label is not caller-supplied.
 * Per D-01: label format is "Active — SV-B-000123".
 *
 * @param {string} soId     - Zoho invoice ID or invoice number
 * @param {string} batchId  - batch ID (e.g. "SV-B-000123")
 * @param {string} status   - one of ['pending', 'active', 'complete']
 * @returns {Promise<{ok: boolean, skipped?: boolean, queued?: boolean}>}
 */
function syncBatchToZoho(soId, batchId, status, opts) {
  var skipQueue = opts && opts.skipQueue;
  var validStatuses = ['pending', 'active', 'complete'];
  if (validStatuses.indexOf(status) === -1) {
    return Promise.reject(new Error('Invalid status "' + status + '" — must be one of: ' + validStatuses.join(', ')));
  }

  var cfName = process.env.ZOHO_CF_BATCH_STATUS;
  if (!cfName) {
    log.warn('[batch/sync-zoho] ZOHO_CF_BATCH_STATUS not configured -- skipping');
    return Promise.resolve({ ok: true, skipped: true });
  }

  // When one invoice produced multiple batches (a kit line with quantity > 1, or
  // several kit lines), show a count instead of a single batch id — otherwise each
  // per-batch sync would overwrite the field and only the last id would survive.
  var count = opts && opts.count;
  var capitalized = status.charAt(0).toUpperCase() + status.slice(1);
  var statusLabel = (count && count > 1)
    ? capitalized + ' — ' + count + ' batches'
    : capitalized + ' — ' + batchId;

  var payload = {
    custom_fields: [{ api_name: cfName, value: statusLabel }]
  };

  return zohoPut('/invoices/' + soId, payload)
    .then(function () {
      eventLog.logEvent('batch.zoho_sync_ok', { batchId: batchId, soId: soId, status: status });
      return { ok: true };
    })
    .catch(function (err) {
      var msg = err.response && err.response.data
        ? (err.response.data.message || err.response.data.error || err.message)
        : err.message;
      log.error('[batch/sync-zoho] Zoho error syncing batchId=' + batchId + ' soId=' + soId + ': ' + msg);
      if (skipQueue) {
        return { ok: false, error: msg };
      }
      return queueSyncForRetry({ so_id: soId, batch_id: batchId, status: status, count: count }, msg).then(function () {
        return { ok: false, queued: true };
      });
    });
}

/**
 * Store a failed Zoho sync payload in Redis for later retry.
 * Mirrors queueForRetry; uses BATCH_SYNC_RETRY_PREFIX.
 *
 * @param {Object} payload - { so_id, batch_id, status }
 * @param {string} reason  - why it failed
 */
function queueSyncForRetry(payload, reason) {
  var key = SYNC_RETRY_PREFIX + Date.now() + '-' + (payload.batch_id || 'unknown');
  var retryData = {
    payload: payload,
    attempts: 0,
    reason: reason,
    queued_at: new Date().toISOString()
  };

  eventLog.logEvent('batch.zoho_sync_retry_queued', {
    batchId: payload.batch_id || '',
    reason: reason
  });

  return cache.set(key, retryData, SYNC_RETRY_TTL);
}

/**
 * Retry sweep: scan Redis for pending Zoho sync keys and retry them.
 * Called by setInterval in server.js every 5 minutes (alongside retryPendingBatches).
 * Max SYNC_MAX_RETRIES (3) attempts per item; after that, log error and delete key.
 */
function retrySyncQueue() {
  if (!cache.isConnected()) return Promise.resolve();

  return cache.getClient().then(function (c) {
    if (!c) return;
    return c.keys(SYNC_RETRY_PREFIX + '*');
  }).then(function (keys) {
    if (!keys || keys.length === 0) return;

    log.info('[brewpad] Zoho sync retry sweep: found ' + keys.length + ' pending sync(s)');

    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return cache.get(key).then(function (retryData) {
          if (!retryData || !retryData.payload) {
            return cache.del(key);
          }

          retryData.attempts = (retryData.attempts || 0) + 1;

          if (retryData.attempts > SYNC_MAX_RETRIES) {
            log.error('[brewpad] Max Zoho sync retries exceeded for key=' + key + ' batchId=' + (retryData.payload.batch_id || '?') + ' -- removing from queue');
            eventLog.logEvent('batch.zoho_sync_retry_exhausted', {
              batchId: retryData.payload.batch_id || '',
              attempts: retryData.attempts
            });
            return cache.del(key);
          }

          log.info('[brewpad] Retrying Zoho sync: attempt ' + retryData.attempts + '/' + SYNC_MAX_RETRIES + ' key=' + key);

          return syncBatchToZoho(retryData.payload.so_id, retryData.payload.batch_id, retryData.payload.status, { skipQueue: true, count: retryData.payload.count }).then(function (result) {
            if (result && result.ok) {
              return cache.del(key);
            }
            return cache.set(key, retryData, SYNC_RETRY_TTL);
          }).catch(function () {
            return cache.set(key, retryData, SYNC_RETRY_TTL);
          });
        });
      });
    });

    return chain;
  }).catch(function (err) {
    log.error('[brewpad] Zoho sync retry sweep error: ' + err.message);
  });
}

/**
 * Create a single batch from a recipe sale.
 * Separate code path from detectKitItems/createBatchesFromSale per D-10.
 * Creates exactly ONE batch regardless of the number of ingredient line items.
 * Fire-and-forget per D-12 — failure is silent; staff can create batch manually.
 *
 * @param {string} recipeId        - recipe ID (e.g. "RCP-0001")
 * @param {Object} recipeSnapshot  - recipe object at time of sale (name, style, ingredients, etc.)
 * @param {string} invoiceNumber   - Zoho invoice number
 * @param {string} customerName    - full customer name (or empty for walk-in)
 * @param {string} contactId       - Zoho contact ID (or empty for walk-in)
 */
function detectRecipeSale(recipeId, recipeSnapshot, invoiceNumber, customerName, contactId) {
  if (!recipeId) return;
  var nameParts = splitCustomerName(customerName);
  var batchPayload = {
    product_sku:        recipeId,
    product_name:       (recipeSnapshot && recipeSnapshot.name) || recipeId,
    customer_name:      customerName || 'Walk-in Customer',
    customer_firstname: nameParts.first || (customerName ? '' : 'Walk-in'),
    customer_lastname:  nameParts.last  || (customerName ? '' : 'Customer'),
    customer_id:        contactId || '',
    source:             'kiosk_recipe',
    zoho_so_number:     invoiceNumber || '',
    recipe_id:          recipeId,
    recipe_snapshot:    JSON.stringify(recipeSnapshot || {}),
    target_volume_l:    (recipeSnapshot && recipeSnapshot.target_volume_l) || null,
    scale_factor:       (recipeSnapshot && recipeSnapshot.scale_factor) || null
  };
  callAppsScriptCreateBatch(batchPayload).catch(function () {});
}

module.exports = {
  createBatchesFromSale: createBatchesFromSale,
  retryPendingBatches: retryPendingBatches,
  detectKitItems: detectKitItems,
  kitBatchQuantity: kitBatchQuantity,
  makersFeeSlots: makersFeeSlots,
  planKitBatches: planKitBatches,
  callAppsScriptCreateBatch: callAppsScriptCreateBatch,
  splitCustomerName: splitCustomerName,
  syncBatchToZoho: syncBatchToZoho,
  queueSyncForRetry: queueSyncForRetry,
  retrySyncQueue: retrySyncQueue,
  detectRecipeSale: detectRecipeSale
};
