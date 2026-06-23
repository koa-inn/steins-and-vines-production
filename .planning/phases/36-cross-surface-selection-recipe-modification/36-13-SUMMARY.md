---
phase: 36-cross-surface-selection-recipe-modification
plan: 13
subsystem: ui-contract
tags: [docs, ui-spec, gap-closure, design-contract]
dependency_graph:
  requires: []
  provides:
    - "36-UI-SPEC.md §Live Price Visibility (GAP-4) — server-authoritative price always visible, _kioskModifyPanelOpen gate forbidden"
    - "36-UI-SPEC.md §Scroll Model (GAP-5) — kiosk-recipe-prompt scroll container + bp-recipe-attach-expanded injection into detail pane"
    - "36-UI-SPEC.md §Audit Polish (GAP-7) — binding C/H fixes checklist for all surface plans"
  affects:
    - "36-14-PLAN.md (admin surface — implements against this spec)"
    - "36-15-PLAN.md (kiosk surface — implements against this spec)"
    - "36-16-PLAN.md (BrewPad surface — implements against this spec)"
tech_stack:
  added: []
  patterns:
    - "Standalone price-preview card outside modify-wrap (GAP-4)"
    - "Scroll container via .kiosk-recipe-prompt-view CSS class (GAP-5)"
    - "BrewPad bp-recipe-attach-expanded injected into scrollable sectionBodyEl (GAP-5)"
key_files:
  created: []
  modified:
    - ".planning/phases/36-cross-surface-selection-recipe-modification/36-UI-SPEC.md"
decisions:
  - "GAP-4: _kioskModifyPanelOpen gate MUST be removed from all 8 write paths in kioskFetchRecipeQuote (admin.js:11031/11043/11056/11066; kiosk.js:801/813/826/836) — spec now explicitly names these anchors"
  - "GAP-4: #kiosk-recipe-price-preview moved out of #kiosk-recipe-modify-wrap to standalone position between modify-wrap and stock-conflict; visible as soon as sale-type is selected"
  - "GAP-5: .kiosk-recipe-prompt-view class provides height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch scroll context on both admin kiosk tab and kiosk.html"
  - "GAP-5: bp-recipe-attach-expanded must be injected into sectionBodyEl (inside .bp-batch-detail-pane) not toggled as a sibling of .bp-batches-layout"
  - "D-10 restated: BrewPad must NOT add any price preview, quote call, or price display — plan 36-16 has explicit prohibition"
  - "GAP-7: .bp-ing-remove must be 44px x 44px (C5); save-as-new button must use .btn-secondary not admin-btn-sm (H4); modify-row inputs must have min-height:44px (H3)"
  - "GAP-7: kiosk-price-preview must be styled card with .kiosk-price-preview class; #kiosk-save-as-new-wrap must appear BELOW #kiosk-add-recipe-to-cart in admin.html (H1)"
metrics:
  duration: "3 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_modified: 1
---

# Phase 36 Plan 13: UI-SPEC Gap-Closure Contract (GAP-4/5/7) Summary

## One-Liner

Updated 36-UI-SPEC.md with three new sections encoding the second-pass UAT gap-closure contract — server-authoritative live price visibility (GAP-4), iPad scroll model (GAP-5), and audit polish checklist (GAP-7) — so the three surface plans (36-14/15/16) implement against one authoritative document.

## What Was Built

This was a documentation-only plan. Two tasks appended new top-level sections to `36-UI-SPEC.md`:

**Task 1 (GAP-4 + GAP-5):**

- `## Live Price Visibility (GAP-4, MOD-02, D-06)`: mandates that `#kiosk-recipe-summary-price` always reflects the live server quote, updated on every volume/factor/ingredient change regardless of modify panel state. Explicitly names the 8 gated lines to remove (`_kioskModifyPanelOpen` gates in admin.js:11031/11043/11056/11066 and kiosk.js:801/813/826/836). Specifies `#kiosk-recipe-price-preview` as a standalone card outside `#kiosk-recipe-modify-wrap`. Restates D-10 prohibiting any price display on BrewPad.

- `## Scroll Model (GAP-5)`: specifies `.kiosk-recipe-prompt-view` CSS class for the sale surface scroll container (height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch), includes the canonical 11-item element order from 36-UI-REVIEW.md lines 29-54. Specifies the BrewPad DOM restructure — `#bp-recipe-attach-expanded` injected into `sectionBodyEl` (inside the scrollable `.bp-batch-detail-pane`) rather than toggled as a sibling of `.bp-batches-layout` which is clipped by `overflow:hidden`.

**Task 2 (GAP-7):**

- `## Audit Polish (GAP-7 — from 36-UI-REVIEW.md)`: binding checklist grouped by category:
  - Touch targets: `.bp-ing-remove` 44px (C5), save-as-new `.btn-secondary` (H4), modify-row `min-height:44px` (H3)
  - iOS zoom: `#tab-kiosk .admin-input { font-size:1rem }` (C4), kiosk volume inputs (M4)
  - Price-preview card: `.kiosk-price-preview` class with cellar-raised bg + ledger-line border + r-md radius + sp-3/sp-4 padding (H2)
  - Element order: `#kiosk-save-as-new-wrap` BELOW `#kiosk-add-recipe-to-cart` in admin.html (H1)
  - Empty state: no-phantom-row rule restated as binding fix (GAP-2+GAP-7 tie-in)
  - Color: kiosk autocomplete must use `.ing-autocomplete-drop` CSS class (H5/L1)
  - Spacing: kiosk.css `:root` needs `--sp-*` token definitions; volume-wrap `margin-bottom:--sp-6` (M2/H6/M3)
  - Copy: remove trailing colon from brewpad.html `× factor:` label (M1)
  - Group-header CSS class extraction noted as "should" (L3, discretionary)
- Updated Checker Sign-Off note to record second-pass extension date 2026-06-22.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 685d765 | docs(36-13): add Live Price Visibility + Scroll Model sections to UI-SPEC (GAP-4, GAP-5) |
| Task 2 | e224cee | docs(36-13): add Audit Polish section to UI-SPEC + update checker sign-off (GAP-7) |

## Deviations from Plan

None — plan executed exactly as written. Both tasks were documentation edits to 36-UI-SPEC.md; no source files were touched; no build required.

## Known Stubs

None — documentation plan. No data sources, components, or UI wired.

## Threat Flags

None — documentation-only plan with no executable surface. The server-authoritative pricing rule (D-06) is now more prominently encoded in the spec (T-36-13-01 mitigated at contract level). BrewPad no-price prohibition restated (T-36-13-02 mitigated at contract level).

## Self-Check

### Files exist:
- `.planning/phases/36-cross-surface-selection-recipe-modification/36-UI-SPEC.md` — FOUND (updated)
- `.planning/phases/36-cross-surface-selection-recipe-modification/36-13-SUMMARY.md` — this file

### Commits exist:
- 685d765: FOUND
- e224cee: FOUND

## Self-Check: PASSED
