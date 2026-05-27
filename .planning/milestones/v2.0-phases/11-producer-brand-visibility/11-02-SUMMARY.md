---
phase: 11-producer-brand-visibility
plan: "02"
subsystem: frontend/catalog
tags: [producer, manufacturer, card-builders, filter, fuse, css, tests]
dependency_graph:
  requires: [manufacturer-field-in-api-response]
  provides: [producer-display-on-cards, producer-filter-in-catalog, producer-css-all-surfaces]
  affects:
    - js/modules/06-featured.js
    - js/modules/07-catalog-kits.js
    - css/styles.css
    - products.html
    - products/ferment-in-store.html
    - tests/frontend/producer.test.js
tech_stack:
  added: []
  patterns: [conditional-element-creation, textContent-xss-safety, filter-system-extension]
key_files:
  created:
    - tests/frontend/producer.test.js
  modified:
    - js/modules/06-featured.js
    - js/modules/07-catalog-kits.js
    - css/styles.css
    - products.html
    - products/ferment-in-store.html
decisions:
  - "Used textContent (not innerHTML) for all manufacturer values per T-11-03 threat mitigation"
  - "Added filter-manufacturer to products/ferment-in-store.html in addition to products.html (Rule 3 deviation: products.html is a redirect, actual catalog is in products/ subdirectory)"
  - "Middleware test failures in worktree are pre-existing missing-dependency failures (express, axios not installed in worktree node_modules) - not caused by this plan's changes"
  - "Test count: 318 frontend tests passing (was 254 + 64 from prior tests before this plan = prior state unknown; plan added 17 new producer tests)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-06T22:00:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
---

# Phase 11 Plan 02: Producer Display on Cards and Catalog Filter Summary

**One-liner:** Producer element (`product.manufacturer` -> `el.textContent`) added conditionally before brand in all 6 kit card builders (3 featured + 3 catalog), all 5 producer CSS classes added to styles.css per 11-UI-SPEC.md, and Producer filter wired into the catalog filter system via 5 synchronization points.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add producer element to all 6 card builders and ALL producer CSS | 4320efd | js/modules/06-featured.js, js/modules/07-catalog-kits.js, css/styles.css |
| 2 | Add Producer filter to catalog page and update Fuse.js search | 58eb18a | js/modules/07-catalog-kits.js, products.html, products/ferment-in-store.html |
| 3 | Add frontend tests for producer display logic and run build | 028e0e0 | tests/frontend/producer.test.js |

## What Was Built

### Task 1: Producer element in all 6 card builders

**06-featured.js — buildFeaturedWineCard** (~line 578):
Producer element inserted before brand using `body.appendChild(producer)` then `body.appendChild(brand)`:
```javascript
if (product.manufacturer) {
  var producer = document.createElement('div');
  producer.className = 'producer';
  producer.textContent = product.manufacturer;
  body.appendChild(producer);
}
body.appendChild(brand);
```

**06-featured.js — buildFeaturedBeerCard** (~line 659):
Producer element inserted between logo and brand (logo -> producer -> brand -> goldRule -> beerName).

**06-featured.js — buildFeaturedDefaultCard** (~line 736):
Producer element using `product-producer` class inserted before brand in `header`.

**07-catalog-kits.js — buildWineCard, buildBeerCard, buildDefaultCard**:
Identical patterns applied to all 3 catalog card builders.

### Task 1: All producer CSS (5 rules added to styles.css near line 4362)

- `.label-wine .producer` — 0.6rem, weight 400, uppercase, letter-spacing 0.15em, var(--color-muted)
- `.label-beer .producer` — 0.6rem, weight 400, uppercase, letter-spacing 0.15em, var(--color-muted)
- `.product-producer` — 0.6rem, weight 400, uppercase, letter-spacing 0.08em, var(--color-muted)
- `.cart-sidebar-item-producer` — 0.6rem, weight 400, var(--color-muted), margin-bottom 0
- `.kiosk-product-producer` — 0.65rem, weight 600, uppercase, letter-spacing 0.05em, var(--color-muted, #5f5f5f)

### Task 2: Producer filter system (5 synchronization points)

1. `activeFilters` init: `manufacturer: []` added to object literal (line 11)
2. Fuse.js keys: `'manufacturer'` added to keys array (line 168)
3. `buildFilterRow` call: `buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:')` after brand filter (line 177)
4. `matchesFilters` fields: `'manufacturer'` added to fields array (line 437)
5. `updateFilterAvailability` fields: `'manufacturer'` added to fields array (line 447)

HTML containers: `<div class="catalog-filter-row" id="filter-manufacturer"></div>` added to both `products.html` and `products/ferment-in-store.html`.

### Task 3: Frontend tests (17 test cases in tests/frontend/producer.test.js)

- 4 groups: label card producer display, default card producer display, filter system, DOM order
- Covers: conditional display (truthy/falsy manufacturer), XSS safety (textContent vs innerHTML), class name validation (.producer vs .product-producer), activeFilters shape, matchesFilters with manufacturer filter, AND logic with combined filters, excludeField behavior, DOM order assertion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Missing HTML Container] Added filter-manufacturer to products/ferment-in-store.html**
- **Found during:** Task 2
- **Issue:** The plan specified adding `filter-manufacturer` to `products.html` but that file is a redirect page pointing to `products/ferment-in-store.html`. The actual catalog UI is in `products/ferment-in-store.html`. Without the container in that file, `buildFilterRow('filter-manufacturer', ...)` would call `document.getElementById('filter-manufacturer')` and get `null`, causing silent filter failure.
- **Fix:** Added `<div class="catalog-filter-row" id="filter-manufacturer"></div>` to both `products.html` and `products/ferment-in-store.html`
- **Files modified:** products/ferment-in-store.html (added), products.html (already done per plan)
- **Commit:** 58eb18a

## Verification Results

```
grep -c 'product.manufacturer' js/modules/06-featured.js      -> 6 (2 per builder x 3 builders: conditional + textContent)
grep -c 'product.manufacturer' js/modules/07-catalog-kits.js  -> 6 (2 per builder x 3 builders)
grep -c "'manufacturer'" js/modules/07-catalog-kits.js        -> 4 (Fuse + buildFilterRow + matchesFilters + updateFilterAvailability)
  Note: activeFilters uses unquoted key 'manufacturer:' -- plan's count of 5 assumed quoted form
grep -c 'filter-manufacturer' products.html                   -> 1
grep -c 'filter-manufacturer' products/ferment-in-store.html  -> 1
grep -c '.producer' css/styles.css (regex)                    -> 5 (wine, beer, product-producer, cart-sidebar, kiosk)
grep -c 'cart-sidebar-item-producer' css/styles.css           -> 1
grep -c 'kiosk-product-producer' css/styles.css               -> 1
npm run build                                                  -> exit 0
npm run lint                                                   -> 0 errors (79 pre-existing warnings)
npm test                                                       -> 318 passed, 0 failed (17 new producer tests)
grep -c 'manufacturer' js/main.js                             -> 17 (build confirmed)
```

## Known Stubs

None. All producer display logic is fully wired. The producer line will be hidden (card unchanged from current state) until a Zoho item has `manufacturer_name` set in Zoho Inventory. This is expected fallback behavior per D-11.

## Threat Surface Scan

No new security surface introduced. The `manufacturer` field:
- Is rendered via `.textContent` in all 6 card builders (inherently XSS-safe, T-11-03 mitigation applied)
- Is never rendered via `.innerHTML` in this plan
- Uses same security posture as the existing `brand` field
- The filter system uses `activeFilters.manufacturer` as an array initialized in object literal — no user input flows to this array directly; it is populated by `buildFilterRow` which uses `.textContent` for button labels

## Self-Check: PASSED

- [x] js/modules/06-featured.js contains 3 card builders with producer elements (4320efd)
- [x] js/modules/07-catalog-kits.js contains 3 card builders with producer elements + filter system (4320efd, 58eb18a)
- [x] css/styles.css contains 5 producer CSS rules (4320efd)
- [x] products.html contains filter-manufacturer div (58eb18a)
- [x] products/ferment-in-store.html contains filter-manufacturer div (58eb18a)
- [x] tests/frontend/producer.test.js created with 17 tests (028e0e0)
- [x] Commit 4320efd exists: feat(11-02): add producer element to all 6 card builders and all producer CSS
- [x] Commit 58eb18a exists: feat(11-02): add producer filter to catalog page and update Fuse.js search
- [x] Commit 028e0e0 exists: test(11-02): add frontend unit tests for producer display logic
- [x] All 318 frontend tests pass
- [x] Build artifacts (main.js, main.min.js, styles.min.css) updated
