/**
 * Product request form — public POST, admin GET.
 * No Zoho auth required; mounted before authGuard.
 */

var express = require('express');
var router = express.Router();
var cache = require('../lib/cache');
var log = require('../lib/logger');

var REQUESTS_KEY = 'sv:product-requests';
var MAX_REQUESTS = 500;

// POST /product-requests — anyone can submit
router.post('/product-requests', function (req, res) {
  var name = (req.body.name || '').toString().trim().substring(0, 100);
  var email = (req.body.email || '').toString().trim().substring(0, 200);
  var items = (req.body.items || '').toString().trim().substring(0, 1000);

  if (!name || !email || !items) {
    return res.status(400).json({ error: 'name, email, and items are required' });
  }

  // Basic email sanity check
  if (!email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  var entry = {
    name: name,
    email: email,
    items: items,
    submitted_at: new Date().toISOString()
  };

  cache.get(REQUESTS_KEY).then(function (existing) {
    var list = Array.isArray(existing) ? existing : [];
    list.unshift(entry); // newest first
    if (list.length > MAX_REQUESTS) list = list.slice(0, MAX_REQUESTS);
    return cache.set(REQUESTS_KEY, list, 365 * 24 * 3600);
  }).then(function () {
    log.info('[product-requests] New request from ' + email);
    res.json({ ok: true });
  }).catch(function (err) {
    log.error('[product-requests] Failed to store request: ' + (err && err.message));
    // Still acknowledge — don't lose the submission silently
    res.json({ ok: true });
  });
});

// GET /product-requests — admin only (requires x-api-key)
var API_SECRET_KEY = process.env.API_SECRET_KEY || '';

router.get('/product-requests', function (req, res) {
  if (!API_SECRET_KEY || req.headers['x-api-key'] !== API_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  cache.get(REQUESTS_KEY).then(function (list) {
    res.json({ ok: true, requests: Array.isArray(list) ? list : [] });
  }).catch(function () {
    res.json({ ok: true, requests: [] });
  });
});

module.exports = router;
