# Phase 23: Cross-Category Search - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up the placeholder search icon on the ingredient sub-nav to open a cross-category search overlay. Users can search ALL ingredient categories from a single entry point, see results grouped by category, quick-add items to cart inline, or click through to the item's category subpage with its detail panel expanded.

This phase delivers the search module, overlay UI, Fuse.js integration, and inline cart controls. SEO meta for subpages is Phase 24.

</domain>

<decisions>
## Implementation Decisions

### Overlay Appearance
- **D-01:** Responsive overlay — dropdown panel on desktop (>=768px), full-screen overlay on mobile (<768px). Breakpoint matches existing `SUBPAGE_DESKTOP_BREAKPOINT`.
- **D-02:** Light semi-transparent backdrop behind the panel on both desktop and mobile. Dims the page content to draw focus to search results.
- **D-03:** Results grouped under bold category headers (Grains, Yeast, Additives, etc.) with match count per group. Categories sorted by number of matches descending.
- **D-04:** Search overlay available on ALL 7 ingredient pages (All, Hops, Grains, Yeast, Additives, Packaging, Equipment) — every `.subnav-search-btn` gets wired up.

### Result Display
- **D-05:** Each result row shows: product name, price with unit (e.g. $4.50/kg), and a small in-stock/out-of-stock badge.
- **D-06:** Dynamic per-category cap — when many categories match, show ~5 per group with a "View all X in [Category]" link. When only 1–2 categories match, show more (~10) per group. Prevents overwhelming results while maximizing usefulness for narrow queries.
- **D-07:** Out-of-stock items appear in results but dimmed (reduced opacity), no cart controls on those rows.
- **D-08:** Dual interaction per result row — clicking the item name navigates to the category subpage with `?item=SKU` (deep-link opens detail panel). A small cart/+ button on the right side does inline add-to-cart without leaving the overlay.

### Edge Cases
- **D-09:** No-results state: simple "No results found" message. No suggestions or category links.
- **D-10:** Minimum 2 characters before search fires (matches existing Fuse `minMatchCharLength`).

### Claude's Discretion
- Overlay open/close animation (slide, fade, or instant)
- ESC key and backdrop-click to close behavior
- Auto-focus behavior on the search input when overlay opens
- Search input placeholder text
- Exact styling of category group headers and result rows
- Whether "View all" link navigates to the category page or expands inline
- Cart button design (icon, size, hover state)
- How to handle weight-based items in inline cart (simplified +1 vs full weight input)
- Debounce timing for search input (existing pattern is 180ms)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Search Library
- `js/vendor/fuse.js` — Fuse.js v7.1.0 vendored library (already loaded on all subpages)

### Sub-nav Search Button (Phase 22 placeholder)
- `products/grains.html` lines 88-92 — `.subnav-search-btn` HTML structure (disabled placeholder, repeated on all 7 pages)
- `css/catalog-subpage.css` line 666 — `.subnav-search-btn` base styles

### Shared Subpage Module
- `js/modules/16-catalog-subpage.js` — Fuse init pattern (lines 216-222), `buildCartObject()`, `renderReserveControl()`, `renderWeightControl()` for inline cart
- `css/catalog-subpage.css` — subpage styles, product card patterns, sub-nav styles (line 596+)

### Hops Module (separate Fuse instance)
- `js/modules/15-hops.js` lines 319-326 — Hops-specific Fuse init (different keys: alpha_acid, origin, etc.)

### Deep-Link Handler
- `js/modules/02-utils.js` line 5 — `handleDeepLinkedItem()` function, reads `?item=SKU` param, opens detail panel

### Cart System
- `js/modules/11-cart.js` — `renderReserveControl()`, `getCartKey()`, `setReservationQty()`, cart event dispatching
- `js/lib/constants.js` — `CART_KEYS`, `ITEM_TYPES`

### Data Pipeline
- `zoho-middleware/routes/catalog.js` lines 520-590 — `/api/ingredients` endpoint (returns all ingredients with `cf_subcategory` field)

### Existing Per-Page Search
- `js/modules/16-catalog-subpage.js` lines 752-789 — per-page search input and Fuse filter in `renderCatalog()` (this is the in-page filter, NOT the cross-category overlay)

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-01, SRCH-02

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Fuse.js` v7.1.0 — already vendored and loaded; cross-category search needs a single Fuse instance over ALL ingredients (not per-page filtered set)
- `handleDeepLinkedItem()` — reads `?item=SKU` from URL, finds the card by `data-sku`, opens detail panel — works for navigation from search results
- `buildCartObject(item)` — transforms API item into cart-compatible object (already in `16-catalog-subpage.js`)
- `renderReserveControl(wrap, product, key)` — renders add-to-cart button/stepper (from `11-cart.js` via global scope)
- `formatCurrency()`, `escapeHTML()` — from `js/lib/utils.js`
- `getCachedMW()` / `setCachedMW()` — localStorage caching pattern for middleware data

### Established Patterns
- Standalone JS modules loaded AFTER `main.min.js` via `<script>` tag
- ES5 `var` style throughout — no let/const/arrow functions
- `_activeCartTab = 'ingredients'` for cart routing on ingredient pages
- 180ms debounce on search input in existing modules
- `SUBPAGE_DESKTOP_BREAKPOINT = 768` for responsive breakpoints

### Integration Points
- `.subnav-search-btn` on 7 pages needs: `disabled` removed, click handler added
- New standalone module (e.g. `17-search-overlay.js`) loaded on all 7 ingredient pages
- New CSS file (e.g. `search-overlay.css`) for overlay styles
- `package.json` build scripts need entries for new standalone files
- Fuse instance for cross-category search is SEPARATE from per-page Fuse (different data set — all items vs. filtered)

</code_context>

<specifics>
## Specific Ideas

- Desktop: dropdown panel anchored below sub-nav bar; Mobile: full-screen overlay with dark backdrop
- Category groups sorted by match count descending — most relevant category first
- Dynamic result cap scales inversely with number of matching categories
- Inline cart on result rows avoids forcing navigation for quick purchases
- Item name click still navigates to subpage (via existing `?item=SKU` deep-link) for users who want to browse

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-cross-category-search*
*Context gathered: 2026-05-30*
