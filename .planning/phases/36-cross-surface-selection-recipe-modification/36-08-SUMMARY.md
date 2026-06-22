---
phase: 36-cross-surface-selection-recipe-modification
plan: "08"
subsystem: planning-docs
tags: [ui-spec, gap-closure, gap-2, gap-3, factor-control, modify-panel]
dependency_graph:
  requires: []
  provides: ["36-UI-SPEC.md ×factor contract", "36-UI-SPEC.md modify-panel ordering contract"]
  affects: ["36-09-PLAN.md", "36-10-PLAN.md", "36-11-PLAN.md"]
tech_stack:
  added: []
  patterns: ["Two-way sync: factor↔litres client-side display only", "Shared element-ID contract across surfaces", "Corrected recipe-prompt element ordering"]
key_files:
  created: []
  modified:
    - .planning/phases/36-cross-surface-selection-recipe-modification/36-UI-SPEC.md
decisions:
  - "× factor input placed immediately to the RIGHT of Target volume (L) in the same flex row (gap --sp-4)"
  - "Two-way sync is display-only: editing factor computes litres = factor × base (rounded to 0.5 L); editing litres computes factor = litres ÷ base (2 decimal places)"
  - "No-base ⇒ BOTH inputs disabled; single disable-copy readout"
  - "Server-authoritative rule explicitly stated verbatim in spec: factor sync never becomes the charge source"
  - "Element order corrected: volume+factor row → readout → Modify toggle (collapsed) → rows+add → price preview (sale only) → stock → action buttons"
  - "Empty modify panel MUST NOT render phantom rows while collapsed; placeholder row only when expanded + all rows removed"
metrics:
  duration: "~2 minutes"
  completed_date: "2026-06-22"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 36 Plan 08: UI-SPEC Gap-Closure — ×factor Control + Modify-Panel Polish Summary

**One-liner:** Extended 36-UI-SPEC.md with a precise ×factor↔litres two-way sync contract (GAP-3) and a corrected recipe-prompt element ordering with empty-state polish (GAP-2), providing a single authoritative contract for the three surface plans (36-09/10/11).

## Tasks Completed

| # | Name | Status | Files |
|---|------|--------|-------|
| 1 | Add synced ×factor control subsection (GAP-3) | Complete | 36-UI-SPEC.md |
| 2 | Document polished/reordered modify-panel layout (GAP-2) | Complete | 36-UI-SPEC.md |

## What Was Built

### Task 1 — ×factor Control (GAP-3)

Added section "## Synced ×factor Control (GAP-3, SEL-01, D-01)" to 36-UI-SPEC.md containing:

- **Element ID table:** `#kiosk-target-factor` (admin + kiosk) and `#bp-target-factor` (BrewPad), each placed immediately to the RIGHT of the existing litres input inside the same volume-wrap container.
- **Input attribute table:** type=number, min=0.01, step=0.1, inputmode=decimal; font-size 1rem on kiosk/BrewPad (iOS zoom guard).
- **Two-way sync contract (display only):**
  - Editing factor → `litres = factor × base_batch_size_l` (rounded to 0.5 L granularity)
  - Editing litres → `factor = litres ÷ base` (shown to 2 decimal places)
- **Bounds table:** factor > 0 & ≤ 10; litres > 0 & ≤ base × 10. Clamping on out-of-range entry.
- **No-base disabled state:** both inputs disabled; readout shows existing "Set batch size (L)" copy.
- **Server-authoritative rule** (verbatim as required): "The ×factor↔litres sync is client-side display only. The charged price always comes from GET /api/kiosk/recipe-quote (sale surfaces) or is absent (BrewPad attach, D-10). The factor input never becomes the source of the charge; it only changes the displayed target_volume_l that the quote endpoint already receives."
- **Copywriting table** updated with: `× factor label | "× factor"`.
- **D-01 consistency statement:** identical on all three surfaces; only CSS class prefix differs.

### Task 2 — Modify-Panel Polish & Ordering (GAP-2)

Added section "## Modify-Panel Polish & Ordering (GAP-2)" to 36-UI-SPEC.md containing:

- **Problem statement:** Identified cramped layout, awkward element ordering, phantom empty rows.
- **Volume + factor row layout:** both inputs on one flex row (gap --sp-4), readout directly beneath — not interleaved.
- **Corrected 8-step element order** inside the recipe prompt, consistent across all three surfaces, with BrewPad explicitly omitting step 6 (price preview, D-10).
- **Empty-state rule:** phantom empty rows in collapsed panel are the bug to remove. Correct empty state = single placeholder `<td colspan="4">` row, rendered only when panel is expanded AND all rows removed.
- **Touch-friendliness reminder:** 44px minimum retained for all interactive elements.
- **D-01 cross-surface consistency statement.**

Updated Checker Sign-Off note to record the gap-closure extension was added.

## Deviations from Plan

None — plan executed exactly as written. Both tasks are doc-only edits to 36-UI-SPEC.md.

## Threat Flags

None — doc-only change, no runtime surface introduced. T-36-08-01 (Tampering) is mitigated: the spec explicitly states the factor sync is client-side display only and the server quote is authoritative for price.

## Known Stubs

None — document plan; no UI stubs or placeholder content.

## Self-Check: PASSED

- [x] 36-UI-SPEC.md modified and contains all required strings
- [x] `grep "× factor"` PASS
- [x] `grep "kiosk-target-factor"` PASS
- [x] `grep "bp-target-factor"` PASS
- [x] `grep "client-side display only"` PASS
- [x] `grep "Modify-Panel Polish & Ordering"` PASS
- [x] `grep "collapsed by default"` PASS
- [x] No code files touched
- [x] Copywriting table row for "× factor" added
- [x] Checker Sign-Off note updated with gap-closure annotation
