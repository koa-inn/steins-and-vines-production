---
phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio
verified: 2026-08-11T20:15:00Z
status: passed
score: 15/15 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "On a real kiosk sale of a compound-tax (GST+PST) item, the kiosk-displayed grand total equals the card charge and the Zoho invoice total"
    reason: "Owner approved the 67-03 checkpoint on a display-level check (live kiosk shows correct compound-tax amounts) without ringing a live test invoice — recorded honestly in 67-03-SUMMARY.md. The live pre-charge assertion (67-01, verified in code + regression tests) is the standing guard: any future divergence is a loud 400 before charging, never a silent wrong charge. The first real compound-tax sale de-facto exercises the happy path."
    accepted_by: "owner (koa)"
    accepted_at: "2026-08-11T00:00:00Z"
deferred:
  - truth: "Recipe carts get a BLOCKING pre-charge assertion (currently log-only detector) and recipe-line tax methodology reconciled server-side"
    addressed_in: "Follow-up phase (flagged in 67-REVIEW.md WR-04)"
    evidence: "REVIEW.md WR-04 outcome: 'A blocking assertion is unsafe today: recipe-scaling computes NO tax in the recipe grandTotal... Follow-up phase needed' — exceeds CONTEXT.md locked scope (assertion scoped to pos.js /api/kiosk/sale)"
  - truth: "Zoho item create/update webhook busts the kiosk catalog cache (or TTL shortening)"
    addressed_in: "Future phase (CONTEXT.md deferred)"
    evidence: "67-CONTEXT.md Deferred Ideas: 'Zoho item create/update webhook → catalog cache bust... revisit if assertion rejections show staleness in practice'"
  - truth: "Public batch-view token removed from shareable URLs (admin.js / kiosk-core.js)"
    addressed_in: "Future phase (CONTEXT.md deferred)"
    evidence: "67-CONTEXT.md: 'distinct security finding from 64-03, needs its own phase'"
---

# Phase 67: Kiosk Tax Quote-Charge Correctness Verification Report

**Phase Goal:** Selling any item through the kiosk produces a kiosk-displayed total equal to the server-computed charge (and Zoho invoice/Helcim charge), with no silent 5% tax fallback anywhere; missing tax data fails closed naming the item; stale client catalogs cannot silently under-quote (closes the INV-000160 seam / KIOSK-TAX-QUOTE-01).
**Verified:** 2026-08-11T20:15:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Note:** The codebase evolved beyond the original plans via the `fix(67-review)` commit series `ae64fb81..8cf8693c` (2 Critical + 5 Warning findings fixed post-review, documented in 67-REVIEW.md). Verification was performed against the current codebase (through docs commit `e364bb26`), not the plan-era snapshots.

## Goal Achievement

### Observable Truths

Must-haves merged from the three PLAN frontmatters (ROADMAP phase 67 has a goal statement but no separate success-criteria list; the goal is fully decomposed by the plan truths).

**67-01 (middleware):**

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Catalog item with no resolvable tax fails the sale closed naming the item — never a silent 5% | ✓ VERIFIED | `pos.js` computeTax (~lines 196-237): NaN-preserving `parseFloat(catalogItem.tax_percentage)`, rule override, then unresolved branch returning `{error: 'Cannot determine tax for "<item>"...', itemName}`; no `KIOSK_TAX_RATE`/`defaultTaxRate` anywhere in pos.js. Tests: `pos-tax.test.js:193` (fail-closed 400), `:222` (CR-02 real builder shape `tax_percentage: null` rejected), `:325` — all green. |
| 2 | Legitimate 0% item still sells with tax 0 | ✓ VERIFIED | `pos-tax.test.js:259` (zero-rate rule item sells at 0); `catalog.test.js:766` (explicit resolved 0 with tax_id preserved as 0, never nulled) — green. |
| 3 | Unresolved tax on confirm path with a real terminal charge routes through void-on-failure — never a bare-400 orphan | ✓ VERIFIED | `pos.js:1104-1105` tagged `__taxUnresolved` throw into the confirm promise chain; outer `.catch` branch at `pos.js:1523-1531` (400 only when no `transaction_id`, releasing `confirmIdemKey` per WR-01; otherwise falls through to existing `moneyPath.voidWithTimeout`). Tests: `pos-precharge-assertion.test.js:379` (void invoked, 502 voided-shape), `:412` (WR-01 lock release), `:434` (no-charge 400, void NOT called) — green. |
| 4 | client_grand_total mismatch > $0.01 → 400, no Helcim charge, idempotency lock released | ✓ VERIFIED | `pos.js:608-634`: assertion in processSaleWithPrices after the grandTotal bounds guards, before gift-card lookup / terminal push; logs full evidence + emits `kiosk.total_mismatch` (WR-05); `cache.releaseLock(idempotencyKey)` on mismatch; staff-actionable copy "Totals changed — refresh the product list and re-ring the sale." Tests: `pos-precharge-assertion.test.js:222`, `:248` — green. |
| 5 | Matching total (within $0.01) → sale proceeds | ✓ VERIFIED | `pos-precharge-assertion.test.js:283` green. CR-01 regression: `pos-discount-rounding.test.js` (3 tests green) proves discounted carts no longer false-reject — server discount math mirrors the client's per-line rounding exactly (`allocateFixedDiscount`/`discountedLineTotal`, pos.js:60-102); tolerance NOT widened (`:285` pins that a genuinely stale total still 400s). |
| 6 | Absent client total → sale proceeds unchanged (back-compat with old cached kiosk JS) | ✓ VERIFIED | `pos.js:608` asserts only when `typeof body.client_grand_total === 'number' && isFinite(...)`. Tests: `:308` (absent), `:333` (non-finite treated as absent) — green. |
| 7 | BC PST+GST compound-tax item resolves tax_percentage === 12 through the kiosk catalog build path | ✓ VERIFIED | `catalog.test.js:682` "BC PST+GST compound-tax item resolves tax_percentage === 12 through the kiosk catalog build path" (rule 109900000000033423 → 12, "GST + PST") — green. |

**67-02 (frontend):**

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 8 | Missing/unparseable tax_percentage on a cart line → no 5%, item flagged by name, checkout blocked | ✓ VERIFIED | `kiosk-core.js:774-786` (kioskCalcTotals detection → `totals.missingTaxItem`, line contributes 0 tax); block at `kiosk-core.js:2535-2542` in kioskProceedToPayment via `kioskShowError('Tax Unavailable', ...)` naming the item; `KIOSK_TAX_RATE_DEFAULT` deleted (grep: zero matches). WR-03 scoping: gate excludes imported-SO carts (`!_kioskImportedSoId`). Tests: `kiosk-missing-tax.test.js` — undefined/non-numeric/CR-02 `null` shapes flagged; checkout blocked with item named, no sale POST; imported-SO not blocked; well-taxed cart not blocked — all green. |
| 9 | kioskItemTax handles missing tax consistently with the cart calc | ✓ VERIFIED | `kiosk-core.js:604-613`: NaN-preserving; returns NaN for missing (never silent $0.00); explicit 0 valid. Tests `:166`, `:172` green. (No live production caller — documented; IN-01 info finding skipped by scope.) |
| 10 | Kiosk sends displayed totals (client_grand_total/client_tax_total) with POST /api/kiosk/sale | ✓ VERIFIED | `kiosk-core.js:2682-2683` on standardSaleBody (and `:2668-2669` on recipeSaleBody per WR-04 detector — exceeds plan scope in the safe direction). Wiring proven end-to-end by `kiosk-catalog-freshness.test.js` Test D (sale POST body carries both fields matching displayed totals through the real GC-panel→terminal-push path) — green. Field names match the 67-01 interface contract exactly. |
| 11 | In-memory catalog is refreshed at the cart-lifecycle point New Sale misses, so a parked kiosk cannot quote from a stale snapshot | ✓ VERIFIED (evolved) | `kiosk-core.js:2444`: `kioskLoadProducts('cached')` at kioskStartCheckout. NOTE: the plan's key-link pattern was `kioskLoadProducts(true)`; the WR-02 review fix deliberately changed the checkout-entry call to a new non-busting `'cached'` mode (re-fetches the server catalog without `?bust=1` — no cold Zoho rebuild per checkout attempt, no deleted-cache race; 30-min server TTL genuinely respected). The truth's substance holds: forceRefresh is truthy so the in-memory catalog re-fetches on every checkout entry; the 67-01 server assertion is the backstop for residual staleness. Regression-pinned by Test E ("entering checkout re-fetches the catalog WITHOUT busting the server cache") — green. `kioskLoadProducts(true)` (busting) still fires at New Sale / staleness-wake / post-sale as before. |
| 12 | A failed refresh keeps the last-good catalog (no wiped grid) | ✓ VERIFIED | `kiosk-core.js` kioskLoadProducts `.catch` (~900-907): keeps `_kioskProducts` + loaded flag when last-good exists. Tests: freshness Test B and Test E post-refresh assertions — green. |

**67-03 (live verification checkpoint):**

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 13 | Real compound-tax kiosk sale: displayed total == card charge == Zoho invoice | PASSED (override) | Override: owner approved the 67-03 checkpoint 2026-08-11 on a display-level check ("the amounts look good") without ringing a live invoice — recorded honestly in 67-03-SUMMARY.md. The live pre-charge assertion is the standing enforcement: divergence now 400s loudly before charging instead of silently under-quoting. Accepted by owner on 2026-08-11. |
| 14 | A deliberately stale/divergent kiosk total is rejected by the server pre-charge assertion instead of charging the wrong amount | ✓ VERIFIED | Codebase-level: the assertion exists, fires before any charge, logs evidence, and is regression-pinned (`pos-precharge-assertion.test.js:222/248`; `pos-discount-rounding.test.js:285` pins that tolerance was NOT widened and a genuinely divergent total still 400s). Live exercise was the plan's "optional but recommended" step and was not performed (recorded in 67-03-SUMMARY). |
| 15 | Deploy order held: middleware (67-01) live before frontend (67-02) sent client_grand_total | ✓ VERIFIED | 67-03-SUMMARY deploy record (2026-08-04): Railway middleware manually deployed and health-checked before frontend; prod serves `kiosk-core.min.js?v=msf5gxir` — matches the current `kiosk.html` stamp in-repo. Skew window safe by design (assertion only fires when field present). |

**Score:** 15/15 (14 verified + 1 owner-accepted override)

### Deferred Items

Documented deferrals — not gaps (per 67-CONTEXT.md and 67-REVIEW.md WR-04):

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Recipe-path blocking assertion + server-side recipe tax methodology (WR-04 shipped a log-only divergence detector: `pos-recipe.js:355-360` logs + emits `kiosk.recipe_total_mismatch`, never blocks) | Follow-up phase flagged in 67-REVIEW.md | "A blocking assertion is unsafe today... exceeds this phase's locked scope (CONTEXT.md scopes the middleware assertion to pos.js)" |
| 2 | Zoho item create/update webhook → catalog cache bust | Future phase | 67-CONTEXT.md Deferred Ideas |
| 3 | Shareable batch-URL token exposure (admin.js/kiosk-core.js) | Future phase | 67-CONTEXT.md: distinct 64-03 security finding |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `zoho-middleware/routes/pos.js` | computeTax fail-closed discriminated result + pre-charge assertion + confirm-path tagged throw; contains `client_grand_total` | ✓ VERIFIED | All present, plus review fixes CR-01 (client-mirrored discount rounding), WR-01 (confirm lock release), WR-05 (mismatch telemetry). Wired: exercised by 3 green test suites. |
| `zoho-middleware/__tests__/pos-precharge-assertion.test.js` | Assertion regression suite + confirm-path orphan-guard tests, min 40 lines | ✓ VERIFIED | 456 lines; 10 tests across both describes incl. WR-01/WR-05 pins; green. |
| `js/kiosk-core.js` | Missing-tax detection + block, client totals on sale body, cart-lifecycle refresh; contains `client_grand_total` | ✓ VERIFIED | All present, plus WR-02/WR-03 review fixes. Wired: exercised by green frontend suites. |
| `js/kiosk-core.min.js` | Rebuilt minified artifact | ✓ VERIFIED | Single-line terser output (1 line); contains `client_grand_total` and the `'cached'` mode; rebuilt at `8cf8693c` after the review fixes (not hand-edited). |
| `kiosk.html` / `admin.html` | `kiosk-core.min.js?v=` cache-buster bumps | ✓ VERIFIED | `?v=msf5gxir` / `?v=msf5gxfq` present; kiosk.html stamp matches the prod-confirmed value in 67-03-SUMMARY. |
| `tests/frontend/kiosk-missing-tax.test.js` | Missing-tax fail-closed suite | ✓ VERIFIED | 268 lines, 10 tests incl. CR-02 null-shape and WR-03 imported-SO pins; green. |
| `tests/frontend/kiosk-catalog-freshness.test.js` | Client-totals-on-body + cart-lifecycle refresh tests | ✓ VERIFIED | Tests D + E added (Test E updated for WR-02 'cached' mode — sanctioned rule-10 modification, noted in-file per REVIEW.md); green. |
| `zoho-middleware/routes/catalog.js` (CR-02, beyond plan) | rebuildKioskCatalog preserves unresolvable tax as null | ✓ VERIFIED | `catalog.js:826-828, 865`: NaN-preserving resolution, `tax_percentage: isNaN(pct) ? null : pct`. rebuildKioskCatalog confirmed as the SOLE producer of `KIOSK_PRODUCTS_CACHE_KEY` (read by pos.js computeTax and GET /api/kiosk/products). Pinned by `catalog.test.js:742/754/766`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| processSale (sale path, pre-charge) | computeTax | discriminated result → early 400 on unresolved tax | ✓ WIRED | Green fail-closed tests; 400 fires before any terminal side-effect. |
| runConfirm (confirm path) | computeTax | tagged `__taxUnresolved` throw → outer .catch → void-on-failure when `transaction_id` set | ✓ WIRED | Throw at pos.js:1104; catch branch at 1523; void path regression-tested. |
| processSaleWithPrices | cache.releaseLock | lock release on assertion mismatch before terminal push | ✓ WIRED | pos.js:631-633; pinned by test :222. |
| kioskCalcTotals | kioskProceedToPayment | `totals.missingTaxItem` → kioskShowError block | ✓ WIRED | Detection 783, block 2535; test-pinned. |
| standardSaleBody | /api/kiosk/sale | client_grand_total / client_tax_total | ✓ WIRED | kiosk-core.js:2682-2683; end-to-end Test D. |
| kioskStartCheckout | kioskLoadProducts | cart-lifecycle refresh | ✓ WIRED (evolved) | Plan pattern `kioskLoadProducts(true)` intentionally evolved to `kioskLoadProducts('cached')` per WR-02 (non-busting); Test E pins the new behavior. |
| kiosk displayed total | Helcim charge + Zoho invoice | live sale equality (67-03) | PASSED (override) | Owner-approved display-level; standing assertion enforces equality on every future sale. |
| rebuildKioskCatalog | computeTax + client gate (data flow, Level 4) | `tax_percentage: null` survives JSON → `parseFloat(null)` is NaN → fail-closed branches reachable end-to-end | ✓ FLOWING | CR-02 fix; pinned builder→computeTax→client-gate by catalog.test.js:742/754 + pos-tax.test.js:222 + kiosk-missing-tax.test.js:120. Before this fix the fail-closed branches were unreachable through real production data — the single most important post-review correction. |

### Behavioral Spot-Checks

No live server started (per verification constraints); the Jest suites are the runnable behavioral checks.

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full frontend suite | `npm test` | 71 suites / 1049 tests pass | ✓ PASS |
| Full middleware suite | `cd zoho-middleware && npm test` | 87 suites / 1352 tests pass (one flake in `checkout-route.test.js` on first run — passes in isolation 20/20 and on full re-run; unrelated to phase 67; suite has a known async open-handle warning) | ✓ PASS |
| Phase-targeted middleware | `npm test -- pos-tax pos-precharge-assertion catalog pos-recipe` | 5 suites / 122 tests pass | ✓ PASS |
| CR-01 discount-rounding regression | `npx jest pos-discount-rounding` | 3/3 pass (incl. tolerance-not-widened pin) | ✓ PASS |
| Frontend lint | `npm run lint` (`eslint js/ --max-warnings 0`) | clean | ✓ PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean | ✓ PASS |
| No silent 5% remnants | `grep KIOSK_TAX_RATE_DEFAULT js/kiosk-core.js`; `grep defaultTaxRate\|KIOSK_TAX_RATE zoho-middleware/routes/pos.js` | zero matches (env var lingers only in `validateEnv.js` manifest — IN-02 info, skipped by scope) | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repository and none are declared by the phase plans — N/A for this phase type (Jest regression suites are the verification vehicle).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| KIOSK-TAX-QUOTE-01 | 67-01, 67-02, 67-03 | Owner-reported defect (INV-000160): kiosk quote ≠ charge; requirement source = 67-CONTEXT.md locked decisions (not a REQUIREMENTS.md ID, per ROADMAP note) | ✓ SATISFIED | All three CONTEXT locked-decision groups delivered: (1) pre-charge assertion live + back-compat; (2) all three silent 5% fallbacks removed (kiosk-core cart calc, kioskItemTax, pos.js computeTax) with 0% kept valid — and CR-02 closed the fourth, upstream laundering in catalog.js the review found; (3) cart-lifecycle catalog refresh without periodic polling. Regression-first TDD held on both sides (RED commits `568c312b`, `409ec4a3` precede GREEN). |

No orphaned requirements: REQUIREMENTS.md maps nothing to Phase 67 (grep confirms), consistent with the owner-reported-defect sourcing.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| js/kiosk-core.js | 3275 | `dayLabel = 'TBD'` | ℹ️ Info | Pre-existing Phase 48 UI copy (undated brew-step label), not a debt marker and not touched by this phase. |
| zoho-middleware/lib/validateEnv.js | 70 | Retired `KIOSK_TAX_RATE` still documented | ℹ️ Info | REVIEW IN-02, skipped per fix scope; no code reads it. |
| js/kiosk.js:82 / js/admin.js:9927 | — | Unused `kioskItemTax` aliases | ℹ️ Info | REVIEW IN-01, skipped per fix scope; NaN contract documented in the function comment. |

No TBD/FIXME/XXX debt markers introduced by phase-67 files. No stubs, empty implementations, or hollow props found in any phase artifact.

### Human Verification Required

None outstanding. The phase's sole human item was the 67-03 blocking checkpoint, executed and owner-approved 2026-08-11 (display-level; honest record in 67-03-SUMMARY.md; accepted via the override above). Per the standing record: if staff ever report a "Totals changed" rejection, that is the assertion working — investigate catalog staleness then, with the WR-05 telemetry (`kiosk.total_mismatch` events + log.error evidence) now available for diagnosis.

### Gaps Summary

No gaps. The phase goal is achieved in the codebase:

- **No silent 5% anywhere:** all three planned fallbacks removed, plus the review-discovered fourth (catalog.js missing→0 laundering, CR-02) — the fail-closed branches are now genuinely reachable through real production catalog data, pinned end-to-end (builder → computeTax → client gate).
- **Quote≠charge is structurally loud:** the pre-charge assertion rejects divergence > $0.01 before any Helcim charge, releases the idempotency lock, and records full divergence telemetry (WR-05). The CR-01 fix removed the deterministic false-reject on discounted carts by mirroring the client's rounding server-side, without widening the tolerance.
- **Missing tax fails closed naming the item** on both client (checkout block) and server (sale-path 400; confirm-path void-then-error preserving the never-orphan-a-charge invariant, with WR-01 lock release).
- **Stale-catalog exposure closed:** checkout-entry re-fetch (non-busting per WR-02) + the server assertion as backstop.
- Both full suites and both lints green; min artifact terser-rebuilt; deploy order held; owner approved the live checkpoint.

---

_Verified: 2026-08-11T20:15:00Z_
_Verifier: Claude (gsd-verifier)_
