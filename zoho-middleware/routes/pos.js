var express = require('express');
var gp = require('globalpayments-api');
var gpLib = require('../lib/gp');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');

var Transaction = gp.Transaction;
var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;

var KIOSK_PRODUCTS_CACHE_KEY = 'zoho:kiosk-products';

var router = express.Router();

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
 *   tax_total: 3.00,          // client-calculated; used for receipt display only
 *   reference_number: "KIOSK-001"  // optional reference for the invoice
 * }
 */
router.post('/api/kiosk/sale', function (req, res) {
  if (!gpLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  var body = req.body;

  // Validate required fields
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  if (body.items.length > 50) {
    return res.status(400).json({ error: 'Too many items in cart' });
  }

  // Validate each line item
  for (var v = 0; v < body.items.length; v++) {
    var vi = body.items[v];
    if (!vi.item_id || typeof vi.item_id !== 'string' || vi.item_id.length > 64) {
      return res.status(400).json({ error: 'Invalid item_id for item ' + v });
    }
    var vQty = Number(vi.quantity);
    var vRate = Number(vi.rate);
    if (!vQty || vQty < 1 || vQty > 100) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + v });
    }
    if (isNaN(vRate) || vRate < 0 || vRate > 10000) {
      return res.status(400).json({ error: 'Invalid rate for item ' + v });
    }
  }

  // Calculate subtotal from line items
  var subtotal = 0;
  var lineItems = body.items.map(function (item) {
    var qty = Number(item.quantity) || 1;
    var rate = Number(item.rate) || 0;
    subtotal += qty * rate;
    return {
      item_id: item.item_id,
      name: item.name || '',
      quantity: qty,
      rate: rate
    };
  });

  var taxTotal = parseFloat(body.tax_total) || 0;
  var grandTotal = parseFloat((subtotal + taxTotal).toFixed(2));

  if (grandTotal <= 0) {
    return res.status(400).json({ error: 'Sale total must be greater than zero' });
  }
  if (grandTotal > 10000) {
    return res.status(400).json({ error: 'Sale total exceeds maximum' });
  }

  var refNumber = (body.reference_number && typeof body.reference_number === 'string')
    ? body.reference_number.slice(0, 64)
    : ('KIOSK-' + Date.now());

  log.info('[pos/kiosk/sale] Starting kiosk sale: total=$' + grandTotal.toFixed(2) +
    ' ref=' + refNumber + ' items=' + lineItems.length);

  // Step 1: Send payment to POS terminal
  gpLib.getTerminal().sale(grandTotal)
    .withCurrency('CAD')
    .withInvoiceNumber(refNumber)
    .execute('terminal')
    .then(function (termResponse) {
      if (termResponse.deviceResponseCode !== '00' && termResponse.status !== 'Success') {
        log.warn('[pos/kiosk/sale] Terminal declined: ' +
          termResponse.deviceResponseCode + ' ' + termResponse.deviceResponseText);
        return res.status(402).json({
          error: 'Payment declined: ' + (termResponse.deviceResponseText || 'Unknown'),
          code: termResponse.deviceResponseCode
        });
      }

      var txnId = termResponse.transactionId || '';
      log.info('[pos/kiosk/sale] Terminal approved: txn=' + txnId);

      // Step 2: Create Zoho Books Invoice
      // Use a generic "Walk-in Customer" contact (or create one if configured).
      // The invoice records the sale and auto-decrements inventory on confirm.
      var today = new Date().toISOString().slice(0, 10);

      // Build Zoho invoice — use cash_sale mode so it auto-marks as paid
      var invoicePayload = {
        date: today,
        reference_number: refNumber,
        payment_terms: 0,
        payment_terms_label: 'Due on Receipt',
        line_items: lineItems,
        notes: 'In-store kiosk sale. Terminal txn: ' + txnId,
        custom_fields: []
      };

      // Attach customer contact: prefer explicit contact_id from request, fall back to env default
      var contactId = (typeof body.contact_id === 'string' && body.contact_id)
        ? body.contact_id
        : (process.env.KIOSK_CONTACT_ID || '');
      if (contactId) invoicePayload.customer_id = contactId;

      // Attach transaction ID to custom field if configured
      if (txnId && process.env.ZOHO_CF_TRANSACTION_ID) {
        invoicePayload.custom_fields.push({
          api_name: process.env.ZOHO_CF_TRANSACTION_ID,
          value: txnId
        });
      }

      return zohoPost('/invoices', invoicePayload)
        .then(function (invoiceData) {
          var invoice = invoiceData.invoice || {};
          var invoiceId = invoice.invoice_id || '';
          var invoiceNumber = invoice.invoice_number || '';

          log.info('[pos/kiosk/sale] Invoice created: ' + invoiceNumber + ' id=' + invoiceId);

          // Step 3: Mark invoice as sent + record payment so inventory adjusts
          // Zoho auto-decrements stock when an invoice is confirmed.
          // We record a cash payment against it to mark as paid.
          var paymentChain = Promise.resolve();

          if (invoiceId) {
            paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {})
              .catch(function (submitErr) {
                // Non-fatal — invoice exists, stock will still adjust
                log.warn('[pos/kiosk/sale] Invoice submit failed (non-fatal): ' + submitErr.message);
              })
              .then(function () {
                // Record the payment against the invoice
                return zohoPost('/customerpayments', {
                  payment_mode: 'cash',
                  amount: grandTotal,
                  date: today,
                  reference_number: txnId || refNumber,
                  invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
                  notes: 'Kiosk POS payment. Terminal txn: ' + txnId
                });
              })
              .then(function () {
                log.info('[pos/kiosk/sale] Payment recorded for invoice ' + invoiceNumber);
              })
              .catch(function (payErr) {
                // Non-fatal — invoice and stock adjustment still happened
                log.error('[pos/kiosk/sale] Payment recording failed (non-fatal): ' + payErr.message);
              });
          }

          return paymentChain.then(function () {
            // Invalidate kiosk product cache so stock counts refresh
            cache.del(KIOSK_PRODUCTS_CACHE_KEY);

            res.status(201).json({
              ok: true,
              transaction_id: txnId,
              auth_code: termResponse.authorizationCode || '',
              invoice_id: invoiceId,
              invoice_number: invoiceNumber,
              reference_number: refNumber,
              subtotal: subtotal,
              tax_total: taxTotal,
              total: grandTotal,
              date: today
            });
          });
        })
        .catch(function (invoiceErr) {
          // Zoho invoice failed — void the terminal transaction
          var invoiceMsg = invoiceErr.message;
          if (invoiceErr.response && invoiceErr.response.data) {
            invoiceMsg = invoiceErr.response.data.message || invoiceErr.response.data.error || invoiceMsg;
          }
          log.error('[pos/kiosk/sale] Invoice creation failed after payment — voiding txn=' + txnId + ': ' + invoiceMsg);

          Transaction.fromId(txnId)
            .void()
            .execute()
            .then(function () {
              log.info('[pos/kiosk/sale] Voided txn=' + txnId + ' after invoice failure');
            })
            .catch(function (voidErr) {
              log.error('[pos/kiosk/sale] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
            })
            .then(function () {
              res.status(502).json({
                error: 'Payment was taken but order could not be recorded. Please contact support.',
                payment_voided: true,
                voided_transaction_id: txnId
              });
            });
        });
    })
    .catch(function (termErr) {
      log.error('[pos/kiosk/sale] Terminal error: ' + termErr.message);
      res.status(502).json({ error: 'Terminal error — please try again' });
    });
});

/**
 * GET /api/pos/status
 * Check if the POS terminal is enabled and configured.
 */
router.get('/api/pos/status', function (req, res) {
  var diag = gpLib.getTerminalDiagnostics();
  // List which GP_ env var names are actually present in process.env
  var gpVarsPresent = Object.keys(process.env).filter(function(k) { return k.indexOf('GP_') === 0; });
  res.json({
    enabled: gpLib.isTerminalEnabled(),
    terminal_type: gpLib.isTerminalEnabled() ? 'UPA (Meet in the Cloud)' : 'none',
    diagnostics: diag,
    gp_vars_present: gpVarsPresent,
    _v: '20260227-2'
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
  if (!gpLib.isTerminalEnabled()) {
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

  gpLib.getTerminal().sale(amount)
    .withCurrency('CAD')
    .withInvoiceNumber(soNumber)
    .execute('terminal')
    .then(function (response) {
      if (response.deviceResponseCode === '00' || response.status === 'Success') {
        log.info('[pos/sale] Terminal sale approved: txn=' + response.transactionId);

        // Record the payment in Zoho if we have a customer_id and SO
        var txnId = response.transactionId || '';
        res.json({
          ok: true,
          transaction_id: txnId,
          status: 'approved',
          auth_code: response.authorizationCode || '',
          amount: amount
        });
      } else {
        log.warn('[pos/sale] Terminal declined: ' + response.deviceResponseCode + ' ' + response.deviceResponseText);
        res.status(402).json({
          error: 'Terminal payment declined: ' + (response.deviceResponseText || 'Unknown'),
          code: response.deviceResponseCode
        });
      }
    })
    .catch(function (err) {
      log.error('[pos/sale] Terminal error: ' + err.message);
      res.status(502).json({ error: 'Terminal error' });
    });
});

/**
 * GET /api/orders/recent
 * Returns the last 20 sales orders, sorted by most recent.
 * Used by the admin panel's "Recent Kiosk Orders" section.
 */
router.get('/api/orders/recent', function (req, res) {
  var limit = parseInt(req.query.limit, 10) || 20;

  zohoGet('/salesorders', {
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

      res.json({ orders: orders });
    })
    .catch(function (err) {
      log.error('[api/orders/recent] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch orders' });
    });
});

module.exports = router;
