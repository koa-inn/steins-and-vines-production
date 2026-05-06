# Phase 11: Producer & Brand Visibility - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Kit product cards and all product name displays show the producer (Zoho Manufacturer field) and brand in a consistent format, so customers can distinguish kits from multiple producers (e.g. RJS Craft Winemaking, Winexpert, Mangrove Jack's).

**What this phase delivers:**
- Middleware pipes `manufacturer_name` from Zoho item detail through catalog enrichment and returns it in the product API response
- All kit card types (wine label, beer label, default) display a new producer line above the existing brand element
- Checkout review table, cart sidebar, kiosk cards, and admin views show producer context in an inline format
- New producer filter dropdown on the catalog page alongside existing brand filter
- Graceful fallback when manufacturer data is missing

**What this phase does NOT touch:**
- Ingredient/supply cards (kit-only)
- Zoho data entry (managed in Zoho directly)
- Product name changes in Zoho (display-only enhancement)
- New card layouts or redesigns — adds to existing card structures

</domain>

<decisions>
## Implementation Decisions

### Display Format
- **D-01:** Producer appears as a new line above the existing brand element on all card types (wine label, beer label, default product card). Visual hierarchy: producer (context) → brand (identity) → product name (what you're buying).
- **D-02:** Producer line uses smaller font size and lighter/muted color compared to brand — establishes clear visual hierarchy, mirrors how wine bottles show vineyard above label name.
- **D-03:** On product cards (homepage featured + catalog), producer is a separate DOM element above brand. In compact views (checkout table, cart sidebar, kiosk list), producer is shown inline as "Producer — Name" format.
- **D-04:** Kit-only — producer does not show on ingredient/supply cards. Ingredients have a different buying pattern where customers care about type, not manufacturer.

### Manufacturer Data Source
- **D-05:** Source is the standard Zoho Inventory `manufacturer_name` field from the item detail API. Not a custom field.
- **D-06:** Follows the exact same enrichment pattern as `brand` — add `manufacturer: detail.manufacturer_name || ''` in all 3 enrichment paths in catalog.js, and `manufacturer: z.manufacturer_name || ''` in `shapeProduct()`.
- **D-07:** Data is mostly populated in Zoho but some gaps exist. Feature ships with fallback handling rather than requiring a data cleanup prerequisite.

### Surfaces (All)
- **D-08:** Producer shows on ALL surfaces: homepage featured cards, catalog kit cards, checkout review table, cart sidebar, kiosk product cards, and admin kit inventory views.
- **D-09:** Add a new Producer filter dropdown on the catalog page alongside the existing Brand filter. Same pattern as the brand filter (populated from distinct manufacturer values in the catalog).
- **D-10:** No admin panel indicator for missing manufacturer data — data completeness managed in Zoho directly.

### Fallback Behavior
- **D-11:** When manufacturer is blank, hide the producer line entirely. Card looks exactly like today. Brand still shows if it exists.
- **D-12:** Graceful degradation in inline format — if no manufacturer, show just name (or brand + name) without the "Producer —" prefix. No empty prefix or separator rendered.

### Claude's Discretion
- Inline separator choice (em dash, pipe, or other) — pick what matches the site's existing typography
- Exact CSS for producer line (font-size, color, letter-spacing) — match existing label card design language
- Whether producer line appears above or below the ornament/gold-rule decorative element on label cards
- Producer filter position relative to existing filters on the catalog page
- Test file organization (new file vs extending existing)
- How kiosk grid vs list views handle the producer display differently

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Middleware catalog enrichment (where manufacturer gets added)
- `zoho-middleware/routes/catalog.js` — `shapeProduct()` at line 810 maps API fields to frontend. Three enrichment paths at lines 172-176 (products), 538-543 (ingredients), and 720 (kiosk). Add `manufacturer` alongside existing `brand` enrichment.
- `zoho-middleware/lib/zoho-api.js` — `fetchItemDetailsBulk()` at line 274 fetches item details. Returns full Zoho item objects including `manufacturer_name`.

### Frontend product cards (where producer line gets added)
- `js/modules/06-featured.js` — Homepage featured cards. `buildFeaturedWineCard()` at line 557, `buildFeaturedBeerCard()` at line 630, `buildFeaturedDefaultCard()` at line 708. Each has a `brand` element to add producer above.
- `js/modules/07-catalog-kits.js` — Catalog page kit cards. Wine label at line 684, beer label at line 778, default card at line 876. Brand filter at line 176 — model for new producer filter. Sort options at line 526.
- `js/modules/08-catalog-ingredients.js` — Ingredients cards at line 592. NOT in scope (kit-only) but good to know the boundary.

### Checkout and cart (inline producer display)
- `js/modules/12-checkout.js` — Checkout review table. `hasBrand` conditional column at line 566. Brand column rendered at line 630. Pattern for adding producer inline.

### Kiosk (inline producer display)
- `js/kiosk.js` — Kiosk product grid card at line 1176 (`.kiosk-product-name`), list view at line 1225 (`.kiosk-list-name`), cart line at line 1587 (`.kiosk-cart-line-name`).

### Admin (producer in kit inventory)
- `js/admin.js` — Kit inventory table. Brand column at line 2291. Brand filter at line 2202. Kit detail display at line 2387.

### Styles
- `css/styles.css` — Label card styles (`.label-wine`, `.label-beer`, `.brand`, `.wine-name`, `.beer-name`). New `.producer` class goes here.

### Requirements
- `.planning/REQUIREMENTS.md` — PROD-VIS-01, PROD-VIS-02, PROD-VIS-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `brand` enrichment already flows through all 3 catalog enrichment paths — `manufacturer` follows identical pattern
- Label card DOM structure (brand → ornament → name) is consistent across wine/beer cards in both `06-featured.js` and `07-catalog-kits.js` — producer line slots in above brand
- Catalog filter system (`buildFilterRow`, `activeFilters`, sort options) is fully established — producer filter is a copy of brand filter logic
- Checkout review table conditionally shows brand column — same conditional pattern for producer

### Established Patterns
- `shapeProduct()` in catalog.js is the single mapping point for all API fields → frontend shape
- Product key is `name + '|' + brand` — no change needed (producer is display-only, not part of the key)
- Card builder functions follow a consistent pattern: create element, set className, set textContent, appendChild
- `getTintClass()`, `buildLabelNotesToggle()`, `buildLabelPriceFooter()` are shared helpers at top-level scope

### Integration Points
- `shapeProduct()` in catalog.js — add manufacturer field
- 3 enrichment loops in catalog.js — add manufacturer from detail
- 6 card builder functions (3 in featured, 3 in catalog-kits) — add producer element
- Checkout review table — add producer inline to name or as separate column
- Kiosk card/list render functions — add producer inline to name
- Admin kit inventory table — add producer column
- Catalog filter bar — add producer filter dropdown
- CSS — add `.producer` class for the new element

</code_context>

<specifics>
## Specific Ideas

- The visual hierarchy mirrors how wine bottles show vineyard above label name — producer is the "who made it" context, brand is the product line identity, name is the specific product
- Three-tier display: producer (small, muted) → brand (normal) → product name (prominent)
- Inline format for compact views avoids vertical space bloat in tables and cart sidebar
- Producer filter complements the existing brand filter — customers can narrow by "show me all RJS kits" or "show me all Winexpert kits"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-producer-brand-visibility*
*Context gathered: 2026-05-06*
