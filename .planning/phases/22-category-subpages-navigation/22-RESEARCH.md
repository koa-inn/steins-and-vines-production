# Phase 22: Category Subpages & Navigation — Research

**Researched:** 2026-05-29
**Domain:** Static HTML page generation, CSS sticky nav, site-wide dropdown navigation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sub-nav Bar Design**
- D-01: Pill tab style — horizontal row of rounded pill buttons (All | Hops | Grains | Yeast | Additives | Packaging | Equipment). Active tab gets a filled/accent background.
- D-02: Sticky below the site header when scrolling — the sub-nav remains visible at all times for quick category switching.
- D-03: Search icon placeholder at the right end of the sub-nav. Non-functional in this phase; Phase 23 wires it up. Adding it now avoids rework later.
- D-04: Sub-nav appears on ALL 7 ingredient pages: All Ingredients, Hops, Grains, Yeast, Additives, Packaging, Equipment.

**URL & Page Structure**
- D-05: All 5 new subpages live in `products/`: `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html`.
- D-06: hops.html moves from root to `products/hops.html`. No redirect at old URL — just update all internal links.
- D-07: `products/ingredients-supplies.html` becomes the "All" tab page — gets sub-nav added, keeps existing rendering.

**Products Dropdown**
- D-08: Grouped with divider — current items (Ferment in Store, Custom Labels) as top group, then a visual divider, then ingredient categories: All Ingredients | Hops | Grains | Yeast | Additives | Packaging | Equipment.

**Existing Pages Impact**
- D-09: Hops keeps its existing `15-hops.js` module (radar charts, comparison features). Only file location and sub-nav change.
- D-10: `ingredients-supplies.html` stays as-is for rendering but gains the sub-nav bar.

### Claude's Discretion
- Mobile sub-nav behavior (horizontal scroll vs. two-row wrap)
- SUBPAGE_CONFIG placement (inline in each HTML vs. shared config file)
- Whether "Ingredients & Supplies" in the dropdown stays as clickable link to All or becomes non-clickable section header
- What happens to the ingredients tab on products.html (remove or keep as teaser with link)
- Sub-nav pill colors, spacing, and animation details
- Exact dropdown divider styling

### Deferred Ideas (OUT OF SCOPE)
- Hop comparison mode feature enhancement (tracked todo: `2026-05-20-hop-compare-mode.md`)
- Cross-category search overlay wiring to sub-nav search icon (Phase 23)
- Per-subpage SEO meta tags, canonical URLs, JSON-LD (Phase 24)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAT-01 | Grains subpage shows items with subcategory Grain or Malt Extract, with weight-based cart controls where applicable | SUBPAGE_CONFIG with `subcategories: ['Grain', 'Malt Extract']`; `renderWeightControl` already called by `buildItemCard` when `hasWeightConfig(item)` is true |
| CAT-02 | Yeast subpage shows items with subcategory Yeast or Yeast Nutrient | SUBPAGE_CONFIG with `subcategories: ['Yeast', 'Yeast Nutrient']` |
| CAT-03 | Additives subpage shows items with subcategory Additive, Flavoring, Fruit, or Oak | SUBPAGE_CONFIG with `subcategories: ['Additive', 'Flavoring', 'Fruit', 'Oak']` |
| CAT-04 | Packaging subpage shows items with subcategory Bottle, Bag, or closures | SUBPAGE_CONFIG with `subcategories: ['Bottle', 'Bag', 'Closure']` [ASSUMED — exact Zoho cf_subcategory values for closures must be confirmed] |
| CAT-05 | Equipment subpage shows items with subcategory Fermenter, Hose/Tubing, or uncategorized | SUBPAGE_CONFIG with `subcategories: ['Fermenter', 'Hose/Tubing']` and `types: ['Equipment']` to catch uncategorized [ASSUMED — exact Zoho values] |
| NAV-01 | Horizontal sub-nav bar on every ingredient page | New `.ingredient-subnav` HTML fragment + CSS; static duplication across 7 pages (no SSI on GitHub Pages) |
| NAV-02 | Main site Products dropdown includes category sublinks | Update `.nav-dropdown-menu` in all 12 pages that have nav (9 public HTML files identified + 3 new subpages) |
| NAV-03 | Sub-nav highlights current category page | CSS-only: `body[data-page="grains"] [data-subnav="grains"]` selector approach; each page's `data-page` value drives the active state |
</phase_requirements>

---

## Summary

Phase 22 is a page-creation and navigation-wiring phase. The shared rendering engine (`16-catalog-subpage.js`) and CSS (`catalog-subpage.css`) were built in Phase 21 and are ready to consume. This phase creates 5 new HTML files following the pattern established by `test-subpage.html`, moves `hops.html` to `products/hops.html`, adds a sticky sub-nav bar to 7 ingredient pages, and updates the Products dropdown across all public pages.

The work is primarily mechanical HTML duplication with two non-trivial engineering problems: (1) a sticky sub-nav that must sit below the already-sticky site header without causing scroll-offset problems, and (2) a wider Products dropdown that must not break on mobile. The existing `--header-height` CSS variable (set dynamically by `13-init.js`) provides the exact hook needed for sub-nav `top` positioning.

The largest surface area is the nav dropdown update — 9 existing HTML files plus 6 new/moved HTML files all need the expanded dropdown. A systematic file-by-file approach is required; missing one page leaves a broken nav on that page.

**Primary recommendation:** Create the 5 new subpages using `test-subpage.html` as the literal template. Add the sub-nav HTML fragment immediately after the `<main id="main">` opening tag on all 7 ingredient pages. Implement active state with `body[data-page]` CSS selectors in `catalog-subpage.css`. Update `stamp:pages` in `package.json` to include all 6 new/moved pages. Update the nav dropdown in all 9 existing public pages plus the 6 new pages.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Category filtering | Browser / Client | — | `filterItemsByConfig()` runs client-side after fetching from middleware or snapshot |
| Product rendering | Browser / Client | — | `16-catalog-subpage.js` renders cards/table entirely in JS |
| Data fetching | Browser / Client → API | CDN / Static (snapshot fallback) | Fetch from `/api/ingredients`; fall back to `content/zoho-snapshot.json` |
| Cart controls | Browser / Client | — | `renderReserveControl` / `renderWeightControl` from `11-cart.js` already in `main.min.js` |
| Sub-nav active state | Browser / Client (CSS) | — | Pure CSS via `body[data-page]` attribute selector; no JS needed |
| Page structure / HTML | CDN / Static | — | GitHub Pages; all 7 ingredient pages are static HTML |
| Navigation dropdown | CDN / Static | — | Static HTML duplication across pages; no templating engine |

---

## Standard Stack

This phase introduces **no new libraries**. All dependencies are already in the codebase.

### Core (already present)
| Asset | Version | Purpose | Status |
|-------|---------|---------|--------|
| `js/modules/16-catalog-subpage.js` | Phase 21 | Shared subpage renderer | Built, minified, in build pipeline |
| `css/catalog-subpage.css` | Phase 21 | Shared subpage styles | Built, minified, in build pipeline |
| `js/modules/15-hops.js` | Phase 21 | Hops-specific renderer (radar charts) | Built, minified |
| `js/main.min.js` | Build artifact | All shared utilities including cart controls | Built |

### No new packages required

The build pipeline already handles `16-catalog-subpage.min.js` and `catalog-subpage.min.css` via `npm run minify:css` and `npm run minify:js`. [VERIFIED: package.json]

**Installation:** None required.

---

## Package Legitimacy Audit

No external packages are being added in this phase.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
User Request
      |
      v
GitHub Pages (static)
  products/grains.html
  products/yeast.html       <-- new pages (this phase)
  products/additives.html
  products/packaging.html
  products/equipment.html
  products/hops.html        <-- moved from /hops.html
  products/ingredients-supplies.html  <-- "All" tab, gains sub-nav
      |
      | loads
      v
js/main.min.js              <-- cart, utils, shared globals
      |
      | then loads
      v
js/modules/16-catalog-subpage.min.js   (for 5 new + grains replaces nothing)
  - reads window.SUBPAGE_CONFIG
  - fetches /api/ingredients (middleware) or /content/zoho-snapshot.json
  - filterItemsByConfig() -> renders cards with cart controls
      |
      | (hops.html only)
      v
js/modules/15-hops.js      <-- unchanged, just at new URL
      |
Sub-nav (on all 7 ingredient pages)
  - Static HTML fragment duplicated across pages
  - CSS active state via body[data-page] selector -> no JS
  - Sticky below .site-header using top: var(--header-height)
  - Search icon: rendered, no handler until Phase 23
      |
Nav Dropdown (all 15 pages = 9 existing + 6 new)
  - Expanded .nav-dropdown-menu with divider li + 7 category links
  - Path prefix varies: root pages use products/grains.html,
    products/ pages use grains.html (relative)
```

### Recommended Project Structure

```
products/
├── ferment-in-store.html    # existing, nav update only
├── ingredients-supplies.html # existing, gains sub-nav + nav update (currently empty — needs full build)
├── hops.html                # moved from /hops.html (gains sub-nav)
├── grains.html              # new (CAT-01)
├── yeast.html               # new (CAT-02)
├── additives.html           # new (CAT-03)
├── packaging.html           # new (CAT-04)
└── equipment.html           # new (CAT-05)

css/
└── catalog-subpage.css      # add .ingredient-subnav styles here

js/modules/
└── 16-catalog-subpage.js    # no changes needed
```

### Pattern 1: SUBPAGE_CONFIG inline script block

Each new subpage includes a `<script>` block before `main.min.js` that sets `window.SUBPAGE_CONFIG`. This is the established pattern from `test-subpage.html`. [VERIFIED: test-subpage.html, 16-catalog-subpage.js]

```html
<!-- Source: test-subpage.html pattern, 16-catalog-subpage.js DOMContentLoaded guard -->
<script>
window.SUBPAGE_CONFIG = {
  categorySlug: 'grains',
  categoryName: 'Grains',
  heroDescription: 'Base malts, specialty grains, and malt extracts for brewing.',
  heroDescriptionFull: 'Browse our selection of brewing grains...',
  accentColor: '#8b6f3a',
  subcategories: ['Grain', 'Malt Extract'],
  types: [],
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};
</script>
<script src="../js/sheets-config.js"></script>
<script src="../js/main.min.js?v=STAMP" defer></script>
<script src="../js/modules/16-catalog-subpage.min.js?v=STAMP" defer></script>
```

### Pattern 2: Sub-nav sticky positioning

The site header is already `position: sticky; top: 0; z-index: 200`. The sub-nav must sit below it. `13-init.js` sets `--header-height` dynamically via `ResizeObserver`/`resize` event. [VERIFIED: css/styles.css line 239, js/modules/13-init.js line 234]

```css
/* Source: css/catalog-subpage.css addition — .ingredient-subnav */
.ingredient-subnav {
  position: sticky;
  top: var(--header-height, 80px);
  z-index: 190; /* below header z-index:200, above page content */
  background: var(--color-cream);
  border-bottom: 1px solid rgba(74, 111, 75, 0.2);
  padding: 0.5rem 0;
}
```

### Pattern 3: CSS-only active state for sub-nav

The roadmap decision (STATE.md) specifies CSS-only active state via `body[data-page]` selector — no JS needed. Each page already sets `data-page` on `<body>`. [VERIFIED: STATE.md roadmap decision, test-subpage.html, hops.html]

```css
/* Source: STATE.md v3.0 Roadmap decision + body[data-page] pattern in styles.css */
/* In catalog-subpage.css */
.subnav-pill[data-subnav="all"]        { /* base styles */ }
.subnav-pill.active,
body[data-page="ingredients"] .subnav-pill[data-subnav="all"],
body[data-page="hops"]        .subnav-pill[data-subnav="hops"],
body[data-page="grains"]      .subnav-pill[data-subnav="grains"],
body[data-page="yeast"]       .subnav-pill[data-subnav="yeast"],
body[data-page="additives"]   .subnav-pill[data-subnav="additives"],
body[data-page="packaging"]   .subnav-pill[data-subnav="packaging"],
body[data-page="equipment"]   .subnav-pill[data-subnav="equipment"] {
  background: var(--color-green);
  color: var(--color-cream);
}
```

### Pattern 4: Nav dropdown with divider

The existing `.nav-dropdown-menu` uses `<li>` items with `<a>` links. A divider `<li>` with `role="separator"` and a CSS border-top rule is the clean HTML approach. [VERIFIED: styles.css nav-dropdown-menu rules, hops.html nav structure]

```html
<!-- Source: existing .nav-dropdown-menu pattern + ARIA separator role -->
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
  <li role="separator" class="nav-dropdown-divider"></li>
  <li><a href="products/ingredients-supplies.html">All Ingredients</a></li>
  <li><a href="products/hops.html">Hops</a></li>
  <li><a href="products/grains.html">Grains</a></li>
  <li><a href="products/yeast.html">Yeast</a></li>
  <li><a href="products/additives.html">Additives</a></li>
  <li><a href="products/packaging.html">Packaging</a></li>
  <li><a href="products/equipment.html">Equipment</a></li>
</ul>
```

Note: from `products/` subdirectory pages, paths are relative (e.g., `ferment-in-store.html`, not `products/ferment-in-store.html`). From root-level pages, paths include the `products/` prefix.

### Pattern 5: Path-prefix handling for moved hops.html

When `hops.html` moves to `products/hops.html`, all asset paths inside it must change from root-relative to one level up:
- `css/styles.min.css` → `../css/styles.min.css`
- `css/hops.min.css` → `../css/hops.min.css`
- `js/main.min.js` → `../js/main.min.js`
- `js/modules/15-hops.min.js` → `../js/modules/15-hops.min.js`
- `js/sheets-config.js` → `../js/sheets-config.js`
- `images/...` → `../images/...`
- Internal nav links (`about.html`) → `../about.html`

The `ingredients-supplies.html` link within `hops.html` nav is already `products/ingredients-supplies.html` (relative from root), so it becomes `ingredients-supplies.html` (sibling in `products/`). [VERIFIED: hops.html lines 66-250]

### Anti-Patterns to Avoid

- **Forgetting path prefix on moved hops.html:** Every asset and internal link uses a bare path from root. Moving the file breaks all of them unless updated to `../` prefix.
- **Hardcoding `top: 80px` for sub-nav sticky:** The header height is set dynamically. Use `var(--header-height, 80px)` — the fallback 80px covers the brief window before JS runs.
- **Using z-index >= 200 for sub-nav:** The site header is at z-index 200; the sub-nav must be lower (e.g., 190) or dropdown menus will overlap incorrectly.
- **Applying `scroll-padding-top` correction:** `html` already has `scroll-padding-top: calc(var(--header-height) + var(--tabs-height) + 1rem)`. With the sub-nav added, anchor scroll offsets may need updating. However, ingredient subpages don't use anchor navigation in this phase — flag for Phase 23.
- **Duplicating the wrong base template:** `ingredients.html` (root) is a redirect shim, not a real page. The actual ingredients content lives in the old `ingredients.html` (shown above, which IS `ingredients-supplies.html`'s intended content). `products/ingredients-supplies.html` is currently empty — it needs a full page build.
- **Missing `_activeCartTab = 'ingredients'`:** `16-catalog-subpage.js` sets this at module init. It must be the first action after the `SUBPAGE_CONFIG` guard. This is already implemented in Phase 21 — do not remove it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Category filtering | Custom filter logic | `filterItemsByConfig(items, SUBPAGE_CONFIG)` in `16-catalog-subpage.js` | Already handles subcategory + type matching, price > 0 guard |
| Weight-based qty inputs | Custom weight control | `renderWeightControl(wrap, cartObj, key)` from `11-cart.js` | Already wired to cart system, handles kg/g display |
| Add-to-cart buttons | Custom reserve UI | `renderReserveControl(wrap, cartObj, key)` from `11-cart.js` | Already handles qty state, refreshAllReserveControls() |
| Product card expand | Custom overlay/modal | `openDetailPanel()` / `toggleMobileAccordion()` in `16-catalog-subpage.js` | Already handles desktop full-width row + mobile accordion |
| Data fetching + caching | Custom fetch wrapper | `loadSubpageItems()` in `16-catalog-subpage.js` | Handles middleware + snapshot fallback + stale-while-revalidate |
| Search | Custom text search | Fuse.js (already vendored) via `_subpageFuse` | Already wired in `16-catalog-subpage.js` |

**Key insight:** `16-catalog-subpage.js` is a complete rendering engine parameterized by `SUBPAGE_CONFIG`. New pages need only the HTML scaffold + config object — the engine handles everything else.

---

## Runtime State Inventory

Not applicable. This is a greenfield page-creation phase. No stored data, live service config, OS-registered state, secrets, or build artifacts carry forward references to the new page URLs. The one near-miss:

- **sitemap.xml:** Contains `/hops` (old URL). Moving to `products/hops` should be reflected in the sitemap. However, Phase 24 owns SEO meta and sitemap updates. The planner should note this as a Phase 24 dependency, not a blocking item for Phase 22.
- **robots.txt:** No changes needed (all new pages are public, non-admin).

---

## Critical Finding: ingredients-supplies.html is Empty

`products/ingredients-supplies.html` currently has 0 bytes. It is an empty file. The actual "All Ingredients" content that was previously served from this URL lives in `ingredients.html` (root), which is now a redirect shim pointing to `products/ingredients-supplies.html`.

This means the planner must include building `products/ingredients-supplies.html` as a full HTML page — not just adding a sub-nav to an existing file. The content model should match the existing `ingredients.html` content (the full catalog page with tabs, controls, and cart drawer), adapted to the `products/` relative path and the new sub-nav.

Decision D-10 says "stays as-is for rendering" — but since the file is empty, "as-is" means replicating the content from `ingredients.html` with appropriate path adjustments.

---

## Common Pitfalls

### Pitfall 1: Relative Path Mismatch Across Subdirectory Levels
**What goes wrong:** Pages in `products/` use relative paths. A root page links to `products/grains.html`; a `products/` page links to `grains.html`. Using the wrong prefix silently creates a broken link.
**Why it happens:** GitHub Pages serves static files; there is no server-side path resolution. Relative paths are resolved from the HTML file's directory.
**How to avoid:** Systematically distinguish two cases: (A) pages at root level — prefix `products/` for all new subpages; (B) pages inside `products/` — use bare filenames for siblings, `../` for parent-level assets.
**Warning signs:** Navigation works on one page but 404s on another; CSS fails to load on subpages.

### Pitfall 2: Sub-nav Covers Page Content on Scroll
**What goes wrong:** Sticky sub-nav `top` is set to a fixed pixel value. When the header height changes (e.g., logo reflow, different viewport), the sub-nav overlaps the header or leaves a gap.
**Why it happens:** `--header-height` is set by JS on `DOMContentLoaded` and `resize`. During initial render there is a brief window where the variable may not be set.
**How to avoid:** Use `top: var(--header-height, 80px)` with a 80px fallback. The header height at desktop is approximately 96px (70px logo + 1rem padding top + 2px border + 1rem padding bottom). Test at multiple viewport sizes.
**Warning signs:** Content appears behind sub-nav after scroll; header partially hidden by sub-nav.

### Pitfall 3: Build Pipeline Not Updated for New Pages
**What goes wrong:** New HTML files are not included in `stamp:pages` in `package.json`. Running `npm run build` does not update cache-bust query strings on new pages, so browsers load stale JS/CSS after deployment.
**Why it happens:** `stamp:pages` has a hardcoded list of file paths. New pages must be added manually.
**How to avoid:** Update the `stamp:pages` script to include all 6 new/moved pages: `products/hops.html`, `products/grains.html`, `products/yeast.html`, `products/additives.html`, `products/packaging.html`, `products/equipment.html`. Remove old `hops.html` from the list.
**Warning signs:** Page loads old JS version in production; `?v=` query string is not updated on new pages.

### Pitfall 4: Dropdown Too Narrow for 7+ Items
**What goes wrong:** The existing `.nav-dropdown-menu` has `min-width: 180px`. With 9 items plus a divider, the menu becomes very tall and may clip on mobile or short viewports.
**Why it happens:** The dropdown uses `position: absolute` from the desktop nav. On mobile, it collapses to static layout (styles.css lines 494-513).
**How to avoid:** Adjust `min-width` to accommodate longer text (e.g., `min-width: 200px`) and verify mobile layout. On mobile the dropdown is already static so height is not an issue — but ensure items are touch-friendly (min-height 44px already enforced by existing mobile rule).
**Warning signs:** Dropdown items wrap awkwardly; dropdown extends below viewport on small screens.

### Pitfall 5: Zoho cf_subcategory Values Don't Match Config
**What goes wrong:** SUBPAGE_CONFIG subcategory arrays use assumed values (e.g., `'Closure'` for Packaging) that don't match what Zoho actually stores in `cf_subcategory`. The page renders empty.
**Why it happens:** Exact Zoho custom field values were established in Phase 20 but not documented in the research artifacts consumed by this phase.
**How to avoid:** Before writing final SUBPAGE_CONFIG values for CAT-04 and CAT-05, run `verify-subcategories.js` (Phase 20 script) against live data OR consult Phase 20 execution artifacts to confirm exact `cf_subcategory` string values.
**Warning signs:** Subpage loads but shows "No items currently available" even though inventory exists.

### Pitfall 6: Missing Cart FAB on New Subpages
**What goes wrong:** `hops.html` has a `.hops-cart-fab` floating action button handled by `15-hops.js`. The 5 new subpages use `16-catalog-subpage.js`, which renders a `.cart-drawer` but no FAB. Users on mobile may not realize there is a cart.
**Why it happens:** The FAB is hops-specific; the subpage module uses the standard cart drawer pattern (same as `test-subpage.html`).
**How to avoid:** The standard cart drawer pattern (`.cart-drawer`, `.cart-drawer-backdrop`, `#cart-drawer-close`) is the correct pattern for subpages. Verify that `11-cart.js` wires up the drawer correctly on these pages — it does, because `_activeCartTab = 'ingredients'` and the drawer is already in HTML.
**Warning signs:** No cart icon visible on mobile; cart drawer open button not present.

---

## Code Examples

### SUBPAGE_CONFIG for each category

```javascript
// Source: requirements CAT-01 through CAT-05 + Phase 20 subcategory rules
// (RULES order per STATE.md: Hops → Cleaning → Equipment → Yeast → Grain → Additive → Packaging)

// Grains (CAT-01)
window.SUBPAGE_CONFIG = {
  categorySlug: 'grains',
  categoryName: 'Grains',
  heroDescription: 'Base malts, specialty grains, and malt extracts for brewing.',
  accentColor: '#8b6f3a',
  subcategories: ['Grain', 'Malt Extract'],
  types: [],
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};

// Yeast (CAT-02)
window.SUBPAGE_CONFIG = {
  categorySlug: 'yeast',
  categoryName: 'Yeast',
  heroDescription: 'Ale, lager, wine, and cider yeasts for fermentation.',
  accentColor: '#c4a035',
  subcategories: ['Yeast', 'Yeast Nutrient'],  // [ASSUMED — verify exact Zoho values]
  types: [],
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};

// Additives (CAT-03)
window.SUBPAGE_CONFIG = {
  categorySlug: 'additives',
  categoryName: 'Additives',
  heroDescription: 'Finings, adjuncts, flavorings, and brewing chemicals.',
  accentColor: '#6b5a9e',
  subcategories: ['Additive', 'Flavoring', 'Fruit', 'Oak'],  // [ASSUMED — verify]
  types: [],
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};

// Packaging (CAT-04)
window.SUBPAGE_CONFIG = {
  categorySlug: 'packaging',
  categoryName: 'Packaging',
  heroDescription: 'Bottles, bags, closures, and packaging supplies.',
  accentColor: '#4a7fa8',
  subcategories: ['Bottle', 'Bag'],  // [ASSUMED — closures subcategory name unverified]
  types: ['Packaging'],              // [ASSUMED — cf_type fallback]
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};

// Equipment (CAT-05)
window.SUBPAGE_CONFIG = {
  categorySlug: 'equipment',
  categoryName: 'Equipment',
  heroDescription: 'Fermenters, tubing, and homebrewing equipment.',
  accentColor: '#5a7a6a',
  subcategories: ['Fermenter', 'Hose/Tubing'],  // [ASSUMED — verify]
  types: ['Equipment'],
  filterGroups: [],
  catalogContainerId: 'subpage-catalog'
};
```

### Sub-nav HTML fragment (duplicated across 7 pages)

```html
<!-- Source: D-01, D-02, D-03, D-04 decisions -->
<!-- Place immediately after <main id="main"> on all 7 ingredient pages -->
<!-- Paths shown for root-level page; adjust to relative for products/ pages -->
<nav class="ingredient-subnav" aria-label="Ingredient categories">
  <div class="container">
    <div class="subnav-pills">
      <a href="products/ingredients-supplies.html" class="subnav-pill" data-subnav="all">All</a>
      <a href="products/hops.html"                 class="subnav-pill" data-subnav="hops">Hops</a>
      <a href="products/grains.html"               class="subnav-pill" data-subnav="grains">Grains</a>
      <a href="products/yeast.html"                class="subnav-pill" data-subnav="yeast">Yeast</a>
      <a href="products/additives.html"            class="subnav-pill" data-subnav="additives">Additives</a>
      <a href="products/packaging.html"            class="subnav-pill" data-subnav="packaging">Packaging</a>
      <a href="products/equipment.html"            class="subnav-pill" data-subnav="equipment">Equipment</a>
    </div>
    <button type="button" class="subnav-search-btn" aria-label="Search ingredients (coming soon)" disabled>
      <!-- Search icon SVG -->
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>
  </div>
</nav>
```

### CSS for sub-nav (addition to catalog-subpage.css)

```css
/* Source: D-01 pill style, D-02 sticky, existing .catalog-filter-btn pattern */
.ingredient-subnav {
  position: sticky;
  top: var(--header-height, 80px);
  z-index: 190;
  background: var(--color-cream);
  border-bottom: 1px solid rgba(74, 111, 75, 0.2);
  padding: 0.5rem 0;
}

.subnav-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;           /* horizontal scroll on mobile */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;      /* hide scrollbar (Firefox) */
  padding-bottom: 2px;        /* prevent clipping of focus ring */
}

.subnav-pills::-webkit-scrollbar { display: none; }

.ingredient-subnav .container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.subnav-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  min-height: 36px;
  border-radius: 20px;
  border: 1px solid var(--color-green);
  background: transparent;
  color: var(--color-green);
  font-family: var(--font-body);
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.subnav-pill:hover {
  background: rgba(74, 111, 75, 0.08);
}

.subnav-pill:focus-visible {
  outline: 2px solid var(--color-green);
  outline-offset: 2px;
}

/* CSS-only active state — no JS needed */
body[data-page="ingredients"] .subnav-pill[data-subnav="all"],
body[data-page="hops"]        .subnav-pill[data-subnav="hops"],
body[data-page="grains"]      .subnav-pill[data-subnav="grains"],
body[data-page="yeast"]       .subnav-pill[data-subnav="yeast"],
body[data-page="additives"]   .subnav-pill[data-subnav="additives"],
body[data-page="packaging"]   .subnav-pill[data-subnav="packaging"],
body[data-page="equipment"]   .subnav-pill[data-subnav="equipment"] {
  background: var(--color-green);
  color: var(--color-cream);
}

.subnav-search-btn {
  flex-shrink: 0;
  margin-left: auto;
  background: none;
  border: none;
  padding: 6px;
  min-height: 36px;
  min-width: 36px;
  cursor: not-allowed;        /* disabled until Phase 23 */
  color: var(--color-muted, #5f5f5f);
  opacity: 0.5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Dropdown divider */
.nav-dropdown-divider {
  border-top: 1px solid rgba(74, 111, 75, 0.2);
  margin: 4px 0;
  pointer-events: none;
}
```

### Build pipeline addition (package.json stamp:pages)

```javascript
// Source: package.json stamp:pages — add new pages to the hardcoded list
// Remove: 'hops.html'
// Add: 'products/hops.html', 'products/grains.html', 'products/yeast.html',
//       'products/additives.html', 'products/packaging.html', 'products/equipment.html'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ingredients-supplies.html as full page | Currently an empty file; `ingredients.html` at root is the redirect shim | Between Phase 20 and Phase 22 | Phase 22 must build ingredients-supplies.html from scratch |
| hops.html at root | Move to products/hops.html | This phase | Update 9 existing HTML files + remove from stamp:pages list |
| 4-item Products dropdown | 9-item dropdown with divider | This phase | Update in all 15 HTML files (9 existing + 6 new/moved) |

---

## Complete File Impact List

**New files to create:**
1. `products/grains.html`
2. `products/yeast.html`
3. `products/additives.html`
4. `products/packaging.html`
5. `products/equipment.html`
6. `products/ingredients-supplies.html` (full page — currently empty)

**Files to move/update:**
7. `hops.html` → `products/hops.html` (path updates + sub-nav add)

**CSS addition:**
8. `css/catalog-subpage.css` (sub-nav styles + dropdown divider)

**Pages receiving nav dropdown update only (9 existing):**
9. `index.html`
10. `about.html`
11. `contact.html`
12. `custom-labels.html`
13. `products.html`
14. `reservation.html`
15. `test-subpage.html`
16. `products/ferment-in-store.html`
17. `ingredients.html` (redirect shim — nav not visible but update for consistency)

**Pages receiving both sub-nav + nav update:**
18. `products/ingredients-supplies.html` (new build)
19. `products/hops.html` (moved)
20. `products/grains.html` (new)
21. `products/yeast.html` (new)
22. `products/additives.html` (new)
23. `products/packaging.html` (new)
24. `products/equipment.html` (new)

**Build pipeline:**
25. `package.json` (`stamp:pages` list update)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Yeast Nutrient is the exact `cf_subcategory` value for yeast nutrient items in Zoho | Phase Requirements CAT-02, Code Examples | Yeast page shows no yeast nutrient items |
| A2 | Packaging items use `cf_subcategory` values `Bottle`, `Bag`; closures may use a different value | Phase Requirements CAT-04, Code Examples | Packaging page missing closure items |
| A3 | Equipment uncategorized items fall back to `cf_type = 'Equipment'` | Phase Requirements CAT-05, Code Examples | Equipment page missing some items |
| A4 | Additives items use `cf_subcategory` values `Additive`, `Flavoring`, `Fruit`, `Oak` | Phase Requirements CAT-03, Code Examples | Additives page missing some items |
| A5 | `data-page` values for new pages should be `grains`, `yeast`, `additives`, `packaging`, `equipment` (matching categorySlug) | Architecture Patterns Pattern 3 | Active state CSS doesn't fire |

**To resolve A1-A4:** Run the Phase 20 `verify-subcategories.js` script against the live Zoho catalog, or inspect the `/api/ingredients` response, before writing final SUBPAGE_CONFIG subcategory arrays. This verification can be the first task in the plan.

---

## Open Questions

1. **Exact Zoho cf_subcategory values for Packaging/Equipment/Additives/Yeast**
   - What we know: Phase 20 tagged all items; verify-subcategories.js can list all values
   - What's unclear: The exact string values (case-sensitive) used in Zoho
   - Recommendation: Make the first plan task a verification step — run verify-subcategories.js and document all distinct cf_subcategory values before writing SUBPAGE_CONFIG

2. **ingredients-supplies.html: which content model to use**
   - What we know: The file is empty; the old content lives in `ingredients.html` (now a redirect); the old content uses the full `08-catalog-ingredients.js` rendering with product tabs, filter controls, and cart sidebar
   - What's unclear: Whether to replicate the old ingredients tab rendering or rebuild it as a simpler "all ingredients" view using `16-catalog-subpage.js`
   - Recommendation: D-10 says "existing code" — replicate the old `ingredients.html` content with the sub-nav added and path-adjusted. The old content used `main.min.js` which includes `08-catalog-ingredients.js`. This is cleaner than switching the All page to the subpage module.

3. **products.html ingredients tab: remove or keep**
   - What we know: `products.html` has a `data-product-tab="ingredients"` tab that currently shows ingredients in the same view as kits
   - What's unclear: Should it redirect to `products/ingredients-supplies.html` or be removed
   - Recommendation: Keep as teaser with a link — removing it might break existing bookmarks or user expectations. Replace the tab content with a brief "Browse by category" message and links to the subpages.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 22 is purely static HTML, CSS, and JavaScript changes with no external tool dependencies beyond the existing build pipeline (`npm run build`). The build pipeline is confirmed operational. [VERIFIED: package.json]

---

## Security Domain

`security_enforcement: true` per config.json. ASVS Level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — public catalog pages, no auth |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a — all new pages are intentionally public |
| V5 Input Validation | yes (minimal) | Sub-nav search button is disabled; no user input processed in this phase |
| V6 Cryptography | no | n/a |

### Known Threat Patterns for Static HTML

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open redirect | Tampering | No redirect logic added in this phase; `ingredients.html` shim uses `location.replace` to a hardcoded path |
| XSS via SUBPAGE_CONFIG | Tampering | SUBPAGE_CONFIG is inline author-controlled JavaScript — values are strings, not user input. No risk. |
| Clickjacking | Elevation of Privilege | New pages are public catalog pages; no auth or sensitive actions — no CSP frame-ancestors change needed |

All new pages must include the same Content-Security-Policy meta tag present in `hops.html` and other pages. [VERIFIED: hops.html line 19]

---

## Sources

### Primary (HIGH confidence)
- `js/modules/16-catalog-subpage.js` — full source read; SUBPAGE_CONFIG interface, filterItemsByConfig, DOMContentLoaded init
- `css/catalog-subpage.css` — full source read; existing styles, breakpoints
- `test-subpage.html` — canonical template for new subpage HTML structure
- `hops.html` — full source read; nav structure, asset paths, page structure to replicate on move
- `package.json` — build pipeline scripts including stamp:pages list and minify:css/js
- `css/styles.css` — nav-dropdown rules (lines 455-513), header sticky (lines 235-242), --header-height variable usage
- `js/modules/13-init.js` — --header-height dynamic set (line 234)
- `.planning/phases/22-category-subpages-navigation/22-CONTEXT.md` — all locked decisions
- `.planning/STATE.md` — roadmap decisions including body[data-page] CSS-only active state

### Secondary (MEDIUM confidence)
- `products/ingredients-supplies.html` — confirmed empty (0 bytes); must be built from scratch
- `tests/frontend/16-catalog-subpage.test.js` — confirmed filterItemsByConfig and buildSortComparator are the exported functions; test infrastructure exists
- `tests/e2e/static-pages.spec.js` — existing e2e tests for ingredient pages; new pages need coverage

### Tertiary (LOW confidence)
- Assumed Zoho cf_subcategory string values for CAT-02 through CAT-05 (A1-A4 in assumptions log)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all tools verified in codebase
- Architecture: HIGH — all patterns verified from source code
- Pitfalls: HIGH — all identified from direct code inspection
- Zoho subcategory values: LOW — not verified in this research session

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (stable stack; risk area is Zoho cf_subcategory values which should be verified before coding CAT-04/05)
