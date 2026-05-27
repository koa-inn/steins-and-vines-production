---
phase: 16-recipe-management-brewpad-kiosk-batch-integration
plan: "03"
subsystem: kiosk
tags: [kiosk, recipe, quick-edit, admin-js, kiosk-css]
dependency_graph:
  requires:
    - "16-01 (recipe CRUD middleware endpoint PUT /api/recipes/:id)"
  provides:
    - "kioskSaveRecipeQuickEdit function in js/admin.js"
    - "Quick-edit panel CSS in css/kiosk.css"
  affects:
    - "js/admin.js kioskShowRecipePrompt function"
    - "css/kiosk.css kiosk recipe panel styles"
tech_stack:
  added: []
  patterns:
    - "Inline quick-edit form inside existing detail pane (no modal/navigation change)"
    - "PUT /api/recipes/:id via fetch with x-api-key header"
    - "Local recipe object mutation on save success"
    - "iOS auto-zoom prevention via font-size:16px on all form inputs"
    - "Touch-friendly 44px min-height on action buttons (tablet kiosk)"
key_files:
  created: []
  modified:
    - js/admin.js
    - css/kiosk.css
    - css/kiosk.min.css
    - js/admin.min.js
decisions:
  - "Edit Recipe button uses .btn (primary) style per 16-UI-SPEC.md — primary CTA on this screen"
  - "status always included in PUT payload to avoid activation-guardrail ambiguity (Pitfall 3)"
  - "recipe object mutated in-place on success — avoids full re-fetch, kiosk card stays consistent"
  - "kqe-cancel closes form without API call — Discard Changes returns to read-only view"
  - "kioskSaveRecipeQuickEdit placed immediately after kioskShowRecipePrompt for locality"
metrics:
  duration_min: 10
  completed_date: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 16 Plan 03: Kiosk Recipe Quick-Edit Summary

## One-liner

Inline quick-edit form (name, notes, locked_price, status) added to kiosk recipe detail pane, saving via PUT /api/recipes/:id with touch-friendly CSS.

## What Was Built

- `kioskSaveRecipeQuickEdit(recipe, wrap, qeBtn)` function in `js/admin.js` (line 10444) — sends PUT /api/recipes/:id with all 4 fields, disables save button during request, mutates local recipe object on success, shows toast
- Quick-edit wrap div and "Edit Recipe" button (`.btn` primary style) appended to `summaryHtml` in `kioskShowRecipePrompt()` before innerHTML assignment
- Click handler wired after `summaryEl.innerHTML = summaryHtml` — builds inline form with `kqe-name`, `kqe-notes`, `kqe-price`, `kqe-status` fields plus Save Changes / Discard Changes buttons
- `.kiosk-recipe-quick-edit` and `.kiosk-quick-edit-actions` CSS classes added to `css/kiosk.css` with `font-size: 16px` (iOS zoom prevention) and `min-height: 44px` (touch targets)

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add quick-edit form and save function to kiosk recipe detail pane | 4e5cfe5 | js/admin.js (+78 lines) |
| 2 | Add CSS styles for kiosk recipe quick-edit panel | 9ac827a | css/kiosk.css (+30 lines), css/kiosk.min.css, js/admin.min.js, js/kiosk.min.js, 11 HTML files (stamp) |
| - | Update admin.js BUILD_TIMESTAMP (npm run build artifact) | c1184a8 | js/admin.js (1 line) |

## Verification Results

- `npm run lint`: 0 errors, 96 warnings (all pre-existing)
- `npm test`: 381/381 passed (21 suites)
- `cd zoho-middleware && npm test`: 510/510 passed (24 suites)
- `npm run build`: successful (CSS/JS minified, HTML stamped)

## Deviations from Plan

None — plan executed exactly as written.

The plan's two code variants (from PLAN.md vs 16-PATTERNS.md) were reconciled: the PLAN.md version was used as authoritative, with the `.kiosk-recipe-quick-edit` CSS class applied to the wrap div (per PLAN.md task 1B and 16-UI-SPEC.md component spec) and the `.kiosk-quick-edit-actions` div wrapper for action buttons (per PLAN.md task 1C).

## Known Stubs

None. The quick-edit form reads live recipe data from the existing recipe object passed into `kioskShowRecipePrompt()`, and saves via real PUT endpoint.

## Threat Flags

No new security surface beyond what the threat model covers. T-16-09 (XSS) mitigated: `escapeHTML()` applied to all recipe field values rendered into HTML attributes. T-16-12 (status omission) mitigated: status field always included in PUT payload.

## Self-Check: PASSED

- js/admin.js contains `function kioskSaveRecipeQuickEdit`: FOUND (line 10444)
- js/admin.js contains `id="kiosk-recipe-quick-edit-btn"`: FOUND (line 10326)
- js/admin.js contains `kqe-name`, `kqe-notes`, `kqe-price`, `kqe-status`: FOUND
- js/admin.js contains `saveBtn.disabled = true`: FOUND (line 10446)
- css/kiosk.css contains `.kiosk-recipe-quick-edit`: FOUND (line 2729)
- css/kiosk.css contains `.kiosk-quick-edit-actions` with `display: flex`: FOUND (lines 2746-2747)
- css/kiosk.css contains `min-height: 44px`: FOUND (line 2754)
- Commits 4e5cfe5, 9ac827a, c1184a8: FOUND in git log
