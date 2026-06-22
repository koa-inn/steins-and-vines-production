---
phase: 36-cross-surface-selection-recipe-modification
plan: "10"
subsystem: kiosk-recipe-sale
tags: [gap-closure, gap-2, gap-3, factor-control, kiosk, ios-zoom-guard, tdd]
dependency_graph:
  requires:
    - phase: 36-09
      provides: "Admin ×factor implementation (reference port); GAP-1 regression guard; kiosk-volume-row CSS pattern"
  provides:
    - "GAP-3: kiosk #kiosk-target-factor input wired, two-way factor↔litres sync"
    - "GAP-2: kiosk volume-wrap uses .kiosk-volume-row flex layout (polished, reordered)"
    - "KFAC-1..KFAC-6 tests locked in kiosk-recipe-volume-factor.test.js"
    - "_kioskShowRecipePrompt test-hook alias exported for factor tests"
  affects: ["36-11-PLAN.md (BrewPad port)"]
tech_stack:
  added: []
  patterns:
    - "Factor input on kiosk has inline style='font-size:1rem' (iOS zoom guard) — both litres and factor inputs"
    - "Two-way factor↔litres sync: factorInput.oninput writes volInput; volInput.oninput writes factorInput (same as admin 36-09)"
    - "Factor clamp (0, 10]: ≤0 → early return; >10 → clamp to 10; litres = Math.round(factor × base × 2) / 2"
    - "No-base disabled state: both inputs disabled when recipe.batch_size_l is 0/null/undefined"
    - "Server-authoritative pricing: factor sync triggers kioskScheduleRecipeQuote only; no factor= param in URL"
key_files:
  created:
    - tests/frontend/kiosk-recipe-volume-factor.test.js
  modified:
    - kiosk.html
    - js/kiosk.js
    - css/kiosk.css
    - js/kiosk.min.js
    - css/kiosk.min.css
    - js/admin.js (build timestamp only — no logic change)
    - js/admin.min.js (build artifact)
key-decisions:
  - "_kioskShowRecipePrompt alias added to exports: kiosk.js already exported kioskShowRecipePrompt directly; alias added for test consistency with admin-recipe-volume-factor.test.js pattern (no production behavior change)"
  - "factorInput uses inline style='font-size:1rem' on both inputs in kiosk.html (not a class override) — consistent with existing kiosk-target-volume which already had the inline guard"
  - "kiosk.css .kiosk-volume-input sets font-size:1rem (not 13px as in admin.css) — kiosk touch surfaces need the iOS guard at the CSS layer too"
  - "No .kiosk-volume-row/.kiosk-volume-input previously in kiosk.css — added fresh (not ported from admin.css which uses 13px font-size)"

requirements-completed: [SEL-01, MOD-01]

duration: ~15min
completed: 2026-06-22
---

# Phase 36 Plan 10: Kiosk GAP Closure — ×factor Control + Layout Polish Summary

**Ported two-way ×factor↔litres sync (GAP-3) and flex volume-row layout (GAP-2) from admin to kiosk surface; iOS zoom guard on both inputs; KFAC-1..KFAC-6 all green; 838 frontend + 897 middleware tests pass.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-06-22
- **Tasks:** 2
- **Files modified:** 6 source files + built bundles + HTML cache-bust stamps

## Accomplishments

- GAP-3 closed on kiosk: `#kiosk-target-factor` input wired beside `#kiosk-target-volume` in a `.kiosk-volume-row` flex row; factor↔litres sync both directions, bounds (0,10], no-base disable, re-quote on change
- GAP-2 polished on kiosk: volume wrap now uses flex row layout consistent with admin; readout beneath both inputs; no greyed phantom inputs when base exists
- iOS zoom guard: both `#kiosk-target-volume` and `#kiosk-target-factor` have `style="font-size:1rem;"` inline; `.kiosk-volume-input` CSS also sets `font-size:1rem`
- 7 new KFAC tests locked (kiosk-recipe-volume-factor.test.js); all 32 existing kiosk tests still pass; no middleware files touched

## Task Commits

1. **Task 1: Port GAP-3 ×factor input + GAP-2 layout to kiosk (markup + wiring + CSS + tests)** — `5130776` (feat)
2. **Task 2: Build kiosk bundles + full frontend + middleware regression gate** — `e4fada9` (chore)

## Files Created/Modified

- `kiosk.html` — Added `#kiosk-target-factor` input with `font-size:1rem` inside `.kiosk-volume-row` flex container; readout below
- `js/kiosk.js` — Factor wiring: `var factorInput = getElementById('kiosk-target-factor')` added; `factorInput.oninput` handler (clamp → litres → re-quote); `volInput.oninput` extended to write `factorInput.value`; `_kioskShowRecipePrompt` alias exported
- `css/kiosk.css` — Added `.kiosk-volume-row` / `.kiosk-volume-label` / `.kiosk-volume-input` / `.kiosk-scale-readout` rules (GAP-2 flex layout; font-size:1rem for iOS guard)
- `tests/frontend/kiosk-recipe-volume-factor.test.js` — Created: KFAC-1..KFAC-6 (7 tests, all pass)
- `js/kiosk.min.js` — Rebuilt (contains `kiosk-target-factor`)
- `css/kiosk.min.css` — Rebuilt (contains `.kiosk-volume-row` flex rules)

## Decisions Made

- `_kioskShowRecipePrompt` added as alias for `kioskShowRecipePrompt` in exports: the test pattern from admin-recipe-volume-factor.test.js uses `admin._kioskShowRecipePrompt(recipe)`. The kiosk module already had `kioskShowRecipePrompt` exported directly; the alias provides a consistent underscore-prefixed test hook without changing any production behavior.
- CSS font-size on `.kiosk-volume-input` set to `1rem` (not `13px` as in admin.css) — the kiosk surface requires iOS zoom guard at the CSS layer. The inline `style="font-size:1rem;"` on the HTML elements provides belt-and-suspenders.
- No `kiosk-save-as-new-wrap` element injected in test DOM fixture — save-as-new is intentionally absent on kiosk (UI-SPEC §2). The test fixture omits it, and KFAC-5 asserts no `/api/recipes POST` occurs.

## Deviations from Plan

None — plan executed exactly as written. The `_kioskShowRecipePrompt` alias was anticipated by the plan ("Drive via `_kioskOpenModifyPanel`/prompt setup") and follows the established Phase 36 export pattern.

## Known Stubs

None — all sync logic is fully wired; no placeholder values or TODO comments in shipped code.

## Threat Flags

None — the factor input is a purely client-side display control (no new endpoints). T-36-10-01 (Tampering: ×factor→price) mitigated by KFAC-5 asserting factor never reaches the quote URL. T-36-10-02 (XSS) covered by existing escapeHTML path. T-36-10-03 (save-as-new on kiosk) confirmed absent by KFAC-5 no-POST assertion.

## Self-Check: PASSED

- [x] `grep kiosk-target-factor kiosk.html` — FOUND (1 match)
- [x] `grep kiosk-target-factor js/kiosk.js` — FOUND (multiple matches)
- [x] `grep kiosk-target-factor js/kiosk.min.js` — FOUND (1 match)
- [x] `grep font-size:1rem kiosk.html` — FOUND (on both #kiosk-target-volume and #kiosk-target-factor)
- [x] `npx jest tests/frontend/kiosk-recipe-volume-factor.test.js` — 7 passed (KFAC-1..KFAC-6)
- [x] `npm test` (full frontend) — 838 passed, 0 failed, 43 suites
- [x] `npm run lint` — 0 errors (133 pre-existing warnings)
- [x] `cd zoho-middleware && npm test` — 897 passed, 0 failed, 39 suites
- [x] No middleware files modified
- [x] Commits: 5130776 (Task 1), e4fada9 (Task 2)

---
*Phase: 36-cross-surface-selection-recipe-modification*
*Completed: 2026-06-22*
