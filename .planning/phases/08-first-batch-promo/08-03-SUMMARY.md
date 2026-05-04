---
phase: 08-first-batch-promo
plan: 03
subsystem: frontend
tags: [promo-banner, homepage, json-driven, dismissible, localStorage, ES5]
dependency_graph:
  requires: []
  provides: [promo-banner-feature, initPromoBanner-function]
  affects: [index.html, content/home.json, js/modules/13-init.js, css/styles.css]
tech_stack:
  added: []
  patterns: [json-driven-content, hidden-class-toggle, localStorage-dismiss-state]
key_files:
  created: []
  modified:
    - content/home.json
    - index.html
    - js/modules/13-init.js
    - css/styles.css
    - js/main.js
    - js/main.min.js
    - css/styles.min.css
decisions:
  - Placed initPromoBanner() before DOMContentLoaded and replicated the IS_KIOSK check inline (window.location.search + standalone) rather than referencing the inner-scope variable
  - Used classList.remove('hidden') pattern consistent with project convention throughout
metrics:
  duration: 15 min
  completed: 2026-05-04
  tasks_completed: 2
  tasks_total: 2
---

# Phase 08 Plan 03: Promo Banner Summary

**One-liner:** JSON-driven dismissible FIRSTBATCH promo banner with localStorage persistence and kiosk guard, rendered via classList.remove('hidden') pattern.

## What Was Built

Added a full-width burgundy banner strip to the homepage advertising 20% off the first batch with code FIRSTBATCH. The banner is:
- **Content-driven**: configured via `content/home.json` `promo-banner` object with `enabled`, `tag`, `text`, `cta`, and `cta-href` fields
- **Toggle-without-deploy**: set `"enabled": false` in `home.json` to hide the banner
- **Dismissible**: clicking the X button hides the banner and stores `sv-promo-banner-dismissed` in localStorage
- **Persistent dismiss**: once dismissed, the banner does not reappear on subsequent page loads
- **Kiosk-safe**: `initPromoBanner()` checks `window.location.search` for `kiosk=1` and `window.navigator.standalone` before rendering

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add promo-banner to home.json and insert banner element in index.html | 77cba6c | content/home.json, index.html |
| 2 | Create initPromoBanner() in 13-init.js and add dismiss button CSS | 5808b13 | js/modules/13-init.js, css/styles.css, js/main.js, js/main.min.js, css/styles.min.css, all HTML stamp files |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IS_KIOSK scope: function placed outside listener cannot access inner-scope variable**
- **Found during:** Task 2
- **Issue:** Plan specified placing `initPromoBanner()` before the `DOMContentLoaded` listener. `IS_KIOSK` is declared inside the listener as a `var`, so it would be `undefined` in a function defined outside the closure.
- **Fix:** Replicated the kiosk check inline using `var isKiosk = (window.location.search.indexOf('kiosk=1') !== -1) || (window.navigator.standalone === true)` — identical logic to the IS_KIOSK definition in the listener.
- **Files modified:** js/modules/13-init.js
- **Commit:** 5808b13

## Verification Results

- `npm run build`: PASS (build succeeded, main.js regenerated)
- `npm run lint`: PASS (0 errors, 79 pre-existing warnings)
- `npm test`: PASS (270/270 tests)
- `grep "function initPromoBanner" js/modules/13-init.js`: FOUND
- `grep "initPromoBanner()" js/modules/13-init.js`: FOUND (call in home page block)
- `grep "promo-banner-dismiss" css/styles.css`: FOUND (2 rules)
- `node -e "require('./content/home.json')['promo-banner'].enabled"`: `true`
- `grep 'classList.remove.*hidden' js/modules/13-init.js`: FOUND

## Known Stubs

None — banner content is fully wired from `content/home.json`.

## Threat Flags

None — all identified threats (T-08-12, T-08-13, T-08-14) are in-scope and mitigated per the plan's threat model:
- T-08-14: fetch `.catch()` silently fails, banner is non-critical
- T-08-12: content/home.json is a repo-controlled static file, not user-supplied input
- T-08-13: localStorage dismiss key is user-controlled by design (D-02 explicitly accepts this)

## Self-Check: PASSED

- content/home.json contains promo-banner object: FOUND
- index.html contains id="promo-banner": FOUND
- js/modules/13-init.js contains function initPromoBanner: FOUND
- css/styles.css contains .promo-banner-dismiss: FOUND
- Commit 77cba6c: FOUND
- Commit 5808b13: FOUND
