# Steins & Vines — Recipe-Based Products

## What This Is

The Steins & Vines website and in-store system (steinsandvines.ca) serves a Squamish-based ferment-in-store business. Customers browse wine kits, beer recipes, and brewing ingredients online, purchase via kiosk or online checkout (Helcim), and staff manage batch fermentation through BrewPad. This milestone expands the product model from single-SKU wine kits to recipe-based products — collections of individual ingredients with service fees — to support beer and other fermented products.

## Core Value

**Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.**

## Current Milestone: v4.1 BrewPad Batch Lifecycle & Zoho Sync

**Goal:** Staff can activate pending batches and pull customer info back from Zoho onto BrewPad — closing the two gaps in the batch workflow.

**Target features:**
- Pending batches visible in the admin batch list with a new "Pending" status filter (today they only surface as a dashboard count)
- Batch activation: one-click "Activate" (quick flip to Primary, today's start date) as default, plus a "Schedule & activate" guided option (schedule template + start date + vessel)
- "Refresh from Zoho" button in the batch detail modal that re-reads the linked Zoho sales order/invoice and updates the batch's customer name/email/contact on the BrewPad display
- Read-back path from Zoho (middleware endpoint to fetch invoice/contact customer details by SO number) — today Zoho sync is write-only
- Scoped to batches that already carry a `zoho_so_number` (kiosk/online sales); manual SO-linking for unlinked batches deferred

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

### Active

- [ ] Refresh a batch's customer info from its linked Zoho sales order/invoice
- [ ] Delete pending batches from the UI with confirmation (Phase 27.1 — emerged during Phase 27 UAT)
- [ ] Reassign the customer on a batch and propagate to the linked Zoho invoice (Phase 29.1 — emerged during Phase 27 UAT)
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
*Last updated: 2026-06-12 after Phase 28 (Zoho customer read-back path — middleware customer-by-number endpoint + Apps Script customer_email/customer_phone write-back, read→write loop verified live; foundation for Phase 29 ZSYNC-01/02)*
