# Current Tasks

## In Progress

<!-- Add items here when starting work. Move to Completed when done. -->

- [ ] **reservation UX** Verify staging looks correct after 2026-03-18 alignment + breakdown changes — awaiting human sign-off before production push

## Notes

- **Batch QR codes** point to `window.location.origin` — on staging they link to staging URLs, on production they link to production. This is correct behavior: QR codes should point to production once the feature is deployed there. No code change needed.

## Blocked / Needs Discussion

- [ ] **#88** [BLOCKED] Online payments disabled — GP contract/Helcim transition _(awaiting GP account activation or early-exit decision, ~Jan 2027 if riding out)_
- [ ] **#96** [CRITICAL] Enable Redis persistence (RDB + AOF) — prevent double-charge on restart _(Railway dashboard action required: Redis → Settings → Persistence)_
- [ ] **#106** [SECURITY] Verify `REDIS_ENCRYPTION_KEY` is set in Railway production _(Zoho refresh token stored in plaintext without it)_
- [ ] **tax-display** Tax rows not showing on reservation page — cart items saved with `tax_percentage: 0`. Fix: clear cart, re-add items. If still missing, assign GST to items in Zoho Inventory. _(data/config issue, not a code bug)_

## Open — Critical / High Priority

- [x] **catalog-error-boundary** [BUG] `renderIngredients()`' `.catch()` treated ANY render-time throw as a data-fetch failure and showed the "Couldn't load products. Check your connection…" banner — so a decorative bug (e.g. `injectProductSchema` throwing on a quoted product name, 2026-07-10 prod outage, fixed in 202744d) took down the whole catalog with a misleading message. **RESOLVED in 828b22a:** `injectProductSchema` is now best-effort (try/catch, can't throw into render); loaders 08 + 16 use `.then(onSuccess, onFetchError)` so a render throw no longer shows the connection banner — only a genuine fetch rejection does. Verified end-to-end against the built bundle (render-throw → no banner). _(surfaced during 202744d incident)_
- [ ] **#101** [TECH-DEBT] Break middleware `checkout.js` into payment, scheduling, and validation sub-modules _(frontend 12a/12b/12c done; middleware routes/checkout.js still monolithic)_
- [ ] **#81** [HIGH] Create README.md

## Open — Medium Priority

- [ ] **#63** [SECURITY] Middleware has no security headers (HSTS, X-Frame-Options, etc.)
- [ ] **#58** [SECURITY] Payment charge allows duplicate transactions — no idempotency key
- [ ] **#57** [SECURITY] `items.js` passes `req.body` directly to Zoho with no validation
- [ ] **#56** [BUG] `bookings.js` double-parse bug — same class as `pos.js` #518
- [ ] **#55** [KIOSK] Deploy kiosk checkout to production
- [ ] **#54** [KIOSK] Verify GP POS terminal + test full sale flow
- [ ] **#53** [KIOSK] Add `KIOSK_CONTACT_ID` env var to Railway
- [ ] **#84** [DOCS] Create deployment runbook
- [ ] **#83** [DOCS] Create API endpoint reference document
- [ ] **#82** [DOCS] Create `.env.example` for the middleware
- [ ] **#79** [TEST] E2E test for the reservation/booking flow
- [ ] **#77** [TEST] Route-level integration tests for `checkout.js` edge cases
- [ ] **reservation-tests** [TEST] Write regression tests for `renderReservationItems()` per-kit breakdown rendering _(no tests currently cover this function — added this session)_

## Open — Low Priority

- [ ] **#105** [TECH-DEBT] Incrementally modularize `admin.js`, `brewpad.js`, `batch.js`, `kiosk.js` (Phase 4)
- [ ] **#62** [LOW] Sentry release version hardcoded — doesn't track deployments
- [ ] **#61** [LOW] `admin.js` heavy `innerHTML` usage with API-sourced data
- [ ] **#60** [LOW] `kiosk.html`, `batch.html`, `brewpad.html` missing Content-Security-Policy
- [ ] **#59** [LOW] `product-requests` silently swallows Redis failures
- [ ] **#86** [TEST] Extract and test `kiosk.js` pure functions
- [ ] **#85** [DOCS] Add architecture diagram
- [ ] **#80** [TEST] Add Firefox/WebKit to Playwright browser matrix
- [ ] **#78** [TEST] Reconcile coverage thresholds — jest configs vs. TESTING.md
- [ ] **#87** [TEST] E2E tests for mobile viewports

## Completed

<!-- Move items here when done. Include date and PR/commit if relevant. -->

- [x] **reservation-qty-width** Compact qty selector boxes on all 3 reservation views (2026-03-18) — fixed at 150px; border-box math, weight item clipping, column/header alignment all resolved
- [x] **reservation-header-align** Column header alignment overhaul: QTY centered, STATUS centered, Price padding, Subtotal desktop rule, empty-column th consistency (2026-03-18)
- [x] **reservation-kit-breakdown** Per-kit inline price breakdown (Kit supplies → Maker's Fee → Kit Total) below each kit row; removed aggregate section-footer breakdown (2026-03-18)
- [x] **#95** Extract shared price calculation module (`zoho-middleware/lib/pricing.js`, 36 tests)
- [x] **#92** Extract shared utility functions into `js/lib/utils.js`
- [x] **#98** Centralize hardcoded magic strings into `js/lib/constants.js` + `zoho-middleware/lib/constants.js`
- [x] **#97** Convert middleware `.then()` chains to async/await
- [x] **#100** Document Sheets ↔ Zoho data model (`docs/DATA-MODEL.md`)
- [x] **#94** Create SECURITY.md
- [x] **#104** Write OpenAPI spec for all middleware routes (`zoho-middleware/openapi.yaml`)
- [x] **#103** Implement event logging (`zoho-middleware/lib/eventLog.js`)
- [x] **#102** Consolidate OAuth flows into `js/lib/auth.js`
- [x] **#101** Split checkout.js into 12a/12b/12c sub-modules _(frontend modules done; middleware checkout.js still open)_
- [x] **#90** Add Redis startup health check (`zoho-middleware/lib/checkRedis.js`)
- [x] **#89** Add startup env var validation (`zoho-middleware/lib/validateEnv.js`)
- [x] **#91** Add error state + retry button for failed catalog loads
- [x] **#93** ESLint + CI pipeline (`.github/workflows/tests.yml`)
