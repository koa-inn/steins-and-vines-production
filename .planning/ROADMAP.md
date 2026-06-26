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
- [ ] **Phase 39: Nightly Snapshot Publishes to Prod Fallback** - drop `[skip ci]` / pull-before-force-push so prod `zoho-snapshot.json` is fresh (DEPLOY-04)
- [ ] **Phase 40: Facility Image Optimization (webp + srcset)** - extend product image pipeline to facility/about; sub-500 KB homepage images with intrinsic dimensions (ASSET-01)
- [ ] **Phase 41: SKU-Keyed Cart Identity** - re-key cart by SKU in `11-cart.js` + `17-search-overlay.js`; one merged line across both carts (CART-01)
- [ ] **Phase 42: Kiosk POS De-Fork (kiosk-core.js)** - shared `js/kiosk-core.js`, behaviour-preserving, parity-tested, discount on both surfaces (KIOSK-01)

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
| 42. Kiosk POS De-Fork (kiosk-core.js) | v4.4 | 0/? | Not started | - |

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
**Plans:** 0 plans

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
