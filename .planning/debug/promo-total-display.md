---
status: resolved
trigger: "Promo code FIRSTBATCH applied on checkout page - Helcim gets correct discounted amount but combined total and bottom total still show undiscounted amount"
created: 2026-05-04T12:00:00Z
updated: 2026-05-04T12:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - The combined total display in renderCheckoutIngredientSection() re-computes fermentTotal from raw cart items WITHOUT applying _promoApplied, while the charge computation in the submit handler DOES apply it
test: Compared lines 1335-1352 (display) vs lines 1708-1726 (charge) in 12-checkout.js
expecting: Display code missing _promoApplied check; charge code has it
next_action: Report root cause - two specific locations need promo discount applied

## Symptoms

expected: Combined total and bottom total should show discounted amount when FIRSTBATCH promo is applied
actual: Combined total and bottom total show original undiscounted amount; individual line items correctly show 20% OFF badges and discounted prices; Helcim receives correct discounted charge
errors: No errors - display logic bug
reproduction: Apply FIRSTBATCH promo code on reservation.html checkout page
started: After Phase 08 promo system build

## Eliminated

## Evidence

- timestamp: 2026-05-04T12:05:00Z
  checked: Lines 794-801 (single-cart ferment subtotal in renderReservationItems)
  found: Correctly applies _promoApplied to kit items - d = _promoApplied.discountPct on line 799
  implication: Single-cart ferment Total at line 885 is correct

- timestamp: 2026-05-04T12:06:00Z
  checked: Lines 1335-1341 (fermentTotal in renderCheckoutIngredientSection combined total)
  found: Only reads parseFloat(i.discount) on line 1337 - NO _promoApplied check. This is the display computation for the dual-cart "Combined Total (both orders)" row.
  implication: Combined total shows undiscounted ferment amount

- timestamp: 2026-05-04T12:07:00Z
  checked: Lines 1345-1352 (Maker's Fee tax in combined total)
  found: Uses raw mfRateCombined without promo discount on line 1346. Compare to line 1721 in charge calc which applies promo.
  implication: Combined total also has undiscounted Maker's Fee tax

- timestamp: 2026-05-04T12:08:00Z
  checked: Lines 1708-1726 (dual-cart charge computation in submit handler)
  found: Correctly applies _promoApplied on lines 1712-1713 (kit items) and line 1721 (Maker's Fee)
  implication: Helcim receives correct discounted amount - confirms display-only bug

## Resolution

root_cause: In renderCheckoutIngredientSection() (lines 1335-1352 of 12-checkout.js), the "Combined Total (both orders)" display re-computes fermentTotal from raw cart items but never checks _promoApplied. It only reads the item's stored discount (line 1337) and ignores the promo override. The Maker's Fee tax on line 1346 also uses the undiscounted rate. Meanwhile the charge computation in the submit handler (lines 1708-1726) correctly applies _promoApplied in both places.
fix: Applied _promoApplied check to combined total display in renderCheckoutIngredientSection() — kit items, Maker's Fee, and Materials Fee all now use discounted rates matching the charge computation
verification: Confirmed _promoApplied references at lines 1433-1434, 1445, 1456 in 12-checkout.js
files_changed: [js/modules/12-checkout.js]
