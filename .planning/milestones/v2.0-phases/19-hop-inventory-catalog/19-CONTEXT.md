# Phase 19: Hop Inventory Catalog - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Dedicated hop browsing page (hops.html) with product cards featuring inline accordion expand, 6-axis SVG radar charts for sensory attributes, size variant toggle for two SKUs per hop, Add to Cart integration via the ingredients cart, and full filtering/sorting. Hop data sourced from Zoho Inventory with custom fields for sensory scores.

</domain>

<decisions>
## Implementation Decisions

### Data Source & Attributes
- **D-01:** Hop data pulled from Zoho Inventory via middleware API (same pipeline as kits/ingredients)
- **D-02:** 6-axis radar chart: Citrus, Tropical, Floral, Spicy, Pine, Herbal — each scored 0–5 as Zoho custom fields
- **D-03:** Alpha acid % shown as text spec outside the radar chart (not a chart axis)
- **D-04:** Origin shown as text spec (country/region)
- **D-05:** Each hop has a brief notes field — origin story, history, or notoriety (Zoho description or custom field)
- **D-06:** Packaging SKUs excluded — only retail hop SKUs displayed

### Card Design & Expand
- **D-07:** Collapsed card shows: hop name, price, alpha acid %, and 2–3 top flavor note tags
- **D-08:** Expanded detail uses inline accordion (same pattern as wine label card notes toggle via `buildLabelNotesToggle` in `04-label-cards.js`)
- **D-09:** Expanded view contains: radar chart, origin, notes/history, size selector, and Add to Cart button
- **D-10:** Two size variants per hop (e.g. 1 oz / 4 oz) — both found in Zoho as separate SKUs
- **D-11:** Size selector rendered as toggle buttons on the expanded card (not dropdown). Price updates on toggle. One Add to Cart button.
- **D-12:** Reuse wine card expand/contract infrastructure to maintain site cohesion

### Radar Chart Rendering
- **D-13:** Render as inline SVG built in JS (no external library). Lightweight, scales perfectly, matches no-framework approach
- **D-14:** Brand green fill (semi-transparent `var(--color-green)`) with darker green stroke. All hops same color scheme
- **D-15:** 0–5 scale per axis, normalized consistently across all hops

### Page & Navigation
- **D-16:** Dedicated page: `hops.html` with its own CSS. Ingredients page keeps basic hop listings too (two paths to find hops)
- **D-17:** Linked from Products dropdown nav alongside Ferment in Store, Ingredients & Supplies, Custom Labels
- **D-18:** Full filtering like ingredients page — category filters (by primary flavor profile: citrus, floral, etc.), search box, sort options (alpha acid, name, price)
- **D-19:** Hops added to the ingredients cart (same `sv-cart-ingredients` storage key and checkout flow)

### Claude's Discretion
- Radar chart sizing and axis label positioning within the accordion expand area
- Grid vs list layout for the hop cards (recommend grid to match ingredients pattern)
- Specific filter categories (derive from the 6 radar axes — e.g. filter by dominant flavor)
- Mobile responsive breakpoints for the card grid and radar charts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Card Patterns
- `js/modules/04-label-cards.js` — Wine/beer label card rendering, `getTintClass`, `buildLabelNotesToggle` (reuse for hop accordion expand)
- `js/modules/08-catalog-ingredients.js` — Ingredient catalog: filters, search, sort, card rendering, Add to Cart with `_item_type: 'ingredient'`
- `js/modules/07-catalog-kits.js` — Kit catalog card rendering for `label-wine` / `label-beer` patterns

### Cart Integration
- `js/modules/11-cart.js` — `getCartKey()`, `setReservationQty()`, dual cart system (`sv-cart-ingredients` key)
- `js/lib/constants.js` — `CART_KEYS`, `ITEM_TYPES`

### Data Pipeline
- `zoho-middleware/` — Middleware API for Zoho Inventory product data. Check existing ingredient endpoint for custom field enrichment patterns

### Styling
- `css/styles.css` — Site-wide variables: `--color-green`, `--color-burgundy`, `--color-cream`, `--font-display`, `--font-body`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildLabelNotesToggle` in `04-label-cards.js`: Accordion expand/contract for wine cards — reuse for hop detail panels
- `08-catalog-ingredients.js` filter/search/sort infrastructure: Full filtering with `buildIngredientFilterRow`, text search with debounce, multi-field sort
- `getTintClass` in `04-label-cards.js`: Subcategory-based tint colors — could extend for hop flavor profiles
- `formatCurrency` in `js/lib/utils.js`: Shared price formatting

### Established Patterns
- All JS must be ES5 (var only, no arrow functions, no template literals)
- Products loaded from Zoho via middleware with CSV fallback
- Cards use `product-card` / `label-wine` / `label-beer` class patterns
- CJS export block at bottom of each module for testing
- `npm run build` concatenates numbered modules into `main.js`

### Integration Points
- Middleware needs to serve hop products with custom fields (sensory scores, alpha acid)
- Hop cards need to add items to the ingredients cart via existing `setReservationQty`
- Two SKUs per hop (size variants) need to be grouped client-side by a shared parent or name prefix
- New module would be `js/modules/15-hops.js` (or similar numbered slot)
- New stylesheet: `css/hops.css` with `hops.min.css` build target

</code_context>

<specifics>
## Specific Ideas

- Radar chart should feel similar to Beer Maverick's hop comparison tool (6-axis sensory spider chart)
- Hop notes field should capture origin story / history / notoriety — not just dry specs
- Size toggle buttons directly on the expanded card face (not a separate step or modal)
- The page should work as both a "browse and learn" experience AND a shopping tool

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-hop-inventory-catalog*
*Context gathered: 2026-05-18*
