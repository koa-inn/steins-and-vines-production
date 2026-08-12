---
status: partial
phase: 69-brewpad-batch-view-ux
source: [69-VERIFICATION.md human_verification (visual check needs staff Google-session auth)]
started: 2026-08-12T00:00:00Z
updated: 2026-08-12T00:00:00Z
---

## Current Test

[awaiting a staff-authenticated BrewPad visual check — code verified 10/10 must-haves; deployed to prod 2026-08-12]

## Tests

### 1. Mark-bottled reflects without reload
expected: On BrewPad, with a batch in "Ready to Bottle", check off its Bottling/Packaging task. The batch drops out of the Ready-to-Bottle list immediately (no full page refresh), and the dashboard stat cards + month chart stay populated (do NOT blank).
result: [pending]

### 2. Ready-to-Bottle filter — core + persistence
expected: On the Batches tab, select the new "Ready to Bottle (N)" filter. The list shows exactly the batches in the dashboard's Ready-to-Bottle set and the count matches. Switch to another tab and back, and reload the batch list — the filtered list stays correct (does NOT silently go empty).
result: [pending]

### 3. Combined path (the one flagged by review/verify)
expected: With the Ready-to-Bottle filter active on the Batches tab, complete a bottling task from the open batch-detail pane — the batch leaves the filtered list and the count decrements, without a reload.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

None — code-level verification passed 10/10; these are visual confirmations of a low-risk frontend change with strong behavioral test coverage (1077 frontend tests). Claude can drive this in Chrome if a staff-authenticated BrewPad session is available.
