# Technical Concerns

**Analysis Date:** 2026-04-27

## Critical Concerns

### 1. Large Monolithic Files
Several files exceed 1000 lines and concentrate too much logic:

| File | Lines | Risk |
|------|-------|------|
| `js/admin.js` | 8,856 | Largest file — IIFE with all admin dashboard logic |
| `js/brewpad.js` | 3,868 | Brew pad management |
| `js/kiosk.js` | 3,154 | Kiosk POS |
| `js/modules/12-checkout.js` | 1,800 | Checkout flow (partially split into 12a/12c) |
| `js/modules/07-catalog-kits.js` | 1,465 | Kit catalog rendering |
| `js/modules/11-cart.js` | 1,243 | Dual cart system |
| `zoho-middleware/routes/pos.js` | 1,328 | POS route handlers |
| `zoho-middleware/routes/catalog.js` | 1,024 | Catalog route handlers |

**Impact:** Hard to test, hard to review, merge conflicts on concurrent work.
**Status:** Phase 4 of tech debt sprint (incremental IIFE modularization) is in progress.

### 2. innerHTML Usage Without Consistent Sanitization
15+ files use `innerHTML =` for DOM manipulation:
- `js/modules/07-catalog-kits.js`, `08-catalog-ingredients.js`, `09-catalog-services.js`
- `js/modules/12-checkout.js`, `12c-checkout-scheduling.js`
- `js/modules/06-featured.js`, `04-label-cards.js`
- `js/admin.js`, `js/kiosk.js`, `js/brewpad.js`, `js/batch.js`

`escapeHTML()` exists in `js/lib/utils.js` (includes apostrophe) but is not universally applied. Product data from Zoho could contain unexpected HTML if a product name/description is crafted maliciously.

**Impact:** Potential XSS if Zoho data is compromised or contains HTML entities.

### 3. Service Worker Cache Staleness
`sw.js` aggressively caches `styles.min.css` and `main.min.js`. After deploys, visitors must hard-refresh (Cmd+Shift+R) to see updates. `CACHE_VERSION` is stamped during build, but the SW update lifecycle means the old cache persists until a second page load.

**Impact:** Users may see stale UI/behavior after deploys until they hard-refresh.

## High Concerns

### 4. Low Test Coverage Thresholds
- Frontend global coverage threshold: **5% lines** (Campaign 1 baseline)
- Middleware global threshold: **35% lines**
- Many test files exist but contain few or zero `it()` blocks (scaffold only)
- Large files like `admin.js`, `kiosk.js`, `brewpad.js` have no unit tests

**Impact:** Regressions can ship undetected in untested code paths.

### 5. Global Scope Pollution (Frontend)
All frontend modules share global scope via concatenation. Any `var` at module top-level is global. Name collisions are prevented only by convention (no tooling enforcement).

**Impact:** Subtle bugs from variable shadowing or accidental overwrites. Standalone apps (admin, kiosk, brewpad, batch) mitigate this with IIFEs.

### 6. Redis Encryption Key Possibly Missing
`zoho-middleware/lib/zohoAuth.js` stores Zoho refresh tokens — encryption is a no-op without `REDIS_ENCRYPTION_KEY` env var in Railway production. Issue #106 filed but awaiting manual verification.

**Impact:** Zoho refresh token stored in plaintext in Redis if key is missing.

### 7. Zoho API Rate Limits
Image sync script (`zoho-middleware/scripts/sync-images.js`) hits 429 errors and needs 700ms delay + multiple runs. Catalog enrichment via `/itemdetails` bulk endpoint has known quirks (missing `sales_tax_rule_id`).

**Impact:** Deploy-time failures or stale product data during high-traffic syncs.

## Medium Concerns

### 8. Console Logging in Production
~100+ `console.log/warn/error` calls across frontend JS. ESLint has `no-console: warn` but doesn't block. Production users see debug output in browser console.

**Impact:** Information disclosure, noise in debugging, slight performance cost.

### 9. No Automated Accessibility Testing
WCAG contrast failures documented (issue H14) but no automated a11y checks in CI. Manual audit identified muted text contrast issues.

**Impact:** Accessibility regressions can ship without notice.

### 10. Placeholder Content on About Page
Issue H1: Lorem ipsum / placeholder copy still present on `about.html`. Awaiting content from business.

**Impact:** Unprofessional appearance to visitors.

### 11. Missing `12b` Sub-Module
Checkout was split into `12a-checkout-validation.js` and `12c-checkout-scheduling.js`, but `12b` doesn't exist. The main `12-checkout.js` (1800 lines) still contains the bulk of checkout logic that was intended for further splitting.

**Impact:** Incomplete refactor — checkout remains hard to test and maintain.

## Pending Human Actions

These items require manual intervention (not code changes):

| Issue | Action Required | Where |
|-------|-----------------|-------|
| #96 | Enable Redis AOF persistence | Railway dashboard → Redis service → Settings |
| #106 | Verify `REDIS_ENCRYPTION_KEY` env var is set | Railway dashboard → zoho-middleware env vars |
| H1 | Write About page copy | Business owner |
| H14 | Design review of muted text contrast | Design decision needed |

## Technical Debt Audit Status

**Completed (on staging):**
- Phase 1: validateEnv, checkRedis, catalog error boundaries, `js/lib/utils.js`, ESLint + audit CI
- Phase 2: `lib/pricing.js` (server-authoritative), `lib/constants.js` (both sides), async/await conversion
- Phase 3: `12-checkout.js` partial split, `js/lib/auth.js`, `eventLog.js`, `openapi.yaml`

**In Progress:**
- Phase 4: Incremental IIFE modularization of `admin.js`, `brewpad.js`, `batch.js`, `kiosk.js`

**Open GitHub Issues:** Tracked at `koa-inn/steins-and-vines-staging` Issues board. Priority labels: `priority:critical` through `priority:low`. Status label: `status:needs-validation` for fixes on staging awaiting human sign-off.
