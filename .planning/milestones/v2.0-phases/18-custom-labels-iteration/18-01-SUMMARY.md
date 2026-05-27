---
phase: 18
plan: "01"
subsystem: frontend/labels
tags: [html, css, assets, seo, copy]
dependency_graph:
  requires: []
  provides:
    - custom-labels.html 3-canvas mockup HTML structure with all element IDs for Plan 02
    - css/labels.css 3-column preview layout and new component styles
    - images/labels/can-photo.jpg and bottle-photo.jpg for canvas compositing
  affects:
    - js/modules/14-labels.js (Plan 02 — targets element IDs created here)
tech_stack:
  added: []
  patterns:
    - flex 3-column layout for canvas preview panel
    - JS-populated wrapper pattern (empty div with id, populated by Plan 02)
key_files:
  created:
    - images/labels/can-photo.jpg
    - images/labels/bottle-photo.jpg
    - .planning/phases/18-custom-labels-iteration/18-01-SUMMARY.md
  modified:
    - css/labels.css
    - css/labels.min.css
    - custom-labels.html
    - about.html, admin.html, brewpad.html, contact.html, index.html, ingredients.html, js/admin.js, kiosk.html, products.html, products/ferment-in-store.html, products/ingredients-supplies.html, reservation.html (build stamp cache busters)
decisions:
  - "Photo assets sourced from Unsplash (free commercial use) instead of Pexels #8066771 — Pexels URL returned 404; Unsplash used as equivalent free-use substitute. User can swap both files later."
  - "css/labels.min.css regenerated manually using node + cleancss binary from main repo node_modules — npm run build in worktree silently skipped minification because no node_modules symlink in worktree."
  - "Build cache-buster stamps committed alongside HTML changes — npm run build auto-updates all page version strings as part of minify pipeline."
metrics:
  duration: "26 min"
  completed: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 16
---

# Phase 18 Plan 01: Static Foundation — HTML Structure, CSS Layout, Photo Assets Summary

3-canvas preview layout HTML, broadened multi-audience copy, JS-populated pricing wrapper, and photo assets for the Phase 18 custom labels iteration.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Download photo assets and update CSS with 3-column preview layout | `6dd992d` | css/labels.css, images/labels/can-photo.jpg, images/labels/bottle-photo.jpg |
| 2 | Update custom-labels.html with 3-canvas mockup, broadened copy, pricing wrapper, guidelines, and SEO meta | `4bb8582` | custom-labels.html, css/labels.min.css, 13 other HTML files (build stamps) |

## What Was Built

### Photo Assets

- `images/labels/can-photo.jpg` — 110KB JPEG (Unsplash free license, beer cans photo), serves as placeholder for can canvas compositing. User can swap with own photo.
- `images/labels/bottle-photo.jpg` — 65KB JPEG (Unsplash free license, wine bottles photo), serves as placeholder for bottle canvas compositing. User can swap with own photo.

### CSS (css/labels.css + css/labels.min.css)

New classes added (D-01, D-06, D-11, D-13):
- `.labels-previews` — flex container, `display: flex; gap: 1.5rem; justify-content: center; align-items: flex-start; flex-wrap: wrap`
- `.labels-preview-col` — individual preview column, `flex: 1; min-width: 180px; max-width: 280px`
- `.labels-preview-col canvas` — canvas styling (border, border-radius, background-color)
- `.labels-preview-label` — caption text ("Flat View", "On a Can", "On a Bottle")
- `.labels-preview-col.hidden` — `display: none` for D-06 container compatibility hide
- `.labels-type-selector` / `.labels-type-selector select` — label size dropdown (min-height 44px touch target)
- `.labels-pricing-group-title` — material group heading, burgundy, display font
- `.labels-pricing-group-subtitle` — material description, muted color
- `.labels-anyone-callout` — green left-border callout for D-11 "anyone welcome" messaging
- Responsive rules inside existing `@media (max-width: 768px)` block: `.labels-previews { flex-direction: column }`, `.labels-preview-col { max-width: 320px; width: 100% }`

Removed:
- `#labels-canvas` standalone rule (replaced by `.labels-preview-col canvas` class rule)
- `#labels-canvas { max-width: 100% }` from responsive block

### HTML (custom-labels.html)

All element IDs that Plan 02's 14-labels.js will target are in place:
- `id="labels-canvas-flat"` — flat preview canvas (aria-labeled)
- `id="labels-canvas-can"` — can preview canvas (aria-labeled)
- `id="labels-canvas-bottle"` — bottle preview canvas (aria-labeled)
- `id="preview-can-wrap"` — can column wrapper for D-06 show/hide
- `id="preview-bottle-wrap"` — bottle column wrapper for D-06 show/hide
- `id="labels-type-selector"` — label size selector wrapper (JS populates select options)
- `id="labels-type-select"` — the select element itself
- `id="labels-pricing-table-wrap"` — pricing table container (JS populates content via buildPricingTable())
- `id="labels-upload"` — file input (preserved from Phase 17)
- `id="labels-reset"` — reset button (preserved from Phase 17)

Copy updated (D-09, D-10, D-11):
- Hero subheadline: "Your design. Your bottle. We'll make it look amazing — for homebrewers, events, or your small business."
- SEO meta description: broadened to include "homebrewers, events, and small businesses" and "$0.15/label" price anchor
- og:description: broadened to include "no membership required"
- "Anyone Can" callout added inside how-it-works section
- CTA body: "Stop by the shop with your design file or email it to us."

Removed:
- Old `#labels-canvas` single canvas element
- Template toggle buttons (`labels-template-btn`, `labels-template-selector`)
- Old `id="labels-pricing-table"` static table with hardcoded rows ($2.50, $2.00, $3.50, $3.00, $3.50)

Design guidelines updated (D-15):
- "Label Dimensions" renamed to "Print Dimensions"
- Hardcoded dimension list replaced with "Max print width: 4.25 in"
- BOPP waterproof material mention added to Colour Mode section
- File Format simplified per spec

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pexels photo URL returned 404**
- **Found during:** Task 1 photo download
- **Issue:** Plan specified Pexels #8066771 URL (`images.pexels.com/photos/8066771/...`) but URL returned HTTP 404. Multiple URL formats tried, all failed.
- **Fix:** Used Unsplash free-license photos instead — beer cans photo for can-photo.jpg, wine bottles photo for bottle-photo.jpg. Both are free commercial use (Unsplash License). User can swap either file with their own photos at any time.
- **Files modified:** images/labels/can-photo.jpg, images/labels/bottle-photo.jpg
- **Commit:** `6dd992d`

**2. [Rule 3 - Blocking] npm run build silently skipped CSS minification in worktree**
- **Found during:** Task 2 post-build verification
- **Issue:** Git worktree has no `node_modules` directory; npm scripts prepend `<worktree>/node_modules/.bin` to PATH when running, but since no node_modules exist there, `cleancss` was not on PATH. Build command exited 0 silently without generating labels.min.css.
- **Fix:** Ran `node /main-repo/node_modules/.bin/cleancss -o css/labels.min.css css/labels.css` directly to regenerate the minified file (5829 bytes vs prior 4457 bytes).
- **Files modified:** css/labels.min.css
- **Commit:** `4bb8582` (included in Task 2 commit)

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `<select id="labels-type-select">` (empty) | custom-labels.html | ~177 | Plan 02 (14-labels.js) populates options from LABEL_DATA constant |
| `<div id="labels-pricing-table-wrap">` (empty) | custom-labels.html | ~157 | Plan 02 (14-labels.js) populates pricing table via buildPricingTable() |

These stubs are intentional per plan design — this plan establishes the HTML structure; Plan 02 wires the JS. The canvases show blank until Plan 02 provides JS initialization. The page loads without JS errors in its current state (empty select and empty div are valid HTML).

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The `img-src 'self' data:` CSP policy is respected — photo assets are served locally from `images/labels/` (not hotlinked). The file upload input has `accept=".png,.jpg,.jpeg,.webp"` per T-18-01 mitigation; JS-layer validation will be added in Plan 02.

## Self-Check: PASSED

Files exist:
- FOUND: images/labels/can-photo.jpg
- FOUND: images/labels/bottle-photo.jpg
- FOUND: css/labels.css (contains labels-previews)
- FOUND: custom-labels.html (contains id=labels-canvas-flat)

Commits exist:
- FOUND: 6dd992d (Task 1)
- FOUND: 4bb8582 (Task 2)
