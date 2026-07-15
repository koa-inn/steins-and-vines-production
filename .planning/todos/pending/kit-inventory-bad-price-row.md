---
title: Correct the bad (negative) price row in the Kits sheet — retail_instore
status: pending
created: 2026-07-15
source: external website review 2026-07-14 ($-68.949 in admin Kit Inventory) + Phase 58 investigation
area: admin / data hygiene
priority: low
owner_action: true
---

## What

At least one kit in the Kits sheet has an invalid (negative / unrounded) value in
its `retail_instore` (and/or `retail_kit`) column — the review saw `$-68.949…`.

Phase 58 (`d25bf6c2`) fixed the DISPLAY: the admin now shows an em dash instead of
rendering a garbage price. But the underlying sheet value is still wrong, and per
the chosen "blank/dash" behaviour the bad row is no longer conspicuous in the table.

## To do (owner)

1. Find the row: in the authenticated admin Kit Inventory, sort by the In-Store
   column (or look for a dash where a price should be), or Claude can locate it via
   the live admin on request.
2. Correct the value in the Kits sheet.

## Related

Fits naturally with Phase 60 (Admin Data Hygiene — orphan/blank kit rows), which
also traces bad Kits-sheet data to its source. Could be folded in there.
