'use strict';

var express = require('express');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var cache = require('../lib/cache');
var C = require('../lib/constants');
var authTiers = require('../lib/authTiers');
var giftCardStore = require('../lib/gift-card-store');

var router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/kiosk/gift-card/adjust (Phase 84, DB-03) — maps a facade-
// returned business error code to its HTTP status + body. 'tx_ref_conflict'
// (idempotency key reused for a different cert/kind) gets its own explicit
// 409 rather than falling into the generic-500 default — the kiosk must
// mint a fresh adjust_key and retry, not treat it as a server crash.
// ---------------------------------------------------------------------------
var ADJUST_ERROR_STATUS = {
  not_found: 404,
  invalid_status: 409,
  negative_balance: 409,
  invalid_amount: 400,
  adjust_unavailable: 403,
  tx_ref_conflict: 409
};

function mapAdjustError(result) {
  var status = ADJUST_ERROR_STATUS[result.error] || 500;
  var body = { ok: false, error: result.error === 'not_found' ? 'Certificate not found' : result.error };
  if (result.error === 'invalid_status') body.status = result.status;
  if (result.error === 'negative_balance') body.balance = result.balance;
  return { status: status, body: body };
}

var ADJUST_VALID_REASONS = ['correction', 'goodwill', 'refund-to-card', 'other'];
var ADJUST_MAX_AMOUNT = 99999999.99;

// M8 (Phase 52-05): next-number is a suggestion only — the server still
// enforces uniqueness on issue — so a short cache is safe (reduces repeat
// Apps Script calls from a busy kiosk without risking a stale money value).
// D-14 (Phase 84): this cache is sheets-mode-only — dual/postgres never
// serve a suggestion from it (see the next-number handler below).
var GC_NEXT_NUMBER_CACHE_TTL = 30; // seconds

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
    var mode = giftCardStore.getMode();

    // D-14: dual/postgres never serve a suggestion from the 30s cache — a
    // sequence value must never be handed out twice.
    if (mode !== 'sheets') {
      return giftCardStore.nextCertNumber().then(function (result) {
        if (!result.ok) {
          log.warn('[gift-cards/next-number] error: ' + (result.error || 'unknown'));
          return res.status(500).json({ error: 'Failed to get next cert number' });
        }
        return res.status(200).json({ ok: true, suggested: result.suggested });
      }).catch(function (err) {
        log.error('[gift-cards/next-number] call failed: ' + err.message);
        return res.status(502).json({ error: 'Failed to reach Apps Script' });
      });
    }

    var cacheKey = C.CACHE_KEYS.GIFT_CARD_NEXT_NUMBER;

    return cache.get(cacheKey).then(function (cached) {
      if (cached) {
        return res.status(200).json(cached);
      }
      return giftCardStore.nextCertNumber().then(function (result) {
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

    var mode = giftCardStore.getMode();

    // 84-05 Claude's-Discretion: the staff lookup is the one read that
    // opts into the dual-mode sheet-compare leg ({compare: true}).
    return giftCardStore.lookup(certNumber, { compare: true }).then(function (result) {
      if (!result.ok) {
        if (result.error === 'not_found') {
          return res.status(404).json({ ok: false, error: 'Certificate not found' });
        }
        log.warn('[gift-cards/lookup] error for ' + certNumber + ': ' + (result.error || 'unknown'));
        return res.status(500).json({ error: 'Failed to look up certificate' });
      }
      // D-05: return server-authoritative data; never expose internal Zoho IDs.
      // D-07: data.store_mode lets the kiosk learn the mode.
      return res.status(200).json({
        ok: true,
        data: Object.assign({}, result.data, { store_mode: mode })
      });
    }).catch(function (err) {
      log.error('[gift-cards/lookup] call failed: ' + err.message);
      // D-09: dual/postgres never falls back to a sheet read on a DB
      // failure — surface as a clean 503, never the sheets-mode 502.
      if (mode !== 'sheets') {
        return res.status(503).json({ error: 'Gift card lookup temporarily unavailable' });
      }
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

  var mode = giftCardStore.getMode();

  return giftCardStore.voidCard({
    certNumber: cert_number,
    reason: reason,
    actor: giftCardStore.actorFromRequest(req, 'kiosk-void')
  }).then(function (gsResult) {
    if (!gsResult.ok) {
      if (gsResult.error === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Certificate not found' });
      }
      log.error('[gift-cards/void] voidCard failed: ' + (gsResult.error || 'unknown'));
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
    if (mode !== 'sheets') {
      return res.status(503).json({ error: 'Gift card service temporarily unavailable' });
    }
    return res.status(502).json({ error: 'Failed to void gift certificate. Please try again.' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/gift-card/adjust
// Ledgered balance-adjust control (D-05/D-06/D-07). Every field is
// validated server-side — the kiosk UI's client-side checks (84-03) are
// UX-only, never trusted. No Zoho Books write of any kind happens here
// (D-08) — the Postgres ledger row (plus its sheet mirror in dual mode) IS
// the record.
// ---------------------------------------------------------------------------
router.post('/api/kiosk/gift-card/adjust', function (req, res) {
  var body = req.body || {};

  // D-07: server-side mode gate, checked before any other work — sheets
  // mode has no dedicated adjust action.
  if (giftCardStore.getMode() === 'sheets') {
    return res.status(403).json({ ok: false, error: 'adjust_unavailable', store_mode: 'sheets' });
  }

  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
  }

  // T-84-37: finite, non-zero, at most 2 decimal places, within the
  // numeric(10,2) column bound. No cap beyond that bound (D-06 "No cap").
  var delta = Number(body.delta);
  if (!isFinite(delta) || delta === 0 || Math.abs(delta) > ADJUST_MAX_AMOUNT ||
      Math.abs(Math.round(delta * 100) - delta * 100) >= 1e-6) {
    return res.status(400).json({ error: 'delta must be a non-zero number with at most 2 decimal places' });
  }

  var reason = String(body.reason || '');
  if (ADJUST_VALID_REASONS.indexOf(reason) === -1) {
    return res.status(400).json({ error: 'reason must be one of: ' + ADJUST_VALID_REASONS.join(', ') });
  }

  var note = String(body.note || '').trim().slice(0, 512);
  if (reason === 'other' && !note) {
    return res.status(400).json({ error: 'note is required when reason is "other"' });
  }

  // D-05: self-reported actor name — control characters stripped, must
  // contain at least one letter (rejects a bare numeric "signature").
  var actorName = String(body.actor_name || '').replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!actorName || actorName.length > 60 || !/[A-Za-z]/.test(actorName)) {
    return res.status(400).json({ error: 'actor_name must be 1-60 characters and contain a letter' });
  }

  // ASSUMPTION (orchestrator note, owner not yet confirmed): D-05's "device
  // ID" requirement is satisfied by this self-reported device_label because
  // kiosk auth is one shared KIOSK_DEVICE_TOKEN with no per-device identity
  // (RESEARCH Open Question 1) — there is no server-issued device ID to
  // validate against instead.
  var deviceLabel = String(body.device_label || '').trim();
  if (!/^[A-Za-z0-9 _.-]{1,40}$/.test(deviceLabel)) {
    return res.status(400).json({ error: 'device_label must be 1-40 characters (letters, digits, space, _.-)' });
  }

  // T-84-41: adjust_key mints the deterministic tx_ref that makes a
  // double-submitted adjust idempotent server-side.
  var adjustKey = String(body.adjust_key || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(adjustKey)) {
    return res.status(400).json({ error: 'adjust_key must be 8-64 characters (letters, digits, -)' });
  }

  // T-84-40: required actor_name + device_label + reason (+ note for
  // "other") on every ledger row removes anonymous adjustment.
  return giftCardStore.adjust({
    certNumber: cert_number,
    delta: delta,
    reason: reason,
    note: note || null,
    actorName: actorName,
    deviceLabel: deviceLabel,
    adjustKey: adjustKey,
    actor: giftCardStore.actorFromRequest(req, 'kiosk-adjust')
  }).then(function (result) {
    if (!result.ok) {
      var mapped = mapAdjustError(result);
      return res.status(mapped.status).json(mapped.body);
    }

    eventLog.logEvent('kiosk.gift_card_adjusted', {
      certNumber: cert_number,
      delta: delta,
      reason: reason,
      actorName: actorName,
      deviceLabel: deviceLabel
    });

    return res.status(200).json({
      ok: true,
      data: {
        cert_number: cert_number,
        current_balance: result.new_balance,
        status: result.status,
        idempotent: !!result.idempotent
      }
    });
  }).catch(function (err) {
    log.error('[gift-cards/adjust] Unexpected error: ' + err.message);
    return res.status(503).json({ error: 'Gift card service temporarily unavailable' });
  });
});

module.exports = router;
