'use strict';

var express = require('express');
var axios = require('axios');
var zohoApi = require('../lib/zoho-api');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');

var zohoPost = zohoApi.zohoPost;

var router = express.Router();

// ---------------------------------------------------------------------------
// Internal helper: call Apps Script via POST.
// All 7 gift-card actions live in the doPost server_token dispatch block.
// CRITICAL: send action + server_token in the JSON body (not query params).
// ---------------------------------------------------------------------------
function callAppsScript(action, payload) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;

  var body = Object.assign({}, payload, {
    action: action,
    server_token: token
  });

  return axios.post(url, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(function (resp) {
    return resp.data || {};
  });
}

// ---------------------------------------------------------------------------
// GET /api/kiosk/gift-card/next-number
// Suggests the next GC-NNNNNN cert number from Apps Script generateNextId.
// Not rate-limited — read/suggest only, no money path.
// The client pre-fills the cert_number field; staff may override.
// The server still enforces uniqueness on issue.
// ---------------------------------------------------------------------------
router.get('/api/kiosk/gift-card/next-number', function (req, res) {
  return callAppsScript('get_next_cert_number', {}).then(function (result) {
    if (!result.ok) {
      log.warn('[gift-cards/next-number] Apps Script error: ' + (result.error || 'unknown'));
      return res.status(500).json({ error: 'Failed to get next cert number' });
    }
    return res.status(200).json({ ok: true, suggested: result.suggested });
  }).catch(function (err) {
    log.error('[gift-cards/next-number] Apps Script call failed: ' + err.message);
    return res.status(502).json({ error: 'Failed to reach Apps Script' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/gift-card/lookup?cert_number=GC-NNNNNN
// Server-authoritative balance lookup (D-05).
// Client never supplies a balance — balance always read from Apps Script.
// Not rate-limited — read-only, no money path.
// ---------------------------------------------------------------------------
router.get('/api/kiosk/gift-card/lookup', function (req, res) {
  var certNumber = String(req.query.cert_number || '').trim().toUpperCase();

  if (!certNumber || !/^GC-\d{6}$/.test(certNumber)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN format (e.g. GC-000042)' });
  }

  return callAppsScript('lookup_gift_card', { cert_number: certNumber }).then(function (result) {
    if (!result.ok) {
      if (result.error === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Certificate not found' });
      }
      log.warn('[gift-cards/lookup] Apps Script error for ' + certNumber + ': ' + (result.error || 'unknown'));
      return res.status(500).json({ error: 'Failed to look up certificate' });
    }
    // D-05: return server-authoritative data; never expose internal Zoho IDs
    return res.status(200).json({ ok: true, data: result.data });
  }).catch(function (err) {
    log.error('[gift-cards/lookup] Apps Script call failed: ' + err.message);
    return res.status(502).json({ error: 'Failed to reach Apps Script' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/gift-card/issue
// Issues a new gift certificate.
// Rate-limited via paymentLimiter in server.js (T-44-11).
//
// Happy-path flow:
//   1. Fail-closed env guard — 503 if KIOSK_GIFT_CARD_ITEM_ID unset (Pitfall 4, T-44-04)
//   2. Input validation — cert format /^GC-\d{6}$/ (D-02, T-44-09) and face_value
//      bounds (0, 2000] (T-44-08)
//   3. Reserve cert in Sheets via issue_gift_card (LockService uniqueness — D-02)
//      Duplicate → 409; Apps Script error → 500
//   4. Create Zoho invoice — KIOSK_GIFT_CARD_ITEM_ID line, NO tax_id (D-03, D-04)
//      Item's own 0%/EXEMPT setting produces zero-tax invoice (44-01 Probe B).
//      Do NOT pass ZOHO_TAX_ZERO_ID here.
//   5. Submit invoice (non-fatal if submit fails)
//   6. Record creditcard payment for face_value
//   7. Update Sheets row with Zoho invoice number
//   8. Respond 201 {ok, cert_number, face_value, zoho_invoice_number}
//
// Void path (T-44-12 / D-06 atomic safety):
//   If any Zoho call throws AFTER the Sheets row was created, void the Sheets
//   row via void_gift_card(reason:'zoho_invoice_failed') to prevent an orphan
//   cert with no Zoho audit trail, then respond 502.
// ---------------------------------------------------------------------------
router.post('/api/kiosk/gift-card/issue', function (req, res) {
  // Pitfall 4 / T-44-04: fail-closed if gift card accounting is not configured.
  // Check at request time (not startup) — OPTIONAL env var, as per 44-01.
  if (!process.env.KIOSK_GIFT_CARD_ITEM_ID) {
    log.warn('[gift-cards/issue] KIOSK_GIFT_CARD_ITEM_ID not set — refusing request (fail-closed)');
    return res.status(503).json({
      error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)'
    });
  }

  var body = req.body || {};

  // T-44-08: face_value must be finite and in (0, 2000]
  var face_value = parseFloat(body.face_value);
  if (!isFinite(face_value) || face_value <= 0 || face_value > 2000) {
    return res.status(400).json({ error: 'face_value must be between $0.01 and $2000' });
  }

  // D-02 / T-44-09: cert_number must match /^GC-\d{6}$/ exactly
  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
  }

  var today = new Date().toISOString().slice(0, 10);
  var issued_by = String(body.issued_by || 'kiosk').slice(0, 64);
  var notes = String(body.notes || '').slice(0, 512);

  // Step 1: Reserve cert_number in Sheets via LockService-protected issue_gift_card.
  // The Apps Script handler checks for duplicates inside the lock (D-02).
  return callAppsScript('issue_gift_card', {
    cert_number: cert_number,
    face_value: face_value,
    issued_by: issued_by,
    notes: notes
  }).then(function (gsResult) {
    if (!gsResult.ok) {
      if (gsResult.error === 'duplicate') {
        // D-02: uniqueness gate — cert already exists in GiftCards sheet
        log.info('[gift-cards/issue] Duplicate cert_number rejected: ' + cert_number);
        return res.status(409).json({ error: 'Certificate number already in use' });
      }
      log.error('[gift-cards/issue] issue_gift_card failed: ' + (gsResult.error || 'unknown'));
      return res.status(500).json({ error: 'Failed to create certificate record' });
    }

    // Sheets row is now created. From this point, any Zoho failure must
    // trigger void_gift_card to prevent an orphan cert (T-44-12).

    // Step 2: Create Zoho invoice for the gift card sale.
    //   D-03: NO tax_id on the line item — KIOSK_GIFT_CARD_ITEM_ID carries its
    //         own 0%/EXEMPT setting which produces tax_total=0 (44-01 Probe B).
    //         ZOHO_TAX_ZERO_ID is NOT required and must NOT be passed here.
    //   D-04: KIOSK_GIFT_CARD_ITEM_ID maps to "Gift Card Sales" income account
    //         (109900000000873209). Account is set on the Zoho item — no override needed.
    return zohoPost('/invoices', {
      date: today,
      customer_id: process.env.KIOSK_CONTACT_ID,
      reference_number: cert_number,
      line_items: [{
        item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,
        name: 'Gift Certificate ' + cert_number,
        quantity: 1,
        rate: face_value
        // No tax_id — item is EXEMPT; omitting lets the item's own setting apply
      }],
      notes: 'Gift certificate ' + cert_number + '. Face value: $' + face_value.toFixed(2)
    }).then(function (invoiceData) {
      var invoice = invoiceData.invoice || {};
      var invoiceId = invoice.invoice_id || '';
      var invoiceNumber = invoice.invoice_number || '';

      log.info('[gift-cards/issue] Invoice created: ' + invoiceNumber + ' for ' + cert_number);

      // Step 3: Submit invoice (non-fatal) + record creditcard payment.
      // Terminal was used for the gift card sale — payment_mode:'creditcard'.
      return zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
        .then(function () {
          return zohoPost('/customerpayments', {
            customer_id: process.env.KIOSK_CONTACT_ID,
            payment_mode: 'creditcard',
            amount: face_value,
            date: today,
            invoices: [{ invoice_id: invoiceId, amount_applied: face_value }],
            notes: 'Gift certificate ' + cert_number + ' sale payment'
          });
        })
        .then(function () {
          // Step 4: Update Sheets row with the Zoho invoice number.
          return callAppsScript('update_gift_card_invoice', {
            cert_number: cert_number,
            zoho_invoice_number: invoiceNumber
          });
        })
        .then(function () {
          eventLog.logEvent('kiosk.gift_card_issued', {
            certNumber: cert_number,
            faceValue: face_value,
            invoiceNumber: invoiceNumber
          });
          return res.status(201).json({
            ok: true,
            cert_number: cert_number,
            face_value: face_value,
            zoho_invoice_number: invoiceNumber
          });
        });
    }).catch(function (zohoErr) {
      // T-44-12: Zoho invoice/payment failed AFTER the Sheets row was created.
      // Void the Sheets row to prevent an orphan cert with no Zoho audit trail.
      log.error('[gift-cards/issue] Zoho invoice/payment failed for ' + cert_number + ': ' + zohoErr.message);
      callAppsScript('void_gift_card', {
        cert_number: cert_number,
        reason: 'zoho_invoice_failed'
      }).catch(function (voidErr) {
        log.error('[gift-cards/issue] CRITICAL: void_gift_card fallback failed for ' + cert_number + ': ' + voidErr.message);
      });
      if (!res.headersSent) {
        return res.status(502).json({ error: 'Failed to record gift card sale in accounting system' });
      }
    });
  }).catch(function (err) {
    if (!res.headersSent) {
      log.error('[gift-cards/issue] Unexpected error: ' + err.message);
      return res.status(502).json({ error: 'Failed to issue gift certificate. Please try again.' });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/gift-card/reload
// Adds value to an existing active gift certificate.
// Rate-limited via paymentLimiter in server.js (same as issue — money path).
//
// ORDERING ASYMMETRY vs issue/redeem:
//   reload increments the balance FIRST (so the customer's added value is
//   never lost), then records the Zoho sale invoice + payment.
//   Issue creates the Sheets row first, then records Zoho (void-on-Zoho-failure).
//   Redeem decrements balance LAST (after Zoho) so a Zoho failure leaves
//   the balance untouched.
//   For reload: if Zoho fails AFTER the balance was incremented we do NOT
//   auto-reverse — the customer has paid and their balance is already up.
//   Log CRITICAL + return 502 with needs_manual_review so staff can reconcile
//   against the GiftCards sheet. Low volume / owner-visible sheet makes this
//   an acceptable ops trade-off (T-44-20 accepted).
//
// Zoho accounting mirrors the issue route (D-03/D-04):
//   - KIOSK_GIFT_CARD_ITEM_ID line, NO tax_id (item's own EXEMPT setting)
//   - creditcard payment for the reload amount
// ---------------------------------------------------------------------------
router.post('/api/kiosk/gift-card/reload', function (req, res) {
  // T-44-22 / Pitfall 4: fail-closed if gift card accounting is not configured.
  if (!process.env.KIOSK_GIFT_CARD_ITEM_ID) {
    log.warn('[gift-cards/reload] KIOSK_GIFT_CARD_ITEM_ID not set — refusing request (fail-closed)');
    return res.status(503).json({
      error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)'
    });
  }

  var body = req.body || {};

  // T-44-18: amount must be finite and in (0, 2000]
  var amount = parseFloat(body.amount);
  if (!isFinite(amount) || amount <= 0 || amount > 2000) {
    return res.status(400).json({ error: 'amount must be between $0.01 and $2000' });
  }

  // D-02 / T-44-19: cert_number must match /^GC-\d{6}$/ exactly
  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
  }

  var today = new Date().toISOString().slice(0, 10);

  // Step 1: Increment balance in Sheets via reload_gift_card.
  // ORDERING ASYMMETRY: balance incremented FIRST (before Zoho) so the
  // customer's added value is safe even if accounting fails.
  return callAppsScript('reload_gift_card', {
    cert_number: cert_number,
    amount: amount,
    transaction_ref: 'reload-' + Date.now()
  }).then(function (gsResult) {
    if (!gsResult.ok) {
      if (gsResult.error === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Certificate not found' });
      }
      if (gsResult.error === 'invalid_status') {
        // T-44-19: cert is voided or otherwise inactive — cannot reload
        log.info('[gift-cards/reload] Cert not active for reload: ' + cert_number +
          ' (status: ' + (gsResult.status || 'unknown') + ')');
        return res.status(409).json({
          ok: false,
          error: 'Certificate is not active and cannot be reloaded'
        });
      }
      log.error('[gift-cards/reload] reload_gift_card failed: ' + (gsResult.error || 'unknown'));
      return res.status(500).json({ error: 'Failed to reload certificate' });
    }

    var newBalance = gsResult.new_balance;

    // Balance is now incremented. Record the Zoho sale.
    // D-03: NO tax_id — KIOSK_GIFT_CARD_ITEM_ID carries its own 0%/EXEMPT setting.
    // D-04: item maps to "Gift Card Sales" income account (same as issue).
    return zohoPost('/invoices', {
      date: today,
      customer_id: process.env.KIOSK_CONTACT_ID,
      reference_number: cert_number,
      line_items: [{
        item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,
        name: 'Gift Certificate Reload ' + cert_number,
        quantity: 1,
        rate: amount
        // No tax_id — item is EXEMPT; omitting lets the item's own setting apply
      }],
      notes: 'Gift certificate ' + cert_number + ' reload. Added: $' + amount.toFixed(2) +
        '. New balance: $' + (typeof newBalance === 'number' ? newBalance.toFixed(2) : String(newBalance))
    }).then(function (invoiceData) {
      var invoice = invoiceData.invoice || {};
      var invoiceId = invoice.invoice_id || '';
      var invoiceNumber = invoice.invoice_number || '';

      log.info('[gift-cards/reload] Invoice created: ' + invoiceNumber + ' for reload of ' + cert_number);

      // Submit invoice (non-fatal) + record creditcard payment.
      return zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
        .then(function () {
          return zohoPost('/customerpayments', {
            customer_id: process.env.KIOSK_CONTACT_ID,
            payment_mode: 'creditcard',
            amount: amount,
            date: today,
            invoices: [{ invoice_id: invoiceId, amount_applied: amount }],
            notes: 'Gift certificate ' + cert_number + ' reload payment'
          });
        })
        .then(function () {
          eventLog.logEvent('kiosk.gift_card_reloaded', {
            certNumber: cert_number,
            amount: amount,
            newBalance: newBalance
          });
          return res.status(200).json({
            ok: true,
            cert_number: cert_number,
            new_balance: newBalance
          });
        });
    }).catch(function (zohoErr) {
      // T-44-20: balance already incremented — do NOT auto-reverse.
      // Staff must reconcile via GiftCards sheet + Zoho invoice queue.
      log.error('[gift-cards/reload] CRITICAL: Zoho invoice/payment failed for reload of ' +
        cert_number + ' (balance already incremented): ' + zohoErr.message);
      if (!res.headersSent) {
        return res.status(502).json({
          ok: false,
          error: 'Failed to record reload in accounting system. Balance has been updated — staff reconciliation required.',
          needs_manual_review: true
        });
      }
    });
  }).catch(function (err) {
    if (!res.headersSent) {
      log.error('[gift-cards/reload] Unexpected error: ' + err.message);
      return res.status(502).json({ error: 'Failed to reload gift certificate. Please try again.' });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/gift-card/void
// Cancels a gift certificate — sets status='void' in the GiftCards sheet.
// No Zoho money movement (status-only change).
// A voided cert returns invalid_status on any later redeem or reload.
// ---------------------------------------------------------------------------
router.post('/api/kiosk/gift-card/void', function (req, res) {
  var body = req.body || {};

  // D-02 / T-44-21: cert_number must match /^GC-\d{6}$/ exactly
  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
  }

  // T-44-21: require a non-empty reason (sanitized + length-capped for audit trail)
  var reason = String(body.reason || '').trim().slice(0, 512);
  if (!reason) {
    return res.status(400).json({ error: 'reason is required to void a certificate' });
  }

  return callAppsScript('void_gift_card', {
    cert_number: cert_number,
    reason: reason
  }).then(function (gsResult) {
    if (!gsResult.ok) {
      if (gsResult.error === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Certificate not found' });
      }
      log.error('[gift-cards/void] void_gift_card failed: ' + (gsResult.error || 'unknown'));
      return res.status(500).json({ error: 'Failed to void certificate' });
    }

    log.info('[gift-cards/void] Certificate voided: ' + cert_number + ' (reason: ' + reason + ')');
    eventLog.logEvent('kiosk.gift_card_voided', {
      certNumber: cert_number,
      reason: reason
    });
    return res.status(200).json({ ok: true });
  }).catch(function (err) {
    log.error('[gift-cards/void] Unexpected error: ' + err.message);
    return res.status(502).json({ error: 'Failed to void gift certificate. Please try again.' });
  });
});

module.exports = router;
