---
status: partial
phase: 23-cross-category-search
source: [23-VERIFICATION.md]
started: 2026-05-30T00:00:00Z
updated: 2026-05-30T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Overlay opens and focuses search input on desktop
expected: Click search icon on any ingredient subpage — overlay dropdown appears below subnav, input is focused
result: [pending]

### 2. Live search returns grouped results from real inventory
expected: Type 2+ chars — results grouped by category, sorted by match count desc, capped at 10/7/5 per group
result: [pending]

### 3. Deep-link navigation from search result to subpage detail panel
expected: Click a result name — navigates to subpage with ?item=SKU, detail panel opens for that item
result: [pending]

### 4. Mobile full-screen layout at <768px
expected: On mobile viewport, overlay fills entire screen with close button visible
result: [pending]

### 5. ESC key closes overlay and returns focus
expected: Press ESC — overlay closes, focus returns to the search button that opened it
result: [pending]

### 6. Out-of-stock items dimmed with no cart controls
expected: Out-of-stock items appear with 0.5 opacity and no Add to Cart button
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
