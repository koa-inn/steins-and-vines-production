# Coding Conventions

**Analysis Date:** 2026-04-27

## Language Style

### Frontend (`js/`)
- **ES5 with `var`** — no `let`/`const`, no arrow functions, no template literals in modules
- Exception: `async/await` used in checkout flow (`12-checkout.js`, `12a-checkout-validation.js`)
- All modules are concatenated into `js/main.js` — no import/export, everything shares global scope
- Standalone apps (`admin.js`, `kiosk.js`, `brewpad.js`, `batch.js`) use IIFE wrapper: `(function() { 'use strict'; ... })();`

### Middleware (`zoho-middleware/`)
- **CommonJS** (`require`/`module.exports`)
- Mix of `var` and selective `async/await` (newer code like checkout uses async/await)
- Express route handlers use standard `(req, res)` or `async (req, res)` patterns

### Shared Module Export Pattern
Frontend modules that need testing append a conditional export:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { functionA, functionB };
}
```

## Naming Conventions

### Variables and Functions
- **camelCase** for functions and variables: `loadProducts()`, `getReservedQty()`, `formatCurrency()`
- **Leading underscore** for module-private state: `_activeCartTab`, `_deepLinkHandled`, `_handlingUnauthorized`
- **UPPER_SNAKE** for constant objects: `CART_KEYS`, `ITEM_TYPES`, `KIT_CATEGORIES`, `CACHE_KEYS`

### Files
- Frontend modules: numbered prefix for load order (`01-config.js` through `13-init.js`)
- Sub-modules: letter suffix (`12a-checkout-validation.js`, `12c-checkout-scheduling.js`)
- Middleware routes: feature name (`catalog.js`, `checkout.js`, `pos.js`)
- Middleware libs: descriptive (`pricing.js`, `checkout-helpers.js`, `validateEnv.js`)
- Tests: `*.test.js` (Jest), `*.spec.js` (Playwright E2E)

### DOM
- `data-` attributes for JS hooks: `data-sku`, `data-product-tab`, `data-content`
- CSS classes: `kebab-case` (`.product-card`, `.label-wine`, `.header-contact`)
- IDs: `kebab-case` (`#product-grid`, `#cart-sidebar`)

## Code Patterns

### Product Card Rendering
Three card types based on product category:
- Wine → `.label-wine` card with tint from `getTintClass()`
- Beer → `.label-beer` card
- Other → `.product-card` (standard)
Shared helpers: `getTintClass()`, `buildLabelNotesToggle()`, `buildLabelPriceFooter()`

### Dual Cart System
Cart routing by `_item_type`:
```js
var cartKey = getCartKey(product);  // routes to CART_KEYS.FERMENT or CART_KEYS.INGREDIENTS
var items = getReservation(cartKey);
saveReservation(items, cartKey);
```
`getReservedQty(sku)` searches BOTH carts for cross-cart awareness.

### Content Loading
`13-init.js` fetches `content/shared.json` + `content/{page}.json` on DOMContentLoaded:
```js
document.querySelectorAll('[data-content]').forEach(function(el) {
  var key = el.getAttribute('data-content');
  if (merged[key] !== undefined) el.innerHTML = merged[key];
});
```

### Middleware Route Pattern
Standard Express route with try/catch, structured logging, and consistent error responses:
```js
router.get('/endpoint', requireAllowedReferer, async (req, res) => {
  try {
    // business logic
    res.json({ success: true, data: result });
  } catch (err) {
    log.error('endpoint failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Security Middleware
- `requireAllowedReferer` — CORS + Referer origin check (prevents subdomain bypass)
- `requireApiKey` — validates `x-api-key` header against `API_SECRET_KEY`
- `reCAPTCHA` verification on checkout and contact forms
- OAuth state param with `crypto.randomBytes(16)` + Redis TTL for CSRF protection

## Error Handling

### Frontend
- `try/catch` around all fetch calls and async operations
- Catalog modules show retry buttons on fetch failure (error boundary pattern)
- `console.warn()` / `console.error()` for debugging (ESLint warns on `no-console`)
- Sentry integration via `js/sentry-init.js` for production error tracking

### Middleware
- Route-level `try/catch` with `res.status(500).json({ error: ... })`
- `validateEnv.js` checks required env vars at startup (4 required, 40+ optional)
- `checkRedis.js` pings Redis at startup, degrades gracefully if unavailable
- `eventLog.js` wraps structured event logging (7 event types, zero PII)
- Void failure alerts via `mailer.sendVoidFailureAlert()` (no PII, includes txnId + amount)

## Build Pipeline

```bash
npm run build
```
Steps:
1. `stamp` — updates `BUILD_TIMESTAMP` in `admin.js`
2. `stamp:sw` — updates `CACHE_VERSION` in `sw.js`
3. `concat:js` — joins `js/lib/constants.js` + `js/modules/01-*.js` through `13-*.js` → `js/main.js`
4. `minify:css` — `cleancss` on all CSS files → `*.min.css`
5. `minify:js` — `terser` on `main.js`, `admin.js`, `batch.js`, `kiosk.js`, `brewpad.js` → `*.min.js`

## Linting

- **Frontend:** ESLint flat config (`eslint.config.js`), ES2020, browser globals, rules: `eqeqeq: warn`, `no-console: warn`
- **Middleware:** Separate ESLint config in `zoho-middleware/`
- **CI:** Both lint checks run in GitHub Actions (`tests.yml`)
- Auto-generated `js/main.js` and all `*.min.js` are excluded from linting
