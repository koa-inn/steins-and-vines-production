# Phase 21: Shared Template & Build Infrastructure - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a single reusable JS module (`16-catalog-subpage.js`) and its CSS (`catalog-subpage.css`) that renders any ingredient category subpage — product grid with expandable detail cards, sort/filter controls, cart integration, and grid/list toggle — parameterized by a per-page `SUBPAGE_CONFIG` object. Integrate all new files into the build pipeline (minify, cache-bust stamps).

This phase delivers the template and build tooling. Actual category subpages (Grains, Yeast, etc.) and navigation are Phase 22.

</domain>

<decisions>
## Implementation Decisions

### Card Design & Layout
- **D-01:** Expandable detail cards — click to expand shows description, weight options, stock count. Not the radar-chart complexity of hops, but richer than plain product cards.
- **D-02:** Expanded card opens as a full-width detail row below the grid row. The original card position becomes a ghost/placeholder. Other cards remain visible and undisturbed. This avoids the hops page issue where expansion covers neighboring cards.
- **D-03:** Responsive CSS grid with `auto-fill`, min card width ~250px, max 4 columns. Naturally drops to 3/2/1 as viewport narrows. Standard responsive pattern already used on the site.
- **D-04:** List view uses compact table rows: Name | Price | Stock | Add to Cart. Dense and scannable, good for bulk ordering.

### Hero & Accent Colors
- **D-05:** Medium hero section (~150px) with category name, short visible description, and a "Read more" toggle that expands a longer SEO-friendly paragraph. Products visible immediately without scrolling.
- **D-06:** Colors derived from existing site palette (dark green / craft brewery aesthetic) but each category gets a unique undertone/accent color to give each page a distinct feel while maintaining brand consistency. Accent colors defined in `SUBPAGE_CONFIG`.

### Sort & Filter Controls
- **D-07:** Three sort options: Name (A-Z / Z-A), Price (low-high / high-low), In Stock first. Universal across all categories.
- **D-08:** Basic sub-filter pills where natural groupings exist in the data. The `SUBPAGE_CONFIG` can define optional `filterGroups` per category. Categories without meaningful sub-filters omit the pills entirely.

### Data Loading
- **D-09:** Single fetch from `/api/ingredients`, filter client-side by category values in `SUBPAGE_CONFIG`. Cache in localStorage (same pattern as hops page with `MW_CACHE_KEY` / `MW_CACHE_TTL`).

### Claude's Discretion
- Category-to-filter mapping logic: `SUBPAGE_CONFIG` defines which `cf_subcategory` values AND `cf_type` values to include per subpage (e.g., Grains page: `{subcategories: ['Grain']}`, Equipment page: `{subcategories: ['Equipment', 'Fermenter', 'Hose/Tubing'], types: ['Equipment']}`). Claude designs the exact data structure.
- Specific accent color hex values per category — within the site's green/brown/amber palette
- Build pipeline integration details (which npm scripts to add/modify)
- Out-of-stock indicator design (badge, opacity, label)
- Empty category message wording and layout

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Closest Analog (standalone module pattern)
- `js/modules/15-hops.js` lines 1-30 — standalone module header, shared globals list, cache key pattern
- `css/hops.css` — standalone CSS for a catalog page (hero, grid, cards, expand)
- `js/modules/14-labels.js` — another standalone module (different pattern: label cards)

### Current Ingredients Implementation
- `js/modules/08-catalog-ingredients.js` — current ingredients tab renderer (in concat bundle)
- `js/modules/05-catalog-view.js` — shared catalog view utilities (may have reusable bits)
- `js/modules/11-cart.js` — cart integration: `renderReserveControl`, `setReservationQty`, `getReservedQty`

### Data Pipeline (Phase 20 findings)
- `zoho-middleware/routes/catalog.js` lines 520-590 — `/api/ingredients` endpoint, enrichment, caching
- Items have `cf_subcategory` (for Ingredient-type items) and `cf_type` (Equipment, Packaging, Cleaning/Sanitization) as category fields

### Build Pipeline
- `package.json` build script — stamp + minify CSS + minify JS chain
- `js/modules/14-labels.min.js`, `js/modules/15-hops.min.js` — existing standalone minified outputs

### Requirements
- `.planning/REQUIREMENTS.md` — TPL-01 through TPL-04 and BUILD-01 are this phase's requirements

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `renderReserveControl(product)` — renders Add to Cart / quantity controls (shared global from `11-cart.js`)
- `renderWeightControl(product)` — weight-based quantity input for kg/g items
- `formatCurrency(amount)` — from `js/lib/utils.js`
- `escapeHTML(str)` — from `js/lib/utils.js`
- `equalizeCardHeights()` — from shared globals, normalizes card heights in a grid
- `Fuse` — Fuse.js v7.1.0 already vendored for search
- `trackEvent(type, data)` — from `js/modules/03-events.js`

### Established Patterns
- Standalone modules load AFTER `main.min.js` via `<script>` tag on their HTML page
- Each standalone module has its own `.min.js` via terser in the build script
- Each standalone module has its own CSS file with a `.min.css` via cleancss
- `_activeCartTab` must be set to `'ingredients'` at module init
- localStorage caching with `MW_CACHE_KEY` / `MW_CACHE_TS` / `MW_CACHE_TTL` pattern (see hops.js)
- ES5 `var` style throughout, no let/const/arrow functions

### Integration Points
- HTML subpages will include `<script src="js/modules/16-catalog-subpage.min.js">` after `main.min.js`
- CSS via `<link href="css/catalog-subpage.min.css">`
- Cart sidebar already handles ingredients via `_activeCartTab = 'ingredients'`
- Build pipeline needs new entries for minify + stamp

</code_context>

<specifics>
## Specific Ideas

- Expanded card detail panel should NOT cover other cards (unlike hops page) — lifts into its own full-width row with a ghost placeholder left behind
- Hero "Read more" toggle for SEO-rich expanded description — hidden by default, visible to crawlers
- Sub-filter pills are optional per category via `SUBPAGE_CONFIG.filterGroups` — not all categories need them
- Table-style list view is for customers who want to scan and bulk-order quickly

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-shared-template-build-infrastructure*
*Context gathered: 2026-05-28*
