# Steins & Vines — Recipe-Based Products

## What This Is

The Steins & Vines website and in-store system (steinsandvines.ca) serves a Squamish-based ferment-in-store business. Customers browse wine kits, beer recipes, and brewing ingredients online, purchase via kiosk or online checkout (Helcim), and staff manage batch fermentation through BrewPad. This milestone expands the product model from single-SKU wine kits to recipe-based products — collections of individual ingredients with service fees — to support beer and other fermented products.

## Core Value

**Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.**

## Current Milestone: v2.0 Recipe-Based Products

**Goal:** Customers can browse pre-made beer/ferment recipes or request custom recipes, with ingredient-level inventory tracking, competitive pricing, and seamless flow through kiosk sales, BrewPad batch tracking, and Zoho.

**Target features:**
- Recipe data model — recipes as collections of existing ingredient SKUs with quantities and a brewing/service fee
- BeerSmith import — import recipes from BeerXML format into the system
- Recipe management — staff can create, edit, and maintain core recipes via admin
- Public site browsing — customers see core recipes alongside wine kits, with a "build your own" option for custom consultations
- Kiosk recipe sales — select a recipe, ingredients auto-populate the cart, brewing fee added, sale processed
- Custom recipe support — staff can build ad-hoc recipes from available ingredients for one-off brews
- Ingredient-level inventory deduction — recipe sale deducts each ingredient from Zoho Inventory automatically
- BrewPad integration — batches linked to their recipe and individual ingredients
- Brewing fee structure — define fee model for beer (likely different from wine's $45+$5)

## Requirements

### Validated

- ✓ Dashboard with batch status overview and upcoming tasks — v1.1
- ✓ Batch list with sorting, filtering, and detail view — v1.1
- ✓ Plato reading entry and chart visualization — v1.1
- ✓ Task management with grouping and completion — v1.1
- ✓ Multi-batch measurement entry — v1.1
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

### Active

- [ ] Recipe data model with ingredient lists, quantities, and service fees
- [ ] BeerSmith/BeerXML recipe import
- [ ] Recipe CRUD for staff (admin interface)
- [ ] Pre-made recipes browsable on public site
- [ ] Custom recipe request flow for customers
- [ ] Kiosk recipe sale with ingredient auto-population
- [ ] Custom recipe builder for staff (ad-hoc ingredient selection)
- [ ] Ingredient-level inventory deduction on recipe sale
- [ ] BrewPad batches linked to recipe and individual ingredients
- [ ] Brewing fee structure for beer/fermented products

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
| Recipes as ingredient collections, not new SKUs | Ingredients already in Zoho; avoids duplicate inventory tracking | — Pending |
| BeerSmith as recipe design tool | Industry standard, BeerXML export is well-documented | — Pending |
| Kiosk-first for recipe sales | In-store consultation needed for custom recipes; online later | — Pending |

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
*Last updated: 2026-05-09 after milestone v2.0 initialization*
