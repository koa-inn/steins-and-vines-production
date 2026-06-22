---
phase: 36-cross-surface-selection-recipe-modification
plan: "11"
subsystem: brewpad-recipe-attach
tags: [gap-closure, gap-2, gap-3, factor-control, brewpad, no-charge, d-10, tdd]
dependency_graph:
  requires:
    - phase: 36-09
      provides: "Admin ×factor implementation (reference port)"
    - phase: 36-10
      provides: "Kiosk port; build artifacts from 36-10 wave"
  provides:
    - "GAP-3: BrewPad #bp-target-factor input wired, two-way factor↔litres sync (D-01)"
    - "GAP-2: BrewPad volume-wrap uses .bp-volume-row flex layout (polished, reordered)"
    - "BFAC-1..BFAC-6 tests locked in brewpad-recipe-volume-factor.test.js"
    - "D-10 preserved: no quote/charge on attach — BFAC-5 asserts this"
  affects: []
tech_stack:
  added: []
  patterns:
    - "Factor input uses .bp-input class (not .admin-input) — BrewPad surface distinction (D-01)"
    - ".bp-input already has font-size:16px iOS guard in brewpad.css — no inline style needed"
    - "Two-way sync: factorInput.oninput writes volInput; volInput.oninput writes factorInput (same pattern as admin 36-09 / kiosk 36-10)"
    - "Factor clamp (0, 10]: ≤0 → early return (no state change); >10 → clamp to 10"
    - "Litres rounding: Math.round(factor × base × 2) / 2 (nearest 0.5 L granularity)"
    - "No-base disabled state: both inputs disabled when recipe.batch_size_l is 0/null/undefined"
    - "No quote/charge: factorInput.oninput ends with a comment and NO fetch (D-10)"
    - "Array.isArray guard on _recipesState.catalog before .slice() — bug fix (Rule 1)"
key_files:
  created:
    - tests/frontend/brewpad-recipe-volume-factor.test.js
  modified:
    - brewpad.html
    - js/brewpad.js
    - css/brewpad.css
    - js/brewpad.min.js
    - css/brewpad.min.css
    - js/admin.js (build timestamp only)
    - js/admin.min.js (build artifact)
decisions:
  - "_bpWireAttachExpandedPanel test hook exported from IIFE — same pattern as _kioskShowRecipePrompt in admin/kiosk; no production behavior change"
  - ".bp-input already carries font-size:16px (1rem iOS guard) in brewpad.css line 2214 — no inline style override needed on the factor input"
  - "Array.isArray(_recipesState.catalog) guard added before .slice() — Rule 1 bug: fetch mock returns {} during test teardown path, causing catalogLoaded=true with non-array catalog"
  - "BFAC-6 drives the snapshot path via bp.buildBpAttachSnapshot() which reads _bpTargetVolumeL directly — no separate wiring needed"
metrics:
  duration: "~20 min"
  completed_date: "2026-06-22"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
requirements_closed: [SEL-01, MOD-01]
---

# Phase 36 Plan 11: BrewPad GAP Closure — ×factor Control + Layout Polish Summary

**Two-way ×factor↔litres sync (GAP-3) ported to BrewPad attach surface with D-10 no-charge guarantee enforced; flex volume-row layout (GAP-2) added; BFAC-1..BFAC-6 all green; 845 frontend + 897 middleware tests pass.**

## Tasks Completed

| # | Name | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | Port ×factor input + polished layout (markup + wiring + CSS + tests) | Complete | 4e089a6 | brewpad.html, js/brewpad.js, css/brewpad.css, tests/frontend/brewpad-recipe-volume-factor.test.js |
| 2 | Build all bundles + full frontend + middleware regression gate | Complete | c785fac | js/brewpad.min.js, css/brewpad.min.css, js/admin.min.js + all HTML cache-bust stamps |

## What Was Built

### Task 1 — ×factor Input + GAP-2 Layout + BFAC Tests

**brewpad.html:**
- `#bp-recipe-volume-wrap` now contains a `.bp-volume-row` div housing both the litres label/input and the ×factor label/input side-by-side
- Factor input: `type="number" id="bp-target-factor" class="bp-input bp-volume-input" min="0.1" step="0.1" inputmode="decimal"` — uses `.bp-input` class (not `.admin-input`), which already has `font-size:16px` (1rem iOS guard) in brewpad.css line 2214

**css/brewpad.css (new rules appended):**
- `.bp-volume-row` — `display:flex; align-items:flex-end; gap:var(--sp-4,16px); flex-wrap:wrap`
- `.bp-volume-label` — `display:flex; flex-direction:column; font-size:13px` (label above input)
- `.bp-volume-input` — `width:96px; min-height:44px` (44px touch target, shared by both inputs)
- `.bp-scale-readout` — `margin-top:var(--sp-2,8px); font-size:13px; font-weight:700` (readout beneath both inputs)

**js/brewpad.js wireAttachExpandedPanel additions:**
- `var factorInput = document.getElementById('bp-target-factor')` added alongside existing `volInput`
- On base recipe: `factorInput.value = '1.00'; factorInput.max = '10'; factorInput.disabled = false`
- No-base: `factorInput.disabled = true` (alongside existing `volInput.disabled = true`) — BFAC-4
- `factorInput.oninput` handler (BFAC-1/BFAC-5): reads rawFactor, clamps to (0, 10], computes `roundedLitres = Math.round(rawFactor × baseVol × 2) / 2`, writes volInput, updates `_bpTargetVolumeL`, `_bpScaleFactor`, readout — and does NOTHING else (no fetch, no quote, no charge; D-10 preserved)
- `volInput.oninput` extended (BFAC-2): after existing state updates, writes `factorInput.value = factor.toFixed(2)`
- Comment: "display/record only — BrewPad attach never charges (D-10); factor only changes the recorded target_volume_l"
- `_bpWireAttachExpandedPanel` test hook exported from IIFE
- `Array.isArray(_recipesState.catalog)` guard before `.slice()` (Rule 1 bug fix — non-array catalog caused crash on second test invocation)

**tests/frontend/brewpad-recipe-volume-factor.test.js (new):**
- BFAC-1: factor 1.5 on base-60L → `_bpTargetVolumeL` = 90, `volInput.value` ≈ 90
- BFAC-2: litres 90 on base-60L → `factorInput.value` = "1.50"
- BFAC-3a: factor ≤ 0 → early return, state unchanged (no negative litres)
- BFAC-3b: factor 15 → clamped to 10, litres ≤ 600 (base 60 × 10)
- BFAC-4: `batch_size_l=0` → both `volInput.disabled` and `factorInput.disabled` true; readout shows "Set batch size (L)…"
- BFAC-5: factor edit → zero calls to recipe-quote / recipe-sale / payment / helcim; `_bpTargetVolumeL` updated; readout updated (D-10)
- BFAC-6: factor 1.5 on base-60L → `buildBpAttachSnapshot().target_volume_l` ≈ 90

### Task 2 — Build + Gates

- `npm run build` successful; `js/brewpad.min.js` contains `bp-target-factor` (verified with `grep -c`)
- `css/brewpad.min.css` updated with `.bp-volume-row` flex layout
- All HTML pages received updated `?v=` cache-bust stamps
- `npm test` (full frontend): **845 tests passed** (44 suites; +7 from BFAC-1..BFAC-6)
- `npm run lint`: **0 errors** (133 pre-existing warnings only)
- `cd zoho-middleware && npm test`: **897 tests passed** (39 suites) — no middleware files touched

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Array.isArray guard on _recipesState.catalog before .slice()**
- **Found during:** BFAC test RED phase — BFAC-2..BFAC-6 failed with `TypeError: _recipesState.catalog.slice is not a function`
- **Issue:** After the first `_bpWireAttachExpandedPanel` call in tests, `loadIngredientCatalogForRecipes` resolved with `fetch` mock returning `{}` (object, not array). Code sets `_recipesState.catalog = data.items || data.ingredients || data || []` where `data = {}` → `catalog = {}`. On subsequent calls, `_recipesState.catalogLoaded = true` so the code hit `_recipesState.catalog.slice()` on a plain object.
- **Fix:** `_bpAttachCatalog = Array.isArray(_recipesState.catalog) ? _recipesState.catalog.slice() : [];`
- **Files modified:** js/brewpad.js (line ~4033)
- **Commit:** 4e089a6 (included in Task 1 commit)

### Additional Exports

**`_bpWireAttachExpandedPanel` test hook:** Needed to drive the volume+factor wiring in BFAC tests without a full attach-flow DOM. Consistent with the `_kioskShowRecipePrompt` pattern from admin (36-09) and kiosk (36-10). No production behavior change.

## Known Stubs

None — all sync logic is fully wired; no placeholder values or TODO comments in shipped code.

## Threat Flags

None — the factor input is a purely client-side display control introducing no new network endpoint or trust boundary. T-36-11-01 (Tampering: ×factor → charge) mitigated by BFAC-5 test asserting zero calls to recipe-quote / recipe-sale / payment / helcim on factor edit. T-36-11-02 (XSS) covered by existing `escapeHTML` path in advisory/modify-row rendering (unchanged). T-36-11-03 (recorded target_volume_l) flows through existing `buildBpAttachSnapshot` path (BFAC-6 verifies).

## Self-Check: PASSED

- [x] `grep bp-target-factor brewpad.html` — FOUND (1 match)
- [x] `grep bp-target-factor js/brewpad.js` — FOUND (multiple matches)
- [x] `grep -c bp-target-factor js/brewpad.min.js` — FOUND (1 match)
- [x] `npx jest tests/frontend/brewpad-recipe-volume-factor.test.js` — 7 passed (BFAC-1..BFAC-6)
- [x] `npx jest tests/frontend/brewpad-recipe-attach-modify.test.js` — 31 passed (all existing tests green)
- [x] `npm test` (full frontend) — 845 passed, 0 failed, 44 suites
- [x] `npm run lint` — 0 errors (133 pre-existing warnings)
- [x] `cd zoho-middleware && npm test` — 897 passed, 0 failed, 39 suites
- [x] No middleware files modified
- [x] Commits: 4e089a6 (Task 1), c785fac (Task 2)
