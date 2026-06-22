---
phase: 36-cross-surface-selection-recipe-modification
plan: "09"
subsystem: admin-kiosk-recipe-sale
tags: [gap-closure, gap-1, gap-2, gap-3, factor-control, modify-panel, regression-test, tdd]
dependency_graph:
  requires: [36-08]
  provides: ["GAP-1 regression test locked", "GAP-3 ×factor input wired (admin)", "GAP-2 layout polished (admin)", "kioskOpenModifyPanel test hook"]
  affects: ["36-10-PLAN.md (kiosk port)", "36-11-PLAN.md (BrewPad port)"]
tech_stack:
  added: []
  patterns:
    - "kioskOpenModifyPanel(recipe) extracted from onclick for testability (GAP-1 hook)"
    - "Two-way factor↔litres sync: factorInput.oninput writes volInput; volInput.oninput writes factorInput"
    - "Factor-to-litres rounding: Math.round(factor × base × 2) / 2 (nearest 0.5 L granularity)"
    - "No-base disabled state: both inputs disabled when recipe.batch_size_l is 0/null"
    - "Server-authoritative pricing: factor sync triggers kioskScheduleRecipeQuote only"
key_files:
  created:
    - tests/frontend/admin-recipe-volume-factor.test.js
  modified:
    - js/admin.js
    - admin.html
    - css/admin.css
    - tests/frontend/admin-recipe-modify.test.js
    - js/admin.min.js
    - css/admin.min.css
decisions:
  - "kioskOpenModifyPanel extracted as named hoisted function; modifyToggle.onclick delegates to it (verbatim behavior, pure refactor)"
  - "Factor input placed in .kiosk-volume-row flex container alongside litres input; readout beneath both"
  - "_kioskShowRecipePrompt exported as test hook to drive full volume+factor wiring in FAC tests"
  - "Factor oninput: clamp (0, 10], compute litres = round(factor × base to nearest 0.5), no negative litres"
  - "volInput.oninput extended to write factorInput.value = factor.toFixed(2) (FAC-2 two-way sync)"
  - "No-base (batch_size_l=0/null): both factorInput.disabled=true and volInput.disabled=true (FAC-4)"
metrics:
  duration: "~30 minutes"
  completed_date: "2026-06-22"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
---

# Phase 36 Plan 09: Admin GAP Closure — ×factor Control + Regression Test Summary

**One-liner:** Locked-in GAP-1 regression guard (kioskOpenModifyPanel refactor + fail/pass cycle validated), two-way ×factor↔litres sync wired on admin recipe prompt (GAP-3), flex-row volume layout added (GAP-2), all bundles rebuilt; 831 frontend + 897 middleware tests green.

## Tasks Completed

| # | Name | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | GAP-1 regression test + kioskOpenModifyPanel hook | Complete | e8cd43f | js/admin.js, tests/frontend/admin-recipe-modify.test.js |
| 2 | GAP-3 ×factor input + GAP-2 layout polish (admin markup + wiring + CSS + tests) | Complete | 1cfafa4 | admin.html, js/admin.js, css/admin.css, tests/frontend/admin-recipe-volume-factor.test.js |
| 3 | Build admin bundles + full frontend + middleware regression gate | Complete | d67bab6 | js/admin.min.js, css/admin.min.css, all HTML (cache-bust stamps) |

## What Was Built

### Task 1 — GAP-1 Regression Test + Test Hook

**`kioskOpenModifyPanel(recipe)` extracted from `modifyToggle.onclick` expand branch:**
- Moved all expand-body logic verbatim into a named hoisted function before `kioskShowRecipePrompt`
- `modifyToggle.onclick` now delegates to `kioskOpenModifyPanel(recipe)` — behavior unchanged
- Function reads DOM by ID (null-guarded), making it directly callable in tests without full prompt context
- Export added: `_kioskOpenModifyPanel: function(r) { return kioskOpenModifyPanel(r); }`

**GAP-1 tests appended to tests/frontend/admin-recipe-modify.test.js:**
- `GAP-1a`: asserts `fetch` is called with a URL containing `/api/ingredients` when `_recipesState.catalogLoaded === false` on panel open
- `GAP-1b`: asserts `_recipesState.catalogLoaded === true` and modify tbody has ≥1 row after catalog promise resolves

**REGRESSION GUARD VALIDATED (CLAUDE.md rule 3):**
- Hotfix lines (`loadIngredientCatalogForRecipes().then(...)` block) temporarily commented out → GAP-1a and GAP-1b FAILED (fetch not called, catalogLoaded stayed false)
- Hotfix lines restored → GAP-1a and GAP-1b PASSED
- Both states observed. Code left in restored (passing) state.

### Task 2 — GAP-3 ×factor Input + GAP-2 Layout Polish

**admin.html:**
- `#kiosk-recipe-volume-wrap` now contains a `.kiosk-volume-row` div housing both the litres label/input and the factor label/input side-by-side
- Factor input: `type="number" id="kiosk-target-factor" min="0.1" step="0.1" inputmode="decimal"` with inline `&times; factor` label

**css/admin.css (new rules appended before "Recipes Tab" section):**
- `.kiosk-volume-row` — `display:flex; align-items:flex-end; gap:var(--sp-4); flex-wrap:wrap`
- `.kiosk-volume-label` — `display:flex; flex-direction:column; font-size:13px` (label above input)
- `.kiosk-volume-input` — `min-height:44px; width:96px; padding; border; border-radius; background` (shared by both inputs)
- `.kiosk-scale-readout` — `margin-top:var(--sp-2); font-size:13px; font-weight:700; color:var(--ink-secondary)`

**js/admin.js volume-control wiring additions:**
- `var factorInput = document.getElementById('kiosk-target-factor')` added alongside `volInput`
- On base recipe: `factorInput.value = '1.00'; factorInput.max = '10'; factorInput.disabled = false`
- No-base: `factorInput.disabled = true` (FAC-4)
- `factorInput.oninput` handler (FAC-1/FAC-5): reads rawFactor, clamps to (0, 10], computes `roundedLitres = Math.round(rawFactor × baseVol × 2) / 2`, updates `volInput.value`, `_kioskTargetVolumeL`, `_kioskScaleFactor`, readout, calls `kioskScheduleRecipeQuote()`
- `volInput.oninput` extended (FAC-2): after existing factor/readout update, writes `factorInput.value = factor.toFixed(2)`
- Comment: "client-side display only — server quote is authoritative for price (D-06)"
- Export `_kioskShowRecipePrompt` test hook added for FAC test setup

**tests/frontend/admin-recipe-volume-factor.test.js (new):**
- FAC-1: factor 1.5 → litres 30 on base-20L recipe (`_kioskGetTargetVolumeL() ≈ 30`, `volInput.value ≈ 30`)
- FAC-2: litres 30 → factor "1.50" on base-20L recipe (`factorInput.value === '1.50'`)
- FAC-3a: factor ≤ 0 clamped — `_kioskTargetVolumeL` remains positive
- FAC-3b: factor > 10 clamped — `_kioskTargetVolumeL ≤ base × 10 = 200`, `factorInput.value ≤ 10`
- FAC-4: `batch_size_l=0` → both `volInput.disabled` and `factorInput.disabled` are true; readout shows "Set batch size (L)…"
- FAC-5: editing factor calls `fetch` with a URL containing `recipe-quote` and `target_volume_l` (not `factor=`)

### Task 3 — Build + Gates

- `npm run build` successful; `js/admin.min.js` contains `kiosk-target-factor` (verified with `grep -c`)
- `css/admin.min.css` updated with `.kiosk-volume-row` flex layout
- All HTML pages received updated cache-bust `?v=` stamps
- `npm test` (full frontend): **831 tests passed** (42 suites)
- `npm run lint`: **0 errors** (133 pre-existing warnings only)
- `cd zoho-middleware && npm test`: **897 tests passed** (39 suites) — no middleware files touched

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Additional Exports Added

**`_kioskShowRecipePrompt` test hook:** The plan specified "Drive the volume wiring via `_kioskOpenModifyPanel`/prompt setup or by dispatching input events." To wire the `factorInput.oninput` handler for FAC tests, `kioskShowRecipePrompt` needed to be callable from test code. Exporting it as `_kioskShowRecipePrompt` is consistent with the existing Phase 36 export pattern and does not change any production behavior.

This is a Rule 2 addition (missing testability hook required for correctness of FAC-5 test) — not a behavioral change.

## Regression Guard Outcomes (CLAUDE.md rule 3)

| State | GAP-1a (fetch called) | GAP-1b (catalogLoaded=true) |
|-------|-----------------------|-----------------------------|
| Hotfix REMOVED (regression) | FAIL — fetch not called | FAIL — catalogLoaded stayed false |
| Hotfix RESTORED | PASS | PASS |

Code left in restored (passing) state. The guard is locked.

## Known Stubs

None — all sync logic is fully wired; no placeholder values or TODO comments in shipped code.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| No new surface | — | The factor input is purely a client-side display control; it does not introduce any new network endpoint or trust boundary. The only new fetch call is to the existing `/api/ingredients` catalog endpoint (already in the GAP-1 hotfix). T-36-09-01 (Tampering: ×factor → price) is mitigated by FAC-5 test verifying `factor=` is never passed to the quote endpoint. T-36-09-02 (XSS) is mitigated by existing `escapeHTML` path in `renderKioskModifyRows` (T6 test, no change). |

## Self-Check: PASSED

- [x] `grep kiosk-target-factor admin.html` — FOUND (1 match)
- [x] `grep kiosk-target-factor js/admin.js` — FOUND (4 matches including function definition + export)
- [x] `grep kiosk-target-factor js/admin.min.js` — FOUND (1 match)
- [x] `grep _kioskOpenModifyPanel js/admin.js` — FOUND (export + function definition + call site)
- [x] `npx jest tests/frontend/admin-recipe-modify.test.js -t "GAP-1"` — 2 passed
- [x] `npx jest tests/frontend/admin-recipe-volume-factor.test.js` — 6 passed (FAC-1..FAC-5)
- [x] Regression guard: FAIL without hotfix, PASS with hotfix — both states observed and recorded
- [x] `npm test` — 831 passed, 0 failed
- [x] `cd zoho-middleware && npm test` — 897 passed, 0 failed
- [x] `npm run lint` — 0 errors
- [x] Commits: e8cd43f (Task 1), 1cfafa4 (Task 2), d67bab6 (Task 3)
- [x] No middleware files modified
