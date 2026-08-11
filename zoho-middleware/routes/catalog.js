var express = require('express');
var fs = require('fs');
var path = require('path');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');

var ledger = require('../lib/inventory-ledger');
var authTiers = require('../lib/authTiers');

var fetchAllItems = zohoApi.fetchAllItems;
var fetchItemDetailsBulk = zohoApi.fetchItemDetailsBulk;

// ---------------------------------------------------------------------------
// Shared raw items cache
// ---------------------------------------------------------------------------
// A short-lived (60 s) in-memory cache that coalesces concurrent cold-cache
// requests across services/ingredients/kiosk/snapshot into a single Zoho
// paginated fetch. Without this, a simultaneous cold-cache burst fires 3–4
// full fetchAllItems() calls in parallel, burning Zoho rate-limit quota.
// doRefreshProducts() is intentionally excluded — it runs under a distributed
// lock and does its own filtering; sharing its fetch here could return a
// stale raw list during the enrichment window.

var _rawItemsCache = null;
var _rawItemsCacheAt = 0;
var RAW_ITEMS_TTL_MS = 60 * 1000; // 60 seconds
var _rawItemsPromise = null;
// Timestamp after which it is safe to retry Zoho Inventory list fetches.
// Set to now+90s after a 429 to give Zoho's per-minute quota time to reset.
var _rawItemsCooldownUntil = 0;
var _productsCooldownUntil = 0;

function fetchAllItemsCached() {
  var now = Date.now();
  if (_rawItemsCache && (now - _rawItemsCacheAt) < RAW_ITEMS_TTL_MS) {
    return Promise.resolve(_rawItemsCache);
  }
  if (now < _rawItemsCooldownUntil) {
    var waitSec = Math.ceil((_rawItemsCooldownUntil - now) / 1000);
    return Promise.reject(new Error('Zoho Inventory rate-limited — cooling down (' + waitSec + 's remaining)'));
  }
  if (_rawItemsPromise) return _rawItemsPromise;
  _rawItemsPromise = fetchAllItems({ status: 'active' }).then(function (items) {
    _rawItemsCache = items;
    _rawItemsCacheAt = Date.now();
    _rawItemsPromise = null;
    return items;
  }, function (err) {
    _rawItemsPromise = null;
    if (err.response && err.response.status === 429) {
      var retryAfter = err.response.headers && parseInt(err.response.headers['retry-after'], 10);
      _rawItemsCooldownUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 90000);
      log.warn('[catalog] Inventory list 429 — cooldown until ' + new Date(_rawItemsCooldownUntil).toISOString());
    }
    throw err;
  });
  return _rawItemsPromise;
}

var router = express.Router();

// ---------------------------------------------------------------------------
// Cache constants
// ---------------------------------------------------------------------------

var PRODUCTS_CACHE_KEY = C.CACHE_KEYS.PRODUCTS;
var PRODUCTS_CACHE_TTL = 3600; // 1 hour hard TTL
var PRODUCTS_SOFT_TTL = 600;   // 10 minutes — triggers background refresh
var PRODUCTS_CACHE_TS_KEY = C.CACHE_KEYS.PRODUCTS_TS; // timestamp of last enrichment
var PRODUCT_IMAGE_HASHES_KEY = C.CACHE_KEYS.PRODUCT_IMAGE_HASHES; // image change detection
var REFRESH_LOCK_KEY = 'products:refresh';
var REFRESH_LOCK_TTL = 120; // 2-min auto-expire if process crashes mid-refresh
// __dirname is routes/ subdirectory, so go up one level to middleware root
var PRODUCTS_FILE_CACHE = path.join(__dirname, '..', 'products-cache.json');
var INGREDIENTS_FILE_CACHE = path.join(__dirname, '..', 'ingredients-cache.json');
// Full ingredient list INCLUDING Internal Only items — admin-only (recipe builder).
// Kept separate from the public list so checkout/POS validation (which read
// INGREDIENTS_CACHE_KEY) never treat an internal-only item as purchasable.
var INGREDIENTS_ALL_CACHE_KEY = C.CACHE_KEYS.INGREDIENTS_ALL;
var INGREDIENTS_ALL_FILE_CACHE = path.join(__dirname, '..', 'ingredients-all-cache.json');

var SERVICES_CACHE_KEY = C.CACHE_KEYS.SERVICES;
var SERVICES_CACHE_TTL = 1800; // 30 minutes

var INGREDIENTS_CACHE_KEY = C.CACHE_KEYS.INGREDIENTS;
var INGREDIENTS_CACHE_TTL = 3600; // 1 hour (match products TTL)
var INGREDIENTS_CACHE_TS_KEY = C.CACHE_KEYS.INGREDIENTS_TS;
var INGREDIENTS_SOFT_TTL = 600; // 10 minutes — triggers background refresh

var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
var KIOSK_PRODUCTS_CACHE_TTL = 1800; // 30 minutes

// Kit type values that belong on the kits/products page.
// Used by both doRefreshProducts() and GET /api/ingredients.
var KIT_CATEGORIES = C.KIT_CATEGORIES;

// In-memory set of kit item IDs (populated by GET /api/products).
// Used by /api/ingredients to exclude kits even when Redis is down.
var _kitItemIds = {};
var _productsRefreshing = false; // in-process guard (Redis-down fallback)
var _ingredientsRefreshPromise = null; // coalesces concurrent cold-cache requests

// ---------------------------------------------------------------------------
// Tax rule lookup
// ---------------------------------------------------------------------------
// Zoho items may have sales_tax_rule_id set (the Sales Tax Rule from the UI)
// even when tax_id points to "Zero Rate" — the rule carries the real rate.
// Uses the same env var defaults as routes/taxes.js.
var _TAX_RULE_PCT = {};
_TAX_RULE_PCT[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 12;  // GST + PST - Standard
_TAX_RULE_PCT[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 0;   // Zero Rated - Ingredients
_TAX_RULE_PCT[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 5;   // GST Only - Services
_TAX_RULE_PCT[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 15;  // GST + PST Liquor
var _TAX_RULE_NAME = {};
_TAX_RULE_NAME[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 'GST + PST';
_TAX_RULE_NAME[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 'Zero Rated';
_TAX_RULE_NAME[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 'GST';
_TAX_RULE_NAME[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 'GST + PST Liquor';

// ---------------------------------------------------------------------------
// Product refresh logic
// ---------------------------------------------------------------------------

/**
 * GET /api/products
 * Returns active product items from Zoho Inventory, enriched with custom_fields
 * and brand from the detail endpoint. Cached in Redis for 10 minutes.
 *
 * The list endpoint does not return custom_fields, so we fetch each item's
 * detail (5 concurrent) to get type, subcategory, tasting notes, body, oak,
 * sweetness, ABV, etc. Services and Ingredients groups are filtered out.
 */
function refreshProducts() {
  // Fast in-process guard first (no Redis round-trip needed for single-instance case)
  if (_productsRefreshing) {
    log.info('[api/products] Refresh already in progress, skipping');
    return Promise.resolve();
  }

  // 429 cooldown — don't hammer Zoho immediately after a rate-limit response
  if (Date.now() < _productsCooldownUntil) {
    var waitSec = Math.ceil((_productsCooldownUntil - Date.now()) / 1000);
    log.info('[api/products] 429 cooldown active — skipping refresh (' + waitSec + 's remaining)');
    return Promise.resolve();
  }

  // Redis distributed lock — prevents concurrent refreshes across multiple instances
  return cache.acquireLock(REFRESH_LOCK_KEY, REFRESH_LOCK_TTL)
    .then(function (acquired) {
      if (!acquired) {
        log.info('[api/products] Refresh lock held by another instance, skipping');
        return Promise.resolve();
      }
      _productsRefreshing = true;
      log.info('[api/products] Refreshing product data from Zoho Inventory');
      return doRefreshProducts();
    });
}

function doRefreshProducts() {
  return fetchAllItems({ status: 'active' })
    .then(function (items) {
      var serialPattern = /\s—\s[A-Z]+-\d+$/;
      items = items.filter(function (item) {
        if (item.product_type === 'service') return false;
        if (serialPattern.test(item.group_name || '')) return false;
        return true;
      });

      log.info('[api/products] Enriching ' + items.length + ' items via bulk detail fetch');

      var itemIds = items.map(function (item) { return item.item_id; });

      return fetchItemDetailsBulk(itemIds)
        .then(function (detailMap) {
          items.forEach(function (item) {
            var detail = detailMap[item.item_id] || {};
            item.custom_fields = detail.custom_fields || [];
            item.brand = detail.brand || item.brand || '';
            item.manufacturer = detail.manufacturer || item.manufacturer || '';
            item.image_name = detail.image_name || '';
            item.tax_id = detail.tax_id || item.tax_id || '';
            item.tax_name = detail.tax_name || item.tax_name || '';
            var _pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
              ? parseFloat(detail.tax_percentage)
              : (item.tax_percentage != null ? parseFloat(item.tax_percentage) || 0 : 0); // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
            if (!_pct && detail.taxes && detail.taxes.length) {
              _pct = detail.taxes.reduce(function (s, t) { return s + (parseFloat(t.tax_percentage) || 0); }, 0);
            }
            item.sales_tax_rule_id = detail.sales_tax_rule_id || item.sales_tax_rule_id || '';
            if (!_pct && item.sales_tax_rule_id && _TAX_RULE_PCT[item.sales_tax_rule_id] !== undefined) {
              _pct = _TAX_RULE_PCT[item.sales_tax_rule_id];
              item.tax_name = _TAX_RULE_NAME[item.sales_tax_rule_id] || item.tax_name;
            }
            item.tax_percentage = _pct;
            item.vendor_id = detail.vendor_id || '';
            item.vendor_name = detail.vendor_name || '';
          });
          var enriched = items;

          // Build snapshot lookup (item_id → snapshot entry) as a fallback for items
          // whose Zoho custom fields have not been populated yet.
          var snapshotLookup = {};
          try {
            var snapRaw = JSON.parse(fs.readFileSync(
              path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json'), 'utf8'));
            (snapRaw.products || []).forEach(function (p) {
              if (p.item_id) snapshotLookup[p.item_id] = p;
            });
            log.info('[api/products] Loaded ' + Object.keys(snapshotLookup).length + ' snapshot entries for CF fallback');
          } catch (e) {
            log.warn('[api/products] Could not load snapshot for CF fallback: ' + e.message);
          }

          // Kit items are identified by their Type CF matching a KIT_CATEGORY exactly.
          // When the CF is absent or not set in Zoho, the snapshot entry is used as a
          // fallback so items populate correctly even before all Zoho CFs are filled in.
          enriched = enriched.filter(function (item) {
            var snap = snapshotLookup[item.item_id];
            var typeCF = (item.custom_fields || []).find(function (cf) {
              return cf.label === 'Type' && cf.value;
            });
            var typeVal = typeCF
              ? typeCF.value.toLowerCase()
              : (snap && snap.type ? snap.type.toLowerCase() : '');

            if (!typeVal) {
              log.info('[api/products] Excluding item with no type: ' + item.name);
              return false;
            }
            if (!KIT_CATEGORIES.some(function (kc) { return typeVal === kc; })) {
              log.info('[api/products] Excluding non-kit item: ' + item.name + ' (type: ' + typeVal + ')');
              return false;
            }
            // Backfill snapshot fields onto items where Zoho CFs are not yet set
            if (!typeCF && snap) {
              item.type = snap.type;
              item.subcategory = item.subcategory || snap.subcategory || '';
              item.tasting_notes = item.tasting_notes || snap.tasting_notes || '';
              item.favorite = item.favorite || snap.favorite || 'false';
              item.abv = item.abv || snap.abv || '';
              item.time = item.time || snap.time || '';
              item.millable = item.millable || snap.millable || 'false';
              item.discount = item.discount || snap.discount || '0';
              item.retail_kit = item.retail_kit || snap.retail_kit || '';
              item.retail_instore = item.retail_instore || snap.retail_instore || '';
            }
            return true;
          });
          _kitItemIds = {};
          enriched.forEach(function (item) { _kitItemIds[item.item_id] = true; });
          // Bust the ingredients cache so it rebuilds without these items in _kitItemIds
          cache.del(INGREDIENTS_CACHE_KEY);
          cache.set(PRODUCTS_CACHE_KEY, enriched, PRODUCTS_CACHE_TTL);
          cache.set(PRODUCTS_CACHE_TS_KEY, Date.now(), PRODUCTS_CACHE_TTL);
          log.info('[api/products] Cached ' + enriched.length + ' kit items');

          // Reconcile inventory ledger with fresh Zoho stock counts
          ledger.reconcile(enriched).catch(function (err) {
            log.error('[api/products] Inventory ledger reconcile failed: ' + err.message);
          });

          // Write file fallback (async, fire-and-forget)
          fs.writeFile(PRODUCTS_FILE_CACHE, JSON.stringify(enriched), function (fileErr) {
            if (fileErr) {
              log.error('[api/products] File fallback write failed: ' + fileErr.message);
            } else {
              log.info('[api/products] Wrote file fallback (' + enriched.length + ' items)');
            }
          });

          // --- Image change detection ---
          // Build a map of item_id -> image_name from the enriched detail data.
          // The detail endpoint includes image_name when an item has an image.
          var currentImageMap = {};
          enriched.forEach(function (item) {
            if (item.image_name) {
              currentImageMap[item.item_id] = item.image_name;
            }
          });

          // Compare against the previously cached image map (fire-and-forget)
          cache.get(PRODUCT_IMAGE_HASHES_KEY)
            .then(function (previousImageMap) {
              previousImageMap = previousImageMap || {};
              var changed = [];
              var newImages = [];

              Object.keys(currentImageMap).forEach(function (itemId) {
                if (!previousImageMap[itemId]) {
                  newImages.push(itemId);
                } else if (previousImageMap[itemId] !== currentImageMap[itemId]) {
                  changed.push(itemId);
                }
              });

              if (changed.length > 0 || newImages.length > 0) {
                log.info('[api/products] Image changes detected (' +
                  changed.length + ' changed, ' + newImages.length + ' new) — run sync-images to update');
              }

              // Store the new image map in Redis (same TTL as products cache)
              return cache.set(PRODUCT_IMAGE_HASHES_KEY, currentImageMap, 86400); // 24 hours — outlasts product cache so diffs are always meaningful
            })
            .catch(function (imgErr) {
              log.error('[api/products] Image change detection error: ' + imgErr.message);
            });

          _productsRefreshing = false;
          cache.releaseLock(REFRESH_LOCK_KEY);
          return enriched;
        });
    })
    .catch(function (err) {
      _productsRefreshing = false;
      cache.releaseLock(REFRESH_LOCK_KEY);
      if (err.response && err.response.status === 429) {
        var retryAfter = err.response.headers && parseInt(err.response.headers['retry-after'], 10);
        _productsCooldownUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 90000);
        log.warn('[api/products] 429 rate limit — cooldown until ' + new Date(_productsCooldownUntil).toISOString());
      }
      throw err;
    });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/api/products', function (req, res) {
  cache.get(PRODUCTS_CACHE_KEY)
    .then(function (cached) {
      if (cached) {
        log.info('[api/products] Cache hit (' + cached.length + ' items)');
        if (!Object.keys(_kitItemIds).length) {
          cached.forEach(function (item) { _kitItemIds[item.item_id] = true; });
        }
        ledger.overlayStock(cached).then(function (overlaid) {
          res.json({ source: 'cache', items: overlaid });
        }).catch(function (err) {
          log.error('[api/products] overlayStock failed: ' + err.message);
          res.json({ source: 'cache', items: cached });
        });

        // Stale-while-revalidate: if cache is older than soft TTL, refresh in background
        cache.get(PRODUCTS_CACHE_TS_KEY).then(function (ts) {
          var age = ts ? (Date.now() - ts) / 1000 : PRODUCTS_SOFT_TTL + 1;
          if (age > PRODUCTS_SOFT_TTL) {
            log.info('[api/products] Cache stale (' + Math.round(age) + 's old), refreshing in background');
            refreshProducts().catch(function (err) {
              log.error('[api/products] Background refresh failed: ' + err.message);
            });
          }
        });
        return;
      }

      // Try file fallback before slow enrichment
      var fileData = null;
      try {
        fileData = JSON.parse(fs.readFileSync(PRODUCTS_FILE_CACHE, 'utf8'));
      } catch {}

      if (fileData && fileData.length > 0) {
        log.info('[api/products] File fallback hit (' + fileData.length + ' items)');
        // Populate in-memory kit IDs
        fileData.forEach(function (item) { _kitItemIds[item.item_id] = true; });
        // Also populate Redis cache from file
        cache.set(PRODUCTS_CACHE_KEY, fileData, PRODUCTS_CACHE_TTL);
        cache.set(PRODUCTS_CACHE_TS_KEY, Date.now(), PRODUCTS_CACHE_TTL);
        ledger.overlayStock(fileData).then(function (overlaid) {
          res.json({ source: 'file-cache', items: overlaid });
        }).catch(function (err) {
          log.error('[api/products] overlayStock failed: ' + err.message);
          res.json({ source: 'file-cache', items: fileData });
        });
        // Trigger background refresh
        refreshProducts().catch(function (err) {
          log.error('[api/products] Background refresh failed: ' + err.message);
        });
        return;
      }

      // Try static snapshot as last resort before hitting Zoho (avoids rate-limit storms)
      var snapshotData = null;
      try {
        var snapRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json'), 'utf8'));
        if (snapRaw && Array.isArray(snapRaw.products) && snapRaw.products.length > 0) {
          snapshotData = snapRaw.products.map(function (p) {
            var rateStr = p.retail_instore || p.retail_kit || '0';
            var rate = parseFloat(String(rateStr).replace(/[^0-9.]/g, '')) || 0;
            return Object.assign({}, p, { rate: rate, source: 'snapshot' });
          });
        }
      } catch {}

      if (snapshotData && snapshotData.length > 0) {
        log.info('[api/products] Snapshot fallback hit (' + snapshotData.length + ' items)');
        snapshotData.forEach(function (item) { _kitItemIds[item.item_id] = true; });
        cache.set(PRODUCTS_CACHE_KEY, snapshotData, PRODUCTS_CACHE_TTL);
        cache.set(PRODUCTS_CACHE_TS_KEY, Date.now(), PRODUCTS_CACHE_TTL);
        res.json({ source: 'snapshot', items: snapshotData });
        // Trigger background refresh from Zoho when rate limit clears
        refreshProducts().catch(function (err) {
          log.warn('[api/products] Background snapshot→Zoho refresh failed: ' + err.message);
        });
        return;
      }

      log.info('[api/products] Cache miss — fetching from Zoho Inventory');
      return refreshProducts()
        .then(function (enriched) {
          if (enriched && enriched.length) {
            return ledger.overlayStock(enriched).then(function (overlaid) {
              res.json({ source: 'zoho', items: overlaid });
            }).catch(function (err) {
              log.error('[api/products] overlayStock failed: ' + err.message);
              res.json({ source: 'zoho', items: enriched });
            });
          }
          // refreshProducts() returned early (cooldown or lock held by another instance).
          // Check if another instance populated the cache in the meantime.
          return cache.get(PRODUCTS_CACHE_KEY).then(function (cached) {
            if (cached && cached.length) {
              return ledger.overlayStock(cached).then(function (overlaid) {
                res.json({ source: 'cache', items: overlaid });
              }).catch(function (err) {
                log.error('[api/products] overlayStock failed: ' + err.message);
                res.json({ source: 'cache', items: cached });
              });
            }
            res.status(502).json({ error: 'Unable to fetch products' });
          });
        });
    })
    .catch(function (err) {
      log.error('[api/products] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch products' });
    });
});

/**
 * GET /api/services
 * Returns active service-type items from Zoho Inventory, cached for 5 minutes.
 */
router.get('/api/services', function (req, res) {
  cache.get(SERVICES_CACHE_KEY)
    .then(function (cached) {
      if (cached) {
        log.info('[api/services] Cache hit');
        return res.json({ source: 'cache', items: cached });
      }

      log.info('[api/services] Cache miss — fetching from Zoho Inventory');
      return fetchAllItemsCached()
        .then(function (allItems) {
          var items = allItems.filter(function (item) {
            return item.product_type === 'service';
          });
          var itemIds = items.map(function (item) { return item.item_id; });
          return fetchItemDetailsBulk(itemIds)
            .then(function (detailMap) {
              items.forEach(function (item) {
                var detail = detailMap[item.item_id] || {};
                item.tax_id = detail.tax_id || item.tax_id || '';
                item.tax_name = detail.tax_name || item.tax_name || '';
                var _pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
                  ? parseFloat(detail.tax_percentage)
                  : (item.tax_percentage != null ? parseFloat(item.tax_percentage) || 0 : 0); // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
                if (!_pct && detail.taxes && detail.taxes.length) {
                  _pct = detail.taxes.reduce(function (s, t) { return s + (parseFloat(t.tax_percentage) || 0); }, 0);
                }
                item.sales_tax_rule_id = detail.sales_tax_rule_id || item.sales_tax_rule_id || '';
                if (!_pct && item.sales_tax_rule_id && _TAX_RULE_PCT[item.sales_tax_rule_id] !== undefined) {
                  _pct = _TAX_RULE_PCT[item.sales_tax_rule_id];
                  item.tax_name = _TAX_RULE_NAME[item.sales_tax_rule_id] || item.tax_name;
                }
                item.tax_percentage = _pct;
              });
              cache.set(SERVICES_CACHE_KEY, items, SERVICES_CACHE_TTL);
              res.json({ source: 'zoho', items: items });
            });
        });
    })
    .catch(function (err) {
      log.error('[api/services] ' + err.message);
      // Snapshot fallback — for display only.
      // IMPORTANT: snapshot services have no real Zoho item_id (only SKUs).
      // We cache with a short TTL (30s) so Zoho is retried quickly.
      // Checkout validates that item_ids are numeric before submitting to Zoho
      // and will return a 503 retry if snapshot SKUs are present.
      try {
        var snapSvc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json'), 'utf8'));
        if (snapSvc && Array.isArray(snapSvc.services) && snapSvc.services.length > 0) {
          var svcItems = snapSvc.services.map(function (s) {
            return Object.assign({}, s, {
              item_id:        s.item_id || s.sku || '',
              rate:           parseFloat(String(s.price || s.rate || '0').replace(/[^0-9.]/g, '')) || 0,
              tax_percentage: s.tax_percentage != null ? s.tax_percentage : 0, // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
              tax_name:       s.tax_name || '',
              source:         'snapshot'
            });
          });
          log.info('[api/services] Snapshot fallback hit (' + svcItems.length + ' items)');
          // Short TTL: 5min so Zoho is retried reasonably quickly once rate-limit clears
          cache.set(SERVICES_CACHE_KEY, svcItems, 300);
          return res.json({ source: 'snapshot', items: svcItems });
        }
      } catch {}
      res.status(502).json({ error: 'Unable to fetch services' });
    });
});

/**
 * Fetch, enrich, and cache ingredients from Zoho Inventory.
 * Extracted from the route handler so server.js can call it for pre-warming.
 * Uses promise coalescing (_ingredientsRefreshPromise) so concurrent requests
 * (e.g. startup pre-warm + first user request) share a single Zoho round-trip.
 */
function doRefreshIngredients() {
  if (_ingredientsRefreshPromise) return _ingredientsRefreshPromise;

  _ingredientsRefreshPromise = fetchAllItemsCached()
    .then(function (allItems) {
      // Use cf_type (available from list endpoint, no enrichment needed) to
      // exclude kit items. This avoids a race condition where _kitItemIds is
      // empty during startup while the products pre-warm is still running.
      var items = allItems.filter(function (item) {
        if (item.product_type === 'service') return false;
        if (item.rate <= 0) return false;
        var cfType = (item.cf_type || '').toLowerCase();
        if (cfType === 'consignment') return false;
        if (cfType && KIT_CATEGORIES.indexOf(cfType) !== -1) return false;
        if (_kitItemIds[item.item_id]) return false; // belt-and-suspenders
        return true;
      });

      log.info('[api/ingredients] Enriching ' + items.length + ' items via bulk detail fetch');

      var itemIds = items.map(function (item) { return item.item_id; });

      return fetchItemDetailsBulk(itemIds)
        .then(function (detailMap) {
          items.forEach(function (item) {
            var detail = detailMap[item.item_id] || {};
            item.custom_fields = detail.custom_fields || [];
            // Flatten the Millable custom field so grain ingredients expose the
            // milling-fee flag the checkout UI looks for (kit path does this too).
            var millCF = (item.custom_fields || []).find(function (f) {
              return (f.label || '').toLowerCase() === 'millable';
            });
            item.millable = (millCF && millCF.value != null) // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
              ? String(millCF.value).toLowerCase()
              : (item.millable || 'false');
            if (detail.sales_description) item.sales_description = detail.sales_description;
            item.brand = detail.brand || item.brand || '';
            item.manufacturer = detail.manufacturer || item.manufacturer || '';
            item.tax_id = detail.tax_id || item.tax_id || '';
            item.tax_name = detail.tax_name || item.tax_name || '';
            var _pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
              ? parseFloat(detail.tax_percentage)
              : (item.tax_percentage != null ? parseFloat(item.tax_percentage) || 0 : 0); // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
            if (!_pct && detail.taxes && detail.taxes.length) {
              _pct = detail.taxes.reduce(function (s, t) { return s + (parseFloat(t.tax_percentage) || 0); }, 0);
            }
            item.sales_tax_rule_id = detail.sales_tax_rule_id || item.sales_tax_rule_id || '';
            if (!_pct && item.sales_tax_rule_id && _TAX_RULE_PCT[item.sales_tax_rule_id] !== undefined) {
              _pct = _TAX_RULE_PCT[item.sales_tax_rule_id];
              item.tax_name = _TAX_RULE_NAME[item.sales_tax_rule_id] || item.tax_name;
            }
            item.tax_percentage = _pct;
          });
          var enriched = items.filter(function (item) {
            var cf = (item.custom_fields || []).find(function (f) {
              return f.label === 'Internal Only';
            });
            if (cf && (cf.value === true || cf.value === 'true')) {
              log.info('[api/ingredients] Hiding internal-only item: ' + item.name);
              return false;
            }
            return true;
          });

          _ingredientsRefreshPromise = null;
          // Cache the FULL enriched list (incl. Internal Only) under the admin-only
          // key so the recipe builder can read it without polluting the public
          // cache that checkout/POS trust. `items` is the superset; `enriched` is
          // the public subset with Internal Only stripped.
          if (items.length > 0) {
            cache.set(INGREDIENTS_ALL_CACHE_KEY, items, INGREDIENTS_CACHE_TTL);
            fs.writeFile(INGREDIENTS_ALL_FILE_CACHE, JSON.stringify(items), function (fileErr) {
              if (fileErr) {
                log.error('[api/ingredients] Full-list file fallback write failed: ' + fileErr.message);
              }
            });
          }
          if (enriched.length > 0) {
            cache.set(INGREDIENTS_CACHE_KEY, enriched, INGREDIENTS_CACHE_TTL);
            cache.set(INGREDIENTS_CACHE_TS_KEY, Date.now(), INGREDIENTS_CACHE_TTL);
            // Reconcile inventory ledger with fresh Zoho stock counts
            ledger.reconcile(enriched).catch(function (err) {
              log.error('[api/ingredients] Inventory ledger reconcile failed: ' + err.message);
            });
            // Write file fallback (async, fire-and-forget)
            fs.writeFile(INGREDIENTS_FILE_CACHE, JSON.stringify(enriched), function (fileErr) {
              if (fileErr) {
                log.error('[api/ingredients] File fallback write failed: ' + fileErr.message);
              } else {
                log.info('[api/ingredients] Wrote file fallback (' + enriched.length + ' items)');
              }
            });
          } else {
            log.warn('[api/ingredients] Enrichment returned 0 items — skipping cache to allow retry');
          }
          return enriched;
        });
    })
    .catch(function (err) {
      _ingredientsRefreshPromise = null;
      throw err;
    });

  return _ingredientsRefreshPromise;
}

// Admin gate for the include_internal=1 mode (46-04). Internal-only items are
// not PII, but exposing them is staff-only. Resolves the request's own credential
// tier (this GET route is exempt from the global guard, so req.authTier is never
// set) and accepts legacy|session only — a kiosk device token must NEVER unlock
// Internal Only items (D-46-02, T-46-03b). Async because session lookup is async;
// callers must consume the returned Promise<boolean>.
function isAdminGrade(req) {
  return authTiers.resolveTier(req).then(function (tier) {
    return authTiers.allowAdmin(tier);
  });
}

// Serve the full ingredient list INCLUDING Internal Only items (admin recipe
// builder). Reads the dedicated admin cache/file; on a cold cache it triggers a
// refresh (which populates both the public and admin keys) then reads the admin
// key. Never falls back to the public list, so a caller asking for internal
// items always gets them once the cache is warm.
function serveFullIngredients(res) {
  cache.get(INGREDIENTS_ALL_CACHE_KEY)
    .then(function (cached) {
      if (cached && cached.length > 0) {
        log.info('[api/ingredients] include_internal cache hit (' + cached.length + ' items)');
        return ledger.overlayStock(cached)
          .then(function (overlaid) { res.json({ source: 'cache', items: overlaid }); })
          .catch(function () { res.json({ source: 'cache', items: cached }); });
      }

      var fileData = null;
      try { fileData = JSON.parse(fs.readFileSync(INGREDIENTS_ALL_FILE_CACHE, 'utf8')); } catch {}
      if (fileData && fileData.length > 0) {
        log.info('[api/ingredients] include_internal file fallback (' + fileData.length + ' items)');
        cache.set(INGREDIENTS_ALL_CACHE_KEY, fileData, INGREDIENTS_CACHE_TTL);
        return ledger.overlayStock(fileData)
          .then(function (overlaid) { res.json({ source: 'file-cache', items: overlaid }); })
          .catch(function () { res.json({ source: 'file-cache', items: fileData }); });
      }

      log.info('[api/ingredients] include_internal cold — refreshing from Zoho');
      return doRefreshIngredients()
        .then(function () {
          return cache.get(INGREDIENTS_ALL_CACHE_KEY).then(function (full) {
            var items = (full && full.length > 0) ? full : [];
            return ledger.overlayStock(items)
              .then(function (overlaid) { res.json({ source: 'zoho', items: overlaid }); })
              .catch(function () { res.json({ source: 'zoho', items: items }); });
          });
        });
    })
    .catch(function (err) {
      log.error('[api/ingredients] include_internal failed: ' + err.message);
      res.status(502).json({ error: 'Could not load full ingredient catalog' });
    });
}

/**
 * GET /api/ingredients
 * Returns active goods items that are NOT kits (no Type custom field)
 * and NOT services. These are ingredients, supplies, and equipment.
 * Uses the products cache to identify kit item IDs to exclude.
 *
 * ?include_internal=1 (with a valid x-api-key) returns the FULL list including
 * items flagged "Internal Only" in Zoho — for the admin recipe builder. The
 * default (public) response always strips Internal Only items.
 */
router.get('/api/ingredients', function (req, res) {
  if (req.query && req.query.include_internal === '1') {
    return isAdminGrade(req).then(function (isAdmin) {
      if (isAdmin) return serveFullIngredients(res);
      return servePublicIngredients(req, res);
    });
  }
  return servePublicIngredients(req, res);
});

function servePublicIngredients(req, res) {
  cache.get(INGREDIENTS_CACHE_KEY)
    .then(function (cached) {
      if (cached && cached.length > 0) {
        log.info('[api/ingredients] Cache hit (' + cached.length + ' items)');
        ledger.overlayStock(cached).then(function (overlaid) {
          res.json({ source: 'cache', items: overlaid });
        }).catch(function (err) {
          log.error('[api/ingredients] overlayStock failed: ' + err.message);
          res.json({ source: 'cache', items: cached });
        });

        // Stale-while-revalidate: if cache is older than soft TTL, refresh in background
        cache.get(INGREDIENTS_CACHE_TS_KEY).then(function (ts) {
          var age = ts ? (Date.now() - ts) / 1000 : INGREDIENTS_SOFT_TTL + 1;
          if (age > INGREDIENTS_SOFT_TTL) {
            log.info('[api/ingredients] Cache stale (' + Math.round(age) + 's old), refreshing in background');
            doRefreshIngredients().catch(function (err) {
              log.error('[api/ingredients] Background refresh failed: ' + err.message);
            });
          }
        });
        return;
      }

      // Try file fallback before slow enrichment
      var fileData = null;
      try {
        fileData = JSON.parse(fs.readFileSync(INGREDIENTS_FILE_CACHE, 'utf8'));
      } catch {}

      if (fileData && fileData.length > 0) {
        log.info('[api/ingredients] File fallback hit (' + fileData.length + ' items)');
        cache.set(INGREDIENTS_CACHE_KEY, fileData, INGREDIENTS_CACHE_TTL);
        ledger.overlayStock(fileData).then(function (overlaid) {
          res.json({ source: 'file-cache', items: overlaid });
        }).catch(function (err) {
          log.error('[api/ingredients] overlayStock failed: ' + err.message);
          res.json({ source: 'file-cache', items: fileData });
        });
        // Trigger background refresh
        doRefreshIngredients().catch(function (err) {
          log.error('[api/ingredients] Background refresh failed: ' + err.message);
        });
        return;
      }

      // Try static snapshot as last resort before hitting Zoho
      var snapIngData = null;
      try {
        var snapIngRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'zoho-snapshot.json'), 'utf8'));
        if (snapIngRaw && Array.isArray(snapIngRaw.ingredients) && snapIngRaw.ingredients.length > 0) {
          snapIngData = snapIngRaw.ingredients.map(function (p) {
            var rate = parseFloat(String(p.rate || p.price_per_unit || p.price || '0').replace(/[^0-9.]/g, '')) || 0;
            return Object.assign({}, p, { rate: rate, source: 'snapshot' });
          });
        }
      } catch {}

      if (snapIngData && snapIngData.length > 0) {
        log.info('[api/ingredients] Snapshot fallback hit (' + snapIngData.length + ' items)');
        cache.set(INGREDIENTS_CACHE_KEY, snapIngData, INGREDIENTS_CACHE_TTL);
        res.json({ source: 'snapshot', items: snapIngData });
        doRefreshIngredients().catch(function (err) {
          log.warn('[api/ingredients] Background snapshot→Zoho refresh failed: ' + err.message);
        });
        return;
      }

      log.info('[api/ingredients] Cache miss — fetching from Zoho Inventory');
      return doRefreshIngredients()
        .then(function (enriched) {
          return ledger.overlayStock(enriched).then(function (overlaid) {
            res.json({ source: 'zoho', items: overlaid });
          }).catch(function (err) {
            log.error('[api/ingredients] overlayStock failed: ' + err.message);
            res.json({ source: 'zoho', items: enriched });
          });
        });
    })
    .catch(function (err) {
      log.error('[api/ingredients] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch products' });
    });
}

/**
 * rebuildKioskCatalog() — force a cold Zoho refetch of the kiosk products
 * catalog, shape it exactly like the cache-miss path below, write it to
 * KIOSK_PRODUCTS_CACHE_KEY, and return the freshly-built sellable array.
 *
 * Extracted (57-04) from the inline cache-miss logic in `GET /api/kiosk/products`
 * so BOTH the manual `?bust=1` refresh AND the sale-time auto-reconcile
 * (routes/pos.js processSale) call the EXACT SAME rebuild — no behavior
 * drift between "staff taps refresh" and "server self-heals a stale catalog
 * cache on a sale miss" (57-DIAGNOSIS variant 1).
 *
 * Returns a Promise<Array> of the sellable catalog (pre-ledger-overlay — the
 * same shape cache.get(KIOSK_PRODUCTS_CACHE_KEY) returns afterward).
 */
function rebuildKioskCatalog() {
  return fetchAllItemsCached()
    .then(function (allItems) {
      var filtered = allItems.filter(function (item) {
        return item.rate > 0;
      });

      var itemIds = filtered.map(function (item) { return item.item_id; });
      // The list API does not reliably return tax fields — fetch per-item
      // details in bulk (3 calls for ~250 items, only on cache miss every 5 min).
      return fetchItemDetailsBulk(itemIds).then(function (detailMap) {
        var sellable = filtered.map(function (item) {
          var detail = detailMap[item.item_id] || {};

          var taxId = detail.tax_id || item.tax_id || '';
          var tName = detail.tax_name || item.tax_name || '';
          // Phase 67 review fix (CR-02): a genuinely MISSING/unparseable tax
          // stays NaN here (and is served as null below) instead of being
          // coerced to a "resolved 0%". Fabricating 0 made the fail-closed
          // unresolved-tax branches in pos.js computeTax and the kiosk
          // client unreachable — an unconfigured item silently sold at 0%
          // tax while its untagged Zoho invoice line was default-taxed (the
          // F3 partial-paid failure mode). A real explicit 0 (or a rule /
          // taxes-array resolution) is still a VALID resolved rate.
          var pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
            ? parseFloat(detail.tax_percentage)
            : (item.tax_percentage != null ? parseFloat(item.tax_percentage) : NaN); // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
          if (!pct && detail.taxes && detail.taxes.length) {
            pct = detail.taxes.reduce(function (s, t) { return s + (parseFloat(t.tax_percentage) || 0); }, 0);
          }
          var ruleId = detail.sales_tax_rule_id || item.sales_tax_rule_id || '';
          if (ruleId && _TAX_RULE_PCT[ruleId] !== undefined) {
            pct = _TAX_RULE_PCT[ruleId];
            tName = _TAX_RULE_NAME[ruleId] || tName;
          }

          // Flatten the ingredient Subcategory custom field so discount
          // product-type matching (lib/discount-match.js) and the kiosk
          // cart preview have it without re-parsing custom_fields.
          var cfSubcategory = item.cf_subcategory || '';
          if (!cfSubcategory) {
            var subCF = (detail.custom_fields || item.custom_fields || []).find(function (f) {
              return (f.label || '').toLowerCase() === 'subcategory';
            });
            if (subCF) cfSubcategory = subCF.value || '';
          }

          return {
            item_id:       item.item_id,
            name:          item.name,
            sku:           item.sku || '',
            rate:          item.rate,
            stock_on_hand: item.stock_on_hand != null ? item.stock_on_hand : 0, // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
            category_name: item.category_name || '',
            product_type:  item.product_type || '',
            image_name:    detail.image_name || item.image_name || '',
            brand:         detail.brand || item.brand || '',
            manufacturer:  detail.manufacturer || item.manufacturer || '',
            tax_id:        taxId,
            tax_name:      tName,
            // CR-02: null (JSON-serializable) marks UNRESOLVED; downstream
            // parseFloat(null) is NaN, which pos.js computeTax and the kiosk
            // missing-tax gate both fail closed on. Never a fabricated 0.
            tax_percentage: isNaN(pct) ? null : pct,
            sales_tax_rule_id: ruleId,
            custom_fields: detail.custom_fields || item.custom_fields || [],
            group_name:    item.group_name || '',
            cf_type:       item.cf_type || '',
            cf_subcategory: cfSubcategory,
            unit:          item.unit || ''
          };
        });

        cache.set(KIOSK_PRODUCTS_CACHE_KEY, sellable, KIOSK_PRODUCTS_CACHE_TTL);
        log.info('[api/kiosk/products] Cached ' + sellable.length + ' sellable items');
        ledger.reconcile(sellable).catch(function (err) {
          log.error('[api/kiosk/products] Inventory ledger reconcile failed: ' + err.message);
        });
        return sellable;
      });
    });
}

/**
 * GET /api/kiosk/products
 * Returns all active sellable items from Zoho Inventory with price, stock,
 * and tax info. Cached for 5 minutes. Intended for the in-store kiosk/POS.
 *
 * Returns items with: item_id, name, sku, rate, stock_on_hand, tax_percentage,
 * tax_name, category_name, image_name, product_type, custom_fields.
 *
 * Pagination: ?page=1&per_page=100 (default 200 per page, max 200)
 * Search: ?search=term (filters name/sku client-side from cache)
 * Category: ?category=wine (filters by category_name)
 */
router.get('/api/kiosk/products', function (req, res) {
  var bustCache = req.query.bust === '1';

  // M7 (Phase 52-05): ?bust=1 forces a cold Zoho refetch — gate ONLY this
  // branch behind a credential so an anon caller cannot repeatedly exhaust Zoho
  // quota. The normal cached read below stays public.
  // D-54-BUST (2026-07-09): 'device' MUST be allowed. The kiosk's own post-sale
  // force-refresh (`kioskLoadProducts(true)` → `?bust=1`) runs under the device
  // token after the Phase 46 cutover; gating to legacy/session only made that
  // 403, so stock never refreshed without a manual page reload. A valid device
  // token is still authenticated (not anon), so the anti-quota-abuse intent holds.
  if (bustCache) {
    return authTiers.requireTiers(['legacy', 'session', 'device'])(req, res, function () { return proceed(); });
  }
  return proceed();

  function proceed() {
  (bustCache ? cache.del(KIOSK_PRODUCTS_CACHE_KEY).then(function () { return null; }) : cache.get(KIOSK_PRODUCTS_CACHE_KEY))
    .then(function (cached) {
      if (cached) {
        log.info('[api/kiosk/products] Cache hit (' + cached.length + ' items)');
        return ledger.overlayStock(cached).then(function (overlaid) {
          res.json({ source: 'cache', items: overlaid });
        }).catch(function (err) {
          log.error('[api/kiosk/products] overlayStock failed: ' + err.message);
          res.json({ source: 'cache', items: cached });
        });
      }

      log.info('[api/kiosk/products] Cache miss — fetching from Zoho Inventory');

      return rebuildKioskCatalog().then(function (sellable) {
        return ledger.overlayStock(sellable).then(function (overlaid) {
          res.json({ source: 'zoho', items: overlaid });
        }).catch(function (err) {
          log.error('[api/kiosk/products] overlayStock failed: ' + err.message);
          res.json({ source: 'zoho', items: sellable });
        });
      });
    })
    .catch(function (err) {
      var status = (err.response && err.response.status) || 0;
      log.error('[api/kiosk/products] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch kiosk products', detail: err.message, zoho_status: status });
    });
  }
});

/**
 * GET /api/snapshot
 * Returns a pre-shaped JSON snapshot of all three catalogs (products, ingredients,
 * services) suitable for use as a static fallback file. Reads from Redis caches
 * when warm; falls back to a fresh Zoho fetch if any cache is cold. Intended to
 * be called by zoho-middleware/scripts/export-snapshot.js before deploys.
 *
 * Response shape:
 * {
 *   generated_at: <ISO string>,
 *   products:     [ ...shaped kit items   ],
 *   ingredients:  [ ...shaped ing items   ],
 *   services:     [ ...shaped svc items   ]
 * }
 *
 * Each item is shaped identically to what the frontend mappers in modules 07/08/09
 * produce, so the snapshot is a drop-in replacement for live middleware data.
 */
router.get('/api/snapshot', function (req, res) {
  var KIT_CATS = ['wine', 'beer', 'cider', 'seltzer'];
  var state = { products: [], ingredients: [], services: [] };

  function flattenCF(customFields, obj) {
    (customFields || []).forEach(function (cf) {
      var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
      if (key && cf.value !== undefined && cf.value !== null) {
        obj[key] = String(cf.value);
      }
    });
  }

  function shapeProduct(z) {
    var obj = {
      name:           z.name || '',
      sku:            z.sku || '',
      item_id:        z.item_id || '',
      brand:          z.brand || '',
      manufacturer:   z.manufacturer || '',
      stock:          z.stock_on_hand != null ? String(z.stock_on_hand) : '0', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      description:    z.description || '',
      discount:       z.discount != null ? String(z.discount) : '0', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      _zoho_category: z.category_name || '',
      tax_percentage: z.tax_percentage != null ? z.tax_percentage : 0, // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      tax_name:       z.tax_name || '',
      tax_id:         z.tax_id  || ''
    };
    flattenCF(z.custom_fields, obj);
    if (z.rate != null) { // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      var rateNum = parseFloat(z.rate);
      if (!obj.retail_kit)     obj.retail_kit     = '$' + rateNum.toFixed(2);
      if (!obj.retail_instore) obj.retail_instore  = '$' + (rateNum + 50).toFixed(2);
    }
    return obj;
  }

  function shapeIngredient(z) {
    var obj = {
      name:           z.name || '',
      unit:           z.unit || '',
      price_per_unit: z.rate != null ? String(z.rate) : '', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      stock:          z.stock_on_hand != null ? String(z.stock_on_hand) : '0', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      description:    z.description || '',
      sales_description: z.sales_description || '',
      sku:            z.sku || '',
      category:       z.category_name || '',
      low_amount:     '',
      high_amount:    '',
      step:           '',
      tax_percentage: z.tax_percentage != null ? z.tax_percentage : 0, // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      tax_name:       z.tax_name || '',
      tax_id:         z.tax_id  || ''
    };
    flattenCF(z.custom_fields, obj);
    return obj;
  }

  function shapeService(z) {
    return {
      name:           z.name || '',
      item_id:        z.item_id || '',
      price:          z.rate != null ? String(z.rate) : '', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      description:    z.description || '',
      sku:            z.sku || '',
      stock:          z.stock_on_hand != null ? String(z.stock_on_hand) : '0', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      discount:       z.discount != null ? String(z.discount) : '0', // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      tax_percentage: z.tax_percentage != null ? z.tax_percentage : 0, // eslint-disable-line eqeqeq -- intentional != null (matches undefined too)
      tax_name:       z.tax_name || '',
      tax_id:         z.tax_id  || ''
    };
  }

  function ensureProducts() {
    return cache.get(PRODUCTS_CACHE_KEY).then(function (cached) {
      if (cached && cached.length > 0) {
        return ledger.overlayStock(cached).then(function (overlaid) {
          state.products = overlaid.map(shapeProduct);
        }).catch(function () {
          state.products = cached.map(shapeProduct);
        });
      }
      log.info('[api/snapshot] Products cache cold — triggering refresh');
      return refreshProducts()
        .then(function () { return cache.get(PRODUCTS_CACHE_KEY); })
        .then(function (p) {
          var items = p || [];
          return ledger.overlayStock(items).catch(function () { return items; });
        })
        .then(function (overlaid) { state.products = overlaid.map(shapeProduct); });
    });
  }

  function ensureIngredients() {
    return cache.get(INGREDIENTS_CACHE_KEY).then(function (cached) {
      if (cached && cached.length > 0) {
        return ledger.overlayStock(cached).then(function (overlaid) {
          state.ingredients = overlaid.map(shapeIngredient);
        }).catch(function () {
          state.ingredients = cached.map(shapeIngredient);
        });
      }
      log.info('[api/snapshot] Ingredients cache cold — fetching from Zoho');
      return fetchAllItemsCached().then(function (allItems) {
        var filtered = allItems.filter(function (item) {
          if (item.product_type === 'service') return false;
          if (item.rate <= 0) return false;
          var cfType = (item.cf_type || '').toLowerCase();
          if (cfType && KIT_CATS.indexOf(cfType) !== -1) return false;
          if (_kitItemIds[item.item_id]) return false;
          return true;
        });
        return ledger.overlayStock(filtered).catch(function () { return filtered; });
      }).then(function (overlaid) {
        state.ingredients = overlaid.map(shapeIngredient);
      });
    });
  }

  function ensureServices() {
    return cache.get(SERVICES_CACHE_KEY).then(function (cached) {
      if (cached && cached.length > 0) {
        state.services = cached.map(shapeService);
        return;
      }
      log.info('[api/snapshot] Services cache cold — fetching from Zoho');
      return fetchAllItemsCached().then(function (allItems) {
        var svcItems = allItems.filter(function (item) {
          return item.product_type === 'service';
        });
        state.services = svcItems.map(shapeService);
      });
    });
  }

  // Sequential rather than Promise.all — prevents three concurrent fetchAllItems()
  // calls hammering Zoho when all three caches are cold, which was the root cause
  // of the 429 rate-limit storms. If the products cache is warm the call returns
  // immediately from Redis, adding only microseconds of overhead.
  ensureProducts()
    .then(function () { return ensureIngredients(); })
    .then(function () { return ensureServices(); })
    .then(function () {
      res.json({
        generated_at: new Date().toISOString(),
        products:     state.products,
        ingredients:  state.ingredients,
        services:     state.services
      });
    })
    .catch(function (err) {
      log.error('[api/snapshot] ' + err.message);
      res.status(502).json({ error: 'Snapshot generation failed: ' + err.message });
    });
});

/**
 * POST /api/admin/upload-catalog
 *
 * Accepts a pre-shaped catalog JSON (products / ingredients / services arrays,
 * identical in structure to what /api/snapshot returns) and stores them in
 * Redis, overriding any Zoho-fetched data for 24 hours.
 *
 * Use this from the admin dashboard Export/Sync tab when the Zoho API is
 * down or quota-exhausted — upload a Zoho Inventory item export CSV and the
 * admin panel parses + posts it here without any Zoho API call.
 *
 * Auth: X-API-Key header required (enforced by server.js /api middleware).
 */
router.post('/api/admin/upload-catalog', function (req, res) {
  var products    = req.body.products    || [];
  var ingredients = req.body.ingredients || [];
  var services    = req.body.services    || [];

  if (!Array.isArray(products) || !Array.isArray(ingredients) || !Array.isArray(services)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload: expected arrays for products, ingredients, services' });
  }

  if (products.length === 0 && ingredients.length === 0 && services.length === 0) {
    return res.status(400).json({ ok: false, error: 'Refusing empty catalog upload' });
  }

  var UPLOAD_TTL = 86400; // 24 hours — long enough to survive until Zoho recovers

  Promise.all([
    cache.set(PRODUCTS_CACHE_KEY, products, UPLOAD_TTL),
    cache.set(INGREDIENTS_CACHE_KEY, ingredients, UPLOAD_TTL),
    cache.set(SERVICES_CACHE_KEY, services, UPLOAD_TTL)
  ]).then(function () {
    log.info('[upload-catalog] Catalog overridden from admin CSV upload — ' +
      products.length + ' products, ' +
      ingredients.length + ' ingredients, ' +
      services.length + ' services (TTL=' + UPLOAD_TTL + 's)');
    res.json({ ok: true, products: products.length, ingredients: ingredients.length, services: services.length });
  }).catch(function (err) {
    log.error('[upload-catalog] Redis write failed: ' + err.message);
    res.status(500).json({ ok: false, error: 'Cache write failed: ' + err.message });
  });
});

/**
 * POST /api/admin/cache-clear
 * Delete all catalog cache keys and trigger immediate re-fetch from Zoho.
 * Auth: X-API-Key header required (enforced by server.js /api middleware).
 */
router.post('/api/admin/cache-clear', function (req, res) {
  var keys = [
    PRODUCTS_CACHE_KEY,
    PRODUCTS_CACHE_TS_KEY,
    INGREDIENTS_CACHE_KEY,
    INGREDIENTS_CACHE_TS_KEY,
    SERVICES_CACHE_KEY
  ];
  // Also delete file caches so stale file data doesn't re-populate Redis
  [PRODUCTS_FILE_CACHE, INGREDIENTS_FILE_CACHE].forEach(function (f) {
    try { fs.unlinkSync(f); } catch {}
  });
  // Reset in-memory rate-limit cooldowns so the refresh isn't blocked
  _productsCooldownUntil = 0;
  _rawItemsCache = null;
  _rawItemsCooldownUntil = 0;
  Promise.all(keys.map(function (k) { return cache.del(k).catch(function () {}); }))
    .then(function () {
      log.info('[admin/cache-clear] Catalog cache cleared. Running fresh product refresh...');
      // Call doRefreshProducts() directly to bypass _productsRefreshing guard,
      // which may be set if a startup pre-warm is still running.
      return doRefreshProducts();
    })
    .then(function (enriched) {
      var count = enriched ? enriched.length : 0;
      var sample = enriched && enriched[0] ? {
        name: enriched[0].name,
        tax_id: enriched[0].tax_id,
        tax_name: enriched[0].tax_name,
        tax_percentage: enriched[0].tax_percentage,
        sales_tax_rule_id: enriched[0].sales_tax_rule_id
      } : null;
      doRefreshIngredients().catch(function (e) { log.warn('[admin/cache-clear] ingredients refresh error: ' + e.message); });
      res.json({ ok: true, cleared: keys, products_fetched: count, sample: sample });
    })
    .catch(function (err) {
      res.status(500).json({ ok: false, error: err.message });
    });
});

// Expose refresh functions so server.js can call them for pre-warming
router.refreshProducts = refreshProducts;
router.refreshIngredients = doRefreshIngredients;
// 57-04: expose the kiosk-catalog rebuild so routes/pos.js can trigger the
// SAME cold-Zoho-refetch the manual ?bust=1 refresh uses, on a sale-time
// catalog-miss auto-reconcile.
router.rebuildKioskCatalog = rebuildKioskCatalog;

module.exports = router;
