---
phase: 18
plan: "03"
subsystem: frontend/labels-mockup
tags: [canvas, labels, build, photo-assets, lint, testing]
dependency_graph:
  requires: [18-01, 18-02]
  provides:
    - Verified build artifacts: css/labels.min.css, js/modules/14-labels.min.js
    - Tuned PHOTO_LABEL_REGIONS coordinates (can + bottle)
    - Replaced bottle-photo.jpg with proper wine bottle product shot
  affects:
    - custom-labels.html (cache-buster stamps updated)
    - All 8 public HTML pages (cache-buster stamps updated by build)
tech_stack:
  added: []
  patterns:
    - SVG fallback pattern for can canvas (can-photo.jpg removed; can-template.svg used instead)
    - Proportional label region coordinates derived from SVG viewBox math
key_files:
  created: []
  modified:
    - js/modules/14-labels.js (PHOTO_LABEL_REGIONS tuned)
    - js/modules/14-labels.min.js (rebuilt)
    - images/labels/bottle-photo.jpg (replaced with wine bottle product shot)
    - css/labels.min.css (rebuilt)
    - custom-labels.html (cache-buster stamps)
    - js/main.js, js/main.min.js (rebuilt)
decisions:
  - "can-photo.jpg removed — original photo (cocktail drinks) was completely wrong for a can label mockup; can-template.svg provides a cleaner purpose-built can illustration and is used as fallback automatically"
  - "bottle-photo.jpg replaced with Pexels wine bottle product shot (blank label visible) at 280x560px matching canvas dimensions exactly"
  - "PHOTO_LABEL_REGIONS for can derived mathematically from SVG viewBox (600x800) scaled to canvas (280x420)"
  - "PHOTO_LABEL_REGIONS for bottle derived from visual inspection of bottle-photo.jpg showing blank label area"
metrics:
  duration: "~30 min"
  completed: "2026-05-18"
  tasks_completed: 1
  tasks_total: 2
  files_created: 0
  files_modified: 18
---

# Phase 18 Plan 03: Build, Lint, Test, Photo Tuning, and Human Verification Summary

Lint, test, and build pipeline verified clean; PHOTO_LABEL_REGIONS tuned based on actual photo inspection; can-photo.jpg replaced/removed in favor of correct assets; checkpoint reached for human visual verification.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Lint, test, build, and tune PHOTO_LABEL_REGIONS coordinates | `b1aaa2b` | js/modules/14-labels.js, images/labels/bottle-photo.jpg, images/labels/can-photo.jpg (deleted) |

## What Was Built / Verified

### Automated Quality Gates

- `npm run lint`: PASS — 0 errors, 96 warnings (pre-existing, not introduced by Phase 18)
- `npm test` (frontend): PASS — 381 tests, 21 suites
- `cd zoho-middleware && npm test` (middleware): PASS — 510 tests, 24 suites
- `npm run build`: PASS — CSS minified, JS minified and concatenated, all HTML stamps updated

### Build Artifacts

- `css/labels.min.css`: EXISTS, non-empty
- `js/modules/14-labels.min.js`: EXISTS, non-empty
- `custom-labels.html`: cache buster `?v=mpbpbske` on both labels.min.css and 14-labels.min.js

### PHOTO_LABEL_REGIONS Tuning

**Previous values (untuned estimates from Plan 02):**
```js
can:    { x: 50, y: 100, w: 180, h: 200 },
bottle: { x: 60, y: 200, w: 160, h: 130 }
```

**Tuned values (Plan 03):**
```js
can:    { x: 95, y: 125, w: 90, h: 170 },
bottle: { x: 55, y: 190, w: 120, h: 170 }
```

Can coordinates derived from `can-template.svg` viewBox math:
- SVG label rect: `x=210, y=240, w=180, h=320` in 600x800 viewBox
- Scale factors: x=0.467 (280/600), y=0.525 (420/800)
- Canvas coords: x=98≈95, y=126≈125, w=84≈90, h=168≈170

Bottle coordinates derived from visual inspection of bottle-photo.jpg (280x560):
- Wine bottle centered-left in image with blank label area
- Label region estimated at left=55, top=190, right=175, bottom=360

### Photo Assets

- `images/labels/bottle-photo.jpg`: Replaced with Pexels wine bottle product photo (27KB, 280x560px) showing a wine bottle with a blank white label area, surrounded by grapes and flowers on a wooden table. The blank label area is clearly visible and centered on the bottle body.
- `images/labels/can-photo.jpg`: Removed. Original was a cocktail drink photo (wrong subject). The JS fallback automatically uses `can-template.svg` — a purpose-built can illustration with gradient body and white label region.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] can-photo.jpg was wrong subject (cocktail drinks, not aluminum can)**
- **Found during:** Task 1 photo inspection step
- **Issue:** The photo downloaded in Plan 01 showed cocktail drinks in glasses, not an aluminum beverage can. Overlaying a label on this photo would produce nonsensical output (label on drink glass).
- **Fix:** Removed can-photo.jpg. The JS rendering engine already has a fallback hierarchy: canPhoto → canSvg → drawFallbackTemplate(). With can-photo.jpg absent, the browser falls through to can-template.svg which is a purpose-built silver can illustration with a white label region — ideal for the mockup.
- **Files modified:** images/labels/can-photo.jpg (deleted)
- **Commit:** `b1aaa2b`

**2. [Rule 1 - Bug] bottle-photo.jpg was wrong subject (wine glasses toasting, not a bottle)**
- **Found during:** Task 1 photo inspection step
- **Issue:** The photo downloaded in Plan 01 showed people toasting with wine glasses, not a wine bottle with a visible label area.
- **Fix:** Replaced with a Pexels wine bottle product shot (photo 1407846) showing a single wine bottle with a blank white label area, shot from above on a dark wooden surface with grapes and flowers. The photo is 280x560px (exactly matching the bottle canvas dimensions). Free commercial use under Pexels License.
- **Files modified:** images/labels/bottle-photo.jpg
- **Commit:** `b1aaa2b`

## Task 2: Checkpoint

Task 2 is `type="checkpoint:human-verify"` — awaiting human visual sign-off before proceeding to staging deploy.

## Known Stubs

None — the label regions have been tuned based on actual photo/SVG inspection. Fine-tuning after human visual verification (Task 2) may adjust coordinates further if the overlay does not look centered.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Photo assets are static local files. No CSP changes needed.

## Self-Check: PASSED

- js/modules/14-labels.js: EXISTS, PHOTO_LABEL_REGIONS tuned (comment references SVG math)
- js/modules/14-labels.min.js: EXISTS and non-empty
- css/labels.min.css: EXISTS and non-empty
- images/labels/bottle-photo.jpg: EXISTS (27KB wine bottle product shot)
- images/labels/can-photo.jpg: INTENTIONALLY ABSENT (wrong photo removed)
- Commit b1aaa2b: VERIFIED
- Frontend tests: 381 PASS
- Middleware tests: 510 PASS
- Lint: 0 errors
