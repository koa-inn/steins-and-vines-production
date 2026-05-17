# Requirements: Steins & Vines — Recipe-Based Products

**Defined:** 2026-05-09
**Core Value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.

## v2.0 Requirements

Requirements for recipe-based product system. Each maps to roadmap phases.

### Recipe Data Model

- [x] **RDM-01**: Staff can define a recipe as a named collection of Zoho ingredient SKUs with quantities, a locked price, and a brewing fee
- [x] **RDM-02**: Recipe schema stores style metadata (ABV, IBU, colour, batch size) for display purposes
- [x] **RDM-03**: Each batch created from a recipe sale stores a full ingredient snapshot at time of sale (immune to future recipe edits)
- [x] **RDM-04**: Recipe sales are gated behind a `BEER_SALES_ENABLED` env var that defaults to false
- [x] **RDM-05**: The existing Maker's Fee (`MAKERS_FEE_ITEM_ID`) and Materials Fee (`MATERIALS_FEE_ITEM_ID`) Zoho service items are confirmed set in Railway and reused for recipe sales (per D-03 — no separate Brewing Fee item needed)

### Middleware Recipe API

- [x] **API-01**: Middleware exposes GET/POST/PUT/DELETE endpoints for recipe CRUD with Redis caching
- [x] **API-02**: Recipe API resolves ingredient references to Zoho item IDs server-side (never trusts client)
- [x] **API-03**: Recipe availability endpoint checks all ingredient stock levels against recipe quantities

### Admin Recipe Management

- [ ] **ADM-01**: Admin panel has a "Recipes" tab where staff can list, create, edit, and activate/deactivate recipes
- [ ] **ADM-02**: Recipe editor allows adding/removing ingredient line items with Zoho SKU lookup and quantity input
- [ ] **ADM-03**: Staff can set a locked price and brewing fee per recipe independently

### BeerXML Import

- [x] **IMP-01**: Staff can upload a BeerXML file (.xml) from any brewing software (BeerSmith, Brewfather, Brewtarget, etc.)
- [x] **IMP-02**: Parser extracts fermentables, hops, yeast, and misc ingredients with correct units (kg, using AMOUNT not DISPLAY_AMOUNT)
- [x] **IMP-03**: Staff review an ingredient-to-Zoho-SKU mapping table before saving, with manual match/correction per ingredient
- [x] **IMP-04**: Imported recipe saves as draft status until staff sets a price and activates it

### Kiosk Recipe Sales

- [x] **KSK-01**: Kiosk has a recipe browser tab where staff can browse and select active recipes
- [x] **KSK-02**: Selecting a recipe auto-populates the kiosk cart with all ingredient line items plus the brewing fee
- [x] **KSK-03**: Recipe sale processes through existing Helcim terminal flow and creates a Zoho invoice with per-ingredient line items
- [x] **KSK-04**: Kiosk recipe sale endpoint rejects requests when `BEER_SALES_ENABLED` is false

### Batch Integration

- [x] **BAT-01**: Recipe sale on kiosk auto-creates exactly one batch in BrewPad linked to the recipe and customer
- [x] **BAT-02**: Batch creation uses a separate code path from kit batch detection (not `detectKitItems`)
- [x] **BAT-03**: Auto-created recipe batch stores recipe_id, recipe_snapshot, and Zoho SO number

### Inventory Management

- [x] **INV-01**: Recipe sale deducts each ingredient individually from Zoho Inventory via invoice line items
- [x] **INV-02**: Pre-sale ingredient reservation via Redis prevents race conditions when multiple recipe sales share ingredients
- [x] **INV-03**: Failed or cancelled payment releases reserved ingredient quantities

## v2.1 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Public Site

- **PUB-01**: Public recipe browsing with recipe cards on products page
- **PUB-02**: "Reserve in store" CTA on recipe cards
- **PUB-03**: Custom recipe consultation request form

### Ad-hoc Recipes

- **ADH-01**: Staff ad-hoc recipe builder (live ingredient picker without pre-registered recipe)

### Batch Workflow Enhancements

- **BWF-01**: Batch completion triggers inventory adjustment in Zoho
- **BWF-02**: Automated notifications when batches need attention (overdue tasks, stale readings)
- **BWF-03**: Batch templates pre-populated from fermentation schedules

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Customer self-serve recipe builder | Consultation model is correct; customers need staff guidance |
| Dynamic pricing from live ingredient rates | Use locked_price; live summation creates price volatility and margin erosion |
| Zoho composite items for recipes | Wrong abstraction — requires separate assembly workflow incompatible with REST API |
| Online checkout for recipe products | Kiosk-only until federal brewing licence granted |
| Recipe versioning/changelog | Snapshot on batch is sufficient for v2.0; formal versioning deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RDM-01 | Phase 12 | Complete |
| RDM-02 | Phase 12 | Complete |
| RDM-03 | Phase 12 | Complete |
| RDM-04 | Phase 12 | Complete |
| RDM-05 | Phase 12 | Complete |
| API-01 | Phase 13 | Complete |
| API-02 | Phase 13 | Complete |
| API-03 | Phase 13 | Complete |
| ADM-01 | Phase 13 | Pending |
| ADM-02 | Phase 13 | Pending |
| ADM-03 | Phase 13 | Pending |
| IMP-01 | Phase 15 | Complete |
| IMP-02 | Phase 15 | Complete |
| IMP-03 | Phase 15 | Complete |
| IMP-04 | Phase 15 | Complete |
| KSK-01 | Phase 14 | Complete |
| KSK-02 | Phase 14 | Complete |
| KSK-03 | Phase 14 | Complete |
| KSK-04 | Phase 14 | Complete |
| BAT-01 | Phase 14 | Complete |
| BAT-02 | Phase 14 | Complete |
| BAT-03 | Phase 14 | Complete |
| INV-01 | Phase 14 | Complete |
| INV-02 | Phase 14 | Complete |
| INV-03 | Phase 14 | Complete |

**Coverage:**
- v2.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-05-09*
*Last updated: 2026-05-09 after roadmap creation (Phases 12-15), RDM-05 updated per D-03 decision*
