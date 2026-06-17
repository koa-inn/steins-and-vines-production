# Roadmap: Steins & Vines

## Milestones

- Ã¢ÂÂ **v1.0 Kiosk Production Readiness** Ã¢ÂÂ Phases 1-4 (shipped 2026-04-28)
- Ã¢ÂÂ **v1.1 Brewpad Reliability & Integration** Ã¢ÂÂ Phases 5-11 (shipped 2026-05-06)
- Ã¢ÂÂ **v2.0 Recipe-Based Products** Ã¢ÂÂ Phases 12-19 (shipped 2026-05-27)
- Ã¢ÂÂ **v3.0 Catalog Subpages** Ã¢ÂÂ Phases 20-24 (shipped 2026-06-03)
- Ã¢ÂÂ **v4.0 Booking Migration (Cal.com) + Edge Protection** Ã¢ÂÂ Phases 25-26 (completed 2026-06-06)
- Ã°ÂÂÂ§ **v4.1 BrewPad Batch Lifecycle & Zoho Sync** Ã¢ÂÂ Phases 27-29 (in progress)

## Phases

<details>
<summary>Ã¢ÂÂ v1.0 Kiosk Production Readiness (Phases 1-4) Ã¢ÂÂ SHIPPED 2026-04-28</summary>

- [x] Phase 1: Catalog & Stock Display (3/3 plans)
- [x] Phase 2: Sales Order Integrity (2/2 plans)
- [x] Phase 3: Resilience & Session Stability (1/1 plans)
- [x] Phase 4: Sales Order Management (2/2 plans)

</details>

<details>
<summary>Ã¢ÂÂ v1.1 Brewpad Reliability & Integration (Phases 5-11) Ã¢ÂÂ SHIPPED 2026-05-06</summary>

- [x] Phase 5: Auth Reliability (2/2 plans)
- [x] Phase 6: Kiosk-to-Brewpad Integration (3/3 plans)
- [x] Phase 7: Zoho Audit Trail (3/3 plans)
- [x] Phase 8: First-Batch Promo (6/6 plans)
- [x] Phase 9: Content & SEO Push (3/3 plans)
- [x] Phase 10: Checkout Payment Safety (4/4 plans)
- [x] Phase 11: Producer & Brand Visibility (3/3 plans)

</details>

<details>
<summary>Ã¢ÂÂ v2.0 Recipe-Based Products (Phases 12-19) Ã¢ÂÂ SHIPPED 2026-05-27</summary>

- [x] Phase 12: Recipe Data Foundation (2/2 plans) Ã¢ÂÂ completed 2026-05-16
- [x] Phase 13: Middleware API + Admin Recipe Management (4/4 plans) Ã¢ÂÂ completed 2026-05-17
- [x] Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation (5/5 plans) Ã¢ÂÂ completed 2026-05-17
- [x] Phase 15: BeerXML Import (2/2 plans) Ã¢ÂÂ completed 2026-05-17
- [x] Phase 16: Recipe Management Ã¢ÂÂ BrewPad, Kiosk & Batch Integration (3/3 plans) Ã¢ÂÂ completed 2026-05-18
- [x] Phase 17: Custom Labels Page (3/3 plans) Ã¢ÂÂ completed 2026-05-18
- [x] Phase 18: Custom Labels Iteration (3/3 plans) Ã¢ÂÂ completed 2026-05-19
- [x] Phase 19: Hop Inventory Catalog (3/3 plans) Ã¢ÂÂ completed 2026-05-19

</details>

### Ã¢ÂÂ v3.0 Catalog Subpages (Shipped 2026-06-03)

**Milestone Goal:** Break the monolithic ingredients page into dedicated category subpages with shared template, cross-category navigation, and unified search.

- [x] **Phase 20: Zoho Data Foundation** - Tag all ingredient items with subcategory; refresh snapshot pipeline
- [x] **Phase 21: Shared Template & Build Infrastructure** - Shared JS module, CSS, and build pipeline for all subpages (completed 2026-05-29)
- [x] **Phase 22: Category Subpages & Navigation** - All 5 subpages live with sub-nav and main nav dropdown (completed 2026-05-29)
- [x] **Phase 23: Cross-Category Search** - Search overlay with grouped results and deep-link navigation (completed 2026-05-30)
- [x] **Phase 24: SEO & Staging Deploy** - Per-subpage SEO meta, QA pass, and staging deployment (completed 2026-06-03)

### Ã°ÂÂÂ§ v4.0 Booking Migration (Cal.com) (In Progress)

**Milestone Goal:** Replace the Zoho Bookings backend with Cal.com Cloud (free tier) behind the existing `/api/bookings*` middleware contract Ã¢ÂÂ keeping the website checkout flow unchanged Ã¢ÂÂ with multiple appointment types and HTTPS-based confirmation emails (Railway blocks outbound SMTP).

- [x] **Phase 25: Cal.com Booking Migration** - Swap Zoho Bookings Ã¢ÂÂ Cal.com Cloud behind unchanged `/api/bookings*` endpoints; multiple event types; manual cutover of existing appointments (completed 2026-06-04)

### Ã°ÂÂÂ§ v4.1 BrewPad Batch Lifecycle & Zoho Sync (In Progress)

**Milestone Goal:** Staff can activate pending batches from the admin batch list and pull customer info back from Zoho onto BrewPad Ã¢ÂÂ closing the two open gaps in the batch workflow.

- [x] **Phase 27: Pending Batch Visibility & Activation** - Surface pending batches in the admin list/filter and add one-click + guided activation (BATCH-01..03) (3 plans executed 2026-06-07; gap-closure plan 27-04 created to close CR-01 blocker + WR-01 warning) (completed 2026-06-08)
- [x] **Phase 28: Zoho Customer Read-Back Path** - New middleware endpoint to fetch customer details by SO/invoice number, plus Apps Script write-back of refreshed fields (ZSYNC foundation) (completed 2026-06-12)
- [x] **Phase 29: Refresh-from-Zoho Admin UI** - "Refresh from Zoho" button in the batch detail modal that updates customer name/email/contact, gated on `zoho_so_number` (ZSYNC-01..02) (completed 2026-06-12)

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

- [x] 20-01-PLAN.md Ã¢ÂÂ Create bulk tagging script and coverage verification script

**Wave 2**

- [x] 20-02-PLAN.md Ã¢ÂÂ Execute tagging workflow and verify 100% coverage

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

- [x] 21-01-PLAN.md Ã¢ÂÂ Create 16-catalog-subpage.js standalone module and catalog-subpage.css stylesheet

**Wave 2**

- [x] 21-02-PLAN.md Ã¢ÂÂ Test HTML page, unit tests, and build pipeline integration

### Phase 22: Category Subpages & Navigation

**Goal**: Customers can navigate directly to any ingredient category subpage from anywhere on the site, and all 5 category pages are live
**Depends on**: Phase 21
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, NAV-01, NAV-02, NAV-03
**Success Criteria** (what must be TRUE):

  1. Each of the 5 subpages (Grains, Yeast, Additives, Packaging, Equipment) loads and shows only its category's items with correct cart controls
  2. A horizontal sub-nav bar appears on every ingredient page showing: All | Hops | Grains | Yeast | Additives | Packaging | Equipment Ã¢ÂÂ and the current page's tab is visually highlighted
  3. The main site Products dropdown includes direct links to each ingredient category subpage
  4. Weight-based products on the Grains page offer quantity entry in kg/g as appropriate

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 22-01-PLAN.md Ã¢ÂÂ Sub-nav CSS styles, dropdown divider style, and build pipeline stamp:pages update

**Wave 2** (parallel)

- [x] 22-02-PLAN.md Ã¢ÂÂ Create 5 new category subpages, move hops.html, rebuild ingredients-supplies.html
- [x] 22-03-PLAN.md Ã¢ÂÂ Update nav dropdown in 9 existing pages and verify navigation end-to-end

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

- [x] 23-01-PLAN.md Ã¢ÂÂ Create search overlay module, CSS, and fix data-sku gap

**Wave 2**

- [x] 23-02-PLAN.md Ã¢ÂÂ Wire overlay into 7 HTML pages, build pipeline, and unit tests

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

- [x] 24-01-PLAN.md Ã¢ÂÂ Add full SEO head (unique title, description, og:*, twitter:card, LocalBusiness JSON-LD) to all 5 category subpages

**Wave 2**

- [x] 24-02-PLAN.md Ã¢ÂÂ Build, stamp, push to staging, and QA-verify all 5 subpages load clean on staging.steinsandvines.ca

### Phase 25: Cal.com Booking Migration

**Goal**: Appointment booking runs on Cal.com Cloud (free tier) behind the unchanged `/api/bookings*` middleware contract, supporting multiple appointment types, with customer/staff confirmation emails delivered by Cal.com over HTTPS
**Depends on**: (new milestone v4.0 Ã¢ÂÂ no prior phase dependency)
**Requirements**: BOOK-01, BOOK-02, BOOK-03, BOOK-04, BOOK-05
**Success Criteria** (what must be TRUE):

  1. `GET /api/bookings/services`, `GET /api/bookings/availability`, `GET /api/bookings/slots`, and `POST /api/bookings` return the same response shapes as today, now backed by Cal.com (frontend unchanged)
  2. A completed ferment-in-store checkout creates a real Cal.com booking and the customer receives a Cal.com confirmation email (verified end-to-end on staging)
  3. At least one additional appointment type beyond ferment-in-store is bookable through Cal.com
  4. Zoho Bookings code paths (`bookingsGet`/`bookingsPost`, `ZOHO_BOOKINGS_*` env) are removed or disabled with no dead references; offline-fallback behavior preserved
  5. Middleware test suite covers the new Cal.com adapter (request/response mapping, error + offline-fallback paths) and passes; lint clean

**Plans**: 4 plans (3 waves)

- [x] 25-01-PLAN.md Ã¢ÂÂ Free-tier risk gate + Cal.com adapter (lib/calcom.js) + env registration
- [x] 25-02-PLAN.md Ã¢ÂÂ Rewrite /api/bookings* handlers onto Cal.com, preserving the contract
- [x] 25-03-PLAN.md Ã¢ÂÂ POST /api/webhooks/calcom (signature-verified, cache invalidation)
- [x] 25-04-PLAN.md Ã¢ÂÂ Staging booking+email verification, additional event type, Zoho removal

### Phase 27: Pending Batch Visibility & Activation

**Goal**: Staff can see and act on pending batches directly from the admin batch list, promoting them to Primary either instantly or through a guided setup
**Depends on**: Nothing new (builds on existing v1.1 batch tracking; backend `updateBatch` already supports the pendingÃ¢ÂÂprimary transition and stamps `fermentation_started_at`)
**Requirements**: BATCH-01, BATCH-02, BATCH-03
**Success Criteria** (what must be TRUE):

  1. Pending batches appear in the admin batch list (no longer hidden), and the status filter/dropdown includes a "Pending" option that shows only pending batches
  2. A pending batch row/detail shows an "Activate" action that, in one click, flips the batch to Primary with the fermentation start date set to today
  3. A "Schedule & activate" option lets staff pick a fermentation schedule template, start date, and vessel/location, then promotes the batch to Primary in a single confirmed step
  4. After either activation path, the batch immediately reflects Primary status and the chosen start date in the list and detail views without a manual page reload

**Plans**: 4 plans (3 executed + 1 gap closure)
Plans:
**Wave 1**

- [x] 27-01-PLAN.md Ã¢ÂÂ Surface pending batches: widen active filter, Pending dropdown option, distinct badge, pin-to-top (BATCH-01)

**Wave 2**

- [x] 27-02-PLAN.md Ã¢ÂÂ One-click Activate (inline + detail modal) with no-schedule confirm, flip to Primary start=today, live refresh (BATCH-02)

**Wave 3**

- [x] 27-03-PLAN.md Ã¢ÂÂ Guided Schedule & Activate modal + backend chosen-start-date fix; single-step promote with generated tasks (BATCH-03)

**Gap Closure**

- [x] 27-04-PLAN.md Ã¢ÂÂ Close WR-01 (one-click activate start_date=today) + CR-01 (guided step1Done partial-failure routing); rebuild min + tests (BATCH-02, BATCH-03)

**UI hint**: yes

### Phase 27.1: Pending batch deletion Ã¢ÂÂ delete pending batches from BrewPad with a confirmation step, removing the row via Apps Script instead of manual Google Sheet edits (INSERTED)

**Goal:** Staff can delete pending (duplicate) batches inline from the admin Batches list and the BrewPad "Needs Scheduling" dashboard rows, each behind a confirmation that names the batch (ID + product + customer), removing the row via the existing Apps Script `delete_batch` action instead of editing the Google Sheet by hand. Frontend-only (backend `deleteBatch()` unchanged); UI-gated to pending rows.
**Requirements**: none (driven by CONTEXT decisions D-01..D-12)
**Depends on:** Phase 27
**Plans:** 2/2 plans complete

Plans:

- [x] 27.1-01-PLAN.md Ã¢ÂÂ Inline Delete on admin Batches pending rows (showConfirm + delete_batch + list/dashboard refresh)
- [x] 27.1-02-PLAN.md Ã¢ÂÂ Inline Delete on BrewPad "Needs Scheduling" rows (showConfirmSheet danger + delete_batch + dashboard refresh; batch-list cards stay delete-free)

**Cross-cutting constraints:**

- D-08: The confirm copy warns generically that any attached tasks/readings/history will be removed
- D-10: The confirm copy frames deletion as irreversible (\"This cannot be undone.\") with no nightly-backup/recovery mention
- D-06: Backend deleteBatch() stays unchanged Ã¢ÂÂ delete_batch is called with only { batch_id }, no status guard or force flag

### Phase 28: Zoho Customer Read-Back Path

**Goal**: BrewPad can read customer details back from Zoho for a linked sales order/invoice and persist the refreshed fields onto the batch record Ã¢ÂÂ the net-new read path behind the refresh feature (today Zoho sync is write-only)
**Depends on**: Nothing new (extends existing `zoho-middleware` Zoho integration and `adminApi.gs`)
**Requirements**: (foundation for ZSYNC-01, ZSYNC-02 Ã¢ÂÂ no requirement closes here on its own)
**Success Criteria** (what must be TRUE):

  1. A new middleware endpoint, given a Zoho sales-order/invoice number, returns the linked customer's name, email, and contact details (and a clear not-found/no-link response when the SO cannot be resolved)
  2. The endpoint is covered by middleware unit tests for the success, not-found, and Zoho-error paths and passes with lint clean
  3. Apps Script (`adminApi.gs`) exposes an update path that writes refreshed customer name/email/contact back onto an existing batch record by batch ID, leaving other batch fields untouched
  4. Calling the read endpoint and then the Apps Script update for a known linked batch results in the batch record showing the current Zoho customer details (verified on staging)

**Plans**: 2 plans (2 waves)
Plans:
**Wave 1**

- [x] 28-01-PLAN.md Ã¢ÂÂ Middleware GET /api/batch/customer-by-number (invoice/SO Ã¢ÂÂ customer name/email/phone) + Jest tests (success, not-found, Zoho-error, partial, validation, auth) + lint clean

**Wave 2**

- [x] 28-02-PLAN.md Ã¢ÂÂ Extend adminApi.gs updateBatch allowedFields with customer_email/customer_phone; deploy Apps Script; manual staging readÃ¢ÂÂwrite loop verification

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

- [x] 29-01-PLAN.md â BrewPad detail pane: Refresh-from-Zoho button, Email/Phone rows, refresh handler
- [x] 29-02-PLAN.md â Admin Batches modal: Zoho Ref row + Refresh button, Email/Phone rows, refresh handler

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 29-03-PLAN.md â Build, full test+lint gate, staging iPad Safari UAT, REQUIREMENTS traceability

**Gap closure** *(verification found 2 Critical + 3 Warning defects â gaps_found)*

- [x] 29-04-PLAN.md â CR-01: align case contract (middleware case-normalization + frontend 400 handling + tests)
- [x] 29-05-PLAN.md â CR-02/WR-01/WR-03/WR-04: visible name refresh (firstname/lastname split), conflict detection, entity rendering, trim parity
- [x] 29-06-PLAN.md â Rebuild artifacts, full frontend+middleware+lint gate, staging iPad Safari re-verify

**Cross-cutting constraints:**

- D-10, D-11: Refresh outcomes surface as distinct toasts per endpoint state (success / no-change / partial / not-found / zoho-error); voided or deleted documents warn but still apply

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

### Phase 29.4: Wine drill-down analytics on BrewPad dashboard â wine-specific category breakdown splitting wine batches by a selectable dimension (subcategory, brand, manufacturer, or kit time e.g. 4-week/5-week). Builds on the Phase 29.3 Batches-by-Month type-breakdown chart. New data source in BrewPad: load product catalog (cheapest: static /content/zoho-snapshot.json â carries sku, subcategory, brand, manufacturer, time per wine kit) and join batch.product_sku -> catalog sku to derive the split attribute (batches store only product_sku/product_name today). Dynamic categories (brand/manufacturer are open sets -> top-N + 'Other' grouping with dynamic colors) + a dimension selector. Frontend-only: js/brewpad.js + tests. Depends on Phase 29.3. (INSERTED)

**Goal:** Staff can split wine batches on the BrewPad dashboard by a selectable dimension (subcategory, brand, manufacturer, or kit time) via a new "Wine Breakdown" card that joins batches to the catalog snapshot.
**Requirements**: none (driven by CONTEXT decisions D-01..D-12)
**Depends on:** Phase 29
**Plans:** 2/2 plans complete

Plans:
- [x] 29.4-01-PLAN.md â Pure helper/data layer: buildSkuLookup, normalizeWineTime, bucketWineDimension, applyTopN + Jest suite
- [x] 29.4-02-PLAN.md â Render/interaction layer: Wine Breakdown card, segmented selector, snapshot lazy-fetch, handlers, build

### Phase 29.3: Pull non-kiosk batch sales into BrewPad â bulk-scan recent Zoho invoices for ferment-in-store sales (Makers Fee present) that have no batch yet and create pending batches; dedupe by zoho_so_number, skip already-batched invoices via cf_batch_status, bounded scan window to respect Zoho rate limits. Touches zoho-middleware scan endpoint + per-invoice detail fetch, apps-script adminApi.gs create_batch dedup, js/brewpad.js Pull-from-Zoho control + confirm + list refresh. (INSERTED)

**Goal:** Staff can pull ferment-in-store sales invoiced directly in Zoho Books into BrewPad as pending batches â a confirm-gated "Pull from Zoho" control bulk-scans a bounded window of recent invoices (Maker's Fee present, no batch yet), plus a single-invoice import path, deduped by zoho_so_number in both the middleware pre-check and an Apps Script idempotency guard.
**Requirements**: none mapped (decisions D-01..D-10 in 29.3-CONTEXT.md)
**Depends on:** Phase 29
**Plans:** 3/3 plans complete

Plans:
- [x] 29.3-01-PLAN.md â Middleware scan + bulk-create endpoints (GET /api/batch/scan-invoices, POST /api/batch/bulk-create) with Jest tests [wave 1]
- [x] 29.3-02-PLAN.md â Apps Script createBatch zoho_so_number idempotency guard (D-10) [wave 1]
- [x] 29.3-03-PLAN.md â BrewPad "Pull from Zoho" control + confirm sheet + single-import + list refresh [wave 2]

### Phase 29.2: BrewPad pending batch activation â one-click Activate and guided Schedule & Activate for pending batches in BrewPad (Needs Scheduling rows + batch detail pane), reusing Phase 27 admin backend; make detail status badge pending-aware so pending batches route through activation instead of silently cycling to Primary. Frontend-only: js/brewpad.js + tests. (INSERTED)

**Goal:** Staff can activate a pending batch from BrewPad â one-click Activate or guided Schedule & Activate â from the Needs Scheduling rows and the batch detail pane, and the detail status badge routes pending batches through activation instead of silently promoting them to Primary.
**Requirements**: none mapped
**Depends on:** Phase 29
**Plans:** 5/5 plans complete

Plans:
- [x] 29.2-01-PLAN.md â Test scaffold + todayPacific() helper + status badge pending guard (bug fix, regression test first)
- [x] 29.2-02-PLAN.md â Needs Scheduling rows: Activate + Schedule & Activate buttons and one-click delegation
- [x] 29.2-03-PLAN.md â Guided Schedule & Activate bottom sheet + detail pane pending action buttons
- [x] 29.2-04-PLAN.md â Gap closure: fix detail-pane Activate re-render (CR-01 blocker, renderBatchDetail data wrapper)
- [x] 29.2-05-PLAN.md â Gap closure: emit last_updated in needsScheduling summary to re-enable optimistic lock (CR-02) + Apps Script redeploy

### Phase 29.1: Batch customer reassignment â change the customer tied to a batch (e.g. WALK-IN placeholder) and propagate the change to the linked Zoho sales order/invoice (INSERTED)

**Goal:** Staff can reassign the customer on a batch from the BrewPad detail pane (search existing Zoho customer or add one inline) and push that change to the linked Zoho SO/invoice; the batch is the source of truth and survives a Zoho rejection with a clear warning.
**Requirements**: none mapped (inserted phase)
**Depends on:** Phase 29
**Plans:** 2/2 plans complete

Plans:

- [x] 29.1-01-PLAN.md â Middleware: contact-search + batch-first reassign endpoint (Zoho push optional, no rollback on Zoho failure)
- [x] 29.1-02-PLAN.md â BrewPad UI: Change Customer control with search/add-new, confirm-gated Zoho push, in-place patch + warning toast

### Phase 26: Cloudflare Edge Protection Ã¢ÂÂ COMPLETE (2026-06-06)

**Outcome:** Cloudflare free tier is live in front of production (`steinsandvines.ca`) Ã¢ÂÂ proxied with SSL Full, Bot Fight Mode + a rate-limit rule active, email auth (SPF/DKIM/DMARC) hardened, staging kept grey-clouded. Executed live without a formal PLAN; see `26-SUMMARY.md` and `DNS-INVENTORY.md`. Follow-up (deferred): protect the Railway API via `api.steinsandvines.ca` if analytics show bots hitting it.

**Goal:** Cloudflare's free tier sits in front of `steinsandvines.ca` (GitHub Pages) and the Railway middleware API, absorbing/filtering the increasing bot traffic Ã¢ÂÂ without breaking the existing GitHub Pages custom-domain setup, `enforce-cname.yml`, Helcim payments, or Cal.com/Zoho integrations.

**Motivation:** Increasing bot traffic hitting the site (and likely the middleware). Cloudflare free tier gives CDN caching, Bot Fight Mode, basic WAF, and rate limiting at no cost.

**Depends on:** Phase 25 (sequential; no hard technical dependency)

**Scope (to refine in discuss):**

  - DNS migration: move `steinsandvines.ca` nameservers to Cloudflare; recreate existing records (Pages A records, staging CNAME, Railway/api, MX/email, any TXT/verification)
  - Proxy (orange-cloud) the apex + www through Cloudflare with SSL mode set correctly for GitHub Pages custom domains (Full, not Flexible Ã¢ÂÂ avoid redirect loops)
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

### Phase 30: Assessment quick wins Ã¢ÂÂ small high-impact fixes from PROJECT_ASSESSMENT.md

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
