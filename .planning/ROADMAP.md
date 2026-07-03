# Roadmap: Steins & Vines

## Milestones

- ✅ **v1.0 Kiosk Production Readiness** — Phases 1-4 (shipped 2026-04-28)
- ✅ **v1.1 Brewpad Reliability & Integration** — Phases 5-11 (shipped 2026-05-06)
- ✅ **v2.0 Recipe-Based Products** — Phases 12-19 (shipped 2026-05-27)
- ✅ **v3.0 Catalog Subpages** — Phases 20-24 (shipped 2026-06-03)
- ✅ **v4.0 Booking Migration (Cal.com) + Edge Protection** — Phases 25-26 (completed 2026-06-06)
- ✅ **v4.1 BrewPad Batch Lifecycle & Zoho Sync** — Phases 27-30 (shipped 2026-06-17)
- ✅ **v4.2 Payment Path Hardening & Deploy Safety** — Phases 31-33 (shipped 2026-06-19)
- 🚧 **v4.3 Recipe Builder Refinement** — Phases 34-37 (in progress)
- 🚧 **v4.4 Audit Remediation** — Phases 38-42 (in progress)
- 🚧 **v4.5 Security & Money-Path Closeout** — Phases 46-53 (in progress)

## Phases

<details>
<summary>✅ v1.0 Kiosk Production Readiness (Phases 1-4) — SHIPPED 2026-04-28</summary>

- [x] Phase 1: Catalog & Stock Display (3/3 plans)
- [x] Phase 2: Sales Order Integrity (2/2 plans)
- [x] Phase 3: Resilience & Session Stability (1/1 plans)
- [x] Phase 4: Sales Order Management (2/2 plans)

</details>

<details>
<summary>✅ v1.1 Brewpad Reliability & Integration (Phases 5-11) — SHIPPED 2026-05-06</summary>

- [x] Phase 5: Auth Reliability (2/2 plans)
- [x] Phase 6: Kiosk-to-Brewpad Integration (3/3 plans)
- [x] Phase 7: Zoho Audit Trail (3/3 plans)
- [x] Phase 8: First-Batch Promo (6/6 plans)
- [x] Phase 9: Content & SEO Push (3/3 plans)
- [x] Phase 10: Checkout Payment Safety (4/4 plans)
- [x] Phase 11: Producer & Brand Visibility (3/3 plans)

</details>

<details>
<summary>✅ v2.0 Recipe-Based Products (Phases 12-19) — SHIPPED 2026-05-27</summary>

- [x] Phase 12: Recipe Data Foundation (2/2 plans) — completed 2026-05-16
- [x] Phase 13: Middleware API + Admin Recipe Management (4/4 plans) — completed 2026-05-17
- [x] Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation (5/5 plans) — completed 2026-05-17
- [x] Phase 15: BeerXML Import (2/2 plans) — completed 2026-05-17
- [x] Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration (3/3 plans) — completed 2026-05-18
- [x] Phase 17: Custom Labels Page (3/3 plans) — completed 2026-05-18
- [x] Phase 18: Custom Labels Iteration (3/3 plans) — completed 2026-05-19
- [x] Phase 19: Hop Inventory Catalog (3/3 plans) — completed 2026-05-19

</details>

### ✅ v3.0 Catalog Subpages (Shipped 2026-06-03)

**Milestone Goal:** Break the monolithic ingredients page into dedicated category subpages with shared template, cross-category navigation, and unified search.

- [x] **Phase 20: Zoho Data Foundation** - Tag all ingredient items with subcategory; refresh snapshot pipeline
- [x] **Phase 21: Shared Template & Build Infrastructure** - Shared JS module, CSS, and build pipeline for all subpages (completed 2026-05-29)
- [x] **Phase 22: Category Subpages & Navigation** - All 5 subpages live with sub-nav and main nav dropdown (completed 2026-05-29)
- [x] **Phase 23: Cross-Category Search** - Search overlay with grouped results and deep-link navigation (completed 2026-05-30)
- [x] **Phase 24: SEO & Staging Deploy** - Per-subpage SEO meta, QA pass, and staging deployment (completed 2026-06-03)

### ✅ v4.1 BrewPad Batch Lifecycle & Zoho Sync (Shipped 2026-06-17)

**Milestone Goal:** Staff can activate pending batches from the admin batch list and pull customer info back from Zoho onto BrewPad — closing the two open gaps in the batch workflow.

- [x] **Phase 27: Pending Batch Visibility & Activation** - Surface pending batches in the admin list/filter and add one-click + guided activation (BATCH-01..03) (3 plans executed 2026-06-07; gap-closure plan 27-04 created to close CR-01 blocker + WR-01 warning) (completed 2026-06-08)
- [x] **Phase 28: Zoho Customer Read-Back Path** - New middleware endpoint to fetch customer details by SO/invoice number, plus Apps Script write-back of refreshed fields (ZSYNC foundation) (completed 2026-06-12)
- [x] **Phase 29: Refresh-from-Zoho Admin UI** - "Refresh from Zoho" button in the batch detail modal that updates customer name/email/contact, gated on `zoho_so_number` (ZSYNC-01..02) (completed 2026-06-12)

### ✅ v4.2 Payment Path Hardening & Deploy Safety (Shipped 2026-06-19)

**Milestone Goal:** Make the money path trustworthy — test the online checkout, close the fail-open security gaps, and stop unsafe/untested code from reaching production. **Audit: 14/14 requirements, 18/18 integration seams, 4/4 flows (DEPLOY-03 cross-phase blocker fixed 2026-06-19). See `milestones/v4.2-MILESTONE-AUDIT.md`.**

- [x] **Phase 31: Money-Path Test Coverage** - Route-level checkout tests, Helcim HMAC tests, honest coverage config (TEST-01..03) (completed 2026-06-17)
- [x] **Phase 32: Fail-Closed Hardening & Access Control** - reCAPTCHA/webhook fail-closed, replay-guard 409, validateEnv update, PII route API-key enforcement, body-shape validation (HARDEN-01..04, PII-01..02) (completed 2026-06-18)
- [x] **Phase 33: Deploy Safety & Monitoring** - Test-gated CI deploys, prod deploy tagging + rollback runbook, snapshot fix, uptime monitoring, secrets verification (DEPLOY-01..03, MONITOR-01..02) (completed 2026-06-18)

### 🚧 v4.3 Recipe Builder Refinement (In Progress)

**Milestone Goal:** Make recipes scalable and adjustable at the point of selection across admin, kiosk, and BrewPad — and make the recipe builder/manager available in BrewPad — without weakening the server-authoritative money path hardened in v4.2.

- [x] **Phase 34: Ingredient Display & Server Enrichment** - Enrich recipe ingredient data server-side with `cf_type`; group ingredients by type in admin, kiosk, and BrewPad views (RDISP-01, RDISP-02, RDISP-03) (completed 2026-06-20)
- [x] **Phase 35: Batch Scaling Engine** - Staff can enter a target batch volume; the system scales ingredient quantities (linear for weight, round-up for pcs), prices scaled recipes server-authoritatively, and captures scaled quantities in the Zoho invoice and frozen `recipe_snapshot` (SCALE-01, SCALE-02, SCALE-03, SCALE-04, SCALE-05) (completed 2026-06-21)
- [x] **Phase 36: Cross-Surface Selection & Recipe Modification** - Batch size control available on all recipe-selection surfaces; staff can add/remove/substitute ingredients for a one-off sale without touching the saved recipe, with optional save-as-new (SEL-01, SEL-02, MOD-01, MOD-02, MOD-03) (completed 2026-06-24)
- [x] **Phase 37: BrewPad Recipe Manager** - Staff can browse, view, create, and edit recipes from within BrewPad, reusing existing recipe CRUD endpoints and activation guardrails (BPR-01, BPR-02) (completed 2026-06-20)

### 🚧 v4.4 Audit Remediation (In Progress)

**Milestone Goal:** Close out the remaining open/partial HIGH-priority items from `PROJECT_ASSESSMENT.md` — gitignore/strip `.planning/`, fix the nightly snapshot publish, optimize facility imagery, fix the duplicate-cart bug, and de-fork the kiosk POS — risk-ordered (low-risk infra first, money-path refactor last) without weakening the v4.2-hardened money path. Continues phase numbering from Phase 38.

- [~] **Phase 38: Repo Hygiene & Deploy-Strip Confirmation** — DEFERRED 2026-06-26 (owner). Investigation: prod already strips `.planning` (safe); staging exposes it (legacy deploy-from-branch); gitignoring would break GSD's git-tracked state (D-01). Low severity (staging noindex; `PROJECT_ASSESSMENT.md` already gitignored → 404). Content-safe fix (switch staging to workflow-based Pages w/ strip) deferred by owner. (HYGIENE-01)
- [x] **Phase 39: Nightly Snapshot Publishes to Prod Fallback** — DONE 2026-06-26 (`303a060`): dropped `[skip ci]` from the PROD snapshot commit so `deploy-production.yml` republishes Pages (was stale); staging keeps it (legacy deploy-from-branch serves directly); prod commit already builds on prod main (FF, CNAME-safe). Verify on next nightly run / manual dispatch. (DEPLOY-04)
- [x] **Phase 40: Facility Image Optimization (webp + srcset)** — DONE 2026-06-26 (`17f9995`): extended optimize-images.js to facility photos; 4 referenced images → webp 800w/1600w + 1600w jpg fallback via `<picture>`; originals removed. Homepage interior 5.7MB→87KB. (ASSET-01)
- [x] **Phase 41: SKU-Keyed Cart Identity** — DONE 2026-06-26 (`b2fdac1`): centralized `getProductKey()` (SKU primary, name|brand fallback) across 11-cart, 06/07/08/15/16/17 + 12-checkout comparisons; same product from catalog + search overlay now merges to one line; +4 regression tests; 928 FE tests green. (CART-01)
- [ ] **Phase 42: Kiosk POS De-Fork (kiosk-core.js)** - shared `js/kiosk-core.js`, behaviour-preserving, parity-tested, discount on both surfaces (KIOSK-01) → rehomed to v4.5 Phase 48 (KIOSK-01)

### 🚧 v4.5 Security & Money-Path Closeout (In Progress)

**Milestone Goal:** Close the deferred CRITICAL and the verified High/Medium security + money-path defects from the 2026-07-02 whole-repo audit (`.planning/reports/AUDIT.md`) — and cure the root cause (the kiosk is a second-class re-implementation of the online-checkout money path) via the KIOSK-01 de-fork plus full synchronous adoption of `lib/money-path.js` primitives across `pos.js`/`pos-recipe.js` — without weakening the gold-standard online checkout. Additive setup: continues phase numbering from Phase 46; nothing archived or renumbered ≤ 46.

- [~] **Phase 46: Auth Re-Architecture** — carried over as v4.5 SEC-02 (existing phase, not re-planned); code-complete + verified, owner production cutover (46-10) pending
- [ ] **Phase 47: Purge Publicly-Served Internal Docs** - untrack `.planning/`/audit docs from staging+prod, reconcile `.nojekyll` vs `_config.yml` exclude (SEC-01)
- [ ] **Phase 48: Kiosk POS De-Fork (kiosk-core.js)** - shared `js/kiosk-core.js`, behaviour-preserving, parity-tested, discount on both surfaces (KIOSK-01) — rehomed from v4.4 Phase 42
- [ ] **Phase 49: Online Captured-Amount Verification** - assert captured card amount ≥ recorded/invoiced total before booking; void + reject on mismatch (MONEY-01)
- [ ] **Phase 50: Kiosk Money-Path Defect Closeout** - reconcile TTL/lock-release/void-status/salesorder-pay/sweep fixes, `pos-recipe.js` adopts money-path primitives (MONEY-02)
- [ ] **Phase 51: Gift-Card Ledger Integrity** - idempotent reload, durable needs_manual_review, cell sanitizer, header-mapped issueGiftCard, tax parity (MONEY-03)
- [x] **Phase 52: Fail-Closed Sweep** - shared closed-on-Redis-error helper across remaining money/security call-sites (RESIL-01) (completed 2026-07-03)
- [x] **Phase 53: Money-Path Observability & CI Gates** - Sentry on every money-path catch, `npm ci` + Node pin, `--max-warnings 0` + ES5 lint rule, pos.js coverage floor (OBS-01) (completed 2026-07-03)

## Phase Details

### Phase 20: Zoho Data Foundation

**Goal**: All ingredient items carry accurate subcategory data so the frontend can filter correctly
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: DATA-01, DATA-02
**Success Criteria** (what must be TRUE):

  1. Every ingredient item in Zoho Inventory has its Subcategory custom field set to one of: Grain, Yeast, Additive, Packaging, Equipment, Hops, or uncategorized
  2. The nightly snapshot JSON file includes the subcategory field for each ingredient item
  3. Client-side filtering by subcategory value returns the correct items on a local test page

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 20-01-PLAN.md — Create bulk tagging script and coverage verification script

**Wave 2**

- [x] 20-02-PLAN.md — Execute tagging workflow and verify 100% coverage

### Phase 21: Shared Template & Build Infrastructure

**Goal**: A single reusable JS module and CSS file can render any category subpage from a per-page config object, and the build pipeline handles all new files
**Depends on**: Phase 20
**Requirements**: TPL-01, TPL-02, TPL-03, TPL-04, BUILD-01
**Success Criteria** (what must be TRUE):

  1. A test HTML page using `16-catalog-subpage.js` with a minimal config renders a product grid from the ingredients API filtered to a single subcategory
  2. Users can switch between grid and list view on the test page
  3. Out-of-stock items display a visible indicator; a category with no items displays a friendly empty-state message
  4. Each subpage's hero section displays the category name with a distinct accent color
  5. `npm run build` completes without errors and produces stamped, minified output for all new CSS and JS files

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 21-01-PLAN.md — Create 16-catalog-subpage.js standalone module and catalog-subpage.css stylesheet

**Wave 2**

- [x] 21-02-PLAN.md — Test HTML page, unit tests, and build pipeline integration

### Phase 22: Category Subpages & Navigation

**Goal**: Customers can navigate directly to any ingredient category subpage from anywhere on the site, and all 5 category pages are live
**Depends on**: Phase 21
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, NAV-01, NAV-02, NAV-03
**Success Criteria** (what must be TRUE):

  1. Each of the 5 subpages (Grains, Yeast, Additives, Packaging, Equipment) loads and shows only its category's items with correct cart controls
  2. A horizontal sub-nav bar appears on every ingredient page showing: All | Hops | Grains | Yeast | Additives | Packaging | Equipment — and the current page's tab is visually highlighted
  3. The main site Products dropdown includes direct links to each ingredient category subpage
  4. Weight-based products on the Grains page offer quantity entry in kg/g as appropriate

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 22-01-PLAN.md — Sub-nav CSS styles, dropdown divider style, and build pipeline stamp:pages update

**Wave 2** (parallel)

- [x] 22-02-PLAN.md — Create 5 new category subpages, move hops.html, rebuild ingredients-supplies.html
- [x] 22-03-PLAN.md — Update nav dropdown in 9 existing pages and verify navigation end-to-end

### Phase 23: Cross-Category Search

**Goal**: Customers can search across all ingredient categories from a single entry point and jump directly to any matching item
**Depends on**: Phase 22
**Requirements**: SRCH-01, SRCH-02
**Success Criteria** (what must be TRUE):

  1. Triggering the search icon in the sub-nav opens an overlay with a text input; typing at least 2 characters shows results grouped by category
  2. Clicking a search result navigates to that item's category subpage with the item's detail panel already expanded

**Plans**: 2 plans
**UI hint**: yes
Plans:
**Wave 1**

- [x] 23-01-PLAN.md — Create search overlay module, CSS, and fix data-sku gap

**Wave 2**

- [x] 23-02-PLAN.md — Wire overlay into 7 HTML pages, build pipeline, and unit tests

### Phase 24: SEO & Staging Deploy

**Goal**: Each subpage is discoverable by search engines and the full feature set is verified on staging
**Depends on**: Phase 23
**Requirements**: BUILD-02
**Success Criteria** (what must be TRUE):

  1. Each subpage has a unique title tag, meta description, og:title, og:description, canonical URL, and LocalBusiness JSON-LD
  2. sitemap.xml includes entries for all 5 new subpages
  3. All 5 subpages load correctly on staging.steinsandvines.ca with no console errors

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 24-01-PLAN.md — Add full SEO head (unique title, description, og:*, twitter:card, LocalBusiness JSON-LD) to all 5 category subpages

**Wave 2**

- [x] 24-02-PLAN.md — Build, stamp, push to staging, and QA-verify all 5 subpages load clean on staging.steinsandvines.ca

### Phase 25: Cal.com Booking Migration

**Goal**: Appointment booking runs on Cal.com Cloud (free tier) behind the unchanged `/api/bookings*` middleware contract, supporting multiple appointment types, with customer/staff confirmation emails delivered by Cal.com over HTTPS
**Depends on**: (new milestone v4.0 — no prior phase dependency)
**Requirements**: BOOK-01, BOOK-02, BOOK-03, BOOK-04, BOOK-05
**Success Criteria** (what must be TRUE):

  1. `GET /api/bookings/services`, `GET /api/bookings/availability`, `GET /api/bookings/slots`, and `POST /api/bookings` return the same response shapes as today, now backed by Cal.com (frontend unchanged)
  2. A completed ferment-in-store checkout creates a real Cal.com booking and the customer receives a Cal.com confirmation email (verified end-to-end on staging)
  3. At least one additional appointment type beyond ferment-in-store is bookable through Cal.com
  4. Zoho Bookings code paths (`bookingsGet`/`bookingsPost`, `ZOHO_BOOKINGS_*` env) are removed or disabled with no dead references; offline-fallback behavior preserved
  5. Middleware test suite covers the new Cal.com adapter (request/response mapping, error + offline-fallback paths) and passes; lint clean

**Plans**: 4 plans (3 waves)

- [x] 25-01-PLAN.md — Free-tier risk gate + Cal.com adapter (lib/calcom.js) + env registration
- [x] 25-02-PLAN.md — Rewrite /api/bookings* handlers onto Cal.com, preserving the contract
- [x] 25-03-PLAN.md — POST /api/webhooks/calcom (signature-verified, cache invalidation)
- [x] 25-04-PLAN.md — Staging booking+email verification, additional event type, Zoho removal

### Phase 27: Pending Batch Visibility & Activation

**Goal**: Staff can see and act on pending batches directly from the admin batch list, promoting them to Primary either instantly or through a guided setup
**Depends on**: Nothing new (builds on existing v1.1 batch tracking; backend `updateBatch` already supports the pending→primary transition and stamps `fermentation_started_at`)
**Requirements**: BATCH-01, BATCH-02, BATCH-03
**Success Criteria** (what must be TRUE):

  1. Pending batches appear in the admin batch list (no longer hidden), and the status filter/dropdown includes a "Pending" option that shows only pending batches
  2. A pending batch row/detail shows an "Activate" action that, in one click, flips the batch to Primary with the fermentation start date set to today
  3. A "Schedule & activate" option lets staff pick a fermentation schedule template, start date, and vessel/location, then promotes the batch to Primary in a single confirmed step
  4. After either activation path, the batch immediately reflects Primary status and the chosen start date in the list and detail views without a manual page reload

**Plans**: 4 plans (3 executed + 1 gap closure)
Plans:
**Wave 1**

- [x] 27-01-PLAN.md — Surface pending batches: widen active filter, Pending dropdown option, distinct badge, pin-to-top (BATCH-01)

**Wave 2**

- [x] 27-02-PLAN.md — One-click Activate (inline + detail modal) with no-schedule confirm, flip to Primary start=today, live refresh (BATCH-02)

**Wave 3**

- [x] 27-03-PLAN.md — Guided Schedule & Activate modal + backend chosen-start-date fix; single-step promote with generated tasks (BATCH-03)

**Gap Closure**

- [x] 27-04-PLAN.md — Close WR-01 (one-click activate start_date=today) + CR-01 (guided step1Done partial-failure routing); rebuild min + tests (BATCH-02, BATCH-03)

**UI hint**: yes

### Phase 27.1: Pending batch deletion — delete pending batches from BrewPad with a confirmation step, removing the row via Apps Script instead of manual Google Sheet edits (INSERTED)

**Goal:** Staff can delete pending (duplicate) batches inline from the admin Batches list and the BrewPad "Needs Scheduling" dashboard rows, each behind a confirmation that names the batch (ID + product + customer), removing the row via the existing Apps Script `delete_batch` action instead of editing the Google Sheet by hand. Frontend-only (backend `deleteBatch()` unchanged); UI-gated to pending rows.
**Requirements**: none (driven by CONTEXT decisions D-01..D-12)
**Depends on:** Phase 27
**Plans:** 2/2 plans complete

Plans:

- [x] 27.1-01-PLAN.md — Inline Delete on admin Batches pending rows (showConfirm + delete_batch + list/dashboard refresh)
- [x] 27.1-02-PLAN.md — Inline Delete on BrewPad "Needs Scheduling" rows (showConfirmSheet danger + delete_batch + dashboard refresh; batch-list cards stay delete-free)

**Cross-cutting constraints:**

- D-08: The confirm copy warns generically that any attached tasks/readings/history will be removed
- D-10: The confirm copy frames deletion as irreversible ("This cannot be undone.") with no nightly-backup/recovery mention
- D-06: Backend deleteBatch() stays unchanged — delete_batch is called with only { batch_id }, no status guard or force flag

### Phase 28: Zoho Customer Read-Back Path

**Goal**: BrewPad can read customer details back from Zoho for a linked sales order/invoice and persist the refreshed fields onto the batch record — the net-new read path behind the refresh feature (today Zoho sync is write-only)
**Depends on**: Nothing new (extends existing `zoho-middleware` Zoho integration and `adminApi.gs`)
**Requirements**: (foundation for ZSYNC-01, ZSYNC-02 — no requirement closes here on its own)
**Success Criteria** (what must be TRUE):

  1. A new middleware endpoint, given a Zoho sales-order/invoice number, returns the linked customer's name, email, and contact details (and a clear not-found/no-link response when the SO cannot be resolved)
  2. The endpoint is covered by middleware unit tests for the success, not-found, and Zoho-error paths and passes with lint clean
  3. Apps Script (`adminApi.gs`) exposes an update path that writes refreshed customer name/email/contact back onto an existing batch record by batch ID, leaving other batch fields untouched
  4. Calling the read endpoint and then the Apps Script update for a known linked batch results in the batch record showing the current Zoho customer details (verified on staging)

**Plans**: 2 plans (2 waves)
Plans:
**Wave 1**

- [x] 28-01-PLAN.md — Middleware GET /api/batch/customer-by-number (invoice/SO → customer name/email/phone) + Jest tests (success, not-found, Zoho-error, partial, validation, auth) + lint clean

**Wave 2**

- [x] 28-02-PLAN.md — Extend adminApi.gs updateBatch allowedFields with customer_email/customer_phone; deploy Apps Script; manual staging read–write loop verification

### Phase 29: Refresh-from-Zoho Admin UI

**Goal**: Staff can refresh a batch's customer info from its linked Zoho sales order/invoice with one click in the batch detail modal, with the action clearly disabled when no link exists
**Depends on**: Phase 28 (requires the middleware read-back endpoint and Apps Script write-back)
**Requirements**: ZSYNC-01, ZSYNC-02
**Success Criteria** (what must be TRUE):

  1. The batch detail modal shows a "Refresh from Zoho" button for batches that carry a `zoho_so_number`
  2. Clicking the button pulls the latest customer name, email, and contact from the linked Zoho SO/invoice and updates the batch's displayed customer info without a full page reload
  3. For a batch with no `zoho_so_number`, the refresh action is clearly unavailable (hidden or disabled with an explanatory state) and never triggers an erroring request
  4. The full feature is verified working on staging.steinsandvines.ca with no console errors on iPad Safari

**Plans**: 6 plans (3 original + 3 gap-closure)

Plans:
**Wave 1**

- [x] 29-01-PLAN.md — BrewPad detail pane: Refresh-from-Zoho button, Email/Phone rows, refresh handler
- [x] 29-02-PLAN.md — Admin Batches modal: Zoho Ref row + Refresh button, Email/Phone rows, refresh handler

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 29-03-PLAN.md — Build, full test+lint gate, staging iPad Safari UAT, REQUIREMENTS traceability

**Gap closure** *(verification found 2 Critical + 3 Warning defects — gaps_found)*

- [x] 29-04-PLAN.md — CR-01: align case contract (middleware case-normalization + frontend 400 handling + tests)
- [x] 29-05-PLAN.md — CR-02/WR-01/WR-03/WR-04: visible name refresh (firstname/lastname split), conflict detection, entity rendering, trim parity
- [x] 29-06-PLAN.md — Rebuild artifacts, full frontend+middleware+lint gate, staging iPad Safari re-verify

**Cross-cutting constraints:**

- D-10, D-11: Refresh outcomes surface as distinct toasts per endpoint state (success / no-change / partial / not-found / zoho-error); voided or deleted documents warn but still apply

**UI hint**: yes

## Phase Details (v4.2)

### Phase 31: Money-Path Test Coverage

**Goal**: The online checkout and Helcim integration are covered by honest, executable tests — so behavior-changing hardening in Phase 32 lands on a safety net, not on faith
**Depends on**: Nothing (first phase of v4.2; builds on existing test infrastructure)
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):

  1. Running `cd zoho-middleware && npm test` executes route-level tests for `POST /api/checkout` covering: a successful charge→Zoho-order path, void recovery when Zoho fails after charge, void-failure alert emission, and dual-cart shared-charge reversal
  2. The Helcim client and HMAC webhook verification have passing tests covering: valid signature accepted, tampered-body rejected, missing-secret behavior (fails closed, not open), and base64 key decoding correctness
  3. Running `cd zoho-middleware && npm run test:coverage` reports coverage numbers that include `routes/**` files (no route file silently excluded from the report)
  4. Stale exclusions in `jest.config.js` (e.g. `!lib/mailer.js` where mailer is no longer untested) are removed so the coverage number is honest

**Plans**: 4 plans (3 waves)
Plans:
**Wave 1**

- [x] 31-01-PLAN.md — server.js export refactor (importable app, guarded listen) + supertest dev dep + jest.config routes coverage glob (TEST-03 foundation)

**Wave 2** (parallel)

- [x] 31-02-PLAN.md — supertest route tests for POST /api/checkout: success→Zoho order, void recovery, void-failure alert, dual-cart reversal + HARDEN-01/03 test.todo (TEST-01)
- [x] 31-03-PLAN.md — Helcim HMAC tests: verifyWebhookSignature unit (valid/tampered/missing-secret/base64) + POST /api/webhooks/terminal route tests + HARDEN-02 test.todo (TEST-02)

**Wave 3**

- [x] 31-04-PLAN.md — Measure honest coverage; set global threshold below actual + per-file money-path floors (checkout/payments/webhooks/helcim) (TEST-03)

### Phase 32: Fail-Closed Hardening & Access Control

**Goal**: Every security gap on the money path that currently fails open now fails closed — unauthenticated checkout attempts, unsigned webhook events, duplicate charges when Redis is down, and PII exposure via unauthenticated GET routes are all rejected
**Depends on**: Phase 31 (tests must cover the behaviors being changed)
**Requirements**: HARDEN-01, HARDEN-02, HARDEN-03, HARDEN-04, PII-01, PII-02
**Success Criteria** (what must be TRUE):

  1. Sending `POST /api/checkout` in production without a valid reCAPTCHA token (or with `RECAPTCHA_SECRET_KEY` unset) returns a 4xx rejection — the request never reaches the charge step
  2. Sending a Helcim or Cal.com webhook event when the corresponding signing secret env var is absent in production returns 400/403 — no event is accepted or processed
  3. A second `POST /api/checkout` with the same `transactionId` when Redis is unavailable returns 409 — no duplicate Zoho order is created
  4. `GET /api/contacts`, `GET /api/invoices`, `GET /api/items/inspect`, and `GET /api/snapshot` require the `MW_API_KEY` header — a request without it returns 401/403 regardless of Referer
  5. `POST /api/items`, `PUT /api/items`, `POST /api/taxes/apply`, and `POST /api/upload-catalog` reject requests with missing or malformed required body fields before forwarding anything to Zoho

**Plans**: 4 plans (1 wave — all parallel, disjoint files)
Plans:
**Wave 1** (parallel)

- [x] 32-01-PLAN.md — reCAPTCHA fail-closed + transactionId replay-guard 409 (HARDEN-01, HARDEN-03)
- [x] 32-02-PLAN.md — Helcim + Cal.com webhook verifiers fail closed in prod (HARDEN-02)
- [x] 32-03-PLAN.md — validateEnv prod-secret boot check + NODE_ENV/RAILWAY assertion + drop GP_* (HARDEN-04)
- [x] 32-04-PLAN.md — Targeted PII GET-route API-key guard + body-shape whitelist on mutating item/tax routes (PII-01, PII-02)

### Phase 33: Deploy Safety & Monitoring

**Goal**: Production deploys are gated on passing tests, every deploy is traceable and reversible, the nightly snapshot reaches the live site, and critical failures (downtime, missing secrets, service degradation) are caught automatically
**Depends on**: Phase 31 (CI gate needs a test suite to gate on; Phase 32 optional but recommended before finalizing runbook)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, MONITOR-01, MONITOR-02
**Success Criteria** (what must be TRUE):

  1. A push to the production remote that would cause frontend or middleware tests to fail is blocked by CI before the deploy completes — the broken code never reaches the live site
  2. Every production deploy has a corresponding git tag (`prod-YYYYMMDD-N`) and a written runbook entry pairing the git SHA with the Railway deploy ID, so a rollback can be initiated from either end within minutes
  3. The nightly Zoho snapshot job produces an updated `zoho-snapshot.json` that is committed and visible at `steinsandvines.ca/content/zoho-snapshot.json` — the `[skip ci]` / force-push interaction no longer leaves the file stale
  4. An external uptime check polls `GET /health` at least every 5 minutes and sends an alert if the endpoint returns non-200, `authenticated:false`, or `redis:false`
  5. `HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, and `SENTRY_DSN` are confirmed present in Railway production, and `validateEnv.js` startup check covers the live Helcim/Cal.com/`REDIS_ENCRYPTION_KEY` variables while dead Global Payments vars are removed

**Plans**: 3 plans (2 waves)
Plans:
**Wave 1** (parallel — disjoint files)

- [x] 33-01-PLAN.md — DEPLOY-03 snapshot fix (update-snapshot.yml repo guard + cross-repo push) + MONITOR-02 code (SENTRY_DSN/HELCIM_API_TOKEN -> REQUIRED_IN_PROD + regression test)
- [x] 33-02-PLAN.md — DEPLOY-01/02 gated-deploy.yml (workflow_dispatch test gate, CNAME swap, force-push, /health smoke-check, prod-YYYYMMDD-N tag, runbook append) + docs/RUNBOOK.md

**Wave 2** (human action — depends on 33-01, 33-02)

- [x] 33-03-PLAN.md — MONITOR-01 UptimeRobot /health keyword monitor + deploy secrets (PROD_DEPLOY_TOKEN, RAILWAY_TOKEN) + Railway "Wait for CI" + first gated deploy verification + close Phase 32 secrets UAT (MONITOR-02)

## Phase Details (v4.3)

### Phase 34: Ingredient Display & Server Enrichment

**Goal**: Recipe ingredient data is enriched with `cf_type` in the middleware so every surface (admin, kiosk, BrewPad) receives a consistent type label and can group ingredients identically without per-surface workarounds
**Depends on**: Nothing (first phase of v4.3; reads existing Zoho ingredient data via the catalog cache)
**Requirements**: RDISP-01, RDISP-02, RDISP-03
**Success Criteria** (what must be TRUE):

  1. The middleware endpoint(s) that return recipe ingredients include a `cf_type` field (e.g. Grain, Hops, Yeast, Additive, Packaging) on every ingredient line, derived from the Zoho item data at request time
  2. In the admin recipe detail view, ingredients are displayed in labelled sections by `cf_type` (e.g. a "Grain" section, a "Hops" section) with items within each section in a consistent order
  3. The kiosk recipe ingredient list and the BrewPad recipe ingredient view both show ingredients grouped by `cf_type`, matching the admin grouping (same section labels, same sort order)
  4. Middleware unit tests cover the `cf_type` enrichment logic (field present, fallback for unknown type, order of groups) and the full test suite passes with lint clean

**Plans**: 3 plans (2 waves)
Plans:
**Wave 1** (parallel — disjoint files)

- [x] 34-01-PLAN.md — Promote CATEGORY_DISPLAY_NAMES to js/lib/constants.js + create shared js/lib/recipe-grouping.js helper (D-01..D-07, D-11) + Jest (RDISP-02)
- [x] 34-02-PLAN.md — Server additive enrichment in recipes.js (cf_type/cf_subcategory/display_group, locked+dynamic, cold-cache) + middleware tests (RDISP-02)

**Wave 2**

- [x] 34-03-PLAN.md — Wire grouped rendering into admin/BrewPad/kiosk via shared helper + build + human verify (RDISP-01, RDISP-03)

**UI hint**: yes

### Phase 35: Batch Scaling Engine

**Goal**: Staff can enter a target batch volume in litres at recipe selection time; the system computes the scale factor, adjusts all ingredient quantities (linear for weight, round-up for pcs), prices the scaled recipe server-authoritatively, and captures the scaled quantities and target volume in the Zoho invoice and the frozen `recipe_snapshot`
**Depends on**: Phase 34 (ingredient `cf_type` enrichment is available; unit types needed to distinguish weight vs. pcs for rounding logic)
**Requirements**: SCALE-01, SCALE-02, SCALE-03, SCALE-04, SCALE-05
**Success Criteria** (what must be TRUE):

  1. On a recipe-selection surface (admin), a "Target volume (L)" input is visible after a recipe is chosen; entering a value displays the computed scale factor (e.g. "1.5× base 20 L") before committing
  2. After scaling, a weight-based ingredient (kg/g) shows a linearly scaled quantity (e.g. 5 kg → 7.5 kg at 1.5×) and a pcs ingredient shows a quantity rounded up to the nearest whole unit (e.g. 2.3 pcs → 3 pcs)
  3. `POST /api/kiosk/recipe-sale` (or equivalent) receives the target volume and returns scaled ingredient costs: locked-price recipes scale only the ingredient-cost portion with service/materials fees fixed; dynamic recipes price from scaled ingredient costs — verified by middleware unit tests
  4. The Zoho invoice line items reflect the scaled quantities (not the base recipe quantities), and the `recipe_snapshot` frozen at sale time includes both the `target_volume_l` and the scaled ingredient quantities
  5. Before sale confirmation, a stock-check using the scaled quantities surfaces any ingredient that would be oversold (quantity requested exceeds available stock), and the sale cannot proceed until the conflict is resolved

**Plans**: 4 plans (4 waves)
Plans:
**Wave 0**

- [x] 35-01-PLAN.md — BLOCKING: verify batch_size_l is in the Apps Script get_recipe response (remediate + redeploy if absent) (SCALE-01)

**Wave 1**

- [x] 35-02-PLAN.md — New pure lib/recipe-scaling.js (unit classification, linear/ceil scaling, locked/dynamic repricing, scaled stock check) + recipe-scaling.test.js (SCALE-02, SCALE-03, SCALE-05)

**Wave 2**

- [x] 35-03-PLAN.md — Wire scaling into pos-recipe.js BOTH paths (validation, factor, scaled qty, repricing, stock 409+override, enriched snapshot) + pos-recipe.test.js (SCALE-01, SCALE-03, SCALE-04, SCALE-05)

**Wave 3**

- [x] 35-04-PLAN.md — Admin Kiosk Sale UI: target-volume input + live factor readout + override block (admin.html + admin.js), build, staging UAT flagging the D-06 locked-price increase (SCALE-01, SCALE-05)

### Phase 36: Cross-Surface Selection & Recipe Modification

**Goal**: The batch-size control is available on every recipe-selection surface and persists through the sale/batch flow; staff can also add, remove, or substitute ingredients for a one-off modified sale without altering the saved recipe, with the option to save the modification as a new recipe
**Depends on**: Phase 35 (scaling engine must exist; server pricing for modified ingredient lists extends the same server path)
**Requirements**: SEL-01, SEL-02, MOD-01, MOD-02, MOD-03
**Success Criteria** (what must be TRUE):

  1. The batch-size (target volume) control appears in the admin recipe-sale flow, the kiosk recipe-sale flow, and the BrewPad recipe-attach flow — using the same visual control and validation rules on all three surfaces
  2. A batch size chosen at recipe-selection time is carried through the entire flow — into the cart line items, the Zoho invoice, the `recipe_snapshot`, and the created batch record — without requiring the staff member to re-enter it at any later step
  3. At recipe-selection time, staff can modify the ingredient list (add an item from the ingredient catalog, remove an existing line, or swap one ingredient for another); the saved recipe template is not altered by this action
  4. The modified ingredient list is priced server-authoritatively (same `pos-recipe.js` / `lib/pricing.js` path as a standard sale) and the Zoho invoice and frozen `recipe_snapshot` reflect the actual ingredients sold, not the original template
  5. A staff member can optionally tap "Save as new recipe" after a one-off modification; this creates a new recipe via the existing recipe-create endpoint (`SV-R-…` ID, activation guardrails enforced), leaving the original recipe untouched

**Plans**: 17 plans (14 waves) — 7 original + 5 first-pass gap-closure (36-08..36-12) + 5 second-pass gap-closure (36-13..36-17)
**UI hint**: yes
Plans:
**Wave 1** (parallel — disjoint middleware files)

- [x] 36-01-PLAN.md — Pure computeModifiedRecipeTotal helper (locked-add/remove asymmetry D-07/D-08, dynamic D-09) + worked-example tests (MOD-02)
- [x] 36-02-PLAN.md — SEL-02 carry-through: detectRecipeSale forwards target_volume_l/scale_factor onto the batch payload + Apps Script create_batch redeploy (human-action) (SEL-02)

**Wave 2**

- [x] 36-03-PLAN.md — Wire modified_ingredients into computeRecipeQuote + recipe-quote/recipe-sale/confirm + freeze modified_base_ingredients/is_modified into snapshot (MOD-02)

**Wave 3** (parallel — disjoint surface files)

- [x] 36-04-PLAN.md — Admin: modify panel + server-quote modified price + (Modified) label + save-as-new (MOD-01, MOD-02, MOD-03, SEL-01)
- [x] 36-05-PLAN.md — Kiosk: port Phase 35 control + modify panel (iOS-zoom-safe), no save-as-new (SEL-01, SEL-02, MOD-01, MOD-02)
- [x] 36-06-PLAN.md — BrewPad attach: port control + modify panel + soft stock advisory + scaled+modified snapshot (no charge) + save-as-new (SEL-01, SEL-02, MOD-01, MOD-03)

**Wave 4** (depends on all surfaces)

- [ ] 36-07-PLAN.md — Staging deploy + cross-surface human UAT (locked-remove asymmetry, carry-through, save-as-new) + REQUIREMENTS traceability (SEL-01, SEL-02, MOD-01, MOD-02, MOD-03)

**Gap closure (from 36-HUMAN-UAT.md GAP-1/2/3)**

**Wave 5** (UI-SPEC contract first)

- [x] 36-08-PLAN.md — Extend 36-UI-SPEC.md with the synced ×factor control contract (GAP-3) + polished/reordered modify-panel layout (GAP-2) (SEL-01, MOD-01)

**Wave 6**

- [x] 36-09-PLAN.md — Admin: GAP-1 catalog-load regression test + hook, GAP-3 synced ×factor input, GAP-2 layout polish + edit-at-base pre-population (SEL-01, MOD-01)

**Wave 7**

- [x] 36-10-PLAN.md — Kiosk: port synced ×factor (iOS-zoom-safe) + GAP-2 layout polish, no save-as-new (SEL-01, MOD-01)

**Wave 8**

- [x] 36-11-PLAN.md — BrewPad attach: port synced ×factor (no quote/charge, D-10) + GAP-2 layout polish (SEL-01, MOD-01)

**Wave 9** (re-UAT)

- [x] 36-12-PLAN.md — Staging re-deploy + second human UAT pass confirming GAP-1/2/3 closed across all three surfaces (autonomous: false) (SEL-01, MOD-01)

**Second-pass gap closure (from 36-HUMAN-UAT.md GAP-4/5/6/7 + 36-UI-REVIEW.md)**

**Wave 10** (UI-SPEC contract first)

- [x] 36-13-PLAN.md — Extend 36-UI-SPEC.md: live-price visibility contract (GAP-4, server-authoritative, no _kioskModifyPanelOpen gate), scroll model (GAP-5), and audit polish (GAP-7) (SEL-01, MOD-01, MOD-02)

**Wave 11**

- [x] 36-14-PLAN.md — Admin: GAP-4 ungate quote + prominent server-quote price on every change, GAP-5 scrollable prompt, GAP-6 admin font-size:1rem + bundle/cache verify, GAP-7 polish (SEL-01, MOD-01, MOD-02)

**Wave 12**

- [x] 36-15-PLAN.md — Kiosk: GAP-4 ungate + prominent server-quote price, GAP-5 scrollable prompt, GAP-7 polish + cellar-palette autocomplete + --sp-* tokens, no save-as-new (SEL-01, MOD-01, MOD-02)

**Wave 13**

- [x] 36-16-PLAN.md — BrewPad attach: GAP-5 inject expanded panel into the scrollable detail pane (no quote/charge, D-10), GAP-7 polish (44px Remove, × factor label) (SEL-01, MOD-01)

**Wave 14** (re-UAT)

- [x] 36-17-PLAN.md — Staging re-deploy + third human UAT pass confirming GAP-4/5/6/7 closed + re-confirming still-pending original items #1-#8 (autonomous: false) (SEL-01, SEL-02, MOD-01, MOD-02, MOD-03)

### Phase 37: BrewPad Recipe Manager

**Goal**: Staff can browse, view, create, and edit recipes from within BrewPad — the recipe builder is no longer admin-only — using the existing recipe CRUD endpoints and activation guardrails
**Depends on**: Phase 34 (ingredient grouping is available for consistent display in the BrewPad recipe view; Phases 35/36 not required — BPR is independent of scaling)
**Requirements**: BPR-01, BPR-02
**Success Criteria** (what must be TRUE):

  1. BrewPad has a "Recipes" section (tab or panel) where staff can browse the full recipe catalogue with status indicators (draft / active) and search/filter by name
  2. Selecting a recipe in BrewPad opens a detail view showing all recipe metadata and ingredients grouped by `cf_type` — the same information visible in the admin recipe detail view
  3. Staff can create a new recipe from BrewPad using the same form fields as the admin recipe builder; the recipe is created via the existing `POST /api/recipes` endpoint and appears in the catalogue immediately
  4. Staff can edit an existing recipe from BrewPad; activation guardrails (`locked_price > 0` and at least one ingredient) are enforced before any recipe can be marked active — identical to the admin path

**Plans**: 3 plans (3 waves — all touch js/brewpad.js, so sequential)
Plans:
**Wave 1**

- [x] 37-01-PLAN.md — Recipes tab scaffold + tab wiring + recipe-list browse with status badges + name search (BPR-01)

**Wave 2**

- [x] 37-02-PLAN.md — Recipe detail (grouped ingredients) + editor (field parity, autocomplete, inline activation guardrail, create/edit save) (BPR-01, BPR-02)

**Wave 3**

- [x] 37-03-PLAN.md — Confirm-gated delete + build bundle + full test/lint gate + iPad Safari UAT (BPR-02)

**UI hint**: yes

## Phase Details (v4.4)

### Phase 38: Repo Hygiene & Deploy-Strip Confirmation

**Goal**: Internal planning artifacts are no longer tracked-and-served — `.planning/` is gitignored and absent from the published artifact on both staging and production
**Depends on**: Nothing (first phase of v4.4; lowest-risk, no money path)
**Requirements**: HYGIENE-01
**Success Criteria** (what must be TRUE):

  1. `.planning/` is listed in `.gitignore` and `git ls-files .planning` returns nothing (the directory is untracked via `git rm -r --cached .planning`) — local working copy is preserved
  2. The published GitHub Pages artifact for production does not contain `.planning/` — fetching `steinsandvines.ca/.planning/STATE.md` (or any known planning path) returns 404, not file contents
  3. The published GitHub Pages artifact for staging does not contain `.planning/` — fetching `staging.steinsandvines.ca/.planning/STATE.md` returns 404 (staging is served directly from the repo, so the gitignore/untrack — not a deploy-time strip — is what removes it)
  4. The production deploy's existing `.planning` strip step still runs (defense in depth) and the prod deploy completes green with no regression to CNAME or the live site

**Plans**: TBD

### Phase 39: Nightly Snapshot Publishes to Prod Fallback

**Goal**: The nightly Zoho snapshot actually reaches the live production static fallback and survives the next force-push deploy
**Depends on**: Phase 38 (sequential; both are deploy/infra hygiene, no functional overlap)
**Requirements**: DEPLOY-04
**Success Criteria** (what must be TRUE):

  1. The nightly snapshot commit that updates `zoho-snapshot.json` no longer carries a `[skip ci]` token that suppresses the GitHub Pages publish (or the publish is driven by an explicit `workflow_dispatch`/scheduled deploy trigger that is not skipped)
  2. The snapshot workflow pulls/rebases (or otherwise reconciles) before the production write so a subsequent `git push production main --force` deploy does not erase the freshly published snapshot
  3. After a nightly run (or a manually triggered run), `steinsandvines.ca/content/zoho-snapshot.json` returns a snapshot whose timestamp is from that run — verifiably fresh, not stale
  4. The change preserves the v4.2 CNAME-safe deploy invariant: the prod `main` history and CNAME are intact after the snapshot publish (no 404, no clobbered domain)

**Plans**: TBD

### Phase 40: Facility Image Optimization (webp + srcset)

**Goal**: Facility/about imagery is served as right-sized webp with `srcset` and intrinsic dimensions, removing the multi-MB JPEG payload from the homepage by extending the existing product image pipeline
**Depends on**: Nothing functional (independent of 38/39; sequenced after for risk ordering — build/asset change, no money path)
**Requirements**: ASSET-01
**Success Criteria** (what must be TRUE):

  1. The homepage hero/facility image (`interior.jpg`, currently ~5.7 MB) and the about-page facility/owner photos are emitted as `webp` with a `srcset` of multiple widths, generated by the existing product image pipeline (extended, not a duplicated/parallel script)
  2. On the homepage path, no single facility image transfers more than ~500 KB at the rendered viewport size (verified in the network panel on a standard laptop/iPad viewport)
  3. Each optimized facility/about `<img>` carries intrinsic `width` and `height` attributes (or aspect-ratio) so the image reserves layout space and does not cause cumulative layout shift
  4. A non-webp fallback (`<picture>` source or `jpg` fallback) is present so browsers without webp support still render the image, and `npm run build` regenerates the optimized assets without errors
  5. The homepage and about page render correctly on staging.steinsandvines.ca with the new images and no broken-image or console errors (iPad Safari included)

**Plans**: TBD
**UI hint**: yes

### Phase 41: SKU-Keyed Cart Identity

**Goal**: The same product added from the catalog page and from the search overlay merges into one cart line keyed by SKU — no duplicate lines, correct quantity — across both the ferment and ingredients carts
**Depends on**: Nothing functional (independent; sequenced after the infra/asset work because it touches the public cart, which has frontend tests — riskier than 38-40, lower-risk than 42)
**Requirements**: CART-01
**Success Criteria** (what must be TRUE):

  1. The cart identity key is derived from SKU in both `11-cart.js` and `17-search-overlay.js` (replacing the `name|brand` / `name|` mismatch), with a `name|brand` fallback only when a SKU is genuinely absent
  2. Adding a product from the catalog page and then the same product from the cross-category search overlay produces exactly one cart line whose quantity is the sum of both adds — no duplicate row, correct displayed quantity
  3. The merge-by-SKU behaviour holds independently for the ferment cart and the ingredients cart (a SKU added on each surface routes to and merges within the correct cart per the dual-cart routing)
  4. Existing frontend cart tests pass and new regression tests cover the catalog+overlay same-SKU merge for both carts; `npm test`, `npm run lint`, and `npm run build` are clean
  5. Verified on staging.steinsandvines.ca: adding a product from a category subpage and from the search overlay shows one line with the correct count

**Plans**: TBD
**UI hint**: yes

### Phase 42: Kiosk POS De-Fork (kiosk-core.js)

**Goal**: The kiosk POS logic lives in a single shared `js/kiosk-core.js` consumed by both `kiosk.js` (standalone) and `admin.js` (embedded), so the cart and payment/checkout paths can no longer diverge — a behaviour-preserving refactor that does not weaken the v4.2-hardened money path
**Depends on**: Phase 41 (sequential; both are frontend — keeps the highest-risk money-path refactor last, after the cart-identity work it conceptually relates to has shipped and been verified)
**Requirements**: KIOSK-01
**Success Criteria** (what must be TRUE):

  1. The ~34 duplicated `kiosk*` functions (cart building, `kioskProceedToPayment`, terminal charge, Zoho invoice/payment, void-on-failure, dual-cart) exist in exactly one place, `js/kiosk-core.js`, and both `kiosk.js` and `admin.js` consume that shared module — no second copy of the payment path remains
  2. The money path is unchanged in behaviour: terminal charge → Zoho invoice/payment → void-on-failure → dual-cart shared-charge handling all behave exactly as before, demonstrated by the existing kiosk tests passing without weakening and by a new admin-embedded-vs-standalone parity check that asserts identical request payloads/flow for the same cart
  3. The kiosk product-type discount feature (which currently exists only in `kiosk.js`) is available identically on both the standalone kiosk and the admin-embedded kiosk after the de-fork — resolving the existing drift where `admin.js` lacks it
  4. `npm test`, `npm run lint`, and `npm run build` are clean (concatenated `main.js`/`main.min.js` and `admin.min.js` regenerated), and no behaviour-changing logic was introduced beyond the discount-parity fix
  5. Verified on staging on iPad Safari: a full kiosk sale (including a recipe/product-type discount) completes identically from both the standalone kiosk URL and the admin-embedded kiosk tab, with the terminal/void/dual-cart behaviour intact

**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 8/8 | Complete | 2026-04-28 |
| 5-11 | v1.1 | 24/24 | Complete | 2026-05-06 |
| 12-19 | v2.0 | 26/26 | Complete | 2026-05-27 |
| 20. Zoho Data Foundation | v3.0 | 2/2 | Complete | 2026-05-28 |
| 21. Shared Template & Build Infrastructure | v3.0 | 2/2 | Complete   | 2026-05-29 |
| 22. Category Subpages & Navigation | v3.0 | 3/3 | Complete   | 2026-05-29 |
| 23. Cross-Category Search | v3.0 | 2/2 | Complete    | 2026-05-30 |
| 24. SEO & Staging Deploy | v3.0 | 2/2 | Complete    | 2026-06-03 |
| 25. Cal.com Booking Migration | v4.0 | 4/4 | Complete   | 2026-06-04 |
| 26. Cloudflare Edge Protection | v4.0 | live-exec | Complete | 2026-06-06 |
| 27. Pending Batch Visibility & Activation | v4.1 | 4/4 | Complete    | 2026-06-11 |
| 28. Zoho Customer Read-Back Path | v4.1 | 2/2 | Complete    | 2026-06-12 |
| 29. Refresh-from-Zoho Admin UI | v4.1 | 6/6 | Complete   | 2026-06-14 |
| 31. Money-Path Test Coverage | v4.2 | 4/4 | Complete    | 2026-06-17 |
| 32. Fail-Closed Hardening & Access Control | v4.2 | 4/4 | Complete    | 2026-06-18 |
| 33. Deploy Safety & Monitoring | v4.2 | 3/3 | Complete    | 2026-06-18 |
| 34. Ingredient Display & Server Enrichment | v4.3 | 3/3 | Complete   | 2026-06-20 |
| 35. Batch Scaling Engine | v4.3 | 6/6 | Complete    | 2026-06-21 |
| 36. Cross-Surface Selection & Recipe Modification | v4.3 | 21/17 | Complete   | 2026-06-25 |
| 37. BrewPad Recipe Manager | v4.3 | 3/3 | Complete    | 2026-06-20 |
| 38. Repo Hygiene & Deploy-Strip Confirmation | v4.4 | 0/? | Not started | - |
| 39. Nightly Snapshot Publishes to Prod Fallback | v4.4 | 0/? | Not started | - |
| 40. Facility Image Optimization (webp + srcset) | v4.4 | 0/? | Not started | - |
| 41. SKU-Keyed Cart Identity | v4.4 | 0/? | Not started | - |
| 42. Kiosk POS De-Fork (kiosk-core.js) → rehomed to v4.5 Phase 48 (KIOSK-01) | v4.4 | 0/? | Not started | - |
| 46. Auth Re-Architecture | v4.5 (carryover, SEC-02) | 9/10 | Code-complete, owner cutover pending | - |
| 47. Purge Publicly-Served Internal Docs | v4.5 | 1/1 | ✅ Closed on staging (verified 2026-07-03); prod audit-doc at next prod deploy | 2026-07-03 |
| 48. Kiosk POS De-Fork (kiosk-core.js) | v4.5 | 0/? | Not started | - |
| 49. Online Captured-Amount Verification | v4.5 | 1/2 | 49-01 done (H2 fix + 13-test regression, suite green); 49-02 live-card UAT pending deploy | - |
| 50. Kiosk Money-Path Defect Closeout | v4.5 | 0/? | Not started | - |
| 51. Gift-Card Ledger Integrity | v4.5 | 0/? | Not started | - |
| 52. Fail-Closed Sweep | v4.5 | 5/5 | Complete    | 2026-07-03 |
| 53. Money-Path Observability & CI Gates | v4.5 | 6/6 | Complete   | 2026-07-03 |

### Phase 29.4: Wine drill-down analytics on BrewPad dashboard — wine-specific category breakdown splitting wine batches by a selectable dimension (subcategory, brand, manufacturer, or kit time e.g. 4-week/5-week). Builds on the Phase 29.3 Batches-by-Month type-breakdown chart. New data source in BrewPad: load product catalog (cheapest: static /content/zoho-snapshot.json — carries sku, subcategory, brand, manufacturer, time per wine kit) and join batch.product_sku -> catalog sku to derive the split attribute (batches store only product_sku/product_name today). Dynamic categories (brand/manufacturer are open sets -> top-N + 'Other' grouping with dynamic colors) + a dimension selector. Frontend-only: js/brewpad.js + tests. Depends on Phase 29.3. (INSERTED)

**Goal:** Staff can split wine batches on the BrewPad dashboard by a selectable dimension (subcategory, brand, manufacturer, or kit time) via a new "Wine Breakdown" card that joins batches to the catalog snapshot.
**Requirements**: none (driven by CONTEXT decisions D-01..D-12)
**Depends on:** Phase 29
**Plans:** 2/2 plans complete

Plans:
- [x] 29.4-01-PLAN.md — Pure helper/data layer: buildSkuLookup, normalizeWineTime, bucketWineDimension, applyTopN + Jest suite
- [x] 29.4-02-PLAN.md — Render/interaction layer: Wine Breakdown card, segmented selector, snapshot lazy-fetch, handlers, build

### Phase 29.3: Pull non-kiosk batch sales into BrewPad — bulk-scan recent Zoho invoices for ferment-in-store sales (Makers Fee present) that have no batch yet and create pending batches; dedupe by zoho_so_number, skip already-batched invoices via cf_batch_status, bounded scan window to respect Zoho rate limits. Touches zoho-middleware scan endpoint + per-invoice detail fetch, apps-script adminApi.gs create_batch dedup, js/brewpad.js Pull-from-Zoho control + confirm + list refresh. (INSERTED)

**Goal:** Staff can pull ferment-in-store sales invoiced directly in Zoho Books into BrewPad as pending batches — a confirm-gated "Pull from Zoho" control bulk-scans a bounded window of recent invoices (Maker's Fee present, no batch yet), plus a single-invoice import path, deduped by zoho_so_number in both the middleware pre-check and an Apps Script idempotency guard.
**Requirements**: none mapped (decisions D-01..D-10 in 29.3-CONTEXT.md)
**Depends on:** Phase 29
**Plans:** 3/3 plans complete

Plans:
- [x] 29.3-01-PLAN.md — Middleware scan + bulk-create endpoints (GET /api/batch/scan-invoices, POST /api/batch/bulk-create) with Jest tests [wave 1]
- [x] 29.3-02-PLAN.md — Apps Script createBatch zoho_so_number idempotency guard (D-10) [wave 1]
- [x] 29.3-03-PLAN.md — BrewPad "Pull from Zoho" control + confirm sheet + single-import + list refresh [wave 2]

### Phase 29.2: BrewPad pending batch activation — one-click Activate and guided Schedule & Activate for pending batches in BrewPad (Needs Scheduling rows + batch detail pane), reusing Phase 27 admin backend; make detail status badge pending-aware so pending batches route through activation instead of silently cycling to Primary. Frontend-only: js/brewpad.js + tests. (INSERTED)

**Goal:** Staff can activate a pending batch from BrewPad — one-click Activate or guided Schedule & Activate — from the Needs Scheduling rows and the batch detail pane, and the detail status badge routes pending batches through activation instead of silently promoting them to Primary.
**Requirements**: none mapped
**Depends on:** Phase 29
**Plans:** 5/5 plans complete

Plans:
- [x] 29.2-01-PLAN.md — Test scaffold + todayPacific() helper + status badge pending guard (bug fix, regression test first)
- [x] 29.2-02-PLAN.md — Needs Scheduling rows: Activate + Schedule & Activate buttons and one-click delegation
- [x] 29.2-03-PLAN.md — Guided Schedule & Activate bottom sheet + detail pane pending action buttons
- [x] 29.2-04-PLAN.md — Gap closure: fix detail-pane Activate re-render (CR-01 blocker, renderBatchDetail data wrapper)
- [x] 29.2-05-PLAN.md — Gap closure: emit last_updated in needsScheduling summary to re-enable optimistic lock (CR-02) + Apps Script redeploy

### Phase 29.1: Batch customer reassignment — change the customer tied to a batch (e.g. WALK-IN placeholder) and propagate the change to the linked Zoho sales order/invoice (INSERTED)

**Goal:** Staff can reassign the customer on a batch from the BrewPad detail pane (search existing Zoho customer or add one inline) and push that change to the linked Zoho SO/invoice; the batch is the source of truth and survives a Zoho rejection with a clear warning.
**Requirements**: none mapped (inserted phase)
**Depends on:** Phase 29
**Plans:** 2/2 plans complete

Plans:

- [x] 29.1-01-PLAN.md — Middleware: contact-search + batch-first reassign endpoint (Zoho push optional, no rollback on Zoho failure)
- [x] 29.1-02-PLAN.md — BrewPad UI: Change Customer control with search/add-new, confirm-gated Zoho push, in-place patch + warning toast

### Phase 26: Cloudflare Edge Protection — COMPLETE (2026-06-06)

**Outcome:** Cloudflare free tier is live in front of production (`steinsandvines.ca`) — proxied with SSL Full, Bot Fight Mode + a rate-limit rule active, email auth (SPF/DKIM/DMARC) hardened, staging kept grey-clouded. Executed live without a formal PLAN; see `26-SUMMARY.md` and `DNS-INVENTORY.md`. Follow-up (deferred): protect the Railway API via `api.steinsandvines.ca` if analytics show bots hitting it.

**Goal:** Cloudflare's free tier sits in front of `steinsandvines.ca` (GitHub Pages) and the Railway middleware API, absorbing/filtering the increasing bot traffic — without breaking the existing GitHub Pages custom-domain setup, `enforce-cname.yml`, Helcim payments, or Cal.com/Zoho integrations.

**Motivation:** Increasing bot traffic hitting the site (and likely the middleware). Cloudflare free tier gives CDN caching, Bot Fight Mode, basic WAF, and rate limiting at no cost.

**Depends on:** Phase 25 (sequential; no hard technical dependency)

**Scope (to refine in discuss):**

  - DNS migration: move `steinsandvines.ca` nameservers to Cloudflare; recreate existing records (Pages A records, staging CNAME, Railway/api, MX/email, any TXT/verification)
  - Proxy (orange-cloud) the apex + www through Cloudflare with SSL mode set correctly for GitHub Pages custom domains (Full, not Flexible — avoid redirect loops)
  - Confirm GitHub Pages custom domain + `enforce-cname.yml` still function behind the proxy
  - Bot Fight Mode (or Super Bot Fight Mode if available on free), basic managed WAF, and a rate-limiting rule
  - Decide whether the Railway `api.` subdomain is proxied too, or stays direct (CORS/Referer guard interactions)
  - Caching rules that don't break dynamic middleware calls or cache-busted assets

**Open questions for discuss-phase:**

  - Who controls the domain registrar / current DNS host? (needed to change nameservers)
  - Is the Railway API on a custom subdomain we can proxy, or the raw `*.up.railway.app`?
  - Acceptable risk window for the DNS cutover (propagation), and staging-first strategy for an infra change that GitHub Pages serves directly?

**Requirements**: TBD (derive in discuss-phase)
**Plans:** 9 plans (5 waves). ⚠ Auth re-architecture (the CRITICAL, D-01..D-05) recommended to split to Phase 46 — see note below.

Plans:

- [ ] TBD (run /gsd-discuss-phase 26, then /gsd-plan-phase 26 to break down)

### Phase 30: Assessment quick wins — small high-impact fixes from PROJECT_ASSESSMENT.md

**Goal:** Ship the curated 21 small high-impact fixes from PROJECT_ASSESSMENT.md (user-facing live bugs, security hardening, dead-weight removal, repo hygiene, config/infra, test cleanup) in risk-batched staging-first deploys, with `.planning/` excluded from the public site (kept in git) and CNAME untracked.
**Requirements**: none mapped (driven by QUICK-WINS items #1-21 + CONTEXT decisions D-01..D-04)
**Depends on:** Phase 29
**Plans:** 4/6 plans executed

Plans:
**Wave 1**
- [x] 30-01-PLAN.md — Dead-weight removal: delete unreferenced assets, dead lib, 9 dead content files, self-destruct sw.js + build refs (#10-14)
- [x] 30-02-PLAN.md — Repo hygiene: deploy-layer `.planning/` exclusion kept-in-git (D-01/#15) + untrack CNAME (#16)

**Wave 2**
- [x] 30-03-PLAN.md — User-facing content/CSS/404 fixes: hero subtitle, nested-URL 404, contrast, empty story paragraph (#1,#3,#5,#6)

**Wave 3**
- [ ] 30-04-PLAN.md — User-facing JS fixes (build): beer waitlist via /api/contact (D-02/#2) + kiosk idle-reset cart leak (#4)

**Wave 4**
- [ ] 30-05-PLAN.md — Security batch (payment-adjacent): escape contact XSS sinks (#7), canonical escapeHTML (#8), proto-pollution guard (#9) + staging-kiosk verify

**Wave 5**
- [x] 30-06-PLAN.md — Config/infra + test cleanup: railway.toml watchPatterns (#19), node-cron 4.2.1 (#20), jest cleanup (#21) + human actions env vars/uptime (#17,#18)

### Phase 43: Kiosk manual custom line item with notes

**Goal:** Let kiosk staff add an ad-hoc invoice line (description + staff-entered price + qty + note) that is not a catalog product, on both kiosk surfaces (standalone `kiosk.js` and admin-embedded `admin.js`, forked per #14), without weakening the v4.2-hardened money path. Server `/api/kiosk/sale` + `/api/kiosk/sale/confirm` gain a custom-line path (no `item_id`, `custom:true`) that trusts the bounded staff price and records the note in the Zoho invoice line description; the terminal charge (server `computeTax`) must equal the Zoho invoice tax for taxable custom lines.
**Requirements**: KIOSK-02 (new owner-requested feature; not from PROJECT_ASSESSMENT.md)
**Depends on:** None (independent of Phase 42 de-fork; both touch the forked kiosk surfaces, sequence to avoid merge churn)
**Plans:** 2/2 plans complete

Plans:
- [x] 43-01-PLAN.md — server custom-line path in routes/pos.js (test-first; bounded price, 5% GST tax_id resolution + fail-closed, note->description, discount-skip)
- [x] 43-02-PLAN.md — "Add custom item" modal + cart wiring on BOTH kiosk.js and admin.js (forked); rebuild bundles + full gate; human-verify

### Phase 44: Kiosk gift card certificate lifecycle

**Goal:** Full gift-card / gift-certificate lifecycle at the kiosk POS — **sell, redeem (as tender), balance lookup, partial redemption, and reload** — on both forked kiosk surfaces (`kiosk.js` + `admin.js`), with correct money-path + accounting semantics. This is a NEW capability, NOT an extension of the Phase 43 custom-line item.
**Requirements**: GIFTCARD-01 (owner-requested; captured 2026-06-27, to be split into sub-requirements at planning)

**Captured scope (from owner, 2026-06-27 — pre-discussion):**
- **Lifecycle:** full — sell, redeem, balance lookup, partial redemption, reload. Likely splits into multiple plans/sub-phases at planning time.
- **Medium:** **paper certificate with a manually-assigned number/code** (no pre-printed barcode stock, no digital/email generation in v1). Staff enter the certificate number at sale and at redemption.
- **Both kiosk surfaces** (forked #14): build in `kiosk.js` AND `admin.js` until the Phase 42 de-fork.

**Critical constraints (MUST hold — these are why this is its own phase):**
- **Tax (BC/Canada):** a gift card/certificate sale is **NOT taxed at sale** (no GST/PST); tax applies to the underlying goods/services at **redemption**. Selling must be zero-tax; redemption applies tax to the real items being bought.
- **Accounting:** a sale is a **liability, not revenue** — must post to an "unredeemed gift card liability" account in Zoho (deferred), recognized as revenue only on redemption. Do NOT post gift-card sales as a normal sales line. (Research the right Zoho mechanism — liability account / gift-card item / store credit — at planning.)
- **Redemption is a tender/payment path**, not a cart line — distinct from how items are added. Must integrate with the v4.2-hardened money path (Helcim terminal for any remaining balance, Zoho payment recording) without weakening it.
- **Balance integrity:** server-authoritative balance tracking (where do balances live — Zoho, Redis, Sheets? decide at planning); partial redemption must atomically decrement; guard against double-spend / replay.

**Depends on:** Phase 43 (sequence after — both touch the forked kiosk surfaces; avoids `kiosk.js`/`admin.js` merge churn). Independent of Phase 42.
**Plans:** 9/10 plans executed

Plans:
**Wave 1** (parallel — owner setup + Apps Script foundation)
- [x] 44-01-PLAN.md — Owner Zoho setup (Gift Card Sales income account + Gift Certificate 0%-tax item + KIOSK_GIFT_CARD_ITEM_ID) + Wave-0 API probes (payment_mode:'others', zero-tax) + validateEnv entry + deferral-journal cadence (GIFTCARD-01)
- [x] 44-02-PLAN.md — Apps Script adminApi.gs: GiftCards sheet + 7 actions (issue/lookup/redeem/reload/void/update-invoice/next-number) with LockService atomicity + last_tx_ref idempotency + manual redeploy (GIFTCARD-01)

**Wave 2** (parallel — disjoint middleware files)
- [x] 44-03-PLAN.md — routes/gift-cards.js: issue + next-number + lookup (fail-closed 503, dup-reject 409, zero-tax sale, void-on-Zoho-failure) + server mount + tests (GIFTCARD-01a/01b)
- [x] 44-04-PLAN.md — pos.js split-tender redemption (reduce terminal by gift_amount, two customerpayments, redeem_gift_card LAST, void-on-failure, tax untouched) + pos-gift-card.test.js (GIFTCARD-01c)

**Wave 3**
- [x] 44-05-PLAN.md — routes/gift-cards.js: reload (increment + sale accounting, fail-closed) + void routes + tests (GIFTCARD-01d/01e)

**Wave 4**
- [x] 44-06-PLAN.md — Issue/Reload "add value" modal on BOTH forked surfaces (kiosk.js inline + admin.js openModal), suggested cert pre-fill, rebuilt bundles (GIFTCARD-01a/01d UI)

**Wave 5**
- [x] 44-07-PLAN.md — Redeem tender (lookup → apply → split terminal) on BOTH surfaces + admin-only lookup/void management view + rebuilt bundles (GIFTCARD-01b/01c/01e UI)

**Wave 6**
- [x] 44-08-PLAN.md — Full gate + staging deploy (frontend + prod middleware) + iPad Safari UAT + REQUIREMENTS traceability (GIFTCARD-01). UAT round 1 found G-44-01 (phantom payment) → fixed by Wave 7 (44-09/44-10) → round 2 visible behavior verified. ⚠ Live terminal-sale checks (real card) DEFERRED by owner 2026-06-29; phase NOT production-promoted until they pass — see 44-08-UAT.md

**Wave 7** (gap closure — G-44-01 from 44-08 UAT: issue/reload recorded a phantom paid invoice with no terminal charge)
- [x] 44-09-PLAN.md — Middleware: pos.js prices a gift_cert cart line (zero-tax via KIOSK_GIFT_CARD_ITEM_ID, D-03) + activates cert on payment SUCCESS (issue_gift_card/reload_gift_card LAST, needs_manual_review on failure, no orphan) + confirm idempotency; decommission phantom-payment /issue+/reload routes (GIFTCARD-01a/01d)
- [x] 44-10-PLAN.md — Frontend (D-08): kiosk.js + admin.js issue/reload modal ADDS a gift_cert cart line (paid via real terminal checkout) instead of POSTing /issue|/reload; reload lookup pre-check; rebuilt bundles (GIFTCARD-01a/01d UI)

**UI hint**: yes

### Phase 45: Security and Money-Path Hardening (audit critical and high) ✅ COMPLETE 2026-07-02 (VERIFIED)

**Goal:** Close the verified CRITICAL and HIGH findings from the 2026-06-29 multi-agent audit (`AUDIT-2026-06-29.md`, 7 leads, 1 critical + 7 high, 0 refuted) — the public-key/auth-model exposure and the kiosk money-path weaknesses — plus safe quick-win containments, **without weakening the v4.2/v4.4-hardened online checkout path** (existing money-path tests must stay green).

**Requirements**: Audit remediation (CRITICAL + HIGH tier). Source: `AUDIT-2026-06-29.md`.
**Depends on:** Phase 44 (done). Coordinate with Phase 42 (Kiosk POS De-Fork, not started) — the shared money-path primitive extraction overlaps the de-fork; plan must decide whether to precede, fold in, or sequence around it.
**Plans:** 9/9 plans executed. **Verification:** 45-VERIFICATION.md — PASSED, 11/11 must-haves (D-01..D-05 absent by owner-approved split to Phase 46). Live-card UAT all 8 steps pass (45-09-SUMMARY.md).

**In scope:**
- **[CRITICAL] Auth-model exposure → MOVED to Phase 46** — admin API key (= Railway `API_SECRET_KEY`) is hardcoded in publicly-served, git-tracked `js/sheets-config.js:65` and loaded on ~13 public pages. Rotate the leaked key and re-architect staff-surface auth to server-side identity (reuse existing Google OAuth) so no shared secret ships to the browser. ⚠ Owner decision: interim containment (network/IP allowlist for the fixed in-store kiosk) vs straight to OAuth. **Split approved (2026-06-29) → see Phase 46.**
- **[HIGH] Unguarded PII GETs** — `/api/kiosk/salesorders` + `/api/kiosk/salesorder/:id` leak customer name/id/totals/line-items with no key check; add to `PII_GET_ROUTES` (quick containment).
- **[HIGH] Fail-open under Redis outage** — rate limiting (PIN brute-force, payment, checkout), distributed locks, and idempotency all silently disable during a Redis outage (the "MemoryStore fallback" comments are wrong). Make security-critical limiters/locks fail-closed or process-local.
- **[HIGH] Kiosk money-path = un-hardened re-impl of checkout.js** (the through-line) — extract `checkout.js` safety primitives (atomic `acquireLock`, error-propagating payment recording, void-on-failure, terminal-timeout reconciliation) into shared helpers used by both paths. Closes: non-atomic sale/confirm idempotency (double-charge/double-invoice), `confirm` swallowing payment-recording failures while returning 201 ok, terminal-timeout orphan charges with no reconciliation, and gift-card split-tender underpay (validate applied amount vs real balance + `needs_manual_review` on redeem failure).
- **[HIGH] CI artifact drift** — no CI step rebuilds/verifies the tracked `.min.js` artifacts GitHub Pages serves; add an artifact-drift check (exclude `Date.now()` cache-stamps).
- **Quick-win containments** — deploy already-committed `#2` (e8b81ce, API-key header-only) + `#10` (7c68f05, PII-log redaction) via `railway up`; `KIOSK_PIN` length-check before `timingSafeEqual` (misconfig → staff lockout); gitignore + remove `dump.rdb`.

**Out of scope** (defer to follow-on phases 46+): the 25 medium / 16 low / info findings — mobile-responsive (iOS auto-zoom inputs, <44px touch targets, safe-area), testing/CI (coverage floors for `pos.js`/`kiosk.js`, `--max-warnings 0` lint gate, ES5 lint rule, money-path E2E), webhook replay/dedup hardening, observability (Sentry on money-path catches), and dependency hygiene (`npm ci`, Node `engines` pin).

**Planned scope (this phase):** Waves 1-5 cover the Redis fail-open, money-path hardening, gift-card split-tender, reconciliation backstop, CI drift, PII guards, and quick-win containments (D-06..D-17). The auth re-architecture (D-01..D-05, the CRITICAL key exposure) is **split to Phase 46 (approved 2026-06-29)** — it contains a net-new device-credential mechanism (an open design decision) plus an owner-coordinated key-rotation cutover (D-04), and bundling it risks degrading the money-path plans' fidelity. Interim containment ships in Wave 1 (PII guards) + the audit's rotate-now option; residual key-validity-until-cutover risk is documented (D-04).

Plans:
**Wave 1** (parallel — disjoint files)
- [x] 45-01-PLAN.md — Quick-win code containments: guard 2 kiosk PII GETs (D-09), KIOSK_PIN length-check (D-15), gitignore dump.rdb (D-15)
- [x] 45-03-PLAN.md — Redis fail-closed policy: drop limiter skip → MemoryStore fallback + in-process acquireLock fallback + fix false comments (D-06/07/08)
- [x] 45-04-PLAN.md — CI artifact-drift check, stamp-normalized (D-10)
- [x] 45-05-PLAN.md — Extract lib/money-path.js from checkout.js + refactor checkout to consume it, no behaviour change (D-11)

**Wave 2**
- [x] 45-02-PLAN.md — Ship Wave-1 containments to prod Railway + verify (D-15) [checkpoint]
- [x] 45-06-PLAN.md — pos.js sale/confirm: atomic required idempotency + deterministic Helcim key + confirm propagates recording failure → void (D-12)

**Wave 3**
- [x] 45-07-PLAN.md — Gift-card split-tender balance validation + needs_manual_review + terminal-timeout pending-charge persist (D-12 + D-13 interface)

**Wave 4**
- [x] 45-08-PLAN.md — Reconciliation backstop: lib/reconcile.js + webhook reconcile + periodic sweep, match on reference_number (D-13)

**Wave 5**
- [x] 45-09-PLAN.md — Bundled live gift-card + money-path UAT on prod (with P44 deferred UAT, D-16) [checkpoint] — COMPLETE 2026-07-02, all 8 steps pass (45-09-SUMMARY.md)

---

### Phase 46: Auth Re-Architecture (CRITICAL — split from Phase 45)

**v4.5 carryover:** This phase now also closes v4.5 **SEC-02** (audit C1) — carried over as-is, not re-planned; code-complete + verified, owner production cutover (46-10) pending. See `REQUIREMENTS.md` Traceability.

**Goal:** Eliminate the shared-secret browser auth model. Stop shipping the admin API key in public git-tracked JS, move staff surfaces to server-side identity, and rotate the leaked `API_SECRET_KEY` at cutover — closing the CRITICAL auth-model exposure from `AUDIT-2026-06-29.md` without locking out the in-store kiosk.

**Requirements**: Audit remediation (CRITICAL tier — auth-model exposure). Source: `AUDIT-2026-06-29.md`. Carried over from Phase 45 decisions D-01..D-05.
**Depends on:** Phase 45 (Wave 1 interim containment ships first). Coordinate with Phase 42 (Kiosk POS De-Fork) — admin/kiosk frontend auth gating overlaps the de-fork.
**Status:** Planned — 10 plans across 6 waves (owner sign-off on the device-credential mechanism captured in 46-CONTEXT.md D-46-01).
**Plans:** 9/10 plans executed

**In scope (D-01..D-05):**
- **Kiosk device-provisioned credential** — single managed in-store iPad on store WiFi (D-01); device-bound session/credential entered/stored once on the iPad, no shared secret served to public pages. Exact mechanism (long-lived device token vs first-run provisioning vs client cert) is an **open design decision** for discuss/research — no existing analog.
- **Admin per-user Google OAuth** (D-02) — admin (`admin.html`) is opened off-site (laptop/phone), so it must require real per-user Google login. The reusable Google identity is frontend-only today (`js/lib/auth.js`, GIS); the **server-side Google ID-token verifier + staff allowlist is net-new** (guard registration mirrors `server.js:418-423`). NOTE: `routes/auth.js` is Zoho OAuth, not Google.
- **Remove `MW_API_KEY`** from `js/sheets-config.js:65` (D-03); public pages (index/products/contact/404) carry no admin key; rebuild artifacts (`npm run build`).
- **Rotate `API_SECRET_KEY` at cutover** (D-04) — owner-coordinated; leaked key stays valid until the new auth is live (documented residual risk, owner-accepted).
- **Interim network containment** (D-05) — IP allowlist as a possible stopgap; likely unnecessary if cutover is quick (planner to confirm).

**Out of scope:** the money-path / quick-win / Redis / CI work (stays in Phase 45); the medium/low/info findings (phases 47+).

**Pre-planning gate:** Run `/gsd:discuss-phase 46` to lock the device-credential mechanism before `/gsd:plan-phase 46`.

Plans:
**Wave 1** (parallel — disjoint files)
- [x] 46-01-PLAN.md — Backend credential primitives: lib/deviceToken.js + lib/session.js + validateEnv vars + install google-auth-library/cookie-parser
- [x] 46-05-PLAN.md — Kiosk full migration: remove Google-auth gate, device-token settings prompt + PIN gate, swap headers to x-device-token, /api/contacts/search
- [x] 46-06-PLAN.md — Admin session migration: checkAuthorization → /auth/google, all calls credentials:'include' (incl. embedded kiosk)
- [x] 46-07-PLAN.md — BrewPad session migration: checkAuthorization(onError) → /auth/google, all calls credentials:'include'
- [x] 46-08-PLAN.md — Public bundles keyless + remove MW_API_KEY from sheets-config (12-checkout 6 sites, 16/17 GETs)

**Wave 2**
- [x] 46-02-PLAN.md — lib/googleVerify.js (getTokenInfo + mandatory aud check) + POST /auth/google & /auth/logout

**Wave 3**
- [x] 46-03-PLAN.md — server.js 3-tier guard (legacy/device/session) + lib/authTiers.js + cookie-parser + keyless exemptions + PII session acceptance

**Wave 4**
- [x] 46-04-PLAN.md — In-route credential migration: pos.js 13 checks + consignment/catalog → req.authTier (kiosk survives rotation; void stays admin-grade)

**Wave 5**
- [x] 46-09-PLAN.md — Rebuild all bundles + full frontend/middleware/lint gate + no-key grep proof

**Wave 6** (owner cutover — checkpoints)
- [ ] 46-10-PLAN.md — Dual-accept deploy + iPad provisioning + per-surface verify + API_SECRET_KEY rotation + runbook


## Phase Details (v4.5)

### Phase 47: Purge Publicly-Served Internal Docs

**Goal**: Internal planning/audit artifacts are no longer served publicly on either staging or production — closing the confirmed-live H1 exposure that hands out the admin key and a file:line exploit map
**Depends on**: Nothing (first phase of v4.5; ~minutes, independent containment; sequenced first because it removes an active exploit map)
**Requirements**: SEC-01
**Success Criteria** (what must be TRUE):

  1. `curl https://staging.steinsandvines.ca/.planning/STATE.md` returns 404, not file contents
  2. `curl <prod>/AUDIT-2026-06-29.md` (and the equivalent staging path) returns 404
  3. `AUDIT-2026-06-29.md` and any other root audit docs are `git rm --cached` from the served repos and added to `.gitignore`
  4. The root `.nojekyll`-vs-`_config.yml exclude` contradiction on staging is reconciled — either `.nojekyll` is dropped on staging so the exclude works, or a `.planning`/audit strip is added to the staging deploy matching prod
  5. The existing production `.planning` strip step still runs and continues to remove root audit docs, with no regression to CNAME or the live site

**Plans**: TBD

### Phase 48: Kiosk POS De-Fork (kiosk-core.js)

**Goal**: The kiosk POS logic lives in a single shared `js/kiosk-core.js` consumed by both `kiosk.js` (standalone) and `admin.js` (embedded), so the cart and payment/checkout paths can no longer diverge — the structural backbone that lets the kiosk void-on-failure synchronously like `checkout.js`, and the prerequisite for MONEY-02 (Phase 50) and MONEY-03 (Phase 51)
**Depends on**: Nothing new (rehomed from v4.4 Phase 42; independent of Phase 47)
**Requirements**: KIOSK-01
**Success Criteria** (what must be TRUE):

  1. The ~34 duplicated `kiosk*` functions (cart building, `kioskProceedToPayment`, terminal charge, Zoho invoice/payment, void-on-failure, dual-cart) exist in exactly one place, `js/kiosk-core.js`, and both `kiosk.js` and `admin.js` consume that shared module — no second copy of the payment path remains
  2. The money path is unchanged in behaviour: terminal charge → Zoho invoice/payment → void-on-failure → dual-cart shared-charge handling all behave exactly as before, demonstrated by the existing kiosk tests passing without weakening and by a new admin-embedded-vs-standalone parity check that asserts identical request payloads/flow for the same cart
  3. The kiosk product-type discount feature (which currently exists only in `kiosk.js`) is available identically on both the standalone kiosk and the admin-embedded kiosk after the de-fork
  4. `npm test`, `npm run lint`, and `npm run build` are clean (concatenated `main.js`/`main.min.js` and `admin.min.js` regenerated), and no behaviour-changing logic was introduced beyond the discount-parity fix
  5. Verified on staging on iPad Safari: a full kiosk sale (including a recipe/product-type discount) completes identically from both the standalone kiosk URL and the admin-embedded kiosk tab, with terminal/void/dual-cart behaviour intact

**Plans**: TBD
**UI hint**: yes

### Phase 49: Online Captured-Amount Verification

**Goal**: `/api/checkout` verifies the captured card amount against the recorded/invoiced total before booking payment, voiding and rejecting on any mismatch — closing audit H2
**Depends on**: Nothing new (extends the existing `lib/money-path.js`/`checkout.js` primitives; independent of Phase 48)
**Requirements**: MONEY-01
**Success Criteria** (what must be TRUE):

  1. After resolving `transactionId` in `/api/checkout`, the handler fetches the Helcim `getCardTransactionById` record and asserts captured amount ≥ recorded/invoiced total before any payment is booked
  2. A mismatch (captured amount below the recorded/invoiced total) triggers `voidWithTimeout` and the request returns a 4xx rejection — no paid Zoho invoice is created
  3. A regression test simulating `initialize(amount: 0.01)` against a full-price order asserts: charge voided, no paid invoice persisted, 4xx response
  4. The existing v4.2-hardened checkout test suite remains green — no regression to the happy-path charge→Zoho-order flow

**Plans**: 2 plans

Plans:
- [x] 49-01-PLAN.md — TDD RED→GREEN: failing H2 regression, then getCardTransactionById captured-amount check (±$0.01) + void-on-mismatch in /api/checkout (autonomous)
- [ ] 49-02-PLAN.md — Live-card UAT: legit order books paid (no false-void) + tamper attempt voided/4xx on staging (checkpoint)

### Phase 50: Kiosk Money-Path Defect Closeout

**Goal**: The kiosk money path closes its remaining correctness defects — reconcile TTL/orphan-age, idempotency lock release on failure, void-status inspection, `salesorder-pay` locking, sweep cleanup, and `pos-recipe.js` primitive adoption — closing audit H3/H4/H5/H8/M12/M13
**Depends on**: Phase 48 (kiosk de-fork must land first so shared money-path primitives have one call site to fix, not two)
**Requirements**: MONEY-02
**Success Criteria** (what must be TRUE):

  1. Reconcile's TTL-vs-orphan-age check is fixed / made Zoho-authoritative (H3) — a regression test asserts a settled paid charge is never voided by reconcile
  2. The idempotency lock is released on every confirm/checkout failure path (H4) — a regression test asserts a retry after a failed attempt re-acquires the lock rather than hanging locked
  3. `voidTransaction` inspects the actual reversal status returned by Helcim rather than trusting any 2xx response (H5) — a regression test covers a 2xx-but-not-reversed response
  4. `salesorder-pay` acquires a lock, deletes its pending record on success, and uses a unique reference (H8) — a duplicate/racing call cannot double-pay
  5. The sweep clears or marks pending records so the alert storm ends (M13), and `pos-recipe.js` adopts the same `money-path` primitives + pending-record pattern already used by `checkout.js`/`pos.js` (M12)

**Plans**: TBD

### Phase 51: Gift-Card Ledger Integrity

**Goal**: Gift-card issue/reload/redeem operations are idempotent and ledger-integral — no duplicate credits, no silent redeem failures, no formula-injection or unbounded-numeric corruption of the Sheets-backed ledger — closing audit H6/H7/M9/M15/M18
**Depends on**: Phase 48 (kiosk de-fork lands first; gift-card redemption is a kiosk tender path)
**Requirements**: MONEY-03
**Success Criteria** (what must be TRUE):

  1. `reloadGiftCard` is idempotent via an append-only processed-ref ledger (H7) — a regression test asserts a duplicate reload request produces a single credit, not two
  2. A redeem failure durably sets `needs_manual_review: true` on the gift-card/transaction record (H6) — a regression test asserts the flag itself, not just a log line
  3. Every Sheets write sanitizes leading `=+-@` characters in user-supplied cell values (M9) — a regression test asserts `=IMPORTRANGE(...)` entered as a void reason is stored as inert text, not a formula
  4. `issueGiftCard`'s `appendRow` is header-mapped (not positional) with bounded numeric fields (M18) — malformed/oversized numeric input is rejected or clamped, not written raw
  5. Negative-taxable custom-line tax parity holds (M15) — a regression test asserts a legitimately discounted sale is not voided by a tax mismatch
  6. An interleaved redeem retry decrements the balance exactly once, verified by a regression test

**Plans**: TBD

### Phase 52: Fail-Closed Sweep

**Goal**: Every remaining Redis-degradation and auth/validation gap that currently fails open now fails closed — no security or money-path guard silently permits an unsafe operation when Redis or an upstream service is unavailable
**Depends on**: Nothing new (independent of Phases 48-51; sequenced after money-path correctness per audit risk order)
**Requirements**: RESIL-01
**Success Criteria** (what must be TRUE):

  1. A single shared closed-on-Redis-error helper is applied to the promo `FIRSTBATCH` check (M1), the rate-limit store's mid-op error path (M4), and its loopback skip (M5) — a test asserts each guard returns closed when its Redis call throws
  2. The legacy `/api/pos/sale` route is quarantined or deleted (M2), and the hardcoded gift-card `account_id` fallback fails closed rather than silently using a default (M3)
  3. The `csv_url` fetch is restricted to `https`-only with a host allowlist, closing the SSRF vector (M6)
  4. The unauthenticated Apps-Script-backed GET routes are auth-guarded and cached (M7, M8) — an unauthenticated `?bust=1` request requires the key
  5. Numeric `:id` path parameters are validated, closing the `%2F` path-pivot vector (M20)
  6. A regression test asserts the promo is not repeatable during a simulated Redis outage

**Plans**: 5 plans
- [x] 52-01-PLAN.md — shared closed-on-Redis-error helper (redis-guard) [wave 1]
- [x] 52-02-PLAN.md — apply helper: promo M1 fail-closed + rate-limit M4/M5 fail-closed [wave 2]
- [x] 52-03-PLAN.md — pos.js: quarantine legacy /api/pos/sale (M2) + gift-card account fail-closed (M3) [wave 1]
- [x] 52-04-PLAN.md — items :id validation (M20) + csv_url SSRF allowlist (M6) [wave 1]
- [x] 52-05-PLAN.md — auth+cache: ?bust=1 key (M7) + Apps-Script proxies (M8) [wave 1]

### Phase 53: Money-Path Observability & CI Gates

**Goal**: Every money-path failure emits a tagged Sentry event, and CI enforces the lint/coverage/dependency gates that keep the hardened money path from silently regressing — protecting every fix made in Phases 47-52
**Depends on**: Phases 49, 50, 51, 52 (sequenced last so its Sentry/coverage gates protect every earlier money-path/resilience fix from regressing, per audit rationale)
**Requirements**: OBS-01
**Success Criteria** (what must be TRUE):

  1. Every money-path `catch` block calls `Sentry.captureException` tagged with `txnId`/`reqId` (M17) — a forced money-path error produces a visible Sentry event
  2. CI and Railway both run `npm ci` (not `npm install`), and a Node `engines` field / `.nvmrc` pins the runtime version (L1, L2)
  3. Lint runs with `--max-warnings 0` and an ES5-only lint rule is enforced — CI fails on a new lint warning and on ES6 syntax (L12)
  4. A per-file coverage floor is set on `pos.js`, calibrated just below its measured coverage so it can't silently regress (L13)

**Plans**: 6 plans

Plans:

**Wave 1**

- [x] 53-01-PLAN.md — Sentry beforeSend PII scrub + error-class fingerprint (D-03/D-04) + regression test
- [x] 53-04-PLAN.md — Frontend lint cleanup (125 warnings) + admin.js optional-chaining→ES5 + rebuild (D-05/D-06)
- [x] 53-05-PLAN.md — npm ci + Node 20 pin (lockfiles/engines/.nvmrc/CI) + pos.js coverage floor (D-07/08/09/10)

**Wave 2**

- [x] 53-02-PLAN.md — Sentry captureException at money-path catch sites, tagged reqId/txnId/invoice-SO (D-01/D-02)

**Wave 3**

- [x] 53-03-PLAN.md — Middleware lint cleanup (60 warnings, own commit) (D-05)

**Wave 4**

- [x] 53-06-PLAN.md — Lint gate flip: --max-warnings 0 + ES5 rule (D-05/D-06)

