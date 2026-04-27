# Testing Infrastructure

**Analysis Date:** 2026-04-27

## Overview

Two separate test suites (frontend + middleware) plus Playwright E2E tests. All run in CI via GitHub Actions.

## Frontend Unit Tests

**Framework:** Jest with jsdom environment
**Location:** `tests/frontend/*.test.js`
**Config:** `jest.config.js` (root)
**Run:** `npm test`

### Test Files
| File | Tests | Coverage Target |
|------|-------|-----------------|
| `cart-dom.test.js` | 9 | `js/modules/11-cart.js` |
| `cart-localStorage.test.js` | 10 | `js/modules/11-cart.js` |
| `cart.test.js` | uses `it()` blocks | `js/modules/11-cart.js` |
| `catalog-search.test.js` | catalog search logic | `js/modules/05-catalog-view.js` |
| `catalog-view.test.js` | grid/list toggle | `js/modules/05-catalog-view.js` |
| `checkout-completion.test.js` | checkout completion | `js/modules/12-checkout.js` |
| `checkout-validation.test.js` | pre-checkout validation | `js/modules/12-checkout.js` |
| `label-cards.test.js` | wine/beer card render | `js/modules/04-label-cards.js` |
| `utils.test.js` | utility functions | `js/modules/02-utils.js` |
| `brewpad-pure.test.js` | brewpad pure functions | `js/brewpad.js` |

### Coverage Config
```js
collectCoverageFrom: [
  'js/modules/02-utils.js',
  'js/modules/04-label-cards.js',
  'js/modules/05-catalog-view.js',
  'js/modules/11-cart.js',
  'js/modules/12-checkout.js'
],
coverageThreshold: { global: { lines: 5 } }
```
Low threshold reflects Campaign 1 scope — pure functions extracted from large files.

### Testing Pattern (Frontend)
Modules use conditional export for testability:
```js
// At bottom of module file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { helperFn, anotherFn };
}
```
Tests import directly:
```js
const { helperFn } = require('../../js/modules/02-utils.js');
```

## Middleware Unit Tests

**Framework:** Jest with Node environment
**Location:** `zoho-middleware/__tests__/*.test.js`
**Config:** `zoho-middleware/jest.config.js`
**Run:** `cd zoho-middleware && npm test`

### Test Files
| File | Tests | Coverage Target |
|------|-------|-----------------|
| `zohoAuth.test.js` | 12 | `lib/zohoAuth.js` |
| `checkout.test.js` | 5 | `routes/checkout.js` |
| `zoho-api.test.js` | 3 | `lib/zoho-api.js` |
| `cache.test.js` | 2 | `lib/cache.js` |
| `bookings.test.js` | — | `routes/bookings.js` |
| `catalog.test.js` | — | `routes/catalog.js` |
| `pricing.test.js` | — | `lib/pricing.js` |
| `taxes.test.js` | — | `routes/taxes.js` |
| `validate.test.js` | — | `lib/validate.js` |
| `logger.test.js` | — | `lib/logger.js` |
| `collect.test.js` | — | `routes/collect.js` |
| `consignment.test.js` | — | `routes/consignment.js` |
| `discounts.test.js` | — | `routes/discounts.js` |
| `inventory-ledger.test.js` | — | `lib/inventory-ledger.js` |
| `kiosk-salesorders.test.js` | — | `routes/pos.js` |
| `pos-cache.test.js` | — | `routes/pos.js` |

### Coverage Config
```js
collectCoverageFrom: [
  'lib/**/*.js',
  '!lib/gp.js',       // Global Payments — Campaign 2+
  '!lib/mailer.js'    // Nodemailer — Campaign 2+
],
coverageThreshold: {
  global: { lines: 35 },
  './lib/validate.js': { lines: 98 },
  './lib/logger.js': { lines: 98 }
}
```

## E2E Tests

**Framework:** Playwright (Chromium only)
**Location:** `tests/e2e/*.spec.js`
**Config:** `playwright.config.js`
**Run:** `npm run test:e2e` (requires `BASE_URL` env var)

### Test Files
| File | Scope |
|------|-------|
| `homepage.spec.js` | Homepage load, hero, featured products |
| `products.spec.js` | Product catalog, tabs, filtering |
| `checkout.spec.js` | Checkout flow end-to-end |
| `static-pages.spec.js` | About, contact, 404 pages |

### CI Behavior
- E2E runs **only on push to main** (not PRs) — tests hit live staging site
- Depends on `test-frontend` and `test-middleware` jobs passing first
- Playwright browsers cached via `actions/cache`
- Failure uploads `playwright-report/` as artifact (7-day retention)

## CI Pipeline (`.github/workflows/tests.yml`)

```
push/PR → test-middleware (Jest + lint + audit)
        → test-frontend  (Jest + lint + audit)
        → test-e2e       (Playwright, push-to-main only)
```

All jobs run on `ubuntu-latest` with Node 20. Both middleware and frontend run:
1. Jest unit tests
2. ESLint
3. `npm audit --audit-level=high`

## Testing Campaigns

Testing is organized in campaigns (tracked in `TESTING.md` at repo root):

**Campaign 1 (complete):** Pure function extraction and testing
- Frontend: 254 tests across 10 files
- Middleware: 323 tests across 16 files

**Campaign 2 (planned):** `routes/taxes.js`, `routes/checkout.js` pure helpers, `lib/gp.js`, `lib/mailer.js`

## Mocking Patterns

### Frontend
- `localStorage` mocked via jsdom environment
- DOM elements created in test setup, cleaned in `afterEach`
- No fetch mocking — tests focus on pure functions

### Middleware
- Redis mocked (no live Redis in tests)
- Zoho API calls mocked with Jest `jest.mock()`
- Express `req`/`res` objects constructed manually
- No database — all state via Zoho API or Redis cache
