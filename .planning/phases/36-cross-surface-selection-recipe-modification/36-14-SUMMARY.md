---
phase: 36-cross-surface-selection-recipe-modification
plan: 14
subsystem: admin-kiosk-sale-ui
tags: [admin, kiosk-sale, gap-closure, live-price, scroll, ios-zoom, audit-polish, build]
dependency_graph:
  requires: [36-13]
  provides:
    - "Admin kiosk-sale surface: live server-quote price on every change (GAP-4, D-06)"
    - "Admin kiosk-sale surface: bounded scrollable #kiosk-recipe-prompt (GAP-5)"
    - "Admin kiosk-sale surface: font-size:1rem on modify/volume inputs (GAP-6)"
    - "Admin kiosk-sale surface: audit polish — price-preview card, save-as-new below CTA, 44px targets, spacing (GAP-7)"
    - "Reference implementation for 36-15 (kiosk) and 36-16 (BrewPad)"
  affects:
    - "36-15-PLAN.md (kiosk surface — mirrors this admin reference)"
    - "36-16-PLAN.md (BrewPad surface — mirrors this reference, no price preview)"
tech_stack:
  added: []
  patterns:
    - "Ungated quote write paths in kioskFetchRecipeQuote — always write to price elements (GAP-4)"
    - "Prominent price (#kiosk-recipe-summary-price) updated from _kioskQuote.total server response (D-06)"
    - "#kiosk-recipe-price-preview as standalone card outside #kiosk-recipe-modify-wrap (GAP-4)"
    - ".kiosk-recipe-prompt-view toggled class for bounded scroll context (GAP-5)"
    - "font-size:1rem overrides on #tab-kiosk .admin-input and .kiosk-volume-input (GAP-6)"
    - ".kiosk-price-preview card class with cellar-raised/ledger-line/r-md styling (GAP-7 H2)"
    - ".kiosk-modify-group-header td CSS class extracted from inline JS styles (GAP-7 L3)"
key_files:
  created:
    - "tests/frontend/kiosk-recipe-live-price.test.js"
  modified:
    - "js/admin.js"
    - "admin.html"
    - "css/admin.css"
    - "css/admin.min.css"
    - "js/admin.min.js"
decisions:
  - "GAP-4: kioskFetchRecipeQuote write paths ungated — _kioskModifyPanelOpen removed from all 4 paths"
  - "GAP-4: server total from _kioskQuote.total written to #kiosk-recipe-summary-price on every successful quote (D-06 — displayed==charged)"
  - "GAP-4: #kiosk-recipe-price-preview shown immediately on sale-type selection; quote fetch sets Calculating then real price"
  - "GAP-5: .kiosk-recipe-prompt-view added/removed in kioskShowRecipePrompt, back button, and kioskSetMode"
  - "GAP-6: font-size:1rem applied via CSS selector #tab-kiosk .admin-input and #tab-kiosk .kiosk-volume-input (not inline styles)"
  - "GAP-7 H1: #kiosk-save-as-new-wrap moved below #kiosk-add-recipe-to-cart in admin.html"
  - "GAP-7 H4: save-as-new button changed from .admin-btn-sm to .btn-secondary (44px touch target)"
  - "GAP-7 L3: .kiosk-modify-group-header td CSS class created to replace inline JS style attributes"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_modified: 5
---

# Phase 36 Plan 14: Admin Kiosk-Sale GAP-4/5/6/7 Closure Summary

## One-Liner

Admin kiosk-sale reference implementation: ungated server-authoritative live price on every volume/factor/ingredient change (GAP-4, D-06), iPad-reachable scrollable prompt (GAP-5), iOS zoom-guard font-sizes (GAP-6), and full audit polish per 36-UI-SPEC (GAP-7) — rebuilt bundles, 8 new regression tests green.

## What Was Built

### Task 1: GAP-4 — Ungate Quote Write Paths + Prominent Server Price (TDD)

**RED phase:** Created `tests/frontend/kiosk-recipe-live-price.test.js` with 8 failing tests (ALP-1 through ALP-5) asserting the prominent price updates from the server quote with the modify panel closed.

**GREEN phase (admin.js):** Removed all 4 `_kioskModifyPanelOpen` guards from `kioskFetchRecipeQuote`:
- Loading path (~line 11031): now writes `"Calculating…"` unconditionally
- Success path (~line 11043): writes quote total to `#kiosk-recipe-price-preview` unconditionally
- Error path (~line 11056): writes error copy unconditionally
- Catch path (~line 11066): writes error copy unconditionally

On quote success, the server total is additionally written to `#kiosk-recipe-summary-price` (the prominent price) via `kioskFmt(total) + ' per batch'`. This is the displayed==charged guarantee (D-06) — the client never computes the charge.

**admin.html restructure:**
- Moved `#kiosk-recipe-price-preview` OUT of `#kiosk-recipe-modify-wrap` — now a standalone sibling between `#kiosk-recipe-modify-wrap` and `#kiosk-stock-conflict`
- Moved `#kiosk-locked-price-notice` alongside the standalone price-preview
- Moved `#kiosk-save-as-new-wrap` to AFTER `#kiosk-add-recipe-to-cart` (GAP-7 H1)
- Changed save-as-new button from `.admin-btn-sm` to `.btn-secondary` (44px touch target, GAP-7 H4)
- Applied `.kiosk-price-preview` class to `#kiosk-recipe-price-preview`

**`kioskSelectSaleType` wired:** added `pricePreviewEl.style.display = ''` so the price card appears as soon as a sale type is selected (before the modify panel is ever opened).

All 8 ALP tests pass. `grep -c '&& _kioskModifyPanelOpen' js/admin.js` returns 0.

### Task 2: GAP-5 Scroll + GAP-6 Font-Size + GAP-7 Polish + Build

**admin.js:**
- `kioskShowRecipePrompt`: adds `.kiosk-recipe-prompt-view` class to `#kiosk-recipe-prompt` when shown
- Back button handler: removes `.kiosk-recipe-prompt-view` when returning to grid
- `kioskSetMode`: removes `.kiosk-recipe-prompt-view` on mode switch (grid view must not scroll)

**css/admin.css (new rules appended):**
- `.kiosk-recipe-prompt-view { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; }` (GAP-5)
- `#tab-kiosk .admin-input { font-size:1rem; }` (GAP-6 C4 — iOS zoom guard)
- `#tab-kiosk .kiosk-volume-input { font-size:1rem; }` (GAP-6 M4)
- `.kiosk-price-preview { background:var(--cellar-raised); border:1px solid var(--ledger-line,...); border-radius:var(--r-md); padding:var(--sp-3) var(--sp-4); font-size:13px; margin:var(--sp-2) 0; }` (GAP-7 H2)
- `.kiosk-recipe-modify-table .admin-input { min-height:44px; }` (GAP-7 H3)
- `#kiosk-recipe-volume-wrap { margin-bottom:var(--sp-6); }` (was --sp-4, GAP-7 H6/M3)
- `#kiosk-recipe-modify-wrap { margin-top:var(--sp-4); }` (GAP-7 M3)
- `.kiosk-modify-group-header td { font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-tertiary); padding:6px 8px; background:var(--ledger-soft,...); }` (GAP-7 L3)
- `#kiosk-add-recipe-to-cart.kiosk-add-recipe-btn { position:sticky; bottom:0; }` (iPad ergonomics)

**Build:** `npm run build` regenerated all minified bundles. Verified `kiosk-target-factor` present in `js/admin.min.js` (factor wiring confirmed in built bundle).

**Test results:** 853 frontend tests pass + 897 middleware tests pass + 0 lint errors.

## GAP-6 Cache/Hard-Refresh Guidance

**Root cause (GAP-6):** The ×factor/modify feature was present in admin.js but the deployed `admin.min.js` was stale (browser cache serving the old bundle without the Phase 36 additions). Additionally, the `.admin-input` base font-size of 13px was causing iOS Safari to auto-zoom on focus, making inputs appear to "jump" and feel non-functional.

**Remedy applied:** This build regenerates `admin.min.js` with a new cache-buster version stamp (`?v=mqpw7ll5`) appended to all script/style tags in `admin.html`. The new `font-size:1rem` CSS rules prevent iOS auto-zoom.

**Operator action for existing iPad sessions:** After deploying to staging:
1. On the iPad admin session, tap the `↻` (Clear-cache) button in the top-right of the admin shell bar
2. OR navigate to `admin.html` then pull-to-refresh twice (iOS Safari double-refresh clears the cache for that page)
3. Verify the `?v=mqpw7ll5` (or current version) appears in the loaded URL in Safari's network inspector

If the modify panel or ×factor control still appears to not work after clearing cache, check the browser console for JS errors — the most common culprit after a hard refresh is the Zoho OAuth session expiring (navigate to `/auth/zoho` on the middleware to re-authenticate).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (RED+GREEN) | d7a57f0 | feat(36-14): GAP-4 — ungate quote write paths + server-authoritative prominent price (admin) |
| Task 2 + Build | 77aa058 | feat(36-14): GAP-5/6/7 scroll + iOS zoom + audit polish + build (admin) |

## Deviations from Plan

### Auto-applied changes

**1. [Rule 2 - Enhancement] `kioskSelectSaleType` wired to show price-preview immediately**
- **Found during:** Task 1 implementation
- **Issue:** The plan specified price-preview should be shown "once a sale-type is selected, independent of modify panel state" — this required adding an explicit `pricePreviewEl.style.display = ''` in `kioskSelectSaleType` (not only relying on the quote fetch setting it)
- **Fix:** Added the explicit show call before `kioskScheduleRecipeQuote()` in `kioskSelectSaleType`
- **Files modified:** js/admin.js

**2. [Rule 2 - Completeness] `#kiosk-locked-price-notice` moved alongside price-preview**
- **Found during:** Task 1 admin.html restructure
- **Issue:** The locked-price notice was inside `#kiosk-recipe-modify-wrap`. Since `#kiosk-recipe-price-preview` was moved out, the notice should sit logically beside it (not inside the modify-wrap where it was hidden when the panel was closed)
- **Fix:** Moved `#kiosk-locked-price-notice` out of `#kiosk-recipe-modify-wrap` alongside `#kiosk-recipe-price-preview`. The JS still references it by `getElementById` so no JS change needed.
- **Files modified:** admin.html

## Known Stubs

None — all price display paths are wired to the server quote response.

## Threat Flags

None — all surfaces from this plan are admin-internal (staff-only). The prominent price comes exclusively from the server quote (T-36-14-01 mitigated). All dynamic ingredient names pass through the existing `escapeHTML` path (T-36-14-02 already mitigated in Phase 36 prior work). The ungated quote write paths eliminate stale price display (T-36-14-03 mitigated).

## Self-Check

### Files exist:
- `tests/frontend/kiosk-recipe-live-price.test.js` — FOUND
- `js/admin.js` — FOUND
- `admin.html` — FOUND
- `css/admin.css` — FOUND

### Commits exist:
- d7a57f0: FOUND
- 77aa058: FOUND

### Gate assertions:
- `grep -c '&& _kioskModifyPanelOpen' js/admin.js` = 0 — PASS
- `grep -q "kiosk-recipe-price-preview" admin.html` — PASS
- `grep -q "kiosk-target-factor" js/admin.min.js` — PASS
- `grep -q "kiosk-recipe-prompt-view" css/admin.css` — PASS
- `grep -q "kiosk-price-preview" css/admin.css` — PASS
- 853 frontend tests passed — PASS
- 897 middleware tests passed — PASS
- 0 lint errors — PASS

## Self-Check: PASSED
