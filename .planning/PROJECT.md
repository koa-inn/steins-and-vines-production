# Steins & Vines — Recipe-Based Products

## What This Is

The Steins & Vines website and in-store system (steinsandvines.ca) serves a Squamish-based ferment-in-store business. Customers browse wine kits, beer recipes, and brewing ingredients online, purchase via kiosk or online checkout (Helcim), and staff manage batch fermentation through BrewPad. This milestone expands the product model from single-SKU wine kits to recipe-based products — collections of individual ingredients with service fees — to support beer and other fermented products.

## Core Value

**Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.**

## Current Milestone: v4.3 Recipe Builder Refinement

**Goal:** Make recipes scalable and adjustable at the point of selection across admin, kiosk, and BrewPad — and make the recipe builder/manager available in BrewPad — without weakening the server-authoritative money path hardened in v4.2.

**Target features:**
- Group/sort recipe ingredients by `cf_type` (Grain/Hops/Yeast/Additive/…) in the recipe view, with server-side enrichment so all surfaces group consistently
- Batch-size scaling by **target volume (litres)**: linearly scale weight-based ingredients, round **up** discrete (pcs) items; price scaled quantities server-authoritatively
- Batch size selectable wherever a recipe is selected — admin, kiosk, BrewPad — with a consistent control
- Add/remove/substitute ingredients at selection time for a one-off modified sale/batch (saved recipe untouched), with an optional "save as new recipe"
- Surface the recipe builder/manager in BrewPad (browse/view/create/edit, reusing existing CRUD + activation guardrails)

**Key design decisions (from kickoff):**
- Locked-price recipes scale the **ingredient-cost portion proportionally** while **service/materials fees stay fixed**; dynamic recipes price from scaled ingredient costs
- Batch size is entered as a **target volume in litres**; scale factor = target ÷ recipe `batch_size_l`
- Scaling + substitution must flow through `pos-recipe.js` / `lib/pricing.js` server-authoritatively and be captured in the frozen `recipe_snapshot` + Zoho invoice line items
- Grouping dimension is `cf_type`; ingredient data enriched in the middleware

## Current State: v4.2 Payment Path Hardening & Deploy Safety — SHIPPED 2026-06-19

v4.2 is complete and live in production (Phases 31–33). Delivered: honest, executable test coverage of the money path (route-level `POST /api/checkout` supertests, Helcim client + webhook HMAC tests, `routes/**` coverage with per-file floors); fail-closed hardening (reCAPTCHA rejects unauthenticated checkout before charge, webhooks reject unsigned events, Redis-down replay/idempotency guard returns 409, `validateEnv.js` fixed to live Helcim/Cal.com vars); access control (API-key enforcement on PII GET routes incl. `/api/snapshot`, body-shape validation on item/tax mutations); and deploy safety (test-gated production deploys, `prod-YYYYMMDD-N` tags + rollback runbook, uptime monitoring on `/health`, fail-closed prod secrets). Final audit: 14/14 requirements, 18/18 integration seams, 4/4 flows — the one cross-phase blocker (Phase 32's `/api/snapshot` API-key vs Phase 33's nightly snapshot job) was fixed and verified live on 2026-06-19 (authenticated fetch + CNAME-safe prod cross-push).

**Next milestone:** TBD — candidates from `PROJECT_ASSESSMENT.md` "Future Requirements" (decompose `processCheckout()`, de-fork kiosk POS into `kiosk-core.js`, `window.SV` namespace, static product rendering + JSON-LD, image pipeline, accessible dialogs, docs refresh) and open product issues (About-page placeholder copy, hero value-prop, WCAG contrast). Run `/gsd-new-milestone` to scope.

<details>
<summary>v4.2 milestone goal (for reference)</summary>

**Goal:** Make the money path trustworthy — test the online checkout, close the fail-open security gaps, and stop unsafe/untested code from reaching production.

Source: `PROJECT_ASSESSMENT.md` (Week 1 + Weeks 2–4). Continued phase numbering from Phase 31.

</details>

<details>
<summary>v4.1 BrewPad Batch Lifecycle & Zoho Sync — SHIPPED 2026-06-17</summary>

v4.1 (Phases 27–30 + sub-phases): full pending-batch lifecycle in BrewPad (visibility, one-click + guided activation, deletion), bidirectional Zoho customer sync (read-back endpoint + refresh-from-Zoho button + reassignment with invoice propagation), bulk pull of non-kiosk batch sales, wine drill-down analytics, and assessment quick-wins (dead-code cleanup, repo hygiene, presentation/contrast/404 fixes, kiosk cart-leak fix, XSS hardening). Also: transactional email moved to Resend, beer waitlist migrated to MailerLite, bottling invites via Resend, and `REDIS_ENCRYPTION_KEY` hardening (#106 closed).

</details>

## Requirements

### Validated

- ✓ Dashboard with batch status overview and upcoming tasks — v1.1
- ✓ Batch list with sorting, filtering, and detail view — v1.1
- ✓ Plato reading entry and chart visualization — v1.1
- ✓ Task management with grouping and completion — v1.1
- ✓ Multi-batch measurement entry — v1.1
- ✓ Pending batches visible and activatable from the admin batch list — Phase 27
- ✓ Batch activation — quick flip to Primary plus guided schedule/start/vessel option — Phase 27
- ✓ Fermentation schedule templates — v1.1
- ✓ Batch QR codes and PDF label generation — v1.1
- ✓ Google OAuth staff authentication — v1.1
- ✓ Batch creation with product/customer search — v1.1
- ✓ Auth sessions that persist reliably without silent expiry — v1.1
- ✓ Form state protection — unsaved work survives auth refresh — v1.1
- ✓ No duplicate/stacked login prompts — v1.1
- ✓ Kit sale on kiosk auto-creates a batch in BrewPad — v1.1
- ✓ Batches linked to Zoho sales orders for audit trail — v1.1
- ✓ Batch lifecycle visible from sale through fermentation to completion — v1.1

- ✓ Recipe data model with ingredient lists, quantities, and service fees — v2.0
- ✓ BeerSmith/BeerXML recipe import — v2.0
- ✓ Recipe CRUD for staff (admin interface) — v2.0
- ✓ Kiosk recipe sale with ingredient auto-population — v2.0
- ✓ Ingredient-level inventory deduction on recipe sale — v2.0
- ✓ BrewPad batches linked to recipe and individual ingredients — v2.0
- ✓ Brewing fee structure for beer/fermented products — v2.0
- ✓ Custom labels page with canvas mockup tool — v2.0
- ✓ Hop inventory catalog with radar charts and cart integration — v2.0

- ✓ Catalog subpages — dedicated pages per ingredient category (Grains, Yeast, Additives, Packaging, Equipment) — v3.0
- ✓ Sub-nav bar for category switching across ingredient pages — v3.0
- ✓ Cross-category product search with inline overlay — v3.0
- ✓ Appointment booking on Cal.com Cloud behind unchanged /api/bookings* contract — v4.0
- ✓ Cloudflare edge protection in front of GitHub Pages + Railway middleware — Phase 26
- ✓ Delete pending batches from the UI with confirmation — Phase 27.1
- ✓ Refresh a batch's customer info from its linked Zoho sales order/invoice (ZSYNC-01/02) — Phase 29
- ✓ Reassign the customer on a batch and propagate to the linked Zoho sales order/invoice — Phase 29.1 (v4.1)
- ✓ Activate pending batches from BrewPad — one-click + guided schedule/start, pending-aware status badge — Phase 29.2 (v4.1)
- ✓ Honest, executable test coverage of the money path: route-level checkout supertests, Helcim HMAC webhook tests, honest coverage thresholds with per-file money-path floors (TEST-01/02/03) — Phase 31 (v4.2)
- ✓ Fail-closed hardening: reCAPTCHA rejects unauthenticated checkout before charge, webhooks reject unsigned events, Redis-down replay/idempotency guard returns 409, `validateEnv.js` validates live Helcim/Cal.com vars (HARDEN-01/02/03/04) — Phase 32 (v4.2)
- ✓ Access control: API-key enforcement on PII GET routes (incl. `/api/snapshot`) + body-shape validation on item/tax mutations (PII-01/02) — Phase 32 (v4.2)
- ✓ Deploy safety: test-gated production deploys, `prod-YYYYMMDD-N` tags + rollback runbook, CNAME-safe nightly snapshot to prod (DEPLOY-01/02/03) — Phase 33 (v4.2)
- ✓ Monitoring: uptime monitor on `/health` + required prod secrets fail closed when absent (MONITOR-01/02) — Phase 33 (v4.2)

### Active

- [ ] Pre-made recipes browsable on public site (deferred)
- [ ] Custom recipe request flow for customers (deferred)

### Out of Scope

- New batch management features (refunds, advanced analytics) — future milestone
- Online checkout for recipe products — kiosk-only initially
- Customer-facing recipe builder — customers consult with staff, not self-serve
- Brewpad redesign or new tabs beyond recipe integration
- Automated pricing from supplier costs — manual margin management for now

## Context

- Federal brewing licence pending — system being built ahead of time
- Two one-off brews completed so far, recipes designed in BeerSmith
- Wine kits are single-SKU products from Zoho Inventory; beer recipes are fundamentally different (ingredient collections)
- Ingredients already tracked individually in Zoho Inventory (sold separately in the ingredients tab)
- Current fee structure: $45 Maker's Fee + $5 Materials Fee (wine); beer fee TBD (more involved process)
- Competitive pricing benchmarked against Terminal City Brewing (Vancouver)
- Pricing model uncertain: flat fee vs. variable by recipe complexity — needs research
- BeerSmith exports BeerXML format which is well-documented and importable
- Existing product card system supports wine label, beer label, and default card types
- Google Sheets + Apps Script backend for batch data; Zoho for inventory/sales

## Constraints

- **Tech stack**: Vanilla JS (ES5 + `var`), no framework changes — match existing patterns
- **Auth**: Google OAuth via GSI library for staff interfaces
- **Backend**: Google Apps Script + Sheets for batch/recipe data — Zoho for inventory/sales
- **Deployment**: Changes go to staging first, production only after manual approval
- **iPad-first**: BrewPad and kiosk UIs must work well on iPad Safari
- **Licence timing**: Beer sales cannot go live until federal brewing licence is granted

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Google Sheets as batch backend | Already working, staff familiar, Apps Script API adequate | ✓ Good |
| Bridge kiosk→brewpad via middleware | Kiosk already talks to middleware; middleware can trigger batch creation | ✓ Good |
| Recipes as ingredient collections, not new SKUs | Ingredients already in Zoho; avoids duplicate inventory tracking | ✓ Good |
| BeerSmith as recipe design tool | Industry standard, BeerXML export is well-documented | ✓ Good |
| Kiosk-first for recipe sales | In-store consultation needed for custom recipes; online later | ✓ Good |
| Recipes in Google Sheets, not Zoho composite items | Zoho composite items don't auto-deduct via REST API invoice path | ✓ Good |
| locked_price set by staff, not computed from live rates | Avoids pricing drift from ingredient cost changes | ✓ Good |
| recipe_snapshot frozen at sale time | Immune to future recipe edits; batch always reflects what was sold | ✓ Good |
| Standalone JS modules for subpages (14-labels, 15-hops) | Not in concat:js; loaded independently per page | ✓ Good |
| Fail closed in production (reCAPTCHA, webhook secrets, Redis replay guard, validateEnv) | Money path must reject on missing config/infra, not silently proceed | ✓ Good (v4.2) |
| Test-gated production deploys via `gated-deploy.yml` | Failing frontend/middleware tests block the deploy; CNAME-safe + tagged | ✓ Good (v4.2) |
| Nightly snapshot pushes a snapshot-only commit on production's own `main` | gated-deploy force-pushes prod history; a plain cross-push can't FF and `--force` would clobber CNAME → 404 | ✓ Good (v4.2) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-19 — v4.2 Payment Path Hardening & Deploy Safety milestone shipped to production and archived (Phases 31–33). Audit 14/14 requirements; the DEPLOY-03/PII-01 cross-phase blocker was fixed and verified live (authenticated snapshot fetch + CNAME-safe prod cross-push). Next milestone TBD — run /gsd-new-milestone.*
