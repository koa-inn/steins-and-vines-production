# Phase 8: First-Batch Promo - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/promo.js` | route/controller | request-response | `zoho-middleware/routes/discounts.js` | exact |
| `zoho-middleware/lib/constants.js` | config/library | — | self (modification) | exact |
| `zoho-middleware/__tests__/promo.test.js` | test | — | `zoho-middleware/__tests__/discounts.test.js` | exact |
| `zoho-middleware/routes/checkout.js` | route/controller | request-response | self (modification) | exact |
| `js/modules/12-checkout.js` | component/UI | request-response | self (modification) | exact |
| `js/modules/13-init.js` | component/init | event-driven | self (modification) | exact |
| `content/home.json` | config/content | — | self (modification) | exact |
| `index.html` | template/markup | — | `index.html` (existing promo-section) | exact |
| `css/styles.css` | stylesheet | — | existing `.discount-badge-sm`, `.promo-news` rules | role-match |

---

## Pattern Assignments

### `zoho-middleware/routes/promo.js` (route, request-response)

**Analog:** `zoho-middleware/routes/discounts.js`

**Imports pattern** (discounts.js lines 1-8):
```javascript
'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
```

**Router scaffold pattern** (discounts.js lines 10-11):
```javascript
var router = express.Router();
// ... route definitions ...
module.exports = router;
```

**Input validation pattern** (discounts.js lines 21-62 — `validatePreset`):
```javascript
// Pattern: extract body fields with type guard, collect error strings, return early with 400
var body = req.body || {};
var code = (typeof body.code === 'string') ? body.code.trim().toUpperCase() : '';
var email = (typeof body.email === 'string') ? body.email.trim().toLowerCase() : '';
if (!code) return res.status(400).json({ error: 'Promo code is required' });
if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'Valid email is required' });
```

**Redis get pattern** (discounts.js lines 64-68 — `loadPresets`):
```javascript
// cache.get returns null on miss or Redis unavailable
return cache.get(CACHE_KEY).then(function (data) {
  return Array.isArray(data) ? data : [];
});
```

**Redis set pattern** (discounts.js lines 70-72 — `savePresets` + cache.js line 83):
```javascript
// cache.set(key, value, ttlSeconds) — uses EX: ttlSeconds internally
return cache.set(CACHE_KEY, presets, CACHE_TTL);
// For promo redemption burn: TTL = 5 years in seconds (never use TTL=0)
var PROMO_REDEMPTION_TTL = 5 * 365 * 24 * 60 * 60; // 157,680,000
```

**Error handling pattern** (discounts.js lines 78-85):
```javascript
router.get('/api/kiosk/discounts', function (req, res) {
  loadPresets().then(function (presets) {
    res.json({ ok: true, discounts: presets });
  }).catch(function (err) {
    log.error('[discounts] GET error: ' + err.message);
    res.status(500).json({ error: 'Failed to load discount presets' });
  });
});
```

**Fail-open pattern for Redis unavailability** (cache.js lines 60-74):
```javascript
// cache.get returns null if Redis is unavailable — treat null as "not redeemed"
// This is the established fail-open pattern used throughout the app
function get(key) {
  if (!connected) return Promise.resolve(null);
  // ... .catch(function () { return null; })
}
```

**acquireLock pattern for race condition guard** (cache.js lines 106-115):
```javascript
// Use for double-redemption prevention inside processCheckout
function acquireLock(key, ttlSeconds) {
  if (!connected) return Promise.resolve(true);
  return getClient().then(function (c) {
    return c.set('lock:' + key, '1', { NX: true, EX: ttlSeconds });
  }).then(function (result) {
    return result !== null; // 'OK' if acquired; null if already held
  }).catch(function () {
    return true; // on Redis error, fall through to in-process guard
  });
}
```

**Log prefix pattern** (discounts.js lines 84, 116, 131):
```javascript
log.error('[discounts] GET error: ' + err.message);
log.info('[discounts] Created preset: ' + preset.id);
// For promo route: use '[promo/validate]' prefix
```

**Route registration in server.js** (server.js line 386):
```javascript
// Pattern: mount after all existing routes, same as discounts.js
app.use('/', require('./routes/discounts'));
app.use('/', require('./routes/promo'));  // ADD after discounts line
```

**API key bypass for public POST** (server.js lines 229-247):
```javascript
// /api/checkout is already exempt — /api/promo/validate must also be exempt
// since it is called from the public checkout page without x-api-key
app.use('/api', function (req, res, next) {
  if (req.method === 'GET') return next();
  if (req.path === '/checkout') return next();
  // ADD: if (req.path === '/promo/validate') return next();
  // ...
});
```

---

### `zoho-middleware/lib/constants.js` (config, modification)

**Analog:** self — add one entry to `CACHE_KEYS`

**Existing pattern** (constants.js lines 15-59):
```javascript
var CACHE_KEYS = {
  // ... existing keys ...
  CONTACT_PREFIX:      'zoho:contact:email:',    // append lowercased email
  KIOSK_DISCOUNT_PRESETS: 'kiosk:discount-presets',
  // ADD:
  PROMO_REDEEMED_PREFIX: 'promo:firstbatch:redeemed:',  // append lowercased email
};
```

**Naming convention:** prefix-style keys use a trailing `:` separator (see `CONTACT_PREFIX`, `AVAILABILITY_PREFIX`, `CHECKOUT_IDEM_PREFIX`). New key follows the same pattern.

---

### `zoho-middleware/__tests__/promo.test.js` (test)

**Analog:** `zoho-middleware/__tests__/discounts.test.js`

**Full test scaffold pattern** (discounts.test.js lines 1-70):
```javascript
'use strict';

jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });

jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var cache = require('../lib/cache');

var _routeRegistry = { get: [], post: [], put: [], delete: [] };

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) { _routeRegistry.get.push({ path: path, handler: handler }); }),
    post: jest.fn(function (path, handler) { _routeRegistry.post.push({ path: path, handler: handler }); }),
    // ...
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

require('../routes/discounts');  // swap: require('../routes/promo')

function findHandler(method, path) { /* ... */ }

function makeReq(body, params) { return { body: body || {}, params: params || {} }; }

function makeRes() {
  var res = { _status: null, _json: null };
  res.status = jest.fn(function (code) { res._status = code; return res; });
  res.json = jest.fn(function (data) { res._json = data; return res; });
  return res;
}

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

beforeEach(function () {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue('OK');
});
```

**Async handler test pattern** (discounts.test.js lines 76-100):
```javascript
describe('POST /api/promo/validate', function () {
  test('returns 400 when code is missing', function () {
    var res = makeRes();
    postHandler(makeReq({ email: 'a@b.com' }), res);
    return flushPromises().then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toBeDefined();
    });
  });

  test('returns 400 when email already redeemed', function () {
    cache.get.mockResolvedValue({ redeemedAt: '2026-01-01T00:00:00.000Z' });
    var res = makeRes();
    postHandler(makeReq({ code: 'FIRSTBATCH', email: 'used@example.com' }), res);
    return flushPromises().then(function () {
      expect(res._status).toBe(400);
    });
  });

  test('returns ok:true and discountPct on valid unredeemed code', function () {
    cache.get.mockResolvedValue(null);
    var res = makeRes();
    postHandler(makeReq({ code: 'FIRSTBATCH', email: 'new@example.com' }), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discountPct).toBe(20);
    });
  });
});
```

---

### `zoho-middleware/routes/checkout.js` (route modification)

**Analog:** self — targeted modifications to `runCheckout` and the Zoho SO creation block

**Maker's Fee injection site** (checkout.js lines 319-356):
```javascript
// THIS is where promo discount must hook in.
// The Maker's Fee is injected AFTER buildLineItems — so discountPct must be
// applied explicitly to the Maker's Fee line item when promo is active.

// Existing Maker's Fee injection (lines 349-356):
lineItems.push({
  item_id: makersFeeItem.item_id,
  name: makersFeeItem.name || "Maker's Fee",
  quantity: kitQtyTotal,
  rate: makersFeeItem.rate  // <-- modify: apply discountPct here when promo active
});
orderTotal = Math.round((orderTotal + makersFeeItem.rate * kitQtyTotal) * 100) / 100;
```

**Post-SO redemption burn site** (checkout.js lines 375-406 — after Zoho SO creation):
```javascript
// Burn AFTER salesorder_id is confirmed (not before charge, not on failure)
// Pattern from transaction ID replay guard (checkout.js lines 186-199):
var soId = data.salesorder ? data.salesorder.salesorder_id : null;
// ADD after existing SO creation success block:
if (soId && body.promo_code === 'FIRSTBATCH' && customerEmail) {
  var promoKey = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + customerEmail.toLowerCase();
  cache.set(promoKey, { redeemedAt: new Date().toISOString(), soId: soId }, 5 * 365 * 24 * 60 * 60)
    .catch(function (e) { log.error('[promo] Failed to burn redemption: ' + e.message); });
}
```

**buildLineItems and discountPct flow** (checkout-helpers.js line pattern, pricing.js lines 46-77):
```javascript
// computeLineItem(product, qty, { discountPct: 20 }) already handles discount
// buildLineItems calls computeLineItem per item — item.discount from body flows through
// For promo: validate body.promo_code server-side, then pass discountPct to Maker's Fee
// specifically (kit items already carry discount from body.items[].discount)
```

**Transaction ID replay guard pattern** (checkout.js lines 183-200 — `checkTransactionIdAndProceed`):
```javascript
// Pattern for any Redis check + fail-open:
async function checkTransactionIdAndProceed() {
  var txnKey = 'helcim:txn:' + transactionId + txnKeySuffix;
  try {
    var existing = await cache.get(txnKey);
    if (existing) {
      return res.status(409).json({ error: 'Payment already processed' });
    }
    return runCheckout();
  } catch (e) {
    return runCheckout(); // fail open when Redis unavailable
  }
}
```

---

### `js/modules/12-checkout.js` (component modification)

**Analog:** self — add `_promoApplied` state and promo widget following established module-level state patterns

**Module-level state pattern** (12-checkout.js lines 22-36):
```javascript
// Existing module-level state to copy pattern from:
var _makersFeeItem = null;     // Zoho item for MAKERS-FEE (fetched lazily when kits present)
var _makersFeeLoaded = false;
var _isDualCart = false;

// NEW — same pattern:
var _promoApplied = null;  // { code: 'FIRSTBATCH', discountPct: 20 } or null
// Do NOT persist to localStorage — apply at render time only
```

**Discount badge rendering pattern** (12-checkout.js lines 407-412):
```javascript
// Existing badge rendering — promo widget re-render must trigger this same path
if (item.discount && parseFloat(item.discount) > 0) {
  var badge = document.createElement('span');
  badge.className = 'discount-badge-sm';
  badge.textContent = Math.round(parseFloat(item.discount)) + '% OFF';
  tdName.appendChild(badge);
}
```

**Discount price display pattern** (12-checkout.js lines 451-459):
```javascript
// Existing strikethrough + sale price rendering:
if (item.discount && parseFloat(item.discount) > 0) {
  var origNum = parseFloat((item.price || '0').replace('$', '')) || 0;
  var disc = parseFloat(item.discount);
  tdPrice.className = 'table-prices';
  tdPrice.innerHTML = '<span class="table-price-original">' + formatCurrency(item.price) + '</span>'
    + '<span class="table-price-sale">' + formatCurrency(origNum * (1 - disc / 100)) + '</span>';
} else {
  tdPrice.textContent = formatCurrency(item.price);
}
```

**Totals calculation pattern uses `i.discount`** (12-checkout.js lines 654-657):
```javascript
// Existing totals loop — discount already applied per item:
var sub = 0; items.forEach(function (i) {
  var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
  var d = parseFloat(i.discount) || 0; if (d > 0) p *= (1 - d / 100); sub += p * (i.qty || 1);
});
// _promoApplied discount must inject into i.discount at render time for kits only
```

**buildLines helper** (12-checkout.js lines 1204-1213):
```javascript
// Existing buildLines passes item.discount to server:
function buildLines(items) {
  return items.map(function (i) {
    return {
      name: i.name,
      quantity: i.qty || 1,
      rate: parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0,
      item_id: i.zoho_item_id,
      discount: i.discount  // promo: override this for kit items when _promoApplied
    };
  });
}
// Also add: promo_code: _promoApplied ? _promoApplied.code : undefined
// to BOTH the single-cart body (lines ~1690-1705) and dual-cart ferment body (lines ~1248-1259)
```

**Middleware URL pattern** (12-checkout.js line 1195):
```javascript
var mw = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
// Same pattern for promo validate fetch
```

**fetch + .then + .catch error pattern** (12-checkout.js lines 1231-1242):
```javascript
// Established fetch pattern in this file:
fetch(mw + '/api/bookings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
  body: JSON.stringify({ ... })
}).then(function (r) { return r.json(); })
// For promo/validate — no x-api-key needed (public endpoint)
```

**renderReservationItems call as re-render trigger** (12-checkout.js line 602, 725, 851):
```javascript
// Pattern: after any state change, call renderReservationItems() to update UI
renderReservationItems();
// Promo Apply / Remove must call renderReservationItems() after mutating _promoApplied
```

**Placement for promo widget:** After `#reservation-items` div in Step 1 (`data-checkout-step="1"`). The `#reservation-list` section is the container. Promo widget must appear BEFORE the payment section (`#payment-section` in Step 3) so the discounted total is used at `payment/initialize` time. The payment init fires at form submit (checkout.js lines 1578-1629 and 1644-1655), not on page load — this is safe.

---

### `js/modules/13-init.js` (component modification)

**Analog:** self — add banner init in existing `page === 'home'` block

**Content loader pattern** (13-init.js lines 115-146):
```javascript
// The content loader already fetches content/home.json in this block.
// The promo banner must NOT use the [data-content] injection pattern
// because it has different logic (dismiss state, show/hide).
// Instead: add a standalone initPromoBanner() call in the home block.

var page = document.body.getAttribute('data-page');
if (page) {
  var sharedFetch = fetch('content/shared.json')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .catch(function () { return {}; });
  var pageFetch = fetch('content/' + page + '.json')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .catch(function () { return {}; });

  Promise.all([sharedFetch, pageFetch])
    .then(function (results) {
      // ... [data-content] injection ...
    })
    .catch(function () { /* silently fail */ });
}
```

**Home page block** (13-init.js lines 244-249):
```javascript
// Existing home block — add initPromoBanner() here:
if (page === 'home') {
  loadFeaturedProducts();
  initCartDrawer();
  setupBeerWaitlistForm();
  // ADD:
  initPromoBanner();
}
```

**IS_KIOSK flag pattern** (13-init.js lines 3-5):
```javascript
// Already available at DOMContentLoaded scope — use to skip banner in kiosk mode
var IS_KIOSK = (window.location.search.indexOf('kiosk=1') !== -1) ||
               (window.navigator.standalone === true);
// initPromoBanner must check IS_KIOSK and return early if true
```

**localStorage dismiss pattern** (13-init.js lines 174-188 — stale cart warning):
```javascript
// Pattern for localStorage read at DOMContentLoaded:
try {
  var _savedMilledKeys = sessionStorage.getItem('sv-milled-keys');
  // ...
} catch (e) {}
// For banner dismiss: localStorage.getItem('sv-promo-banner-dismissed')
```

**renderOpenStatus() / setInterval pattern** (13-init.js lines 259-261):
```javascript
// Pattern for DOM mutation after page load — same approach for banner dismiss button
renderOpenStatus();
setInterval(renderOpenStatus, 60 * 1000);
```

---

### `content/home.json` (config modification)

**Analog:** self — add `promo-banner` object alongside existing `promo-news`

**Existing JSON structure** (home.json lines 20-33):
```json
{
  "promo-news": [
    {
      "date": "Jan 15, 2026",
      "title": "Grand Opening Special",
      "text": "..."
    }
  ],
  "promo-featured-skus": ["80087760", "80088339"]
}
```

**New object to add** (following same flat-key convention):
```json
{
  "promo-banner": {
    "enabled": true,
    "text": "New customers: <strong>20% off your first batch</strong> — use code <strong>FIRSTBATCH</strong> at checkout",
    "cta-text": "Reserve Your Kit",
    "cta-url": "products/ferment-in-store.html"
  }
}
```

**Key conventions:** flat camelCase-with-hyphens keys, values can contain HTML (other values like `intro-text`, `why-text` already contain HTML entities). `enabled` flag allows toggle without code deploy.

---

### `index.html` (template modification)

**Analog:** existing `<section class="promo-section">` at line 154 — insert `#promo-banner` between `</section>` (hero) and `<section class="promo-section">`

**Structural placement** (index.html lines 138-154):
```html
<!-- Hero section ends at ~line 153 -->
<section class="hero">
  <!-- ... -->
</section>

<!-- INSERT promo-banner here — between hero and promo-section -->
<div id="promo-banner" class="promo-banner hidden" role="alert" aria-live="polite">
  <div class="container promo-banner-inner">
    <span class="promo-banner-text"></span>
    <a href="" class="promo-banner-cta btn btn--sm"></a>
    <button type="button" class="promo-banner-dismiss" aria-label="Dismiss offer">&times;</button>
  </div>
</div>

<section class="promo-section" id="promo-section">
```

**`hidden` class pattern:** used throughout the project to start elements invisible, then JS removes the class.

**`data-page="home"` pattern** (index.html line 111):
```html
<body data-page="home">
```
This drives `page === 'home'` in 13-init.js to activate the banner init.

---

### `css/styles.css` (stylesheet modification)

**Analog:** existing `.discount-badge-sm` and `.promo-news` rules — add `.promo-banner` and `.promo-code-section` rules following same pattern

**Discount badge pattern (existing, to be echoed in banner):**
```css
/* Referenced in 12-checkout.js line 409 — badge for discounted items */
.discount-badge-sm { /* ... existing styles ... */ }
```

**Banner must be full-width strip** (D-01) — styled above `.hero` level, full viewport width, dismissible.

**Promo code section** (`.promo-code-section`) sits inside `#reservation-items` area in reservation.html — should inherit form field sizing from existing checkout styles.

**CSS for `hidden` utility class** (used project-wide):
```css
.hidden { display: none !important; }
```

---

## Shared Patterns

### Redis Key Constant Pattern
**Source:** `zoho-middleware/lib/constants.js` lines 37-58
**Apply to:** `promo.js` route, `checkout.js` modification, `constants.js` addition
```javascript
// All Redis key prefixes live in CACHE_KEYS; import with var C = require('../lib/constants')
// New key: C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + email.toLowerCase()
var C = require('../lib/constants');
var key = C.CACHE_KEYS.PROMO_REDEEMED_PREFIX + email;
```

### Cache Get/Set with Fail-Open
**Source:** `zoho-middleware/lib/cache.js` lines 60-88
**Apply to:** `promo.js` validate endpoint, `checkout.js` redemption burn
```javascript
// get returns null on miss OR Redis unavailable — treat both as "not redeemed"
var existing = await cache.get(key);
if (existing) { /* already redeemed */ }
// set: fire-and-forget on burn (do not await, catch errors)
cache.set(key, { redeemedAt: new Date().toISOString() }, TTL)
  .catch(function (e) { log.error('[promo] burn failed: ' + e.message); });
```

### ES5 Style (All Frontend Files)
**Source:** `js/modules/12-checkout.js` and `js/modules/13-init.js` throughout
**Apply to:** All new frontend code in `js/modules/`
- Use `var`, never `const`/`let`
- Use `function` declarations, never arrow functions
- Use `.then()` chains, never `async/await`
- Use `document.createElement` + `.appendChild`, never template literals for DOM

### Module Export Pattern for Test Access
**Source:** `js/modules/12-checkout.js` lines 46-55 (submodule load block)
**Apply to:** Any new functions in `12-checkout.js` that need test coverage
```javascript
// Append at bottom of module if test access needed:
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { functionName: functionName };
}
```

### Log Prefix Convention
**Source:** `zoho-middleware/routes/discounts.js` lines 84, 116, 131; `routes/checkout.js` lines 271, 356
**Apply to:** `promo.js`, `checkout.js` modifications
```javascript
log.info('[promo/validate] ...');
log.error('[promo] Failed to burn redemption: ' + err.message);
log.warn('[checkout] promo code present but validation failed');
```

### 'use strict' + Express Router Scaffold
**Source:** `zoho-middleware/routes/discounts.js` lines 1-11
**Apply to:** `zoho-middleware/routes/promo.js`
```javascript
'use strict';
var express = require('express');
// ... other requires ...
var router = express.Router();
// ... route definitions ...
module.exports = router;
```

### Server-Side Authoritative Pricing (C3 Constraint)
**Source:** `zoho-middleware/lib/pricing.js` lines 29-35 (comment), `routes/checkout.js` line 330
**Apply to:** `checkout.js` promo discount enforcement
```javascript
// The discount field on the product is intentionally ignored on the server (C3).
// Discounts must be computed server-side from authoritative data.
// For promo: validate body.promo_code === 'FIRSTBATCH', then pass discountPct: 20
// to computeLineItem — never trust body.items[].discount alone.
var built = buildLineItems(checkoutItems, catalogMap, true);
// discountPct flows through buildLineItems → computeLineItem (pricing.js lines 46-77)
```

---

## No Analog Found

All files have close analogs in the codebase. No "no analog" entries.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`, `zoho-middleware/__tests__/`, `js/modules/`, `content/`, `index.html`, `reservation.html`
**Files scanned:** ~15 files read directly; additional files searched via grep
**Pattern extraction date:** 2026-05-03
