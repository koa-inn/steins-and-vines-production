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

  // Return all non-fee items (the actual kits)
  return lineItems.filter(function (item) {
    return item !== feeItem && item !== matFeeItem;
  });
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
function createBatchesFromSale(lineItems, invoiceNumber, customerName, contactId, catalogMap, invoiceId) {
  var kitItems = detectKitItems(lineItems);
  if (kitItems.length === 0) return;

  log.info('[brewpad] Detected ' + kitItems.length + ' kit item(s) for batch creation, invoice=' + invoiceNumber);

  kitItems.forEach(function (item) {
    var batchPayload = {
      product_sku: item.sku || item.item_id || '',
      product_name: item.name || '',
      customer_name: customerName || 'Walk-in Customer',
      customer_id: contactId || '',
      source: 'kiosk',
      zoho_so_number: invoiceNumber || ''
    };

    callAppsScriptCreateBatch(batchPayload).then(function (result) {
      if (result && result.ok && invoiceId) {
        syncBatchToZoho(invoiceId, result.batch_id || '', 'pending')
          .catch(function () {}); // fire-and-forget; errors already queued for retry
      }
    });
  });
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

  var statusLabel = status.charAt(0).toUpperCase() + status.slice(1) + ' — ' + batchId;

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
      return queueSyncForRetry({ so_id: soId, batch_id: batchId, status: status }, msg).then(function () {
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

          return syncBatchToZoho(retryData.payload.so_id, retryData.payload.batch_id, retryData.payload.status, { skipQueue: true }).then(function (result) {
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

module.exports = {
  createBatchesFromSale: createBatchesFromSale,
  retryPendingBatches: retryPendingBatches,
  detectKitItems: detectKitItems,
  callAppsScriptCreateBatch: callAppsScriptCreateBatch,
  syncBatchToZoho: syncBatchToZoho,
  queueSyncForRetry: queueSyncForRetry,
  retrySyncQueue: retrySyncQueue
};
