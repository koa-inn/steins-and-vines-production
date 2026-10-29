---
phase: 100-limited-releases-page-and-online-deposits
plan: 11
subsystem: frontend
tags: [limited-releases, module, basket, sticky-bar, json-ld]
requires: ["100-10"]
provides: ["js/modules/18-limited-releases.js", "window.LimitedReleases {getBasketLines, setControlsLocked, clearBasket, computeDepositTotal}"]
affects: [package.json, limited-releases.html, tests/e2e/static-pages.spec.js]
key-files:
  created: [js/modules/18-limited-releases.js, js/modules/18-limited-releases.min.js, tests/frontend/limited-releases.test.js]
  modified: [limited-releases.html, package.json, tests/e2e/static-pages.spec.js]
metrics:
  completed: 2026-10-29
---

# Phase 100 Plan 11: Limited releases page module Summary

Standalone ES5 module that renders the ten kits, calendar, collections, terms and JSON-LD from the content JSON and drives the stepper, basket, sticky bar and pay-button gating (payment itself is Plan 12).

## Commits
- a3a7cb7a: module (render, basket, stepper, sticky bar, JSON-LD) plus 36 frontend tests
- a64167b6: minify:js entry, stamped script tag, `.min.js`, e2e describe (the e2e file addition is a list-style addition; no existing tests changed)

## What was built
- Pure exports: groupKitsByCollection, buildCalendar, computeDepositTotal, isPayEnabled, formatSpecs, buildJsonLd, applyQtyChange (non-mutating, returns `{basket, changed, reason}`), plus render, getBasketLines, setControlsLocked, clearBasket.
- DOM built only with createElement/textContent; JSON-LD via JSON.stringify with `<` escaped (T-100-53). No scarcity text (T-100-55, tested).
- Order cap 10 kits (D-18): an over-cap "+" is refused and the clicked card's `role=status` note shows the order-limit message; per-kit max note at 10.
- Sticky bar: IntersectionObserver hide-while-form-visible (always shown if absent), `lr-bar--static` while `html.cookie-notice-open` (MutationObserver), `--lr-bar-h` and last-section padding, Reserve scrolls and focuses `#lr-reserve-heading`. Hidden while controls are locked.
- Plan 12 hooks are on `window.LimitedReleases`. No `#lr-pay` click handler is attached.

## Verification
- Frontend: 234 suites / 3248 tests pass; lint clean; middleware 266 suites / 3779 tests pass.
- `npm run build` produces `js/modules/18-limited-releases.min.js`; `limited-releases.html` carries a stamped `18-limited-releases.min.js?v=`; concat:js unchanged.
- E2E describe added but NOT run: Playwright browsers are not installed in this worktree (`npx playwright install` required); CI will run it.

## Deviations from Plan
- `render` is a private `lrRender` in the global scope (exported as `render`) to avoid generic global names in the classic script.
- The first collection's hero is wrapped in `div.lr-collection__hero-frame` so the "no overlay sibling" assertion is meaningful.
- Calendar active cell (`.lr-calendar__month--active`) marks the current calendar month when it falls in range.
- `npm run build` re-stamped unrelated pages and js/admin.*; those were reverted, only plan files committed (as in Plan 10).
- Oak spec uses the full JSON string ("Oak: Medium (American and French)") per the plan behaviour bullet, not the shortened UI-SPEC example.

## Known Stubs
None. Pay click is intentionally unwired until Plan 12.

## Self-Check: PASSED
