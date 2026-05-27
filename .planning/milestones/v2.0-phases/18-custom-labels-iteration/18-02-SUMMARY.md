---
phase: 18-custom-labels-iteration
plan: "02"
subsystem: frontend/labels-mockup
tags: [canvas, labels, es5, pricing-table, cylindrical-warp]
dependency_graph:
  requires: [18-01]
  provides: [14-labels.js rendering engine, LABEL_DATA constant, pricing table]
  affects: [custom-labels.html, js/modules/14-labels.min.js]
tech_stack:
  added: []
  patterns: [Canvas 2D API, scanline cylindrical warp, IIFE module pattern, CJS exports for testing]
key_files:
  created: []
  modified:
    - js/modules/14-labels.js
    - js/modules/14-labels.min.js
decisions:
  - LABEL_DATA comment references excluded SKUs for D-08 auditability even though grep count shows 1 (comment-only, not in array)
  - drawFallbackTemplate uses proportional coordinates so it scales correctly across all 3 canvas sizes
  - All 3 tasks implemented in one cohesive Write since they all target the same file and can't be safely split mid-refactor
metrics:
  duration: "~35 min"
  completed: "2026-05-18"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 2
---

# Phase 18 Plan 02: 14-labels.js 3-Canvas Rendering Engine Summary

## One-liner

Complete overhaul of 14-labels.js to support LABEL_DATA-driven pricing table, 3-canvas rendering (flat/can/bottle), scanline cylindrical warp compositing, and label-type selector with container show/hide.

## What Was Built

Replaced the single-canvas labels mockup module with a full 3-canvas rendering engine:

**LABEL_DATA constant (Task 1):** 15 label SKUs across 3 material groups (5 BOPP, 3 Poly, 7 Paper). Packaging SKUs `11013-c4000` and `11034-c4000` excluded per D-08 (documented in comment). Each entry includes sku, name, dimensions, material, price, containers, and uses fields.

**buildPricingTable() (Task 1):** Iterates LABEL_DATA by material group, generates 3 HTML tables (Satin/Matte BOPP, Matte Poly, High Gloss Paper), appends $10 setup fee note per D-12. Target element: `id="labels-pricing-table-wrap"`.

**New rendering functions (Task 2):**
- `drawCylindrical(ctx, labelImg, region, numSlices)` — scanline cosine warp (scale = cos(t) * 0.3 + 0.7) for realistic cylindrical label appearance
- `renderFlat()` — draws label at correct aspect ratio with dimension text below, handles continuous roll edge case
- `renderCan()` / `renderBottle()` — draw photo background with SVG/drawn fallback, composite label via drawCylindrical
- `renderAll()` — orchestrates all 3 canvases (D-02: single upload updates all)
- `PHOTO_PATHS` — paths to `images/labels/can-photo.jpg` and `bottle-photo.jpg`
- `PHOTO_LABEL_REGIONS` — initial label position estimates for photo canvases (tunable in Plan 03)

**State, handlers, init wiring (Task 3):**
- State vars updated for 3 canvases: `_canvasFlat/_ctxFlat`, `_canvasCan/_ctxCan`, `_canvasBottle/_ctxBottle`, `_currentLabelType`, `_typeSelect`
- `populateLabelTypeSelector()` fills `<select id="labels-type-select">` from LABEL_DATA, defaults to first non-continuous label
- `handleLabelTypeChange()` + `updateContainerVisibility()` — D-06 container show/hide via `.hidden` class on `#preview-can-wrap` and `#preview-bottle-wrap`
- `drawFallbackTemplate(ctx, type, w, h)` — parameterized for 3-canvas use (was global-state-dependent)
- `preloadImages()` updated to `total = 5` (bottleSvg, canSvg, canPhoto, bottlePhoto, placeholder)
- Old code removed: `handleTemplateSwitch`, `CANVAS_WIDTH/HEIGHT`, `LABEL_REGIONS`, single `_canvas/_ctx`, `render()`
- CJS exports updated to expose all new public symbols

## Commits

| Hash | Message |
|------|---------|
| 12310cf | feat(18-02): overhaul 14-labels.js with 3-canvas engine, LABEL_DATA, cylindrical warp |
| 352970c | chore(18-02): rebuild assets and stamp cache versions after 14-labels.js overhaul |

## Verification Results

- ESLint: PASS (exit 0, no warnings on 14-labels.js)
- Terser minification: PASS (exit 0, valid JS output)
- npm run build: PASS (CSS + JS minified, all HTML pages stamped)
- LABEL_DATA entries: 15 confirmed
- No forbidden SKUs in LABEL_DATA array (11013-c4000, 11034-c4000 in comment only for D-08 documentation)
- No old single-canvas code remaining (handleTemplateSwitch: 0 matches, CANVAS_WIDTH: 0 matches)
- CJS exports: all new symbols present (_renderAll, _renderFlat, _renderCan, _renderBottle, _drawCylindrical, _handleLabelTypeChange, LABEL_DATA)

## Deviations from Plan

### Auto-fixed Issues

None.

### Intentional Adjustments

**1. drawFallbackTemplate coordinates converted to proportional**
- **Found during:** Task 3 implementation
- **Issue:** Original fallback used fixed pixel values (600x800 coordinate space). With 3 different canvas sizes (300x300, 280x420, 280x560), the hardcoded pixel positions would produce wrong shapes.
- **Fix:** Converted all coordinates to `w * fraction` / `h * fraction` proportional math so the bottle/can shapes scale correctly across all 3 canvases.
- **Files modified:** js/modules/14-labels.js
- **No plan deviation:** The plan specified parameterizing the function; proportional coordinates are the correct implementation detail.

**2. Tasks 1-3 committed together**
- All 3 tasks modify the same file (`js/modules/14-labels.js`) and form one atomic transformation. Committing mid-way would leave the file in a broken state (functions referenced before being added). One commit with all changes is the correct approach.

## Known Stubs

- `PHOTO_LABEL_REGIONS` values (`can: { x:50, y:100, w:180, h:200 }`, `bottle: { x:60, y:200, w:160, h:130 }`) are initial estimates. These will need visual tuning in Plan 03 human verification once the actual can/bottle photos are in place.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. File upload handler preserves existing validation (type + size). LABEL_DATA is a hardcoded constant — no XSS vector. Photo assets must be served from same origin (`images/labels/`) per existing CSP `img-src 'self' data:`.

## Self-Check: PASSED

- js/modules/14-labels.js: EXISTS
- js/modules/14-labels.min.js: EXISTS (regenerated by build)
- Commit 12310cf: VERIFIED (feat)
- Commit 352970c: VERIFIED (chore/build)
- LABEL_DATA: 15 entries confirmed
- All acceptance criteria met for Tasks 1, 2, and 3
