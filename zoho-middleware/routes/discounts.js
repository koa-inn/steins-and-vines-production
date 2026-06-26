'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var discountMatch = require('../lib/discount-match');

var CACHE_KEY = C.CACHE_KEYS.KIOSK_DISCOUNT_PRESETS;
var CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

var router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return 'disc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function validatePreset(body, isUpdate) {
  var errors = [];

  if (!isUpdate || body.name !== undefined) {
    var name = (typeof body.name === 'string') ? body.name.trim() : '';
    if (!name || name.length === 0) {
      errors.push('name is required (1-64 characters)');
    } else if (name.length > 64) {
      errors.push('name must be 64 characters or fewer');
    }
  }

  if (!isUpdate || body.type !== undefined) {
    if (body.type !== 'percentage' && body.type !== 'fixed') {
      errors.push('type must be "percentage" or "fixed"');
    }
  }

  if (!isUpdate || body.value !== undefined) {
    var value = Number(body.value);
    if (isNaN(value) || value <= 0) {
      errors.push('value must be a number greater than 0');
    } else {
      // For updates, use supplied type or defer full range check to caller
      var effectiveType = body.type;
      if (effectiveType === 'percentage' && value > 100) {
        errors.push('percentage value must be 100 or less');
      }
      if (effectiveType === 'fixed' && value > 9999.99) {
        errors.push('fixed value must be 9999.99 or less');
      }
    }
  }

  if (!isUpdate || body.scope !== undefined) {
    if (body.scope !== 'cart' && body.scope !== 'type') {
      errors.push('scope must be "cart" or "type"');
    }
  }

  // applies_to: required + validated when scope is "type"; validated whenever supplied.
  // For creates, a "type" scope must carry a non-empty, known-token applies_to.
  if (body.applies_to !== undefined) {
    errors = errors.concat(discountMatch.validateAppliesTo(body.applies_to));
  } else if (!isUpdate && body.scope === 'type') {
    errors.push('applies_to is required when scope is "type"');
  }

  return errors;
}

function loadPresets() {
  return cache.get(CACHE_KEY).then(function (data) {
    return Array.isArray(data) ? data : [];
  });
}

function savePresets(presets) {
  return cache.set(CACHE_KEY, presets, CACHE_TTL);
}

// ---------------------------------------------------------------------------
// GET /api/kiosk/discounts
// ---------------------------------------------------------------------------

router.get('/api/kiosk/discounts', function (req, res) {
  loadPresets().then(function (presets) {
    res.json({ ok: true, discounts: presets });
  }).catch(function (err) {
    log.error('[discounts] GET error: ' + err.message);
    res.status(500).json({ error: 'Failed to load discount presets' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/discounts
// ---------------------------------------------------------------------------

router.post('/api/kiosk/discounts', function (req, res) {
  var body = req.body || {};
  var errors = validatePreset(body, false);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  var preset = {
    id: generateId(),
    name: body.name.trim(),
    type: body.type,
    value: Number(body.value),
    scope: body.scope,
    active: true,
    created_at: new Date().toISOString()
  };
  if (body.scope === 'type') {
    preset.applies_to = body.applies_to;
  }

  loadPresets().then(function (presets) {
    presets.push(preset);
    return savePresets(presets).then(function () {
      log.info('[discounts] Created preset: ' + preset.id + ' (' + preset.name + ')');
      res.status(201).json({ ok: true, discount: preset });
    });
  }).catch(function (err) {
    log.error('[discounts] POST error: ' + err.message);
    res.status(500).json({ error: 'Failed to create discount preset' });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/kiosk/discounts/:id
// ---------------------------------------------------------------------------

router.put('/api/kiosk/discounts/:id', function (req, res) {
  var body = req.body || {};
  var errors = validatePreset(body, true);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  loadPresets().then(function (presets) {
    var found = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === req.params.id) {
        found = presets[i];
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Discount preset not found' });
    }

    if (body.name !== undefined) found.name = body.name.trim();
    if (body.type !== undefined) found.type = body.type;
    if (body.value !== undefined) found.value = Number(body.value);
    if (body.scope !== undefined) found.scope = body.scope;
    if (body.applies_to !== undefined) found.applies_to = body.applies_to;
    if (body.active !== undefined) found.active = !!body.active;

    // Coherence: a "type"-scoped preset must end up with a valid applies_to;
    // a "cart"-scoped preset must not carry one.
    if (found.scope === 'type') {
      var appliesErrors = discountMatch.validateAppliesTo(found.applies_to);
      if (appliesErrors.length > 0) {
        return res.status(400).json({ error: appliesErrors.join('; ') });
      }
    } else if (found.scope === 'cart') {
      delete found.applies_to;
    }

    return savePresets(presets).then(function () {
      log.info('[discounts] Updated preset: ' + found.id);
      res.json({ ok: true, discount: found });
    });
  }).catch(function (err) {
    log.error('[discounts] PUT error: ' + err.message);
    res.status(500).json({ error: 'Failed to update discount preset' });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/kiosk/discounts/:id
// ---------------------------------------------------------------------------

router.delete('/api/kiosk/discounts/:id', function (req, res) {
  loadPresets().then(function (presets) {
    var idx = -1;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === req.params.id) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      return res.status(404).json({ error: 'Discount preset not found' });
    }

    presets.splice(idx, 1);

    return savePresets(presets).then(function () {
      log.info('[discounts] Deleted preset: ' + req.params.id);
      res.json({ ok: true });
    });
  }).catch(function (err) {
    log.error('[discounts] DELETE error: ' + err.message);
    res.status(500).json({ error: 'Failed to delete discount preset' });
  });
});

module.exports = router;
