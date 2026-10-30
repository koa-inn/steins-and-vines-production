---
status: resolved
trigger: "kiosk recipe invoice total ≠ charged total (adjustment vs Zoho line rounding)"
created: 2026-10-15
updated: 2026-10-15
severity: high
area: kiosk money-path (recipe-sale confirm → Zoho invoice → customerpayment)
---

# Kiosk recipe invoice total ≠ charged total

## Symptoms

- **Expected:** For a kiosk recipe sale, the Zoho invoice total == card charge (grandTotal = pre-tax package price + tax). The invoice uses an `adjustment` ("Recipe package price") = package price − line sum so totals match; `/customerpayments` then records the full amount and the invoice reads Paid.
- **Actual:** On staging hardware (Phase 90 D-17, 2026-10-15) the card was charged grandTotal $4.89, but the Zoho invoice totalled $4.79. `/customerpayments` returned 400 (payment exceeds balance due), so the invoice stayed draft/unpaid. Seen on INV-000236 (charged $4.79?) and INV-000237 (charged $4.89, Helcim txn 56642753). Both were deleted in cleanup.
- **Error:** staging log "Payment recording failed: 400".
- **Timeline:** The first real recipe sales ever run on hardware were on 2026-10-15. The adjustment logic came from 4849f473 (2026-10-13, staging only). The related fixes f4272eed (numeric txn id) and ae191772 (payment after submit) are already on main/staging.
- **Reproduction:** Kiosk recipe sale on staging with a recipe whose ingredient lines carry discounts. Whirlfloc came out as a negative discounted line (-0.02).
- **Suspected cause (from the session notes, unverified):**
  1. The adjustment is computed as preTaxTotal − server line sum. The server floors negative discounted lines to 0, but Zoho keeps them (Whirlfloc -0.02).
  2. qty × rate rounding differs between the server and Zoho (Zoho may round line totals differently, e.g. rate precision, discount application, or entity_level tax rounding per rate group — see memory zoho-tax-rounding-entity-level).
  3. The tax portion may also drift: Zoho computes tax on the lines + adjustment? (check whether the adjustment is pre- or post-tax in Zoho and whether the tax base matches computeRecipeTax).
- **Constraints:** This is a money path. The prod hotfix (cherry-pick f4272eed + ae191772) is blocked until this is fixed. Fail-closed behaviour must be preserved. Per CLAUDE.md: write the regression test first, one logical change per commit, run both test suites + lint before committing, don't modify existing tests. Middleware lives in `zoho-middleware/` (cd first). Relevant code: `zoho-middleware/routes/pos-recipe.js` (buildRecipeLineItems, computeRecipeTax, confirm handler), `zoho-middleware/routes/pos.js` computeTax.
- **Candidate fix directions:** (a) compute the adjustment exactly the way Zoho computes line totals (keep negatives, mirror rounding); (b) after invoice creation, read invoice.total and reconcile against grandTotal (update the adjustment, or fail closed + void); (c) both. Recommend robust (b) as a safety net plus (a) for correctness.

## Current Focus

- hypothesis: Zoho computes invoice line totals differently from the server (kept -0.02 line, likely quantity/rate rounding); the exact Zoho rule could NOT be confirmed (no Zoho MCP tool in this agent, local middleware unauthenticated, test invoices deleted)
- next_action: owner re-runs a staging recipe sale (with discount) and confirms invoice reads Paid; check log for "re-balancing adjustment" to learn the real delta

## Evidence

- pos-recipe.js confirm: adjustment = preTaxTotal - sum(recipeLineAmount) where recipeLineAmount floors negatives at 0 and rounds per line; it never reads Zoho's computed total.
- distributeRecipeDiscount caps each share at round2(qty*rate), so a server-side negative is impossible; Zoho's -0.02 therefore means Zoho's gross for that line is lower than the server's (qty/rate precision), unconfirmed.
- convertedQty is 4dp (mass/volume) or raw pass-through (count); Zoho's accepted quantity precision is unverified.
- Existing tests mock zohoPost without `total`, so reconcile treats a missing total as unknown (warn, proceed).

## Eliminated

## Resolution

- root_cause: adjustment was predicted from the server's own line math, which does not match Zoho's computed invoice total; no check ever compared invoice.total to the charge, so a few-cent gap made /customerpayments 400 after the card was charged. Zoho's exact rounding rule is unconfirmed.
- fix: reconcileRecipeInvoice in routes/pos-recipe.js. After POST /invoices, compare returned total to grandTotal; if gap < $1 PUT the invoice with adjustment += gap and require the PUT total to equal the charge; otherwise reject so the existing catch voids the card (502). Missing total in the response = warn and proceed.
- verification: new __tests__/pos-recipe-invoice-reconcile.test.js (6 tests, red then green); frontend 2570 pass; middleware 3371 pass, 2 pre-existing vancouver-timezone failures (Node 20.20 tzdata, fail without my change); lint clean. NOT verified against live Zoho (PUT /invoices payload acceptance).
- files_changed: [zoho-middleware/routes/pos-recipe.js, zoho-middleware/__tests__/pos-recipe-invoice-reconcile.test.js]

## Re-test 2026-10-15 (INV-000238, txn 56643687, auto-voided)

- Log: Zoho total 4.79 vs charge 4.89; reconcile PUT +0.10 -> 4.87; failed closed, card reversed, 502. Draft INV-000238 left in Zoho.
- Root cause 1 (pre-tax gap): Zoho stores quantities to 3dp (Whirlfloc 0.0023 kg -> 0.002); server line math used 4dp, so lineSum 4.52 vs Zoho 4.42 and the adjustment was 0.10 low.
- Root cause 2 (PUT): POST tax 0.14 matched (item defaults: Makers 5%, Materials 12%). PUT re-sent lines without tax_id, Zoho re-defaulted to GST 5% -> tax 0.12, so +0.10 moved total +0.08.
- Data issue: Whirlfloc T Bulk (109900000001061014) has NO sales tax / sales_tax_rule in Zoho (other ingredients are "Zero Rated - Ingredients").
- Fix 0cfbd181: round ingredient qty to 3dp; reconcile PUT re-sends Zoho's created lines (line_item_id, tax_id). Tests: __tests__/pos-recipe-zoho-line-fidelity.test.js.

## Verified 2026-10-15

INV-000239 (txn 56644488): Paid, total 4.88 == charge, balance 0, confirm 201, batch SV-B-000238. No re-balance needed (3dp qty fix alone matched). Owner fixed Whirlfloc sales tax in Zoho.
