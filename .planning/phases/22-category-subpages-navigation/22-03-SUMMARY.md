---
phase: 22-category-subpages-navigation
plan: 03
subsystem: ui
tags: [html, nav, dropdown, teaser, tabs]

# Dependency graph
requires:
  - phase: 22-category-subpages-navigation
    plan: 01
    provides: nav-dropdown-divider CSS, stamp:pages build config
depends_on: [22-01]
provides:
  - Expanded Products dropdown on all 9 existing HTML pages (divider + 7 category links)
  - ingredients.html promoted from no-dropdown to full dropdown nav
  - products.html ingredients tab has static category teaser block
  - js/main.js and js/main.min.js rebuilt with 10-tabs.js change
affects: [human-verify-checkpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "category-teaser div with hidden class, shown/hidden via existing tab-switch mechanism in 10-tabs.js"
    - "nav-dropdown class added to ingredients.html li (was a bare link previously)"

key-files:
  created: []
  modified:
    - index.html
    - about.html
    - contact.html
    - custom-labels.html
    - products.html
    - reservation.html
    - test-subpage.html
    - ingredients.html
    - products/ferment-in-store.html
    - js/modules/10-tabs.js
    - js/main.js
    - js/main.min.js

key-decisions:
  - "Added ingredients-category-teaser to 10-tabs.js show/hide logic (same pattern as pickup/mill notes) so teaser visibility follows tab state"
  - "ingredient.html received full nav-dropdown class and menu (was a bare Products link, no dropdown)"
  - "stamp:pages skipped in this worktree — Plan 02 subpage files (hops.html, grains.html, etc.) do not exist here yet; JS concat+minify ran successfully instead"

requirements-completed: [NAV-02]

# Metrics
duration: 20min
completed: 2026-05-29
---

# Phase 22 Plan 03: Nav Dropdown Update + Ingredients Teaser Summary

**Expanded Products dropdown with divider and 7 ingredient category links deployed to all 9 existing HTML pages; ingredients.html promoted to full dropdown; products.html gains ingredients category teaser**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-29T17:10:00Z
- **Completed:** 2026-05-29T17:34:00Z
- **Tasks:** 1 of 2 complete (Task 2 is human-verify checkpoint)
- **Files modified:** 12 (9 HTML pages + 10-tabs.js + js/main.js + js/main.min.js)

## Accomplishments

- Replaced 4-item dropdown with 10-item grouped dropdown (Ferment in Store, Custom Labels, [divider], All Ingredients, Hops, Grains, Yeast, Additives, Packaging, Equipment) across 8 root-level pages using `products/` prefix paths
- Updated `products/ferment-in-store.html` with sibling-relative paths (bare filenames, `../custom-labels.html`)
- Promoted `ingredients.html` from bare Products link to full `nav-dropdown` with complete menu
- Added `div#ingredients-category-teaser.category-teaser.hidden` to products.html ingredients tab area with heading, body, and 7 subpage links
- Updated `js/modules/10-tabs.js` to show/hide `#ingredients-category-teaser` alongside the existing pickup/mill notes when the ingredients tab is active
- Rebuilt `js/main.js` and `js/main.min.js` via `npm run minify:js` (concat + terser)
- All 417 frontend tests pass, 0 lint errors, 109 pre-existing warnings

## Task Commits

1. **Task 1: Update nav dropdown + ingredients teaser** - `ddb7d88` (feat)

## Files Created/Modified

- `index.html` - Nav dropdown updated (root-level paths)
- `about.html` - Nav dropdown updated (root-level paths)
- `contact.html` - Nav dropdown updated (root-level paths)
- `custom-labels.html` - Nav dropdown updated (root-level paths)
- `products.html` - Nav dropdown updated + category teaser added to ingredients tab
- `reservation.html` - Nav dropdown updated (root-level paths)
- `test-subpage.html` - Nav dropdown updated (root-level paths)
- `ingredients.html` - Promoted from bare link to full nav-dropdown with complete menu
- `products/ferment-in-store.html` - Nav dropdown updated (products/-relative paths)
- `js/modules/10-tabs.js` - Added show/hide logic for `#ingredients-category-teaser`
- `js/main.js` - Regenerated via concat:js
- `js/main.min.js` - Regenerated via terser minification

## Decisions Made

- **Category teaser show/hide via 10-tabs.js:** Added the teaser element ID to the existing tab-switch mechanism alongside `ingredients-pickup-note` and `ingredients-mill-note`. This keeps the show/hide behavior consistent without introducing new patterns. The teaser starts with `class="hidden"` (kits tab is active by default) and is toggled via `classList.toggle('hidden', tab !== 'ingredients')`.

- **stamp:pages skipped:** The build failed at `stamp:pages` because Plan 22-02 subpage files (`products/hops.html`, `products/grains.html`, etc.) do not exist in this worktree. The JS module change was handled by running `npm run minify:js` directly, which includes concat + terser. The stamp:pages step will succeed once Plan 02 merges into main and those files exist. This is a cross-wave worktree isolation issue, not a bug.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] stamp:pages fails on missing Plan 02 subpage files**
- **Found during:** Task 1 `npm run build`
- **Issue:** `products/hops.html`, `products/grains.html`, etc. referenced in `stamp:pages` don't exist in this worktree (created by Plan 22-02 agent in the other worktree)
- **Fix:** Ran `npm run minify:js` directly (concat:js + terser) to regenerate main.js/main.min.js without stamp:pages. The full `npm run build` will succeed after waves merge on main.
- **Files modified:** js/main.js, js/main.min.js
- **Commit:** ddb7d88

## Known Stubs

- `#ingredients-category-teaser` is a static HTML block with hardcoded links. Links point to `products/hops.html`, `products/grains.html`, etc. These files will be created by Plan 22-02. The teaser renders correctly once those files exist; before that, links 404 (expected during development).

## Threat Flags

None — this plan modifies only static HTML navigation links and a JS tab toggle. No new user input processing, auth paths, or network endpoints introduced.

## Self-Check

All verified before writing SUMMARY:

- [x] `index.html` contains `nav-dropdown-divider`
- [x] `about.html` contains `nav-dropdown-divider`
- [x] `contact.html` contains `nav-dropdown-divider`
- [x] `custom-labels.html` contains `nav-dropdown-divider`
- [x] `products.html` contains `nav-dropdown-divider` + "Browse Ingredients by Category"
- [x] `reservation.html` contains `nav-dropdown-divider`
- [x] `test-subpage.html` contains `nav-dropdown-divider`
- [x] `ingredients.html` contains `nav-dropdown-divider` (3 matches: class on li + role attribute)
- [x] `products/ferment-in-store.html` contains `nav-dropdown-divider`
- [x] No bare `hops.html` link in root-level dropdowns
- [x] `products/ferment-in-store.html` uses `../custom-labels.html` (not `custom-labels.html`)
- [x] Commit `ddb7d88` exists: `git log --oneline | grep ddb7d88`

## Self-Check: PASSED
