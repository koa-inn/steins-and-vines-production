---
phase: 17-custom-labels-page
plan: 03
subsystem: build
tags: [build-pipeline, minification, cache-busting, custom-labels]

# Dependency graph
requires:
  - phase: 17-custom-labels-page plan 01
    provides: custom-labels.html page, css/labels.css
  - phase: 17-custom-labels-page plan 02
    provides: js/modules/14-labels.js canvas mockup module
provides:
  - Build pipeline integration for custom labels page (stamp, minify CSS, minify JS)
  - Minified artifacts css/labels.min.css and js/modules/14-labels.min.js
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [page-specific CSS minification in build pipeline, standalone module minification outside main bundle]

key-files:
  created:
    - css/labels.min.css
    - js/modules/14-labels.min.js
  modified:
    - package.json
    - custom-labels.html

key-decisions:
  - "14-labels.js minified as standalone module (not concatenated into main.js) since it loads only on custom-labels.html"
  - "labels.min.css cache-bust pattern added to stamp:pages for all pages even though only custom-labels.html loads it -- stamp is regex-based and only replaces if found"

requirements-completed: [D-18]

# Metrics
duration: 3min
completed: 2026-05-18
---

# Phase 17 Plan 03: Build Pipeline Integration Summary

**Custom labels page integrated into build pipeline with CSS/JS minification, cache-bust stamping, and full build/test/lint pass -- 381 tests passing, 0 lint errors**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-18T12:40:00Z
- **Completed:** 2026-05-18T12:43:38Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files modified:** 17

## Accomplishments
- Added custom-labels.html to stamp:pages array in package.json
- Added labels.min.css and 14-labels.min.js cache-bust replacement patterns to stamp:pages
- Added labels.css to minify:css command chain
- Added 14-labels.js to minify:js command chain (standalone, not concatenated into main.js)
- Switched custom-labels.html to reference minified CSS and JS with cache-bust params
- Full build completes successfully (npm run build exits 0)
- All 381 frontend tests pass (npm test exits 0)
- ESLint passes with 0 errors (npm run lint exits 0, only pre-existing warnings)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update build pipeline and run full build, test, and lint** - `fe89703` (chore)

## Files Created/Modified
- `package.json` - Updated stamp:pages (added custom-labels.html + labels cache-bust patterns), minify:css (added labels.css), minify:js (added 14-labels.js)
- `custom-labels.html` - Switched to labels.min.css and 14-labels.min.js with cache-bust params
- `css/labels.min.css` - New minified CSS build artifact
- `js/modules/14-labels.min.js` - New minified JS build artifact
- Various HTML files updated by build stamps (cache-bust version strings refreshed)

## Decisions Made
- 14-labels.js stays as standalone minified module (not part of main.js concat) because it only loads on the custom labels page
- Cache-bust patterns for labels assets added to the general stamp:pages loop (no-op on pages that don't reference those files)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None.

## Threat Flags
None - no new network endpoints, auth paths, or trust boundary changes. Build pipeline changes run locally with same trust level as existing scripts.

## Checkpoint: Human Visual Verification (Task 2)

Task 2 is a `checkpoint:human-verify` gate. The human must verify:
1. custom-labels.html renders correctly with hero, how-it-works, pricing, mockup tool, guidelines, CTA
2. Canvas template switching (bottle/can) works
3. Image upload and reset functionality works
4. Navigation links on other pages point to custom-labels.html
5. Mobile responsiveness

## Self-Check: PASSED

- [x] css/labels.min.css exists
- [x] js/modules/14-labels.min.js exists
- [x] package.json references custom-labels.html in stamp:pages
- [x] package.json references labels.css in minify:css
- [x] package.json references 14-labels in minify:js
- [x] custom-labels.html uses labels.min.css
- [x] custom-labels.html uses 14-labels.min.js
- [x] npm run build exits 0
- [x] npm test: 381 passed, 0 failed
- [x] npm run lint: 0 errors
- [x] Commit fe89703 exists

---
*Phase: 17-custom-labels-page*
*Completed: 2026-05-18*
