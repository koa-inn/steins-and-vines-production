var express = require('express');
var gp = require('globalpayments-api');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');

var Transaction = gp.Transaction;
var zohoPost = zohoApi.zohoPost;

var PRODUCTS_CACHE_KEY = 'zoho:products';

var router = express.Router();

/**
 * POST /api/checkout
 * Accepts a cart payload, formats it as a Zoho Books Sales Order, and creates
 * it via the API. Invalidates the products cache so stock counts refresh.
 *
 * If a payment transaction_id is provided (online deposit was charged),
 * deposit/balance custom fields are added and a Zoho Books customer payment
 * is recorded against the sales order.
 *
 * Expected request body:
 * {
 *   customer_id: "zoho_contact_id",
 *   items: [
 *     { item_id: "zoho_item_id", name: "Product Name", quantity: 2, rate: 14.99 }
 *   ],
 *   notes: "optional order notes",
 *   transaction_id: "gp-txn-id (optional)",
 *   deposit_amount: 50.00 (optional)
 * }
 */
router.post('/api/checkout', function (req, res) {
  var body = req.body;

  // --- Validate required fields ---
  if (!body || !body.customer_id) {
    return res.status(400).json({ error: 'Missing customer_id' });
  }
  if (typeof body.customer_id !== 'string' || body.customer_id.length > 64) {
    return res.status(400).json({ error: 'Invalid customer_id' });
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

  // --- Validate each line item ---
  for (var v = 0; v < body.items.length; v++) {
    var vi = body.items[v];
    var vQty = Number(vi.quantity) || 1;
    var vRate = Number(vi.rate) || 0;
    var vDiscount = Number(vi.discount) || 0;
    if (vQty < 1 || vQty > 100) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + v });
    }
    if (vRate < 0 || vRate > 10000) {
      return res.status(400).json({ error: 'Invalid rate for item ' + v });
    }
    if (vDiscount < 0 || vDiscount > 100) {
      return res.status(400).json({ error: 'Invalid discount for item ' + v });
    }
  }

  // --- Calculate order total and deposit ---
  var orderTotal = 0;
  var lineItems = body.items.map(function (item) {
    var qty = Number(item.quantity) || 1;
    var rate = Number(item.rate) || 0;
    var discount = Number(item.discount) || 0;
    var effectiveRate = discount > 0 ? rate * (1 - discount / 100) : rate;
    orderTotal += qty * effectiveRate;
    var li = {
      item_id: item.item_id,
      name: item.name || '',
      quantity: qty,
      rate: rate
    };
    if (discount > 0) li.discount = discount + '%';
    return li;
  });

  var transactionId = body.transaction_id || '';
  var depositAmount = transactionId ? (parseFloat(body.deposit_amount) || 0) : 0;
  var balanceDue = Math.max(0, orderTotal - depositAmount);

  var salesOrder = {
    customer_id: body.customer_id,
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

  // Deposit tracking custom fields (only included if configured in .env)
  if (process.env.ZOHO_CF_DEPOSIT) {
    salesOrder.custom_fields.push({
      api_name: process.env.ZOHO_CF_DEPOSIT,
      value: String(depositAmount.toFixed(2))
    });
  }
  if (process.env.ZOHO_CF_BALANCE) {
    salesOrder.custom_fields.push({
      api_name: process.env.ZOHO_CF_BALANCE,
      value: String(balanceDue.toFixed(2))
    });
  }
  if (transactionId && process.env.ZOHO_CF_TRANSACTION_ID) {
    salesOrder.custom_fields.push({
      api_name: process.env.ZOHO_CF_TRANSACTION_ID,
      value: transactionId
    });
  }

  var responseSent = false;

  zohoPost('/salesorders', salesOrder)
    .then(function (data) {
      // Invalidate product cache so stock counts refresh on next fetch
      cache.del(PRODUCTS_CACHE_KEY);

      var soId = data.salesorder ? data.salesorder.salesorder_id : null;
      var soNumber = data.salesorder ? data.salesorder.salesorder_number : null;

      // If an online deposit was charged, record the payment in Zoho Books
      if (transactionId && depositAmount > 0 && soId) {
        return zohoPost('/customerpayments', {
          customer_id: body.customer_id,
          payment_mode: 'creditcard',
          amount: depositAmount,
          date: new Date().toISOString().slice(0, 10),
          reference_number: transactionId,
          notes: 'Online deposit for Sales Order ' + (soNumber || soId)
        })
        .then(function () {
          log.info('[api/checkout] Payment recorded for SO=' + soNumber);
        })
        .catch(function (payErr) {
          // Payment recording failed — log but don't fail the order
          // The deposit custom fields on the SO still have the transaction reference
          log.error('[api/checkout] Payment recording failed (non-fatal): ' + payErr.message);
        })
        .then(function () {
          responseSent = true;
          res.status(201).json({
            ok: true,
            salesorder_id: soId,
            salesorder_number: soNumber,
            deposit_amount: depositAmount,
            balance_due: balanceDue
          });
        })
        .catch(function (sendErr) {
          log.error('[api/checkout] Failed to send response: ' + sendErr.message);
        });
      } else {
        responseSent = true;
        res.status(201).json({
          ok: true,
          salesorder_id: soId,
          salesorder_number: soNumber,
          deposit_amount: depositAmount,
          balance_due: balanceDue
        });
      }
    })
    .catch(function (err) {
      if (responseSent) {
        log.error('[api/checkout] Error after response already sent: ' + err.message);
        return;
      }

      var status = 502;
      var message = err.message;

      // Surface Zoho-specific errors (e.g. "Out of Stock", validation)
      if (err.response && err.response.data) {
        message = err.response.data.message || err.response.data.error || message;
        // 400-level from Zoho -> relay as 400 to the client
        if (err.response.status >= 400 && err.response.status < 500) {
          status = 400;
        }
      }

      // Sanitize: only pass Zoho 400-level messages (user-meaningful) to the client
      var clientMsg = (status === 400) ? message : 'Order could not be placed. Please try again.';

      // If payment was already charged but Zoho failed, void the transaction
      if (transactionId) {
        log.error('[api/checkout] Zoho failed after payment — voiding txn=' + transactionId);
        Transaction.fromId(transactionId)
          .void()
          .execute()
          .then(function () {
            log.info('[api/checkout] Voided txn=' + transactionId);
          })
          .catch(function (voidErr) {
            log.error('[api/checkout] CRITICAL: Void failed for txn=' + transactionId + ': ' + voidErr.message);
          })
          .then(function () {
            if (!responseSent) {
              res.status(status).json({
                error: clientMsg,
                payment_voided: true,
                voided_transaction_id: transactionId
              });
            }
          });
        return;
      }

      log.error('[api/checkout] ' + message);
      res.status(status).json({ error: clientMsg });
    });
});

module.exports = router;
