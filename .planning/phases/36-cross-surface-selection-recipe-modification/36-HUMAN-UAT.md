---
status: partial
phase: 36-cross-surface-selection-recipe-modification
source: [36-VERIFICATION.md]
started: 2026-06-21T05:40:00Z
updated: 2026-06-21T05:40:00Z
---

## Current Test

[awaiting human testing on staging]

## Tests

### 1. Cross-surface control parity (SEL-01, D-01)
expected: The identical target-volume control (pre-fill base, 0.5 L steps, >0 & ≤~10× base bounds, no-base ⇒ disabled, "1.5× base 20 L" readout) appears and behaves the same on admin recipe-sale, kiosk recipe-sale, and BrewPad recipe-attach.
result: [pending]

### 2. Displayed == charged, end-to-end (MOD-02)
expected: On admin + kiosk, the modified-list price shown before Add-to-Cart equals the amount charged at the Helcim terminal for a real (or test) transaction.
result: [pending]

### 3. Locked-recipe add/remove asymmetry (D-07/D-08) — owner acknowledgement
expected: On a live locked-price recipe at 1.5×, ADDING a discrete ingredient increases the charge by the scaled added line (e.g. 1 pcs → 2 pcs × rate; the $125.50 worked example), while REMOVING an ingredient leaves the charge unchanged (no credit). Staff/owner acknowledge the intentional asymmetry.
result: [pending]

### 4. SEL-02 carry-through chain (SEL-02, D-02)
expected: A sale at a non-1× volume flows the chosen volume through cart → Zoho invoice → frozen recipe_snapshot → created batch record with NO re-entry. The batch row shows target_volume_l + scale_factor. (Depends on test #5.)
result: [pending]

### 5. Apps Script create_batch redeploy (SEL-02 — BLOCKED human-action)
expected: adminApi.gs create_batch handler reads payload.target_volume_l + scale_factor and writes them to the Batches sheet row (columns added if missing); existing Web App deployment redeployed (same URL). Verified by a staging sale at 30 L / 1.5× showing those values on the batch row without re-typing.
result: [pending]

### 6. BrewPad attach is record-keeping only (D-10/D-11)
expected: Attaching a (possibly modified) recipe freezes a scaled+modified snapshot via updateBatch with NO price preview, NO Helcim charge. The stock advisory is soft — the Attach button is never disabled by stock.
result: [pending]

### 7. Save-as-new recipe (MOD-03, D-12/D-13/D-14)
expected: On admin + BrewPad, saving a modification prompts for a name and creates a NEW draft (inactive), dynamic-priced recipe storing the modified BASE list at base volume. The original recipe is untouched. Kiosk has NO save-as-new affordance.
result: [pending]

### 8. iPad Safari touch/zoom
expected: On the in-store iPad (kiosk + BrewPad), number/text inputs do not trigger iOS auto-zoom (font-size ≥16px), and the modify panel + autocomplete are touch-friendly.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
