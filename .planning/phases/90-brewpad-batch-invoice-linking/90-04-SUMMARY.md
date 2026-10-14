---
phase: 90-brewpad-batch-invoice-linking
plan: 04
subsystem: frontend-kiosk
tags: [recipe-picker, kiosk, search, es5]
requires: []
provides:
  - window.RecipePicker (sortRecipesByName, filterRecipes, findRecipeNameMatches)
  - kiosk recipe-mode search dropdown
affects: [90-08, 90-09, 90-07]
key-files:
  created:
    - js/lib/recipe-picker.js
    - tests/frontend/recipe-picker.test.js
    - tests/frontend/kiosk-recipe-picker.test.js
  modified:
    - js/kiosk-core.js
    - css/kiosk.css
    - brewpad.html
    - kiosk.html
    - admin.html
decisions:
  - Tiles keep existing (API) order; only the dropdown list is sorted A-Z
  - Flat A-Z list, no beer_category grouping; 2s tile highlight dropped (Q12 escape clause)
metrics:
  tasks: 2
  completed: 2026-10-14
---

# Phase 90 Plan 04: Shared recipe picker and kiosk search dropdown Summary

Shared pure ES5 helper `js/lib/recipe-picker.js` (sort, uncapped name/style filter, exact/similar name match) loaded on brewpad, kiosk and admin pages, plus a full-list combobox search above the kiosk recipe tiles.

## Commits
- f91e80b5: helper, script tags, recipe-picker.test.js
- b952a7e7: kiosk search dropdown (kiosk-core.js, kiosk.css, kiosk-recipe-picker.test.js)

## Details
- Search header is the first child of `#kiosk-recipe-grid` (`grid-column: 1 / -1`), so it hides with the grid on kiosk.html and the admin-embedded kiosk. Focus, click and input open the panel (click covers iPad Safari's already-focused input). Row selection (mousedown/touchstart) goes through new `kioskSelectRecipeById`, shared with the tile click. Escape and outside tap close. Tiles are narrowed by `data-recipe-id` display toggling, no re-render, so focus is kept and render stays deterministic.
- `window.RecipePicker` resolved lazily via `_kcRecipePicker()`; test-only `require` fallback at top of the kiosk-core IIFE.
- Tile order kept as-is (not re-sorted); only the dropdown is A-Z.
- Recipe text goes through `escapeHTML` (T-90-14); filtering uses data attributes only.

## CSP check (rule 12)
- kiosk.html: `script-src 'self' ...` includes 'self'; new tag is same-origin, no CSP change.
- brewpad.html and admin.html: no CSP `<meta>` tag present (grep for Content-Security-Policy returns 0), so nothing to change.

## Deviations from Plan
- Task 1 RED was observed (3 HTML-reference tests failed before the tags were added; helper tests passed because the helper was written first).
- Task 2: the implementation was written before the test file, so no RED run was captured; the 9 tests passed on first run. Acknowledged TDD-order deviation.
- [Rule 1] ESLint `eqeqeq` warnings in the new helper (`== null`) were replaced with explicit null/undefined checks.
- Worktree HEAD base was eaf0b8cc, not the required 82146111; reset --hard to 82146111 per the startup check (no work lost).

## Gate results (Node 24.21.0)
- Root: 180 suites / 2390 tests pass; lint clean.
- zoho-middleware: 215 suites / 3214 tests pass; lint clean.
- Existing kiosk tests unedited; only the two new test files changed under tests/frontend. No min/main.js, ?v= stamps, STATE.md or ROADMAP.md touched.

## Known Stubs
None.

## Self-Check: PASSED
Files and commits f91e80b5, b952a7e7 exist.
