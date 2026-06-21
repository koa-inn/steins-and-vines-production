---
status: partial
phase: 35-batch-scaling-engine
source: [35-VERIFICATION.md, 35-04-SUMMARY.md]
started: 2026-06-21T00:20:44Z
updated: 2026-06-21T00:20:44Z
---

## Current Test

[awaiting human testing — all automated/code checks passed (14/14); these need a live recipe sale]

## Tests

### 1. D-06 locked-price increase (needs a locked-price recipe)
expected: On a LOCKED-price recipe, a 1.0x sale charges `locked_price + service_fee + materials_fee` (higher than the old flat locked price); a 1.5x sale charges `locked_price * 1.5 + flat fees`. Owner acknowledges every locked recipe's price now rises by (service + materials) fees even at 1x.
note: Not testable yet — the only live recipe (Dangerous Bunny) is dynamic-priced. Set a recipe to locked pricing or create one. Math is covered by 35-03 unit tests (locked 1.5x = $342.50).
result: [pending]

### 2. Full terminal-to-Zoho-invoice flow (SCALE-04 live)
expected: A completed scaled recipe sale pushes the scaled total to the Helcim terminal, creates a Zoho invoice whose line items reflect the SCALED ingredient quantities, and freezes a recipe_snapshot containing target_volume_l + scale_factor + scaled ingredients.
note: UAT confirmed the price/cart display but did not complete a real terminal charge. Server behavior is covered by pos-recipe.test.js (scaled invoice line items + enriched snapshot).
result: [pending]

### 3. Manager override to completion (D-08 live)
expected: At a target volume that oversells an ingredient (e.g. 360 L / 6x oversells Gambrinus Pale Malt), the sale returns 409, the "Manager Override — Proceed Anyway" button appears, and clicking it completes the sale.
note: The server 409 was confirmed live via the quote endpoint; the override-to-completion path was not exercised end-to-end.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
