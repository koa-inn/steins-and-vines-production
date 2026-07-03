'use strict';

var express = require('express');
var axios = require('axios');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var cache = require('../lib/cache');
var C = require('../lib/constants');
var authTiers = require('../lib/authTiers');

var router = express.Router();

// M8 (Phase 52-05): next-number is a suggestion only — the server still
// enforces uniqueness on issue — so a short cache is safe (reduces repeat
// Apps Script calls from a busy kiosk without risking a stale money value).
var GC_NEXT_NUMBER_CACHE_TTL = 30; // seconds

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
// The client pre-fills the cert_number field; staff may override.
// The server still enforces uniqueness on issue.
// M8 (Phase 52-05): gated behind a credential tier + a short read-through
// cache — this was previously unauth + uncached, letting an anon caller
// repeatedly exhaust Apps Script quota (KIOSK_ROUTES entry, kiosk-scoped).
// ---------------------------------------------------------------------------
router.get('/api/kiosk/gift-card/next-number', function (req, res) {
  return authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
    var cacheKey = C.CACHE_KEYS.GIFT_CARD_NEXT_NUMBER;

    return cache.get(cacheKey).then(function (cached) {
      if (cached) {
        return res.status(200).json(cached);
      }
      return callAppsScript('get_next_cert_number', {}).then(function (result) {
        if (!result.ok) {
          log.warn('[gift-cards/next-number] Apps Script error: ' + (result.error || 'unknown'));
          return res.status(500).json({ error: 'Failed to get next cert number' });
        }
        var body = { ok: true, suggested: result.suggested };
        cache.set(cacheKey, body, GC_NEXT_NUMBER_CACHE_TTL);
        return res.status(200).json(body);
      });
    }).catch(function (err) {
      log.error('[gift-cards/next-number] Apps Script call failed: ' + err.message);
      return res.status(502).json({ error: 'Failed to reach Apps Script' });
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/gift-card/lookup?cert_number=GC-NNNNNN
// Server-authoritative balance lookup (D-05).
// Client never supplies a balance — balance always read from Apps Script.
// M8 (Phase 52-05): gated behind a credential tier (KIOSK_ROUTES entry,
// kiosk-scoped) — was previously unauth, letting an anon caller repeatedly
// exhaust Apps Script quota. T-52-M8b: this returns a live gift-card
// BALANCE — deliberately NOT cached (auth alone stops the quota DoS;
// caching a balance risks serving a stale value into a redemption, i.e.
// over-redemption).
// ---------------------------------------------------------------------------
router.get('/api/kiosk/gift-card/lookup', function (req, res) {
  return authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
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
});

// NOTE (Phase 44-09): POST /api/kiosk/gift-card/issue and POST /api/kiosk/gift-card/reload
// have been DECOMMISSIONED. Their phantom creditcard customerpayment flow (G-44-01 defect)
// is replaced by the cart+terminal checkout in pos.js — gift_cert lines in the kiosk cart
// are charged via the real Helcim terminal and activated post-payment via issue_gift_card /
// reload_gift_card in the confirm chain. The standalone routes no longer exist.

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
