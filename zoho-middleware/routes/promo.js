'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var redact = require('../lib/redact');

var PROMO_CODE = 'FIRSTBATCH';
var PROMO_DISCOUNT_PCT = 20;
var KIOSK_PRESET_TTL = 30 * 24 * 60 * 60; // 30 days, same as discounts.js

var router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/promo/validate — public endpoint (no API key required)
// Validates a promo code and checks per-email redemption eligibility.
// ---------------------------------------------------------------------------

router.post('/api/promo/validate', async function (req, res) {
  var body = req.body || {};
  var rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  var rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!rawCode) {
    return res.status(400).json({ error: 'Promo code is required.' });
  }

  if (!rawEmail || rawEmail.indexOf('@') === -1) {
    return res.status(400).json({ error: 'A valid email address is required to use a promo code.' });
  }

  if (rawCode !== PROMO_CODE) {
    return res.status(400).json({ error: 'That promo code isn\'t valid.' });
  }

  try {
    var redeemed = await cache.get(C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + rawEmail);
    if (redeemed) {
      return res.status(400).json({ error: 'This code has already been used for this email address. Each code is one use per customer.' });
    }
    return res.json({ ok: true, discountPct: PROMO_DISCOUNT_PCT, code: PROMO_CODE });
  } catch (err) {
    // Fail open — Redis unavailable should not block legitimate customers
    log.error('[promo/validate] Redis error, failing open: ' + err.message);
    return res.json({ ok: true, discountPct: PROMO_DISCOUNT_PCT, code: PROMO_CODE });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/promo/redemption/:email — admin endpoint (API key required)
// Clears a per-email redemption record so the customer can redeem again.
// ---------------------------------------------------------------------------

router.delete('/api/promo/redemption/:email', async function (req, res) {
  var email = typeof req.params.email === 'string' ? req.params.email.trim().toLowerCase() : '';

  if (!email || email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    await cache.del(C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + email);
    return res.json({ ok: true, email: email, message: 'Redemption cleared' });
  } catch (err) {
    log.error('[promo/reset] Failed to clear redemption for ' + redact.maskEmail(email) + ': ' + err.message);
    return res.status(500).json({ error: 'Failed to clear redemption' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/promo/seed-kiosk — admin endpoint (API key required, per D-07)
// Creates the FIRSTBATCH discount preset in the kiosk preset store so staff
// can apply it from the kiosk UI. Idempotent — no-op if preset already exists.
// ---------------------------------------------------------------------------

router.post('/api/promo/seed-kiosk', function (req, res) {
  cache.get(C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS).then(function (data) {
    var presets = Array.isArray(data) ? data : [];

    // Check if FIRSTBATCH preset already exists
    var found = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].name === PROMO_CODE) {
        found = presets[i];
        break;
      }
    }

    if (found) {
      return res.json({ ok: true, message: 'FIRSTBATCH preset already exists', preset: found });
    }

    var preset = {
      id: 'promo_firstbatch',
      name: PROMO_CODE,
      type: 'percentage',
      value: PROMO_DISCOUNT_PCT,
      scope: 'cart',
      active: true,
      created_at: new Date().toISOString()
    };

    presets.push(preset);
    return cache.set(C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS, presets, KIOSK_PRESET_TTL).then(function () {
      log.info('[promo/seed-kiosk] Created FIRSTBATCH kiosk discount preset');
      return res.status(201).json({ ok: true, message: 'FIRSTBATCH preset created', preset: preset });
    });
  }).catch(function (err) {
    log.error('[promo/seed-kiosk] Failed to seed kiosk preset: ' + err.message);
    return res.status(500).json({ error: 'Failed to seed kiosk preset' });
  });
});

module.exports = router;
