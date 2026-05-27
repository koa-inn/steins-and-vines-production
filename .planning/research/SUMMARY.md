# Research Summary — v3.0 Catalog Subpages

## Executive Summary

No new libraries, middleware endpoints, or build tools needed. One shared standalone module (`16-catalog-subpage.js`) initialized per-page via config, one shared CSS file (`catalog-subpage.css`), and 5 static HTML files. Fuse.js already vendored. Critical pre-condition: 198/219 ingredients have empty subcategory — Zoho tagging must happen first.

## Stack Additions

None. Fuse.js v7.1.0 already vendored. All patterns proven by `15-hops.js`.

## Architecture

- **One shared module** (`16-catalog-subpage.js`) parameterized via `SUBPAGE_CONFIG` per page — not 5 separate modules
- **One shared CSS** (`catalog-subpage.css`) with `body[data-page]` scoping for per-category accents
- **Static sub-nav HTML** duplicated across pages (no SSI on GitHub Pages), CSS-only active state
- **Data source unchanged** — `/api/ingredients` endpoint, client-side subcategory filtering
- **Search overlay** — single Fuse instance over all ingredients, grouped results, deep-link to subpage

## Feature Table Stakes

- Product grid with filter/sort/search
- Sub-nav bar with horizontal scroll on mobile
- Cart integration (ingredients cart, not ferment cart)
- Empty/error states, out-of-stock indicators
- Grid/list view toggle

## Top 5 Pitfalls

1. **SVG filter containing block** — breaks `position:fixed`; use `::before` pseudo-elements only
2. **`_activeCartTab` defaults to 'kits'** — must override to 'ingredients' at module init
3. **Build script gaps** — `stamp:pages` + `minify:css` + `minify:js` must all be updated atomically
4. **Global `var` namespace collision** — prefix module-level vars with page name
5. **Search data version skew** — single shared cache key, lazy-init Fuse on first search focus

## Suggested Phase Order

1. Zoho category tagging + snapshot refresh (data prerequisite)
2. Shared module + CSS + build infrastructure
3. First subpage (Grains) as pattern validator
4. Remaining 4 subpages + sub-nav + nav updates
5. Cross-category search overlay
6. SEO, QA, staging deploy
