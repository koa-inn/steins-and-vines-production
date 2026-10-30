'use strict';

// lib/kiosk-sale-catalog.js — the ONE place kiosk sale paths resolve the
// catalogue they anchor prices and tax to (follow-up to 261029-zq1,
// owner-approved 2026-10-29).
//
// Order: live cache (zoho:kiosk-products) → one rebuild from Zoho → the
// last-good copy every successful rebuild writes (kiosk:products:lastgood).
// The last-good step only runs when the rebuild FAILS (quota exhausted, 429,
// cooldown, network); with no last-good copy the rebuild error is rethrown so
// callers keep their existing error responses. The last-good copy is the
// exact array a successful rebuild produced, so prices and tax fields
// (including CR-02 null tax) are unchanged — callers apply the same checks.

var cache = require('./cache');
var C = require('./constants');

function defaultUsable(items) {
  return Array.isArray(items) && items.length > 0;
}

function readLastGood() {
  return Promise.all([
    cache.get(C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD),
    cache.get(C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD_AT)
  ]).then(function (r) {
    if (!Array.isArray(r[0]) || r[0].length === 0) return null;
    return { items: r[0], source: 'stale', staleAt: typeof r[1] === 'string' ? r[1] : null };
  }, function () { return null; });
}

/**
 * getKioskCatalogForSale(opts) → Promise<{ items, source, staleAt }>
 *
 * opts.isUsable(items) — whether the cached catalogue can serve this request
 *   (default: non-empty array). processSale passes "every cart item is in it".
 * opts.rebuild — false skips the Zoho rebuild and goes straight to last-good
 *   (the post-charge confirm path, which has never rebuilt).
 *
 * source: 'cache' (live cache used, staleAt null), 'zoho' (rebuilt now),
 * 'stale' (rebuild failed or skipped; last-good copy, staleAt = its rebuild
 * time). With rebuild:false and no last-good copy it resolves the cached value
 * as source 'cache' so the caller's existing not-found handling runs.
 *
 * Rejections: a cache read error rejects with err.stage = 'cache'; a rebuild
 * error with no last-good copy rejects with that error, err.stage = 'rebuild'.
 */
function getKioskCatalogForSale(opts) {
  opts = opts || {};
  var isUsable = typeof opts.isUsable === 'function' ? opts.isUsable : defaultUsable;

  return cache.get(C.CACHE_KEYS.KIOSK_PRODUCTS).then(function (cached) {
    if (isUsable(cached)) return { items: cached, source: 'cache', staleAt: null };

    if (opts.rebuild === false) {
      return readLastGood().then(function (lg) {
        return lg || { items: cached, source: 'cache', staleAt: null };
      });
    }

    // Lazy require: routes/catalog.js is heavy and route tests mock it.
    return require('../routes/catalog').rebuildKioskCatalog().then(function (fresh) {
      return { items: fresh, source: 'zoho', staleAt: null };
    }, function (rebuildErr) {
      return readLastGood().then(function (lg) {
        if (lg) {
          lg.rebuildError = rebuildErr;
          return lg;
        }
        if (rebuildErr && typeof rebuildErr === 'object') rebuildErr.stage = 'rebuild';
        throw rebuildErr;
      });
    });
  }, function (cacheErr) {
    if (cacheErr && typeof cacheErr === 'object') cacheErr.stage = 'cache';
    throw cacheErr;
  });
}

module.exports = { getKioskCatalogForSale: getKioskCatalogForSale };
