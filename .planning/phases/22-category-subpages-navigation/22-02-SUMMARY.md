---
phase: 22-category-subpages-navigation
plan: 02
subsystem: ui
tags: [html, subpages, sub-nav, ingredients, hops, grains, yeast, additives, packaging, equipment]

# Dependency graph
requires:
  - phase: 22-category-subpages-navigation
    plan: 01
    provides: catalog-subpage.css sub-nav styles, stamp:pages build config
  - phase: 22-category-subpages-navigation
    plan: 03
    provides: Phase 22 expanded nav dropdown format (already in test-subpage.html template)
provides:
  - products/grains.html: Grains category subpage with SUBPAGE_CONFIG subcategories=['Grain']
  - products/yeast.html: Yeast category subpage with SUBPAGE_CONFIG subcategories=['Yeast']
  - products/additives.html: Additives category subpage with SUBPAGE_CONFIG subcategories=['Additive']
  - products/packaging.html: Packaging category subpage with SUBPAGE_CONFIG subcategories=['Bottle','Bag'] types=['Packaging']
  - products/equipment.html: Equipment category subpage with SUBPAGE_CONFIG subcategories=['Fermenter','Equipment','Hose/Tubing'] types=['Equipment','Cleaning/Sanitization']
  - products/hops.html: Hops page moved from root with sub-nav added
  - products/ingredients-supplies.html: All Ingredients page rebuilt from empty placeholder
affects: [human-verify-checkpoint, phase-23]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All 7 ingredient subpages in products/ directory use sibling-relative hrefs (no products/ prefix in sub-nav or dropdown)"
    - "products/hops.html preserves all hops-specific content (SVG filter, hops-cart-fab) unchanged"
    - "products/ingredients-supplies.html uses main.min.js only — 08-catalog-ingredients.js is bundled"
    - "SUBPAGE_CONFIG uses verified Zoho cf_subcategory values from 22-01-SUMMARY (not RESEARCH.md assumptions)"

key-files:
  created:
    - products/grains.html
    - products/yeast.html
    - products/additives.html
    - products/packaging.html
    - products/equipment.html
    - products/hops.html
  modified:
    - products/ingredients-supplies.html (rebuilt from 0-byte placeholder)
    - about.html, contact.html, custom-labels.html, index.html, ingredients.html, products.html, reservation.html, test-subpage.html, products/ferment-in-store.html, products/additives.html, products/equipment.html, products/grains.html, products/packaging.html, products/yeast.html, admin.html, brewpad.html, kiosk.html (version stamp updated by npm run build)

key-decisions:
  - "SUBPAGE_CONFIG uses verified values from 22-01-SUMMARY: Grains=['Grain'], Yeast=['Yeast'], Additives=['Additive'] — NOT the RESEARCH.md assumptions (A1: 'Yeast Nutrient' does not exist; A4: 'Flavoring','Fruit','Oak' do not exist)"
  - "Equipment includes types=['Equipment','Cleaning/Sanitization'] to catch 27 items with no cf_subcategory"
  - "products/ingredients-supplies.html header contact block upgraded to phone-popover pattern (matching current site standard, not the older bare anchor from ingredients.html)"
  - "npm run build run after Task 2 — stamp:pages updated version tokens on all 15 pages, confirming all new files are accessible to the build pipeline"

requirements-completed: [CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, NAV-01, NAV-02]

# Metrics
duration: 35min
completed: 2026-05-29
---

# Phase 22 Plan 02: 7 Ingredient Subpages — Grains, Yeast, Additives, Packaging, Equipment, Hops (Moved), All Ingredients (Rebuilt) Summary

**5 new category subpages + products/hops.html moved from root + products/ingredients-supplies.html rebuilt from empty — all with sub-nav, expanded dropdown, verified SUBPAGE_CONFIG, and ../prefix asset paths**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-29T17:45:00Z
- **Completed:** 2026-05-29T18:20:00Z
- **Tasks:** 2 of 2 complete
- **Files created/modified:** 7 HTML files created/rebuilt + 15 HTML pages version-stamped by build

## Accomplishments

- Created 5 category subpages (grains, yeast, additives, packaging, equipment) from test-subpage.html template with verified SUBPAGE_CONFIG values from 22-01-SUMMARY
- Created products/hops.html as a path-adjusted copy of root hops.html, adding sub-nav + catalog-subpage.min.css; root hops.html preserved
- Rebuilt products/ingredients-supplies.html from empty (0 bytes) into a full All Ingredients page using ingredients.html as content source — no redirect shim, updated header to phone-popover pattern, sub-nav added
- All 7 pages: GTM-NHRCGLC5 in head and body noscript, CSP meta, ingredient sub-nav with 7 pills, expanded Products dropdown with divider and 9 items, all asset paths use ../ prefix
- npm run build completed successfully — stamp:pages updated all 15 HTML pages, CSS and JS minified without errors

## Task Commits

1. **Task 1: Create 5 new category subpages** - `6348e10` (feat)
2. **Task 2: Move hops + rebuild ingredients-supplies + run build** - `4e1e6e2` (feat)

## Files Created/Modified

- `products/grains.html` - Created: Grains subpage, SUBPAGE_CONFIG subcategories=['Grain'], accentColor='#8b6f3a'
- `products/yeast.html` - Created: Yeast subpage, SUBPAGE_CONFIG subcategories=['Yeast'], accentColor='#c4a035'
- `products/additives.html` - Created: Additives subpage, SUBPAGE_CONFIG subcategories=['Additive'], accentColor='#6b5a9e'
- `products/packaging.html` - Created: Packaging subpage, SUBPAGE_CONFIG subcategories=['Bottle','Bag'] types=['Packaging'], accentColor='#4a7fa8'
- `products/equipment.html` - Created: Equipment subpage, SUBPAGE_CONFIG subcategories=['Fermenter','Equipment','Hose/Tubing'] types=['Equipment','Cleaning/Sanitization'], accentColor='#5a7a6a'
- `products/hops.html` - Created: Path-adjusted copy of root hops.html with sub-nav + catalog-subpage.min.css added
- `products/ingredients-supplies.html` - Rebuilt from empty: Full All Ingredients page using ingredients.html as content source

## Decisions Made

- **Verified SUBPAGE_CONFIG arrays**: Used 22-01-SUMMARY confirmed values. Key corrections from RESEARCH.md assumptions: 'Yeast Nutrient' subcategory does not exist (nutrients are under 'Additive'); 'Flavoring', 'Fruit', 'Oak' subcategories do not exist (all fall under 'Additive'). Equipment correctly includes types=['Equipment','Cleaning/Sanitization'] to capture 27 items with no cf_subcategory.

- **Phone popover pattern for ingredients-supplies.html**: The source file (ingredients.html) uses an old bare anchor `<a href="tel:...">` in the header contact block. The current site-wide standard (as seen in test-subpage.html, hops.html, ferment-in-store.html) is the phone-popover pattern with Call/Text menu items. Applied the current standard pattern to the rebuilt page. This is a Rule 2 fix (missing UI consistency) not a deviation.

## Deviations from Plan

None — plan executed exactly as written. The only implementation choice made was upgrading the header contact block in ingredients-supplies.html to the current phone-popover pattern (the source ingredients.html used an outdated bare tel: link), which is a correctness improvement per Rule 2.

## Known Stubs

None — all 7 pages are fully functional HTML. The 5 new category subpages load their SUBPAGE_CONFIG and delegate rendering entirely to 16-catalog-subpage.js (which already exists and functions). products/hops.html delegates to 15-hops.js. products/ingredients-supplies.html delegates to the bundled 08-catalog-ingredients.js in main.min.js.

## Threat Flags

None — this plan creates static HTML navigation pages only. All pages include the same CSP meta tag as existing pages. No new auth paths, network endpoints, or user input processing introduced.

## Self-Check

- [x] `products/grains.html` exists with data-page="grains", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, SUBPAGE_CONFIG subcategories=['Grain']
- [x] `products/yeast.html` exists with data-page="yeast", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, SUBPAGE_CONFIG subcategories=['Yeast']
- [x] `products/additives.html` exists with data-page="additives", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, SUBPAGE_CONFIG subcategories=['Additive']
- [x] `products/packaging.html` exists with data-page="packaging", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, SUBPAGE_CONFIG subcategories=['Bottle','Bag']
- [x] `products/equipment.html` exists with data-page="equipment", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, SUBPAGE_CONFIG subcategories=['Fermenter','Equipment','Hose/Tubing']
- [x] `products/hops.html` exists with data-page="hops", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, ../css/hops.min.css, hops-cart-fab
- [x] `products/ingredients-supplies.html` exists with data-page="ingredients", 1x ingredient-subnav, 1x nav-dropdown-divider, 2x GTM-NHRCGLC5, no location.replace
- [x] All 7 files have 0 bare css/ js/ images/ paths (all use ../ prefix)
- [x] Root hops.html still present
- [x] npm run build succeeded (stamp:pages updated all 15 pages)
- [x] npm test: 417 tests pass
- [x] Commits 6348e10 and 4e1e6e2 exist

## Self-Check: PASSED
