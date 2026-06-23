---
phase: 36-cross-surface-selection-recipe-modification
plan: 17
status: complete
completed: 2026-06-22
type: checkpoint:human-verify
---

# 36-17 Summary — Third-pass UAT (owner-approved)

## Outcome

**Approved by owner on staging, 2026-06-22** ("that works great now! approved").

The third-pass UAT covered the round-2 gap-closure fixes (GAP-4/5/6/7 via 36-13..36-16)
and surfaced one regression, **GAP-8** (live price + ingredient list did not update on
volume/×factor change until a sale type was clicked). GAP-8 was fixed in **36-18**
(commit `669f221`, in-store preview default + scaled ingredient-list re-render on
admin + kiosk) and the owner re-verified it live on staging — sign-off given.

This plan supersedes the round-1 36-12 UAT checkpoint (folded in per owner decision).

## Items confirmed

- GAP-4 (now via GAP-8/36-18): live prominent price updates on volume/×factor/ingredient
  change with the modify panel CLOSED, pre-sale-type; displayed == charged at cart. PASS.
- Ingredient list scales live with volume/×factor (GAP-8/36-18). PASS.
- GAP-5 (scroll/reachability), GAP-6 (admin kiosk-view + iOS zoom), GAP-7 (polish):
  owner confirmed the editing/modify UX "looks really good on kiosk". PASS.
- BrewPad no-charge (D-10): unchanged. PASS.

## Still open (does NOT block this sign-off)

- **TP-8 carry-through to batch row (SEL-02):** requires the manual Apps Script
  `create_batch` redeploy + the two Batches-sheet columns (`target_volume_l`,
  `scale_factor`) to be made live. Code is in repo (commit f5037c2); the live steps are
  a human-action item tracked in 36-HUMAN-UAT.md test #5. Verify once those steps are done.

## Follow-on requests (new scope, not part of this sign-off)

Owner raised two BrewPad recipe-view enhancements in the same message:
- Show the recipe style on the BrewPad recipe list.
- Add a "clone recipe" button.
These are tracked separately (new gap-closure cycle) — they do not affect this UAT sign-off.

## Self-Check: PASSED

Third-pass UAT signed off by the owner. GAP-1..GAP-8 resolved. The SEL/MOD gap-closure
for Phase 36 is complete on staging pending the TP-8 Apps Script live step.
</content>
