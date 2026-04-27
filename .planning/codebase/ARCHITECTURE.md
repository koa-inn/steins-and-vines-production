<!-- refreshed: 2026-04-27 -->
# Architecture

**Analysis Date:** 2026-04-27

## System Overview

```text
+---------------------------------------------------------------------+
|                    Static Frontend (GitHub Pages)                     |
|  index.html, products.html, ingredients.html, reservation.html, etc. |
|  `js/modules/01-13` -> concat -> `js/main.min.js`                   |
|  `js/admin.js`, `js/kiosk.js`, `js/brewpad.js`, `js/batch.js`       |
+-----------+------------------+-------------------+-------------------+
            |                  |                   |
            | fetch()          | Google OAuth       | Apps Script
            v                  v                   v
+-----------+------------------+---+   +-----------+-----------+
|   Express Middleware (Railway)    |   | Google Sheets/Apps    |
|   `zoho-middleware/server.js`    |   | Script Backend        |
|   14 route modules               |   | `apps-script/*.gs`    |
+--+------------+------------------+   +----------+------------+
   |            |                                  |
   v            v                                  v
+--+----+  +---+--------+                 +--------+--------+
| Redis |  | Zoho Books |                 | Google Sheets   |
| Cache |  | Inventory  |                 | (Batches, etc.) |
+-------+  | Bookings   |                 +-----------------+
           +---+--------+
               |
+--------------+---------+
| Helcim Payment Gateway |
+------------------------+
```

## Component Responsibilities

| Component | Responsibility | File(s) |
|-----------|----------------|---------|
| Public pages | Customer-facing catalog, cart, checkout, content pages | `index.html`, `products.html`, `ingredients.html`, `reservation.html`, `about.html`, `contact.html`, `404.html` |
| Clean-URL sub-pages | SEO-friendly product URLs | `products/ferment-in-store.html`, `products/ingredients-supplies.html` |
| Module pipeline | Concatenated JS for public pages | `js/modules/01-config.js` through `js/modules/13-init.js` -> `js/main.js` |
| Shared libs | Cross-module utilities | `js/lib/constants.js`, `js/lib/utils.js`, `js/lib/auth.js` |
| Admin dashboard | Staff reservation/inventory management | `admin.html` + `js/admin.js` (IIFE) |
| Kiosk POS | In-store point-of-sale terminal | `kiosk.html` + `js/kiosk.js` (IIFE) |
| BrewPad | Brewing operations dashboard | `brewpad.html` + `js/brewpad.js` (IIFE) |
| Batch tracker | Public batch status page | `batch.html` + `js/batch.js` (IIFE) |
| Middleware server | Express API proxying Zoho and Helcim | `zoho-middleware/server.js` |
| Catalog routes | Product/ingredient/service listing with cache | `zoho-middleware/routes/catalog.js` |
| Checkout routes | Sales order creation, payment recording | `zoho-middleware/routes/checkout.js` |
| POS routes | Kiosk sale flow (Helcim terminal + Zoho) | `zoho-middleware/routes/pos.js` |
| Auth routes | Zoho OAuth flow, payment config | `zoho-middleware/routes/auth.js` |
| Redis cache | Multi-layer caching for Zoho data | `zoho-middleware/lib/cache.js` |
| Zoho API client | HTTP wrapper for Zoho REST endpoints | `zoho-middleware/lib/zoho-api.js` |
| Zoho auth | OAuth token management with encrypted refresh | `zoho-middleware/lib/zohoAuth.js` |
| Helcim client | Payment initialization, void, refund | `zoho-middleware/lib/helcim.js` |
| Apps Script | Google Sheets CRUD for batches, events, admin | `apps-script/adminApi.gs`, `apps-script/trackEvent.gs` |
| Content loader | JSON-driven CMS for page copy | `content/*.json` |
| Service worker | Cache-busting (self-unregistering) | `sw.js` |

## Pattern Overview

**Overall:** Multi-page static site with API middleware proxy

**Key Characteristics:**
- Frontend is vanilla JS (ES5 style with `var`), no framework or bundler
- JS modules are numbered and concatenated in order (01-13) into a single `main.js`
- Standalone pages (admin, kiosk, brewpad, batch) use self-contained IIFEs
- Middleware is a traditional Express.js REST API acting as a proxy to Zoho APIs
- Redis provides caching, rate-limiting state, and session persistence
- Two separate deployment targets: GitHub Pages (frontend) and Railway (middleware)

## Layers

**Presentation Layer (GitHub Pages):**
- Purpose: Renders HTML pages, handles user interaction, manages client-side cart
- Location: Root HTML files + `js/`, `css/`, `content/`, `images/`
- Contains: Static HTML, concatenated JS modules, CSS, JSON content
- Depends on: Middleware API (via fetch), Google Apps Script API, Google Identity Services
- Used by: End customers (public pages), staff (admin/kiosk/brewpad pages)

**API Middleware Layer (Railway):**
- Purpose: Proxies Zoho APIs, handles payment processing, manages caching, enforces security
- Location: `zoho-middleware/`
- Contains: Express routes, library modules, Redis client
- Depends on: Zoho Books/Inventory APIs, Helcim payment API, Redis, SMTP
- Used by: Frontend (via CORS-protected fetch calls)

**Data Layer (External Services):**
- Purpose: Persistent storage and business data
- Location: Zoho Books/Inventory (products, orders, contacts), Google Sheets (batches, schedules, reservations)
- Contains: Product catalog, customer orders, batch tracking data
- Depends on: N/A (external SaaS)
- Used by: Middleware (Zoho), Apps Script (Sheets), Admin dashboard (both)

**Content Layer (Static JSON):**
- Purpose: CMS-like content management without a database
- Location: `content/*.json`, `content/*.csv`
- Contains: Page copy, FAQ data, promo config, product snapshots, timeslots
- Depends on: N/A (committed to git)
- Used by: Frontend content loader (`js/modules/13-init.js`), fallback catalog

## Data Flow

### Primary Request Path: Product Catalog

1. Page loads, `loadProducts()` called (`js/modules/07-catalog-kits.js:7`)
2. Checks localStorage cache (`sv-products-mw`, 30min TTL) (`js/modules/07-catalog-kits.js:32-40`)
3. If stale, fetches `{MIDDLEWARE_URL}/api/products` (`js/modules/07-catalog-kits.js:52-53`)
4. Middleware checks Redis cache (`zoho:products`, 1hr TTL) (`zoho-middleware/routes/catalog.js:68-69`)
5. If Redis miss, calls Zoho Inventory API (paginated fetch + detail enrichment) (`zoho-middleware/lib/zoho-api.js`)
6. Response cached in Redis, returned to frontend (`zoho-middleware/routes/catalog.js`)
7. Frontend renders product cards/table, caches in localStorage (`js/modules/07-catalog-kits.js`)
8. If middleware unavailable, falls back to `content/zoho-snapshot.json` (`js/modules/07-catalog-kits.js:20-28`)

### Checkout Flow

1. Customer fills checkout form on `reservation.html` (`js/modules/12-checkout.js:76`)
2. Validation runs (12a-checkout-validation.js), reCAPTCHA token obtained
3. If payment enabled, `POST /api/payment/initialize` gets Helcim checkout token (`js/modules/12-checkout.js`)
4. HelcimPay.js iframe opens, customer completes payment
5. Payment result received via `postMessage`, transaction ID captured
6. `POST /api/checkout` with items, customer info, transaction_id (`zoho-middleware/routes/checkout.js:57`)
7. Server looks up/creates Zoho contact, builds Sales Order line items (`zoho-middleware/routes/checkout.js`)
8. Creates Zoho Sales Order, records payment if transaction_id present
9. On Zoho failure after charge: automatic void via Helcim API (`zoho-middleware/lib/helcim.js`)
10. Dual-cart: two sequential `/api/checkout` calls with same transaction_id (replay guard via Redis)

### Content Loading

1. `DOMContentLoaded` fires, reads `data-page` attribute from `<body>` (`js/modules/13-init.js:116`)
2. Fetches `content/shared.json` and `content/{page}.json` in parallel (`js/modules/13-init.js:118-123`)
3. Merges (page overrides shared), applies to all `[data-content="KEY"]` elements (`js/modules/13-init.js:130-141`)

### Admin/Staff Auth Flow

1. Admin/kiosk/brewpad pages load Google Identity Services SDK
2. `waitForGoogleIdentity()` polls until GIS ready (`js/lib/auth.js:25`)
3. User clicks sign-in, `gsiInitTokenClient()` initiates OAuth (`js/lib/auth.js`)
4. Token received, `fetchGoogleUserInfo()` gets email (`js/lib/auth.js`)
5. Email checked against staff list (from Google Sheets Config tab)
6. Session stored in localStorage with expiry

**State Management:**
- Client-side cart state in localStorage: `sv-cart-ferment`, `sv-cart-ingredients` (two separate carts)
- In-memory fallback (`_memoryStore`) for iOS Safari private browsing (`js/modules/11-cart.js:14`)
- Milling state in sessionStorage: `sv-milled-keys` (`js/modules/12-checkout.js:7`)
- Admin/kiosk sessions in localStorage with expiry-based invalidation
- Server-side state in Redis (cache, rate limits, Zoho auth tokens, idempotency keys)

## Key Abstractions

**Dual Cart System:**
- Purpose: Separate carts for ferment-in-store kits vs. ingredients/supplies
- Storage: `sv-cart-ferment` and `sv-cart-ingredients` in localStorage
- Routing: `getCartKey(product)` routes by `_item_type`; `getCartKeyForTab(tab)` routes by active tab
- Files: `js/modules/11-cart.js`, `js/lib/constants.js`

**Module Pipeline (Frontend Build):**
- Purpose: Ordered concatenation of numbered modules into a single JS file
- Pattern: `js/lib/constants.js` + `js/modules/01-*.js` through `js/modules/13-*.js` -> `js/main.js`
- Build: `npm run concat:js` (via cat), then `terser` minification
- Rule: Module N can reference globals from modules 1..(N-1) since they are concatenated in order

**IIFE Standalone Pages:**
- Purpose: Self-contained JS for staff-facing pages, no shared globals with main pipeline
- Pattern: `(function() { 'use strict'; ... })()`
- Files: `js/admin.js` (8856 lines), `js/kiosk.js` (3154 lines), `js/brewpad.js` (3868 lines), `js/batch.js` (406 lines)

**Cache Cascade (Products):**
- Purpose: Minimize Zoho API calls via multi-tier caching
- Tiers: localStorage (30min) -> Redis (1hr hard / 10min soft) -> Zoho API -> local file cache fallback
- Warm-up: Cron at 05:00 and 13:00 UTC, also on startup (`zoho-middleware/server.js:395-430`)
- Fallback: `content/zoho-snapshot.json` (committed static snapshot)

**Content JSON System:**
- Purpose: Editable page copy without code changes
- Pattern: `content/shared.json` (global) + `content/{page}.json` (page-specific), merged at load
- Delivery: `[data-content="KEY"]` attributes on HTML elements replaced with values
- File: `js/modules/13-init.js:116-146`

## Entry Points

**Public Frontend Pages:**
- Location: `index.html` (data-page="home"), `products.html` (data-page="products"), etc.
- Triggers: Browser navigation, direct URL
- JS Entry: `js/modules/13-init.js` DOMContentLoaded handler dispatches by `data-page` value

**Staff Pages:**
- Location: `admin.html`, `kiosk.html`, `brewpad.html`, `batch.html`
- Triggers: Direct URL (admin: `/admin.html?tab=kiosk`, etc.)
- JS Entry: Each loads its own IIFE script (e.g., `js/admin.js`)

**Middleware Server:**
- Location: `zoho-middleware/server.js`
- Triggers: Railway `npm start` / local `node server.js`
- Startup: Helcim init -> Redis connect -> checkRedis -> Zoho auth restore -> HTTP listen -> cache warm-up

**Build System:**
- Location: `package.json` scripts
- Trigger: `npm run build`
- Steps: stamp timestamps -> stamp cache-bust versions -> minify CSS -> concat+minify JS

## Architectural Constraints

- **No bundler:** JS modules are concatenated via `cat` in a fixed order. No import/export, no tree-shaking. Every module shares a single global scope. Order matters.
- **ES5 style:** Codebase uses `var` throughout, `function` declarations, no arrow functions in production code. Node tests use some async/await.
- **Two deployment targets:** Frontend on GitHub Pages (static), middleware on Railway (Node.js). They cannot share code at runtime -- only constants are manually mirrored (`js/lib/constants.js` and `zoho-middleware/lib/constants.js`).
- **Global scope coupling:** The concat pipeline means module N has implicit access to all globals from modules 1..(N-1). Shared helpers (e.g., `escapeHTML`, `formatCurrency`, `showToast`) must be defined before they are called.
- **No SSR:** All rendering is client-side DOM manipulation. SEO relies on static HTML content + JSON-LD injection.
- **Single-threaded middleware:** Express runs in a single Node.js process. No worker threads. Redis provides shared state for rate limiting and caching.
- **Zoho rate limits:** API calls are throttled. Catalog enrichment uses coalesced in-memory cache (`_rawItemsCache`, 60s TTL) and distributed Redis lock (`products:refresh`) to prevent concurrent Zoho fetches.

## Anti-Patterns

### Monolithic IIFE Staff Pages

**What happens:** `js/admin.js` is 8856 lines in a single IIFE. `js/brewpad.js` is 3868 lines, `js/kiosk.js` is 3154 lines.
**Why it's wrong:** Difficult to test (cannot import individual functions), hard to navigate, merge conflicts likely.
**Do this instead:** Phase 4 of the tech debt sprint plans incremental IIFE modularization. Extract logical sections into separate files concatenated together, matching the `js/modules/` pattern. See `docs/tasks.md`.

### Mirrored Constants

**What happens:** `js/lib/constants.js` and `zoho-middleware/lib/constants.js` define overlapping constants (e.g., `KIT_CATEGORIES`) independently.
**Why it's wrong:** Manual sync required. A change in one can be missed in the other.
**Do this instead:** Accept this as a limitation of the no-bundler architecture. When changing shared constants, always grep both `js/lib/constants.js` and `zoho-middleware/lib/constants.js`.

## Error Handling

**Strategy:** Defensive fallback with graceful degradation

**Patterns:**
- Frontend: try/catch around localStorage access with in-memory fallback (`js/modules/11-cart.js:48-54`)
- Frontend: Catalog falls back from middleware -> snapshot JSON -> CSV (`js/modules/07-catalog-kits.js`)
- Middleware: Zoho offline mode -- POST endpoints check `req.zohoOffline` and send email notifications instead (`zoho-middleware/server.js:195-206`)
- Middleware: Redis unavailable -- rate limiting falls back to in-process MemoryStore (`zoho-middleware/server.js:306-309`)
- Checkout: Automatic Helcim void on Zoho Sales Order creation failure (`zoho-middleware/routes/checkout.js`)
- Void failure: Email alert via `mailer.sendVoidFailureAlert()` (`zoho-middleware/lib/mailer.js`)

## Cross-Cutting Concerns

**Logging:**
- Frontend: `console.log/error` (no structured logging)
- Middleware: `zoho-middleware/lib/logger.js` (structured, no PII)
- Middleware: `zoho-middleware/lib/eventLog.js` -- 7 event types, zero PII, logged to Redis

**Validation:**
- Frontend: Inline form validation in `js/modules/12a-checkout-validation.js`
- Middleware: `zoho-middleware/lib/validate.js` for input sanitization
- Middleware: `zoho-middleware/lib/validateEnv.js` for startup env var checks (4 required, 40+ optional)

**Authentication:**
- Public pages: No auth required
- Staff pages: Google OAuth via Identity Services (`js/lib/auth.js`), email checked against staff list
- Middleware Zoho: OAuth 2.0 with auto-refresh, encrypted refresh token in Redis (`zoho-middleware/lib/zohoAuth.js`)
- Middleware API: `x-api-key` header checked against `API_SECRET_KEY` env var for mutating endpoints
- Checkout: reCAPTCHA verification instead of API key (`zoho-middleware/routes/checkout.js`)

**Rate Limiting:**
- Redis-backed per-IP rate limiting via `express-rate-limit` (`zoho-middleware/server.js:240-348`)
- Scoped limiters: general API (60/min), payment (10/min), contact (5/min), PIN (5/min)
- Falls back to in-process MemoryStore when Redis unavailable

**Security:**
- CORS origin whitelist (`zoho-middleware/server.js:41-57`)
- Referer guard on API routes (`zoho-middleware/server.js:60-80`)
- Helmet security headers (`zoho-middleware/server.js:38`)
- Zoho refresh token AES-256-GCM encryption (`zoho-middleware/lib/zohoAuth.js:28-55`)
- OAuth state param with Redis-backed CSRF protection (`zoho-middleware/routes/auth.js:20`)
- Idempotency keys for checkout/kiosk to prevent duplicate orders (`zoho-middleware/lib/constants.js:41-42`)
- HMAC-SHA256 verification on Helcim webhooks (`zoho-middleware/routes/webhooks.js`)

---

*Architecture analysis: 2026-04-27*
