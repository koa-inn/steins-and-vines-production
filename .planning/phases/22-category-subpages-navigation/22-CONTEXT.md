# Phase 22: Category Subpages & Navigation - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Create 5 ingredient category subpages (Grains, Yeast, Additives, Packaging, Equipment) using the shared `16-catalog-subpage.js` template from Phase 21. Add a horizontal sub-nav bar to all ingredient pages (All, Hops, and the 5 new subpages) for quick category switching. Update the main site Products dropdown to include direct links to each category subpage. Move hops.html into the products/ subfolder for URL consistency.

This phase delivers the pages, navigation, and integration. Cross-category search is Phase 23; SEO meta is Phase 24.

</domain>

<decisions>
## Implementation Decisions

### Sub-nav Bar Design
- **D-01:** Pill tab style — horizontal row of rounded pill buttons (All | Hops | Grains | Yeast | Additives | Packaging | Equipment). Active tab gets a filled/accent background.
- **D-02:** Sticky below the site header when scrolling — the sub-nav remains visible at all times for quick category switching.
- **D-03:** Search icon placeholder at the right end of the sub-nav. Non-functional in this phase; Phase 23 wires it up to the cross-category search overlay. Adding it now avoids reworking the sub-nav later.
- **D-04:** Sub-nav appears on ALL 7 ingredient pages: All Ingredients, Hops, Grains, Yeast, Additives, Packaging, Equipment. Consistent navigation per requirement NAV-01.

### URL & Page Structure
- **D-05:** All 5 new subpages live in the `products/` subfolder: `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html`.
- **D-06:** hops.html moves from root to `products/hops.html`. No redirect at the old URL — just update all internal links. Accept that external links to /hops.html will 404 until re-indexed.
- **D-07:** The existing `products/ingredients-supplies.html` becomes the "All" tab page. It gets the sub-nav added and continues to show all ingredient categories in one grid.

### Products Dropdown
- **D-08:** Grouped with divider — current items (Ferment in Store, Custom Labels) as top group, then a visual divider, then ingredient categories: All Ingredients | Hops | Grains | Yeast | Additives | Packaging | Equipment.

### Existing Pages Impact
- **D-09:** Hops keeps its existing `15-hops.js` module (radar charts, comparison features don't fit the generic template). Only the file location changes and the sub-nav gets added.
- **D-10:** The ingredients-supplies.html page stays as-is for rendering (existing code) but gains the sub-nav bar. It serves as the "All" tab.

### Claude's Discretion
- Mobile sub-nav behavior (horizontal scroll vs. two-row wrap) — pick what works best
- SUBPAGE_CONFIG placement (inline in each HTML vs. shared config file) — pick cleanest approach
- Whether "Ingredients & Supplies" in the dropdown stays as a clickable link to All or becomes a non-clickable section header
- What happens to the ingredients tab on products.html (remove it, or keep as teaser with link to subpages)
- Sub-nav pill colors, spacing, and animation details
- Exact dropdown divider styling

### Reviewed Todos (not folded)
- "Add hop comparison mode" (`2026-05-20-hop-compare-mode.md`) — matched on "hops" keyword but this is a feature enhancement to the hops page, not related to category navigation. Belongs in a future phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shared Template Module (Phase 21 output — closest analog)
- `js/modules/16-catalog-subpage.js` — the shared subpage module. Read the `SUBPAGE_CONFIG` interface, `filterItemsByConfig()`, and `DOMContentLoaded` init block
- `css/catalog-subpage.css` — shared subpage styles (hero, grid, cards, expand panels)
- `test-subpage.html` — reference HTML structure showing how a subpage wires up to the module

### Existing Hops Page (moving to products/)
- `hops.html` — current hops page HTML structure (will be relocated)
- `js/modules/15-hops.js` — standalone hops module with radar charts (NOT being converted to shared template)
- `css/hops.css` — hops-specific styles

### Existing Ingredients Page (becomes "All" tab)
- `products/ingredients-supplies.html` — current "all ingredients" page that will gain the sub-nav
- `js/modules/08-catalog-ingredients.js` — current ingredients renderer (in concat bundle)

### Navigation
- `css/styles.css` — site-wide styles including `.nav-dropdown`, `.nav-dropdown-menu`, `.site-header`
- `js/modules/13-init.js` — DOMContentLoaded bootstrap, content loader, header behavior

### Data Pipeline (Phase 20)
- `zoho-middleware/routes/catalog.js` lines 520-590 — `/api/ingredients` endpoint
- Items have `cf_subcategory` and `cf_type` as category fields (Phase 20 tagged all items)

### Build Pipeline
- `package.json` — build scripts (stamp, minify, concat)
- `.planning/phases/21-shared-template-build-infrastructure/21-CONTEXT.md` — Phase 21 decisions on build integration

### Requirements
- `.planning/REQUIREMENTS.md` — CAT-01 through CAT-05, NAV-01 through NAV-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `16-catalog-subpage.js` — renders product grid, filters, sort, cart controls from a `SUBPAGE_CONFIG` object
- `filterItemsByConfig(items, config)` — filters by subcategories[] and types[] arrays
- `buildSortComparator(sortMode)` — 5 sort modes (name asc/desc, price asc/desc, stock-first)
- `buildFilterPills(containerId, config)` — optional sub-filter pills from `config.filterGroups`
- `applyHeroAccent(config)` — applies accent color from config to hero section
- `renderReserveControl(product)` — shared Add to Cart / quantity controls from `11-cart.js`
- `renderWeightControl(product)` — weight-based quantity input for kg/g items
- `formatCurrency()`, `escapeHTML()` — from `js/lib/utils.js`

### Established Patterns
- Standalone modules load AFTER `main.min.js` via `<script>` tag
- Each standalone module has its own `.min.js` and `.min.css` via build pipeline
- `_activeCartTab = 'ingredients'` set at module init for cart routing
- localStorage caching with `MW_CACHE_KEY` / `MW_CACHE_TS` / `MW_CACHE_TTL` pattern
- ES5 `var` style throughout — no let/const/arrow functions
- Products dropdown uses `.nav-dropdown` > `.nav-dropdown-menu` pattern in all HTML pages

### Integration Points
- Each subpage HTML needs: `<script>` block with `SUBPAGE_CONFIG`, then loads `16-catalog-subpage.min.js`
- Sub-nav HTML fragment needs to be added to 7 pages (All, Hops, 5 new subpages)
- Products dropdown HTML needs updating across all 12+ public pages
- `package.json` build scripts may need new entries if new standalone files are added
- `sitemap.xml` and `robots.txt` will be updated in Phase 24 (SEO)

</code_context>

<specifics>
## Specific Ideas

- Sub-nav search icon is a placeholder — renders but has no click handler until Phase 23
- Hops page keeps radar charts and comparison mode; only gains sub-nav and moves to products/
- The "All" page (ingredients-supplies.html) keeps existing rendering, just gets sub-nav injected
- Expanded card detail panel uses the Phase 21 full-width row pattern (not overlay like hops)

</specifics>

<deferred>
## Deferred Ideas

- Hop comparison mode feature enhancement (tracked as todo: `2026-05-20-hop-compare-mode.md`)
- Cross-category search overlay wiring to sub-nav search icon (Phase 23)
- Per-subpage SEO meta tags, canonical URLs, JSON-LD (Phase 24)

</deferred>

---

*Phase: 22-category-subpages-navigation*
*Context gathered: 2026-05-29*
