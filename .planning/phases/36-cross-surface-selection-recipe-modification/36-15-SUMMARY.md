---
phase: 36-cross-surface-selection-recipe-modification
plan: 15
subsystem: kiosk-pos-ui
tags: [kiosk, gap-closure, live-price, scroll, ios-zoom, audit-polish, build]
dependency_graph:
  requires: [36-14]
  provides:
    - "Kiosk iPad POS: live server-quote price on every change (GAP-4, D-06)"
    - "Kiosk iPad POS: bounded scrollable #kiosk-recipe-prompt (GAP-5)"
    - "Kiosk iPad POS: audit polish — price-preview card, 44px targets, --sp-* tokens, cellar autocomplete (GAP-7)"
  affects:
    - "36-16-PLAN.md (BrewPad surface — next in wave 3)"
tech_stack:
  added: []
  patterns:
    - "Ungated quote write paths in kioskFetchRecipeQuote — always write to price elements (GAP-4)"
    - "Prominent price (#kiosk-recipe-summary-price) updated from _kioskQuote.total server response (D-06)"
    - "#kiosk-recipe-price-preview as standalone card outside #kiosk-recipe-modify-wrap (GAP-4)"
    - ".kiosk-recipe-prompt-view toggled class for bounded scroll context (GAP-5)"
    - "--sp-* spacing tokens in kiosk.css :root (GAP-7 M2)"
    - ".kiosk-price-preview card class with cellar-raised/ledger-line/r-md styling (GAP-7 H2)"
    - ".ing-autocomplete-drop CSS class in kiosk.css replacing hardcoded #fff/#ccc (GAP-7 H5/L1)"
    - ".kiosk-modify-group-header td CSS class extracted from inline JS styles (GAP-7 L3)"
key_files:
  created: []
  modified:
    - "js/kiosk.js"
    - "kiosk.html"
    - "css/kiosk.css"
    - "css/kiosk.min.css"
    - "js/kiosk.min.js"
    - "tests/frontend/kiosk-recipe-live-price.test.js"
    - "js/admin.js (timestamp-stamped by npm run build)"
    - "js/admin.min.js (rebuilt)"
decisions:
  - "GAP-4: kioskFetchRecipeQuote write paths ungated — _kioskModifyPanelOpen removed from all 4 paths in kiosk.js"
  - "GAP-4: server total from _kioskQuote.total written to #kiosk-recipe-summary-price on every successful quote (D-06 — displayed==charged)"
  - "GAP-4: #kiosk-recipe-price-preview shown immediately on sale-type selection (kioskSelectSaleType shows it before quote fires)"
  - "GAP-5: .kiosk-recipe-prompt-view added/removed in kioskShowRecipePrompt, back button handler, and kioskSetMode"
  - "GAP-7 H5/L1: autocomplete dropdown cssText replaced with .ing-autocomplete-drop class; option role=option for accessibility"
  - "GAP-7 H2: .kiosk-price-preview card class added to kiosk.css + applied in kiosk.html"
  - "GAP-7 H3: kiosk-recipe-modify-table .admin-input min-height 44px touch targets"
  - "GAP-7 M2: --sp-* spacing tokens added to kiosk.css :root"
  - "GAP-7 L3: .kiosk-modify-group-header td CSS class created (mirrors admin.css)"
metrics:
  duration: "~30 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_modified: 6
---

# Phase 36 Plan 15: Kiosk GAP-4/5/7 Closure Summary

## One-Liner

Kiosk iPad POS port of admin reference (36-14): ungated server-authoritative live price on every volume/factor/ingredient change (GAP-4, D-06), iPad-reachable scrollable recipe prompt (GAP-5), and full audit polish matching admin — cellar-palette autocomplete, 44px modify inputs, --sp-* tokens, price-preview card (GAP-7) — rebuilt bundles, 8 new KLP regression tests green.

## What Was Built

### Task 1: GAP-4 — Ungate Quote Write Paths + Prominent Server Price (TDD)

**RED phase:** Appended 8 failing KLP-1..KLP-5 tests to `tests/frontend/kiosk-recipe-live-price.test.js`. Tests required `kiosk._kioskSetModifiedIngredients`, `kiosk.kioskFetchRecipeQuote`, and asserted `#kiosk-recipe-summary-price` received the server quote total with `_kioskModifyPanelOpen = false`.

**GREEN phase (kiosk.js):** Removed all 4 `_kioskModifyPanelOpen` guards from `kioskFetchRecipeQuote`:
- Loading path (~line 801): now writes `"Calculating…"` unconditionally
- Success path (~line 813): writes quote total to `#kiosk-recipe-price-preview` unconditionally
- Error path (~line 826): writes error copy unconditionally
- Catch path (~line 836): writes error copy unconditionally

On quote success, the server total is additionally written to `#kiosk-recipe-summary-price` (the prominent price) via `kioskFmt(total) + ' per batch'`. This is the displayed==charged guarantee (D-06) — mirrors the admin.js approach exactly (36-14).

**kiosk.html restructure:**
- Moved `#kiosk-recipe-price-preview` OUT of `#kiosk-recipe-modify-wrap` — now a standalone sibling between `#kiosk-recipe-modify-wrap` and `#kiosk-stock-conflict`
- Moved `#kiosk-locked-price-notice` alongside the standalone price-preview
- Applied `.kiosk-price-preview` class to `#kiosk-recipe-price-preview` (GAP-7 H2)

**`kioskSelectSaleType` wired:** added `pricePreviewEl.style.display = ''` so the price card appears as soon as a sale type is selected (before the modify panel is ever opened).

**GAP-5 JS:** `kioskShowRecipePrompt` adds `.kiosk-recipe-prompt-view` class to `#kiosk-recipe-prompt` when shown; back button handler and `kioskSetMode` remove it on exit.

All 16 tests (ALP-1..5 + KLP-1..5) pass. `grep -c '&& _kioskModifyPanelOpen' js/kiosk.js` = 0.

### Task 2: GAP-5 Scroll + GAP-7 Polish (kiosk CSS) + Build + Full Gate

**css/kiosk.css (new rules appended):**
- `--sp-1/2/3/4/6/8` tokens in `:root` (GAP-7 M2)
- `.kiosk-recipe-prompt-view { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; }` (GAP-5)
- `.kiosk-price-preview { background:var(--cellar-raised); border:1px solid var(--ledger-line,...); border-radius:var(--r-md); padding:var(--sp-3) var(--sp-4); font-size:13px; margin:var(--sp-2) 0; }` (GAP-7 H2)
- `.kiosk-recipe-modify-table .admin-input { min-height:44px; }` (GAP-7 H3)
- `#kiosk-recipe-volume-wrap { margin-bottom:var(--sp-6); }` (GAP-7 H6/M3)
- `#kiosk-recipe-modify-wrap { margin-top:var(--sp-4); }` (GAP-7 M3)
- `.ing-autocomplete-drop` block with `cellar-raised` bg, `cellar-border` border, `14px 12px` option padding for 44px tap height, `z-index:300` to clear scroll container (GAP-7 H5/L1)
- `.kiosk-modify-group-header td` CSS class (GAP-7 L3)
- `#kiosk-add-recipe-to-cart.kiosk-add-recipe-btn { position:sticky; bottom:0; }` (iPad ergonomics, GAP-5)

**kiosk.js autocomplete:** Replaced inline `cssText` (`background:#fff;border:1px solid #ccc;...`) with class-only `drop.className = 'ing-autocomplete-drop'`; added `role="option"` to each option `<div>` for accessibility.

**Build:** `npm run build` regenerated all minified bundles. Verified `kiosk-recipe-summary-price` present in `js/kiosk.min.js`, `kiosk-recipe-prompt-view` in `css/kiosk.min.css`, `ing-autocomplete-drop` in `css/kiosk.min.css`.

**Test results:** 861 frontend tests pass + 897 middleware tests pass + 0 lint errors. No middleware files modified.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (RED+GREEN) | a2c297c | feat(36-15): GAP-4 — ungate kiosk quote write paths + server-authoritative prominent price |
| Task 2 + Build | f04040f | feat(36-15): GAP-5/7 scroll + audit polish (kiosk CSS) + rebuild all bundles |

## Deviations from Plan

### Auto-applied changes

**1. [Rule 2 - Completeness] `kioskSelectSaleType` wired to show price-preview immediately**
- **Found during:** Task 1 implementation
- **Issue:** The plan specified price-preview should be shown "once a sale-type is selected, independent of modify panel state" — this required adding `pricePreviewEl.style.display = ''` in `kioskSelectSaleType` (not only relying on the quote fetch setting it). Mirrors the admin reference (36-14).
- **Fix:** Added explicit show call before `kioskScheduleRecipeQuote()` in `kioskSelectSaleType`
- **Files modified:** js/kiosk.js

**2. [Rule 2 - Completeness] `#kiosk-locked-price-notice` moved alongside price-preview**
- **Found during:** Task 1 kiosk.html restructure
- **Issue:** The locked-price notice was inside `#kiosk-recipe-modify-wrap`. Since `#kiosk-recipe-price-preview` was moved out, the notice should sit logically beside it (identical to admin.html fix in 36-14).
- **Fix:** Moved `#kiosk-locked-price-notice` out of `#kiosk-recipe-modify-wrap` alongside `#kiosk-recipe-price-preview`. The JS references it by `getElementById` so no JS change needed.
- **Files modified:** kiosk.html

**3. [Rule 2 - Enhancement] `role="option"` added to autocomplete dropdown items**
- **Found during:** Task 2 autocomplete class migration
- **Issue:** The original inline-styled `<div>` option elements had no ARIA role. When migrating to `.ing-autocomplete-drop` (which includes `[role="option"]` CSS selectors from admin.css), adding the role attribute was the correct action.
- **Fix:** Added `opt.setAttribute('role', 'option')` to each option div in `kioskShowIngredientAutocomplete`
- **Files modified:** js/kiosk.js

## Known Stubs

None — all price display paths are wired to the server quote response. Kiosk has no save-as-new (per spec §2, D-05).

## Threat Flags

None — all kiosk surfaces are staff-only in-store iPad POS. The prominent price comes exclusively from the server quote (T-36-15-01 mitigated via ungated write path + KLP-5 assertion). All dynamic ingredient names in autocomplete continue to use `opt.textContent` (no innerHTML — no XSS path, T-36-15-02 mitigated). The ungated quote write paths eliminate stale price display (T-36-15-03 mitigated).

## Self-Check

### Files exist:
- `js/kiosk.js` — FOUND
- `kiosk.html` — FOUND
- `css/kiosk.css` — FOUND
- `css/kiosk.min.css` — FOUND
- `js/kiosk.min.js` — FOUND
- `tests/frontend/kiosk-recipe-live-price.test.js` — FOUND

### Commits exist:
- a2c297c: FOUND
- f04040f: FOUND

### Gate assertions:
- `grep -c '&& _kioskModifyPanelOpen' js/kiosk.js` = 0 — PASS
- `grep -q "kiosk-recipe-price-preview" kiosk.html` — PASS (standalone outside modify-wrap)
- `grep -q "kiosk-recipe-summary-price" js/kiosk.js` — PASS
- `grep -q "kiosk-recipe-prompt-view" css/kiosk.css` — PASS
- `grep -q "ing-autocomplete-drop" css/kiosk.css` — PASS
- `grep -q "kiosk-price-preview" css/kiosk.css` — PASS
- `grep -q "kiosk-recipe-summary-price" js/kiosk.min.js` — PASS
- 861 frontend tests passed — PASS
- 897 middleware tests passed — PASS
- 0 lint errors — PASS

## Self-Check: PASSED
