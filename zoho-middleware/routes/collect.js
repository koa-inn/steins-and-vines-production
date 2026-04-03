'use strict';

var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var C = require('../lib/constants');

var zohoGet = zohoApi.zohoGet;

var IDEMPOTENCY_TTL = 300;    // 5 minutes
var PENDING_TTL = 600;        // 10 minutes

var router = express.Router();

/**
 * POST /api/pos/collect
 * Collect payment on an existing Zoho Sales Order via the Helcim Smart Terminal.
 *
 * Called by a Zoho Inventory Deluge script (server-to-server). Deluge has a
 * ~10 s timeout, so this route returns 202 Accepted as soon as the terminal
 * push succeeds. The Helcim webhook handler (separate file) processes the
 * terminal result and records the payment in Zoho.
 *
 * Expected body:
 * {
 *   salesorder_id: "1234567890012345678"   // Zoho Sales Order ID
 * }
 *
 * Returns 202:
 * {
 *   message: "Payment sent to terminal",
 *   salesorder_number: "SO-00123",
 *   amount: 149.95,
 *   status: "pending"
 * }
 */
router.post('/api/pos/collect', function (req, res) {
  var body = req.body || {};
  var soId = body.salesorder_id;

  // Step 1: Validate salesorder_id
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
  }

  // Step 2: Check terminal is available
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  // Step 3: Idempotency check — prevent duplicate terminal pushes for the same SO
  var idemCacheKey = C.CACHE_KEYS.COLLECT_IDEM_PREFIX + soId;

  cache.get(idemCacheKey)
    .catch(function () { return null; })
    .then(function (existing) {
      if (existing) {
        log.info('[collect] Idempotent duplicate blocked: soId=' + soId);
        return res.status(409).json({ error: 'Payment already in progress for this order' });
      }

      // Step 4: Fetch the Sales Order from Zoho
      return zohoGet('/salesorders/' + soId)
        .then(function (data) {
          var so = data.salesorder || {};
          var soNumber = so.salesorder_number || '';
          var balance = parseFloat(so.balance);
          var customerId = so.customer_id || '';

          // Step 5: Guard — balance must be positive
          if (isNaN(balance) || balance <= 0) {
            log.info('[collect] No balance due: soId=' + soId + ' balance=' + so.balance);
            return res.status(400).json({ error: 'No balance due on this order' });
          }

          // Step 6: Guard — reject void/closed orders
          var orderStatus = (so.order_status || so.status || '').toLowerCase();
          if (orderStatus === 'void' || orderStatus === 'closed') {
            log.info('[collect] Order is ' + orderStatus + ': soId=' + soId);
            return res.status(400).json({ error: 'Order is ' + orderStatus });
          }

          // Step 7: Set idempotency key in cache
          var idempotencyKey = helcimLib.generateIdempotencyKey();

          return cache.set(idemCacheKey, idempotencyKey, IDEMPOTENCY_TTL)
            .catch(function () { /* non-fatal — proceed without idempotency guard */ })
            .then(function () {
              log.info('[collect] Pushing to terminal: soNumber=' + soNumber +
                ' amount=$' + balance.toFixed(2) + ' soId=' + soId);

              // Step 8: Push payment to terminal (returns immediately)
              return helcimLib.terminalPurchase(balance, soNumber, idempotencyKey)
                .then(function () {
                  // Step 9: Cache pending context for webhook handler
                  var pendingCacheKey = C.CACHE_KEYS.COLLECT_PENDING_PREFIX + soNumber;
                  var pendingContext = {
                    salesorder_id: soId,
                    salesorder_number: soNumber,
                    customer_id: customerId,
                    amount: balance,
                    idempotency_key: idempotencyKey,
                    created_at: new Date().toISOString()
                  };

                  return cache.set(pendingCacheKey, pendingContext, PENDING_TTL)
                    .catch(function (cacheErr) {
                      log.error('[collect] Failed to cache pending context (non-fatal): ' + cacheErr.message);
                    })
                    .then(function () {
                      // Step 10: Fire event and return 202
                      eventLog.logEvent('collect.sent_to_terminal', {
                        soId: soId,
                        soNumber: soNumber,
                        amount: balance
                      });

                      return res.status(202).json({
                        message: 'Payment sent to terminal',
                        salesorder_number: soNumber,
                        amount: balance,
                        status: 'pending'
                      });
                    });
                });
            });
        })
        .catch(function (err) {
          // Step 11: Clean up idempotency key on error
          cache.del(idemCacheKey).catch(function () {});

          // Determine appropriate status code
          var status = err.status || (err.response && err.response.status) || 502;
          var message = err.message || 'Unknown error';

          if (status === 404 || (err.response && err.response.status === 404)) {
            log.error('[collect] Sales order not found: soId=' + soId);
            return res.status(404).json({ error: 'Sales order not found' });
          }

          log.error('[collect] Failed: soId=' + soId + ' err=' + message);
          if (!res.headersSent) {
            return res.status(502).json({ error: 'Failed to process collect payment' });
          }
        });
    });
});

module.exports = router;
