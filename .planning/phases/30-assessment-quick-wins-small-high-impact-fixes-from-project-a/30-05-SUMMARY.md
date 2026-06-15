---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: "05"
subsystem: security-hardening
tags: [xss, prototype-pollution, escapeHTML, kiosk, admin, catalog]
dependency_graph:
  requires: [30-04]
  provides: [30-05]
  affects: [js/kiosk.js, js/admin.js, js/modules/07-catalog-kits.js, js/modules/02-utils.js, js/brewpad.js, js/main.js, js/main.min.js, js/kiosk.min.js, js/admin.min.js, js/brewpad.min.js, package.json]
tech_stack:
  added: []
  patterns:
    - escapeHTML wrapping at innerHTML sinks (T-30-05-XSS1, T-30-05-XSS2)
    - prototype-pollution guard at custom-field key assignment (T-30-05-PP)
    - single canonical escapeHTML in concat:js bundle (T-30-05-ESC)
key_files:
  created:
    - tests/frontend/catalog-kits-proto-guard.test.js
  modified:
    - js/kiosk.js
    - js/admin.js
    - js/modules/07-catalog-kits.js
    - js/modules/02-utils.js
    - js/brewpad.js
    - js/main.js
    - js/main.min.js
    - js/kiosk.min.js
    - js/admin.min.js
    - js/brewpad.min.js
    - package.json
decisions:
  - "[30-05]: flattenCustomFields extracted as top-level helper with module.exports for test isolation; replaces inline forEach in fetchFromMiddleware()"
  - "[30-05]: js/lib/utils.js added to concat:js BEFORE 02-utils.js; 02-utils.js weak escapeHTML removed (now resolves canonical via global); Node test fallback require('../lib/utils').escapeHTML added to 02-utils.js top"
  - "[30-05]: kiosk.js keeps its own standalone escapeHTML copy (not in concat pipeline); null guard added; apostrophe was already present"
  - "[30-05]: brewpad.js local escapeHTML upgraded in-place (apostrophe + null guard); still standalone"
  - "[30-05]: admin.js escapeHTML inside IIFE already canonical (apostrophe + null guard) — no change needed for admin.js escapeHTML definition itself"
metrics:
  duration: "~20 min"
  completed: "2026-06-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 28
---

# Phase 30 Plan 05: Security Hardening Batch (XSS Escaping + Canonical escapeHTML + Prototype-Pollution Guard) Summary

Security hardening batch: escape customer-controlled Zoho contact name/email at all staff POS innerHTML sinks in kiosk.js and admin.js (#7/#8), canonicalize to a single apostrophe-escaping escapeHTML in the main bundle via js/lib/utils.js (#8/#9), and guard the catalog custom-field flattening loop against __proto__/constructor/prototype prototype-pollution attacks (D-04 group c).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Escape XSS sinks + proto guard + regression test | a7def41 | js/kiosk.js, js/admin.js, js/modules/07-catalog-kits.js, tests/frontend/catalog-kits-proto-guard.test.js |
| 2 | Canonicalize escapeHTML in bundle + rebuild | 5f4fdec | js/modules/02-utils.js, js/brewpad.js, js/kiosk.js, package.json, js/main.js, js/main.min.js, js/admin.min.js, js/brewpad.min.js, js/kiosk.min.js + all HTML stamps |

## What Was Built

### Item #7 / T-30-05-XSS1 — kiosk.js XSS sinks escaped

Both contact-render innerHTML sinks in `js/kiosk.js` now wrap customer-controlled values in `escapeHTML()`:
- `selectedEl.innerHTML` display sink (~2242): `c.name` and `c.email`
- result-row loop innerHTML sink (~2344): `c.contact_id`, `c.contact_name || c.name`, `c.email`

### Item #7 / T-30-05-XSS2 — admin.js XSS sinks escaped

Both mirrored contact-search innerHTML sinks in `js/admin.js` now wrap in `escapeHTML()`:
- `selectedEl.innerHTML` display sink (~10092): `c.name` and `c.email`
- result-row loop innerHTML sink (~10185): `c.contact_id`, `c.contact_name || c.name`, `c.email`

### Item #9 / T-30-05-ESC — Canonical escapeHTML in bundle

- `js/lib/utils.js` (canonical — with `&#39;` apostrophe escaping) added to `package.json concat:js` pipeline, placed immediately after `js/lib/constants.js` and before `js/modules/02-utils.js`
- The duplicate weak `function escapeHTML` (no apostrophe, in `02-utils.js:97`) removed; Node test fallback added at top of `02-utils.js`: `if (typeof escapeHTML === 'undefined' && typeof require !== 'undefined') { var escapeHTML = require('../lib/utils').escapeHTML; }`
- `js/brewpad.js` standalone local `escapeHTML` upgraded to canonical form (apostrophe + null guard)
- `js/kiosk.js` standalone local `escapeHTML` updated with null guard (apostrophe was already present)
- Verified: `grep -c 'function escapeHTML[^A-Za-z]' js/main.js` == **1**

### D-04 group c / T-30-05-PP — Prototype-pollution guard

- `flattenCustomFields(obj, customFields)` extracted as a top-level named function in `js/modules/07-catalog-kits.js`, exported via `module.exports` for test isolation
- Guard added: `if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;` — same pattern as `js/modules/17-search-overlay.js:176`
- Called from `fetchFromMiddleware()` replacing the former inline `forEach`
- Regression test: `tests/frontend/catalog-kits-proto-guard.test.js` — 9 tests covering pollution guard + normal flatten + edge cases

## Test Results

- Frontend: 34 suites / 674 tests — all PASS
- Middleware: 31 suites / 648 tests — all PASS
- Lint: 0 errors (122 pre-existing warnings in other files, unchanged)
- TDD gate: RED (9 failures) → GREEN (9 passes) confirmed for proto-guard tests

## Deviations from Plan

### Auto-added: module.exports for flattenCustomFields

**Found during:** Task 1  
**Issue:** `07-catalog-kits.js` had no exports — proto-guard test couldn't import the flattening logic  
**Fix:** Extracted inline forEach into named `flattenCustomFields()` helper at top-level scope; added `module.exports = { flattenCustomFields }` with standard Node guard  
**Files modified:** `js/modules/07-catalog-kits.js`  
**Commit:** a7def41  
**Rule:** Rule 2 — missing functionality required for testability (plan acceptance criteria required the test to exist and pass)

### Auto-added: escapeHTML wraps data-id attribute (contact_id)

**Found during:** Task 1  
**Issue:** `data-id="' + (c.contact_id || '') + '"` was also customer-controlled data in an HTML attribute — same XSS risk pattern as the visible name/email sinks  
**Fix:** Wrapped `c.contact_id` in `escapeHTML()` at the result-row HTML in both kiosk.js and admin.js  
**Files modified:** `js/kiosk.js`, `js/admin.js`  
**Commit:** a7def41  
**Rule:** Rule 2 — missing escaping at an additional XSS sink discovered while fixing the specified sinks

### Node fallback in 02-utils.js for escapeHTML

**Found during:** Task 2  
**Issue:** After removing the local `escapeHTML` from `02-utils.js`, the module's `module.exports = { escapeHTML: escapeHTML, ... }` would reference an undefined `escapeHTML` in Node test context (the global from `js/lib/utils.js` is only available in browser/concat context)  
**Fix:** Added Node-env require fallback at top of `02-utils.js`: `if (typeof escapeHTML === 'undefined' && typeof require !== 'undefined') { var escapeHTML = require('../lib/utils').escapeHTML; }`  
**Files modified:** `js/modules/02-utils.js`  
**Commit:** 5f4fdec  
**Rule:** Rule 3 — blocking issue (would break `utils.test.js` which imports escapeHTML from 02-utils)

## Known Stubs

None — all changes are complete security fixes, not stubs.

## Pending Human Verification (Staging Gate)

Items #7 and #8 touch the staff kiosk and admin POS UI in PAYMENT-ADJACENT context. The following human verification is REQUIRED before production deploy:

1. Deploy to staging: `git push origin main` (CNAME must be `staging.steinsandvines.ca`)
2. **STAGING KIOSK VERIFICATION:** Open the staging kiosk POS, run a contact/customer search, and confirm contact name + email render correctly — no broken markup, no double-escaping artifacts. If a Zoho test contact with HTML-special characters (`<`, `&`, `'`) exists, confirm they render as literal text, not markup.
3. **STAGING ADMIN VERIFICATION:** Same contact-search render check in the admin POS context.
4. **Note PWA cache:** Use the in-app cache-clear button before testing kiosk — stale SW cache will serve the old bundle.
5. **Catalog sanity check:** Confirm kit catalog pages still load and render products normally (proto-guard change must not break flattening).
6. Only after both kiosk + admin checks pass → proceed to production deploy.

## Threat Flags

None — all surfaces covered by this plan were already in the `<threat_model>` (`T-30-05-XSS1`, `T-30-05-XSS2`, `T-30-05-ESC`, `T-30-05-PP`). No new untreated surfaces introduced.

## Self-Check: PASSED

- `tests/frontend/catalog-kits-proto-guard.test.js`: FOUND
- `js/modules/07-catalog-kits.js`: FOUND, contains `flattenCustomFields` + proto guard + module.exports
- `js/main.js`: FOUND, contains exactly 1 `function escapeHTML` (canonical with &#39;)
- `js/main.min.js`: FOUND (rebuilt by npm run build)
- Commit a7def41: FOUND (Task 1 — XSS + proto guard)
- Commit 5f4fdec: FOUND (Task 2 — canonical escapeHTML + rebuild)
- `js/kiosk.js` selectedEl.innerHTML sink: escapeHTML(c.name), escapeHTML(c.email) — VERIFIED
- `js/admin.js` selectedEl.innerHTML sink: escapeHTML(c.name), escapeHTML(c.email) — VERIFIED
