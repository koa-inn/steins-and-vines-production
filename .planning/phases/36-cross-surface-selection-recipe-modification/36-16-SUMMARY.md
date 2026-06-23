---
phase: 36-cross-surface-selection-recipe-modification
plan: 16
subsystem: brewpad-recipe-attach-ui
tags: [brewpad, gap-closure, scroll, audit-polish, 44px, template, build]
dependency_graph:
  requires: [36-13, 36-14, 36-15]
  provides:
    - "BrewPad attach surface: expanded panel injected into scrollable detail pane (GAP-5)"
    - "BrewPad attach surface: .bp-ing-remove 44px×44px touch target (GAP-7 C5)"
    - "BrewPad attach surface: × factor label colon removed (GAP-7 M1)"
    - "D-10 preserved: no price/quote/charge on BrewPad attach path"
  affects:
    - "Phase 36 final wave — all surfaces now closed"
tech_stack:
  added: []
  patterns:
    - "<template id='bp-recipe-attach-expanded-tpl'> in brewpad.html (static source fragment)"
    - "wireAttachExpandedPanel clones template content into sectionBodyEl via tpl.content.cloneNode(true)"
    - "Injected container id='bp-recipe-attach-expanded-injected' — removable by ID on cancel/re-open"
    - ".bp-ing-remove 44px touch target (GAP-7 C5)"
key_files:
  created: []
  modified:
    - "brewpad.html"
    - "js/brewpad.js"
    - "css/brewpad.css"
    - "js/brewpad.min.js"
    - "css/brewpad.min.css"
    - "tests/frontend/brewpad-recipe-attach-modify.test.js"
decisions:
  - "GAP-5 approach (a) chosen: #bp-recipe-attach-expanded converted to <template id='bp-recipe-attach-expanded-tpl'>; wireAttachExpandedPanel clones into sectionBodyEl — lower risk than approach (b) (DOM move) since the template never renders in the clipped location at all"
  - "Injected container wrapped in <div id='bp-recipe-attach-expanded-injected'> for deterministic removal on cancel/re-open/attach"
  - "D-10 invariant preserved: attach path has NO price preview, NO recipe-quote call, NO Helcim call — only target_volume_l written to update_batch snapshot"
  - "GAP-7 M1: × factor colon removed from brewpad.html (inside template)"
  - "GAP-7 C5: .bp-ing-remove bumped from 36px to 44px with padding 10px 12px"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_modified: 6
---

# Phase 36 Plan 16: BrewPad GAP-5/7 Closure Summary

## One-Liner

BrewPad recipe-attach DOM restructure (GAP-5): expanded panel injected into the scrollable detail pane via template cloning so the full ingredient list and Attach button are reachable on iPad; × factor colon removed and Remove button bumped to 44px (GAP-7); D-10 no-price invariant regression-guarded by BSC-3/4; all 865 frontend tests green.

## What Was Built

### Task 1: GAP-5/7 — Template Injection + Polish + Tests (TDD)

**RED phase:** Added BSC-1..BSC-4 tests to `tests/frontend/brewpad-recipe-attach-modify.test.js`:
- BSC-1: expanded panel content is inside sectionBodyEl after `wireAttachExpandedPanel` runs
- BSC-2: `#bp-recipe-attach-confirm-btn` is findable inside sectionBodyEl
- BSC-3: no recipe-quote/recipe-sale/Helcim URL hit on expand (D-10 regression guard)
- BSC-4: editing `#bp-target-factor` updates `_bpTargetVolumeL` and fires no quote call

BSC-1 and BSC-2 failed as expected (RED confirmed). BSC-3 and BSC-4 passed even pre-implementation (D-10 already intact).

**GAP-5 restructure (brewpad.html + brewpad.js — approach a):**

`#bp-recipe-attach-expanded` (static `<div style="display:none">` sibling of `.bp-batches-layout`) was converted to `<template id="bp-recipe-attach-expanded-tpl">`. Template markup is never rendered in the clipped location.

`wireAttachExpandedPanel(b, sectionBodyEl)` now:
1. Removes any prior `#bp-recipe-attach-expanded-injected` container from sectionBodyEl
2. Finds `<template id="bp-recipe-attach-expanded-tpl">` and clones its content via `tpl.content.cloneNode(true)`
3. Wraps the document fragment in `<div id="bp-recipe-attach-expanded-injected">` for deterministic removal
4. Appends into `sectionBodyEl` — which lives inside `.bp-batch-detail-pane { overflow-y:auto }`

This ensures the full ingredient list AND the Attach Recipe button are always reachable by scrolling the detail pane. The `.bp-batches-panel { overflow:hidden }` clip is intentional layout behavior and is preserved.

`openRecipeAttachPanel` updated:
- Old `expandedPanel = document.getElementById('bp-recipe-attach-expanded')` + show/hide references removed
- On open: removes prior injected panel from sectionBodyEl
- On cancel: removes injected panel from sectionBodyEl
- On recipe selection: `wireAttachExpandedPanel` handles injection directly (no separate show call)

Attach confirm onclick: `renderRecipeSectionBody(sectionBodyEl, b, snap2)` replaces sectionBodyEl.innerHTML, automatically removing the injected panel — no explicit hide needed.

**GAP-7 M1 (brewpad.html):** `&times; factor:` → `&times; factor` (colon removed from label inside template).

**GAP-7 C5 (css/brewpad.css):** `.bp-ing-remove { min-height: 36px; min-width: 36px; padding: 6px 10px; }` → `min-height: 44px; min-width: 44px; padding: 10px 12px;`.

**GREEN phase:** All 35 tests pass (BSC-1..BSC-4 now green). Lint clean (0 errors).

### Task 2: Build + Full Gate

`npm run build` regenerated all minified bundles. Key verification:
- `grep -q "bp-recipe-attach-expanded-injected" js/brewpad.min.js` → PASS (injection ID compiled)
- `grep -q "bp-target-factor" js/brewpad.min.js` → PASS (factor wiring present)
- `grep -q "bp-ing-remove" css/brewpad.min.css` → PASS (CSS rule compiled)
- `npm test` → 865 frontend tests pass
- `cd zoho-middleware && npm test` → 897 middleware tests pass unchanged
- `npm run lint` → 0 errors

No middleware files modified.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (TDD RED+GREEN) | 404deda | feat(36-16): GAP-5/7 — inject expanded attach panel into scrollable detail pane + 44px polish |
| Task 2 + Build | 5c0ac08 | feat(36-16): rebuild all bundles — GAP-5/7 brewpad changes compiled |

## Deviations from Plan

### Auto-applied changes

**1. [Rule 2 - Completeness] Test fixture includes `<template>` element inline**
- **Found during:** Task 1 RED — BSC-1/2 tests needed the template in the DOM
- **Issue:** `injectEl()` puts elements directly into `document.body`, not inside `sectionBodyEl`. The original fixture idea (injecting elements via `injectEl`) wouldn't satisfy BSC-1/2 since the elements would be in `document.body`, not inside `sectionBodyEl`. The correct approach is to inject the `<template>` element and let `wireAttachExpandedPanel` clone it into `sectionBodyEl` — exactly as it does in the browser.
- **Fix:** `buildDetailPaneFixture()` in the BSC test block creates the `<template>` element with the same inner markup as `brewpad.html` and appends it to `document.body`. No existing tests modified.
- **Files modified:** tests/frontend/brewpad-recipe-attach-modify.test.js (BSC fixture only)

## Known Stubs

None — all controls (volume, factor, modify panel, attach button, save-as-new) are wired in `wireAttachExpandedPanel`. The template is a source fragment, not a stub — it is always cloned into the live DOM before any user interaction.

## Threat Flags

None — D-10 verified:
- `grep -n "recipe-quote\|recipe-sale\|helcim\|kiosk/payment" js/brewpad.js` returns only comments (line 1238 and 4124), no actual calls.
- BSC-3 regression-guards this invariant: the test asserts no forbidden URL is hit during `wireAttachExpandedPanel` invocation.
- The template injection does not introduce any new network endpoints — it only restructures where existing DOM elements are rendered.
- XSS: the existing `escapeHTML` path for ingredient names in the modify rows and advisory is preserved (T-36-16-02 mitigated).
- `target_volume_l` snapshot path unchanged (T-36-16-03 mitigated by BSC-4).

## Self-Check

### Files exist:
- `brewpad.html` — FOUND
- `js/brewpad.js` — FOUND
- `css/brewpad.css` — FOUND
- `js/brewpad.min.js` — FOUND
- `css/brewpad.min.css` — FOUND
- `tests/frontend/brewpad-recipe-attach-modify.test.js` — FOUND

### Commits exist:
- 404deda: FOUND
- 5c0ac08: FOUND

### Gate assertions:
- `sectionBodyEl` in js/brewpad.js — PASS
- `bp-target-factor` in js/brewpad.js — PASS
- `times; factor:` NOT in brewpad.html — PASS (colon removed)
- `bp-ing-remove` in css/brewpad.css — PASS
- `min-height: 44px` in css/brewpad.css — PASS
- `bp-recipe-attach-expanded-injected` in js/brewpad.min.js — PASS
- `bp-target-factor` in js/brewpad.min.js — PASS
- `bp-ing-remove` in css/brewpad.min.css — PASS
- 865 frontend tests passed — PASS
- 897 middleware tests passed (unchanged) — PASS
- 0 lint errors — PASS
- D-10: no recipe-quote/recipe-sale/helcim calls in brewpad.js — PASS

## Self-Check: PASSED
