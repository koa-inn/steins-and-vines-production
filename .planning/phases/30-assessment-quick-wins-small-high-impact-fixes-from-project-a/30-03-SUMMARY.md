---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: 03
subsystem: ui
tags: [css, html, content-json, wcag, contrast, 404, hero]

# Dependency graph
requires:
  - phase: 30-01
    provides: 404.html with sw.js service-worker registration removed (prerequisite for path fix)
provides:
  - hero subtitle resolved to strong copy (content/home.json hero-subtitle key removed)
  - 404.html works on nested URLs with root-absolute paths and minified bundles
  - WCAG contrast improved in labels.css (var(--color-muted)) and styles.css (opacity and placeholder fixes)
  - About page no empty story paragraph
affects: [staging-deploy, homepage, 404, about-page, custom-labels]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "content/home.json: omitting a key leaves the inline HTML fallback intact (13-init.js:230 checks data[k] !== undefined)"
    - "404.html: root-absolute paths required for error pages served at any URL depth"
    - "CSS contrast: var(--color-muted) (#5f5f5f) replaces hardcoded #777 on light backgrounds; rgba alpha raised from 0.6 to 0.85 on dark backgrounds"

key-files:
  created: []
  modified:
    - content/home.json
    - content/about.json
    - about.html
    - 404.html
    - css/labels.css
    - css/labels.min.css
    - css/styles.css
    - css/styles.min.css
    - index.html

key-decisions:
  - "[30-03]: hero-subtitle key removed from home.json rather than replaced — loader leaves inline HTML copy intact when key absent (13-init.js:230 undefined check)"
  - "[30-03]: story-text empty key and its <p data-content='story-text'> both removed — story-text-2 is the real content"
  - "[30-03]: 404.html switches from css/styles.css+js/main.js to /css/styles.min.css+/js/main.min.js (root-absolute + minified production bundles)"
  - "[30-03]: rgba(229,222,193,0.85) used for dark-background placeholders (beer-waitlist, reservation-bar-clear) — matches .beer-banner p pattern at 0.9"

patterns-established:
  - "Root-absolute paths on 404.html: all hrefs/srcs prefixed with / to work at any URL depth on GitHub Pages"

requirements-completed: []

# Metrics
duration: 20min
completed: 2026-06-15
---

# Phase 30 Plan 03: Presentation Bug Fixes Summary

**Hero subtitle strong copy restored (JSON key removal), 404.html root-absolute paths with minified bundles, #777 contrast replaced with var(--color-muted), opacity dimming removed from .hero p, empty About story paragraph eliminated**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-15T22:42:00Z
- **Completed:** 2026-06-15T23:02:24Z
- **Tasks:** 2 auto tasks (Task 3 is checkpoint:human-verify, deferred)
- **Files modified:** 25 (including build artifacts)

## Accomplishments

- Removed `hero-subtitle` key from content/home.json — the 13-init.js content loader leaves the strong inline HTML copy intact when the key is absent (undefined check at line 230), fixing the `Right Here In Squamish.` regression
- Removed empty `<p data-content="story-text">` from about.html and orphaned `story-text: ""` from content/about.json — About page no longer renders a visible empty gap before the real story paragraph
- Converted all relative asset/image/nav/CTA paths in 404.html to root-absolute (`/css/styles.min.css`, `/js/main.min.js`, `/images/...`, `/index.html`, etc.) — 404 page now renders correctly when served from any URL depth (e.g. /products/anything-bad)
- Replaced three hardcoded `#777` occurrences in css/labels.css with `var(--color-muted)` (#5f5f5f) for WCAG-compliant contrast on light backgrounds
- Removed `opacity: 0.9` from `.hero p` in both css/styles.css and the index.html inline critical CSS block
- Raised beer-waitlist email placeholder and reservation-bar-clear from `rgba(229,222,193,0.6)` to `rgba(229,222,193,0.85)` for improved contrast on dark backgrounds
- Ran `npm run build` to regenerate all minified CSS bundles and update cache-busting version strings across all pages

## Task Commits

1. **Task 1: Fix hero subtitle (#1) and empty story paragraph (#6)** - `222460f` (fix)
2. **Task 2: Fix 404.html nested-URL paths (#3) and contrast (#5)** - `a047fe1` (fix)

## Files Created/Modified

- `content/home.json` — removed `hero-subtitle` key (weak tagline was overwriting strong HTML copy at runtime)
- `content/about.json` — removed `story-text: ""` (empty key that rendered blank paragraph)
- `about.html` — removed `<p data-content="story-text">` empty element; build also updated CSS version stamp
- `404.html` — all paths converted to root-absolute; CSS/JS switched to minified production bundles
- `css/labels.css` — replaced `#777` with `var(--color-muted)` at lines 141, 157, 225
- `css/labels.min.css` — regenerated from labels.css via `npm run build`
- `css/styles.css` — removed `opacity: 0.9` from `.hero p`; raised placeholder/clear alpha from 0.6 to 0.85
- `css/styles.min.css` — regenerated from styles.css via `npm run build`
- `index.html` — removed `opacity:.9` from inline critical CSS `.hero p`; build updated version stamp
- All other HTML pages — build updated cache-busting version strings (admin.html, kiosk.html, brewpad.html, products/*.html, etc.)

## Decisions Made

- Removed `hero-subtitle` key from JSON rather than replacing with the strong copy: the loader's `data[k] !== undefined` guard means the inline HTML fallback wins automatically when the key is absent — simpler, less duplication
- Removed both the empty `<p>` element and the orphaned `story-text` key together — no dangling JSON key that could confuse future editors
- 404.html now references minified production CSS/JS rather than the unminified development files — consistent with all other production pages
- `rgba(229,222,193,0.85)` chosen for dark-background placeholders to match the existing `.beer-banner p` pattern (which uses `opacity: 0.9`) while staying below the full cream value

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Also fixed reservation-bar-clear contrast in styles.css**
- **Found during:** Task 2 (styles.css contrast fixes)
- **Issue:** `.reservation-bar .reservation-bar-clear` also used `rgba(229,222,193,0.6)` on the green reservation bar background — same WCAG contrast failure, same file, same value
- **Fix:** Raised to `rgba(229,222,193,0.85)` matching the waitlist placeholder fix
- **Files modified:** `css/styles.css`, `css/styles.min.css`
- **Verification:** No `rgba(229,222,193,0.6)` remains in styles.css
- **Committed in:** `a047fe1` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Root-absolute paths applied to all 404.html image srcs, not just CSS/JS**
- **Found during:** Task 2 (404.html path fixes)
- **Issue:** Plan specified nav/CTA links and asset paths; images (`/images/SV_Logo...`, `/images/Icon...`) were also relative and would 404 on nested URLs
- **Fix:** Applied root-absolute prefix to all `src=` and `href=` attributes in 404.html including images, apple-touch-icon, manifest, favicon
- **Files modified:** `404.html`
- **Verification:** No relative `src="images/` or `href="images/` remain in 404.html
- **Committed in:** `a047fe1` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both fixes necessary for complete correctness. No scope creep.

## Issues Encountered

None — all edits were straightforward CSS/JSON/HTML changes with no surprises.

## Known Stubs

None — all content changes are wired to real data. The empty `story-text` placeholder has been eliminated.

## Threat Flags

None — presentation-only changes (content JSON, CSS, static HTML). No new attack surface introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 items (#1, #3, #5, #6) are complete and committed
- Task 3 (checkpoint:human-verify / staging deploy) is pending — deferred to orchestrator for phase-level staging gate consolidation
- Ready for: staging push → verify homepage hero strong copy, 404 nested-URL rendering, About page story paragraph, label/placeholder contrast

## Self-Check: PASSED

Commits found: `222460f` and `a047fe1` confirmed in git log. Key files present: content/home.json, 404.html, css/labels.css, css/styles.css, index.html all modified. No `Right Here In Squamish` in content/home.json. No `data-content="story-text"` (without dash suffix) in about.html. `/css/styles.min.css` in 404.html. No `opacity:.9` in index.html. No `#777` in labels.css.

---
*Phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a*
*Completed: 2026-06-15*
