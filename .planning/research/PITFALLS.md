# Domain Pitfalls: v3.0 Catalog Subpages

**Domain:** Adding 5 ingredient-category subpages + sub-nav + cross-category search to an existing vanilla JS e-commerce site
**Researched:** 2026-05-27
**Scope:** Pitfalls specific to THIS codebase, v3.0 milestone — not generic web dev advice

---

## Critical Pitfalls

Mistakes that cause rewrites, broken production deploys, or silent data/cart loss.

---

### Pitfall 1: SVG Filter Breaks position:fixed on Every New Subpage

**What goes wrong:** Any subpage that uses an inline `<svg>` filter element in its hero (like the foil texture on hops.html) makes the filtered element a CSS containing block. All `position:fixed` children — the cart sidebar, the reservation bar, the mobile nav backdrop, and the search overlay — will position relative to the filtered element instead of the viewport. The sub-nav bar (if position:sticky or position:fixed) will also misbehave.

**Why it happens:** This is spec-compliant W3C behavior: any element with a non-`none` `filter` CSS property becomes a containing block for fixed and absolutely positioned descendants. The hops page already hit this exact bug. Each new subpage with a decorative hero filter will reproduce it independently.

**Consequences:** Cart sidebar snaps to wrong position on pages with visual FX. Nav backdrop misaligns on mobile. Search overlay anchors inside the content section instead of over the full viewport. On mobile, visible immediately; on desktop, only on scroll.

**Prevention:**
- Never apply `filter` to an element that is a structural ancestor of `position:fixed` elements.
- Apply decorative filters only to pseudo-elements (`::before`/`::after`) of non-ancestor elements. The hops page already does this correctly: `.hops-catalog-section::before { filter: url(#foil2) blur(1.5px); }` — follow this exact pattern on all new subpages.
- The SVG filter element itself (`<svg width="0" height="0">`) must remain at the top of `<body>` before the header. It does not create a containing block on its own — only elements with CSS `filter:` do.
- After any new hero CSS lands, manually test: open the sidebar and confirm it is flush with the right edge of the viewport, not clipped inside the content section.

**Detection:** Sidebar or nav backdrop appears to end partway up the page rather than covering the full viewport height.

**Phase:** Template design phase — establish the hero CSS pattern before writing any per-page decorative styles.

---

### Pitfall 2: `stamp:pages` Build Script Has a Hardcoded Page List That Will Be Silently Incomplete

**What goes wrong:** The `stamp:pages` npm script in `package.json` contains an explicit array of 9 HTML files. Every new subpage must be added to this list. If forgotten, that page ships with a stale `?v=` cache-buster on its CSS and JS references. The service worker is now a self-unregistering stub, so the GitHub Pages CDN cache is the only layer that can serve stale files — and it can do so for hours.

**Concrete current list:** `products.html`, `ingredients.html`, `reservation.html`, `about.html`, `contact.html`, `products/ferment-in-store.html`, `products/ingredients-supplies.html`, `custom-labels.html`, `hops.html`. Five new subpages will each need to be added.

**Why it happens:** The build was designed incrementally — one page at a time. With 5 subpages arriving together, the list grows significantly and is easy to miss because it lives inside a `node -e` inline script in `package.json`.

**Consequences:** A new subpage that was not added to `stamp:pages` will reference an old cache-busting version of `styles.min.css` or `main.min.js`. Users see broken layouts or stale JS behavior.

**Prevention:**
- Treat the `stamp:pages` update as an atomic part of page creation — it must be in the same commit as the new HTML file.
- Also update `minify:css` to add the new page's CSS file, and `minify:js` to add its standalone module terser step. These are a three-part atomic change every time a new page is created.
- Consider refactoring `stamp:pages` to use `fs.readdirSync` with a glob after this milestone, but do NOT do it during this milestone — it risks breaking existing stamping.

**Detection:** After `npm run build`, the `?v=` cache version in a new subpage must match the version in an existing page from the same build run.

**Phase:** First subpage creation — repeat for each.

---

### Pitfall 3: Standalone Module Global Variable Namespace Collision

**What goes wrong:** Each new subpage loads `main.min.js` (13 concatenated modules compiled from `js/modules/01–13`) plus its own standalone module (e.g., `js/modules/16-grains.js`). The concatenated bundle exposes many top-level `var` names on `window`: `_allIngredients`, `_ingredientsFuse`, `_ingredientFilters`, `_ingredientTypeOrder`, `MW_CACHE_KEY`, `MW_CACHE_TS_KEY`, `MW_CACHE_TTL`, `catalogViewMode`, `_allHops`, `_hopGroups`, `_hopsFuse`, and more. A standalone module that declares any of these names will silently overwrite the shared state from `main.min.js`.

**Why it happens:** ES5 `var` at top level is always `window.*`. There is no module scope boundary. The hops module (`15-hops.js`) deliberately avoids this by using `_allHops` instead of `_allIngredients`. As more category modules are added, the probability of an accidental collision rises.

**Consequences:** A `var _allIngredients = []` at the top of `16-grains.js` silently replaces the shared state. Any call to `renderIngredients()` after grains data loads will use the grains array, not the full ingredients array. Cart re-renders that call `renderIngredients()` will display wrong items — and this will only manifest on pages where both modules are loaded.

**Prevention:**
- Every new standalone module must use page-scoped variable names: `_grainsAll`, `_yeastAll`, `_additivesAll`, `_grainsFuse`, `_yeastFuse`, etc. Never reuse names from `08-catalog-ingredients.js`.
- Add a comment block at the top of each new module (mirror `15-hops.js` lines 1-6): list globals it depends on from `main.min.js` and declare all its own names are prefixed.
- Standalone modules must NOT call `renderIngredients()`, `buildIngredientFilters()`, or `wireIngredientEvents()` — those functions target DOM elements (`#product-catalog`, `.product-tab-btn`) that do not exist on subpages.

**Detection:** On a subpage, run `window._allIngredients` in the console immediately after the page loads — it should be the empty array from the bundle init, not populated with the subpage's category data.

**Phase:** Establish naming convention before writing the first subpage module. Document in the module template.

---

### Pitfall 4: Cross-Category Search Aggregating Per-Cache Data Produces Version-Skewed Results

**What goes wrong:** The current data-loading pattern (in `08-catalog-ingredients.js`) caches middleware results in `localStorage` under `sv-ingredients-mw` with a 30-minute TTL. A cross-category search overlay that reads from multiple per-category caches will see different data versions — one category's cache written 25 minutes ago, another just refreshed. Search results will show inconsistent stock levels or prices, or items that appear in search but are absent (or at different prices) on the category page.

**Why it happens:** Each standalone module will have its own cache key and TTL clock. There is no global catalog version stamp. The `sv-ingredients-mw` key is already shared across pages — but if subpages introduce new per-category keys (e.g., `sv-grains-mw`), the search overlay can no longer reconstruct a coherent view.

**Consequences:** User searches for "Pale Malt", finds it, clicks through to Grains page — the item shows different stock or price, or is not visible because the Grains page is filtering from a fresher cache that has already removed it.

**Prevention:**
- Do NOT introduce per-category localStorage cache keys. Keep a single shared cache key for all ingredient data (`sv-ingredients-mw` / `sv-ingredients-all-mw`).
- The preferred architecture: each subpage filters `_allIngredients` (already loaded from a single `/api/ingredients` fetch) by `subcategory` field. No new cache keys. Coherent by construction.
- The search overlay fetches from the same single endpoint and same cache key, then presents grouped results. It never merges multiple per-category caches.

**Detection:** Search returns an item; clicking it opens a category page where the item has a different price or is absent.

**Phase:** Architecture decision must be made before writing any per-subpage data-fetching code.

---

### Pitfall 5: Sub-Nav Active State Uses Hardcoded Class — Copy-Paste Error Guaranteed

**What goes wrong:** The existing nav uses hardcoded `class="active"` on anchor tags in each HTML file (e.g., `<a href="hops.html" class="active">Hops</a>` in hops.html). With a sub-nav bar shared across 5 subpages, each copy of the shared sub-nav HTML must have the correct item marked active. Copying the template from one subpage to another without updating the active class means the wrong tab is always highlighted — a copy-paste error that is nearly certain to happen at least once.

**Why it happens:** No templating system. Active state is manual HTML attribution. The existing nav pattern encourages this because it has always been done this way.

**Consequences:** Users on the Grains page see "Yeast" highlighted in the sub-nav because the template was copied from the Yeast page. Subtle but erodes trust.

**Prevention:**
- Drive sub-nav active state via JavaScript on `DOMContentLoaded`, not via hardcoded HTML class. Use the existing `data-page` body attribute (already present on all pages: `<body data-page="hops">`) to identify the current page.
- One init function in the standalone module template: read `document.body.dataset.page`, find the sub-nav link whose `data-page` attribute or `href` matches, and add `class="active"`. Do NOT put `class="active"` in the sub-nav HTML.
- The existing main nav still uses inline active — do not extend that pattern to the sub-nav.

**Detection:** Open each subpage and confirm the correct sub-nav item is visually highlighted.

**Phase:** Sub-nav implementation. Build active state detection into the sub-nav component before creating any subpage HTML.

---

### Pitfall 6: Cart Sidebar Shows Empty Ferment Cart on Ingredient Subpages

**What goes wrong:** `_activeCartTab` is initialized to `'kits'` in `11-cart.js` and is only updated by tab-click events wired in `10-tabs.js`. On ingredient subpages there are no product tabs — `_activeCartTab` stays at `'kits'` forever. `getCartKey(product)` routes by `product._item_type` and correctly sends ingredient items to `INGREDIENT_CART_KEY`. But `getCartKeyForTab()` — which the reservation bar and sidebar render paths use to decide what to display — will return `FERMENT_CART_KEY` because the active tab is still `'kits'`. The sidebar opens showing the empty ferment cart instead of the ingredient cart that has the items the user just added.

**Why it happens:** The dual-cart system's tab state was designed around the tab-switching UI on the products page. Subpages have no tabs, so the active cart tab is never updated.

**Consequences:** User adds a grain to cart on the Grains page. Opens sidebar. Sees an empty cart. Thinks the item was not added. May try to add it again.

**Prevention:**
- Include `_activeCartTab = 'ingredients';` at the very top of each standalone ingredient module's init block, before any cart initialization or data loading. This is a one-line fix that belongs in the module template.
- Verify: after this assignment, `getCartKeyForTab(_activeCartTab)` must return `INGREDIENT_CART_KEY`. Manually test by adding an item and confirming the sidebar renders the ingredient cart.

**Detection:** Add an ingredient to cart on a subpage. Open the sidebar. Confirm it shows the ingredient cart items.

**Phase:** Part of the standalone module template. Include before writing any page-specific code.

---

### Pitfall 7: All 9+ Public Pages Need Nav HTML Updates When Subpages Are Added

**What goes wrong:** There is no templating system. Main nav HTML (`<ul class="nav-list">`) is duplicated verbatim in every public page. Adding new ingredient subpages to the Products dropdown requires touching all existing public pages. The current list is: `index.html`, `products.html`, `ingredients.html`, `reservation.html`, `about.html`, `contact.html`, `products/ferment-in-store.html`, `products/ingredients-supplies.html`, `custom-labels.html`, `hops.html` — plus each new subpage. If any page is missed, the nav dropdown is inconsistent across the site.

**Why it happens:** No server-side includes, no JS partial loader for nav. Pure static HTML.

**Consequences:** Users on `about.html` see a Products dropdown without the Grains page. Users on `grains.html` see it with the Grains page. Support confusion.

**Prevention:**
- Before starting nav changes, write out the complete checklist of pages that need updating — every page above plus the new subpages being created.
- Perform nav updates in one focused commit, not mixed with subpage feature work. This makes review and rollback straightforward.
- If new subpages live in a subdirectory (e.g., `products/grains.html`), all asset `href` paths need `../` prefix. Use `products/ferment-in-store.html` as the canonical reference for path prefixing — not root-level pages.

**Detection:** After adding subpages to the nav dropdown, open each page in the checklist and confirm the dropdown shows identical items.

**Phase:** Cross-cutting concern — plan as an explicit checklist step, not implicit in subpage feature work.

---

## Moderate Pitfalls

### Pitfall 8: Snapshot May Be Missing `subcategory` Field for New Ingredient Categories

**What goes wrong:** `content/zoho-snapshot.json` is generated from `/api/snapshot`. The tax pipeline bug (fixed commit `281d796`) revealed that the `/itemdetails` bulk endpoint does not always return `sales_tax_rule_id` — the enrichment step was silently dropping it. The same risk applies to `subcategory` if it is stored as a Zoho `custom_field` rather than a native Zoho field. Items without `subcategory` will fail to appear on the correct subpage when middleware is unavailable and the snapshot is the fallback data source.

**Prevention:**
- Before writing any subpage category filter logic, run `npm run snapshot` locally and inspect the output for a representative sample of ingredient items. Verify `subcategory` is present and correctly populated.
- If `subcategory` is in `custom_fields`, confirm the enrichment paths in `export-snapshot.js` and the middleware API explicitly promote it to a top-level field (same fix pattern as `sales_tax_rule_id`).
- After regenerating the snapshot, assert: count ingredients with non-empty `subcategory` and log a warning if the count is zero or lower than expected.

**Phase:** Before writing any subcategory filter logic — this must be confirmed early.

---

### Pitfall 9: localStorage View-Mode Key Collision With Main Products Page

**What goes wrong:** `05-catalog-view.js` uses keys `catalogViewMode-kits`, `catalogViewMode-ingredients`, `catalogViewMode-services` in localStorage. The hops module uses `hopsViewMode`. If a new standalone module uses a generic view-mode key without a page-specific prefix, it will read/write the same slot as the products page, causing unexpected view-mode switches when navigating between the products page and a subpage.

**Prevention:**
- Each standalone module uses a unique localStorage key: `grainsViewMode`, `yeastViewMode`, etc. Follow `hopsViewMode` exactly.
- Never use `catalogViewMode-*` keys in standalone modules — those are owned by the main products page tab system.
- Document the convention in the module template comment block.

**Phase:** Module template design.

---

### Pitfall 10: Search Overlay Trapped by Stacking Context on Subpages With Visual Effects

**What goes wrong:** The search overlay must render above all page content including the sticky sub-nav and the open cart sidebar. Each new subpage's unique hero/visual treatment may create stacking contexts (via `filter`, `opacity < 1`, `transform`, `will-change`, `isolation: isolate`). An overlay rendered inside a stacking-context ancestor cannot escape that context regardless of z-index value.

**Prevention:**
- Append the search overlay element to `document.body` directly — not inside any page-specific container. Standard practice for site-wide overlays.
- Before implementing the overlay, audit each subpage's hero CSS for stacking context properties.
- Define overlay z-index as a CSS custom property at `:root` level. Use a value higher than the cart sidebar's z-index (check `css/styles.css` section 29 for current sidebar z-index values).

**Phase:** Search overlay implementation. Audit subpage CSS first.

---

### Pitfall 11: Cross-Category Search Fuse.js Index Not Available on Pages That Didn't Load Its Data

**What goes wrong:** Each category's Fuse.js instance is initialized inside that category's `loadX().then(...)` callback. On any given subpage, only that page's Fuse instance is initialized. All other categories' Fuse instances are `null` or `undefined`. If the search overlay attempts to call `_grainsFuse.search(q)` while on the Yeast page, it will either throw (null reference) or return no results.

**Prevention:**
- The cross-category search overlay must be self-contained: it fetches all ingredient data into its own array and builds its own independent Fuse.js instance. It does not depend on or reuse any per-page module's Fuse instances.
- Initialize the search's Fuse index lazily on the first focus event of the search input — not at page load — to avoid blocking render.
- If the search data is already in the page module's in-memory array (because the page loaded that category), the search can reuse the same data. But the Fuse instance and the search cache must be the overlay's own state.

**Phase:** Search overlay implementation.

---

### Pitfall 12: `sitemap.xml` and JSON-LD Canonical URLs Not Updated for New Pages

**What goes wrong:** `sitemap.xml` is a static file — new subpages will not appear in it automatically. Search engines will not discover the new pages promptly without explicit sitemap entries. Each public page also has a `LocalBusiness` JSON-LD block and `<link rel="canonical">` set manually in the HTML. Copying from another page will leave the wrong canonical URL on the new page — a silent SEO regression.

**Prevention:**
- Add each new subpage to `sitemap.xml` with `<lastmod>` equal to the deploy date. Treat sitemap update as atomic with page creation.
- Update `<link rel="canonical">`, `og:url`, `og:title`, `og:description`, and the JSON-LD `"url"` field on every new page before the first deploy.
- New ingredient subpages must NOT have `<meta name="robots" content="noindex">` — that restriction is for admin/kiosk/batch/brewpad only.

**Phase:** Per-page creation and pre-deploy checklist.

---

## Minor Pitfalls

### Pitfall 13: Three-Part Build Script Update Is Required Per New Page

**What goes wrong:** Creating a new page requires three separate `package.json` script updates: (1) add `css/{page}.css` to `minify:css`, (2) add `terser js/modules/{N}-{page}.js` to `minify:js`, (3) add the HTML path to `stamp:pages`. Missing any one produces an inconsistent build. These are all inline strings inside `node -e` calls, easy to miss during code review.

**Prevention:** These three changes must be in the same commit as the new HTML file. Write them as a checklist item in the commit message.

**Phase:** Per-page creation.

---

### Pitfall 14: Kiosk Mode Link Propagation Misses Dynamically Rendered Sub-Nav

**What goes wrong:** `13-init.js` propagates `?kiosk=1` to all internal links at `DOMContentLoaded`. Sub-nav links rendered dynamically by a standalone module after `DOMContentLoaded` are created too late to receive this treatment. Kiosk mode context is lost when navigating between subpages.

**Why it matters:** Low user impact — kiosk users primarily navigate kits, not ingredient subpages. But if kiosk mode is tested on an ingredient subpage, the broken state is confusing to debug.

**Prevention:** If `window.IS_KIOSK` is truthy, append `?kiosk=1` to sub-nav links when rendering them dynamically. A one-line guard in the sub-nav init function is sufficient.

**Phase:** Sub-nav implementation. Low priority.

---

### Pitfall 15: GTM, JSON-LD, and PWA Head Boilerplate Must Be Copied Correctly to Every New Page

**What goes wrong:** Each public page requires 20+ head elements: GTM head snippet and noscript, `LocalBusiness` JSON-LD with correct canonical URL, `og:*` / `twitter:*` meta, PWA meta tags (`apple-mobile-web-app-*`, manifest, theme-color), font preloads, apple-touch-icon. Missing any of these on a new subpage is a silent regression — analytics, SEO, and PWA functionality break without a build error.

**Prevention:** Create one canonical "new public page" template HTML file (e.g., `docs/_template-public-page.html`) with all required head elements and clearly marked placeholders for title, description, canonical URL, and `og:url`. Copy from the template, never from a content page. This should be the first deliverable before any subpage is created.

**Phase:** Before creating the first new subpage.

---

## Phase-Specific Warnings

| Phase Topic | Pitfall | Concrete Mitigation |
|-------------|---------|---------------------|
| Page template creation | P1: SVG filter breaks fixed elements | Use `::before` pseudo-element for all decorative filters; test sidebar right edge = viewport right edge |
| Page template creation | P7: Wrong asset paths in `products/` subdirectory | Use `products/ferment-in-store.html` as canonical asset path reference (has `../` prefix) |
| Page template creation | P15: Missing head boilerplate | Create `docs/_template-public-page.html` before touching any subpage HTML |
| Standalone module creation | P3: Global var collision with `main.min.js` | Use `_{pageName}All`, `_{pageName}Fuse` naming; document in module header comment |
| Standalone module creation | P6: Cart tab defaults to `'kits'` | First line of DOMContentLoaded: `_activeCartTab = 'ingredients'` |
| Standalone module creation | P9: `localStorage` view-mode key collision | Use `{pageName}ViewMode` key, never `catalogViewMode-*` |
| Build pipeline | P2: `stamp:pages` not updated | Atomic three-part commit: HTML + `stamp:pages` + `minify:css` + `minify:js` |
| Build pipeline | P13: Missing CSS/JS build entries | Same atomic commit — checklist in commit message |
| Sub-nav bar | P5: Active state wrong | JS-driven via `data-page` body attribute; no `class="active"` in sub-nav HTML |
| Sub-nav bar | P7: Nav HTML on all 9+ pages | Single focused commit; write full page checklist first |
| Sub-nav bar | P14: Kiosk link propagation | Add `IS_KIOSK` guard to sub-nav renderer |
| Cross-category search | P4: Data version skew | Single shared cache key for all ingredients; filter by `subcategory` in-memory |
| Cross-category search | P10: Overlay trapped by stacking context | Overlay appended to `document.body`; audit subpage CSS for stacking context properties first |
| Cross-category search | P11: Fuse instances null on other pages | Search overlay owns its own data fetch and Fuse instance; lazy init on search focus |
| Zoho data / snapshot | P8: `subcategory` missing from snapshot | Verify snapshot before writing filter logic; add enrichment if field is in `custom_fields` |
| SEO / launch | P12: sitemap + JSON-LD not updated | Atomic with page creation; use template for canonical/og values |
