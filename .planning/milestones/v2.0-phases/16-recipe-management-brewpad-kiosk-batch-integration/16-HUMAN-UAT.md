---
status: partial
phase: 16-recipe-management-brewpad-kiosk-batch-integration
source: [16-VERIFICATION.md]
started: 2026-05-18T05:45:00Z
updated: 2026-05-18T05:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. BrewPad New Batch tab switching + recipe selection
expected: Kits/Recipes tabs switch correctly, recipe dropdown shows active recipes with name + ABV, selecting a recipe pre-fills product name and writes recipe_snapshot to Batches sheet
result: [pending]

### 2. BrewPad Batch Detail expand/edit/save/reload
expected: Collapsible Recipe section expands, Edit Snapshot mode shows all 6 metadata fields + ingredient quantities, saving persists via Apps Script update_batch, values survive page reload
result: [pending]

### 3. Attach Recipe and Create Recipe flows
expected: Batches without snapshot show Attach/Create buttons, Attach searches + links existing recipe, Create opens slide-out + POSTs new recipe, both transition to State A with snapshot
result: [pending]

### 4. Kiosk Quick-Edit save/discard with live PUT
expected: Edit Recipe button opens inline form, Save sends PUT /api/recipes/:id with all 4 fields, Discard closes without API call, touch targets are finger-friendly on tablet
result: [pending]

### 5. Direct Google Sheets inspection
expected: recipe_id and recipe_snapshot columns populated in Batches sheet after batch creation/editing, master Recipes sheet unchanged by batch-local edits
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
