---
status: partial
phase: 15-beerxml-import
source: [15-VERIFICATION.md]
started: 2026-05-17T20:45:00Z
updated: 2026-05-17T20:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Happy path: Upload valid BeerXML and confirm import
expected: Review modal opens with parsed ingredients, confidence badges, autocomplete search; Confirm Import pre-fills recipe form as draft with success toast
result: [pending]

### 2. Autocomplete override: Change a Zoho match via search dropdown
expected: Typing in search input shows filtered catalog items; selecting one updates the row match and confidence to "high"
result: [pending]

### 3. Skip/Restore toggle on ingredient row
expected: Clicking "Skip" dims the row (45% opacity); clicking "Restore" returns it to normal
result: [pending]

### 4. Confirm Import end-to-end
expected: Recipe form opens with name, style, ABV, batch size, IBU, colour pre-filled; ingredients rendered; status shows "draft"; toast: "Recipe imported from BeerXML. Set a price and activate when ready."
result: [pending]

### 5. Error: File too large (>500KB)
expected: Error toast: "BeerXML file is too large (max 500 KB)..."
result: [pending]

### 6. Error: Malformed XML
expected: Error toast: "The file contains invalid XML..."
result: [pending]

### 7. Error: No RECIPE element
expected: Error toast: "No valid BeerXML recipe found..."
result: [pending]

### 8. Visual: Confidence badge colors
expected: Green "Matched", amber "Review", red "No match" badges with correct colors
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
