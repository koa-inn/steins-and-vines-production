---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
verified: 2026-07-04T16:40:00Z
status: human_needed
score: 8/9 must-haves verified (1 human-verification gate pending, 1 disclosed narrow exception accepted as WARNING not blocker)
overrides_applied: 0
human_verification:
  - test: "Full kiosk sale (product + recipe + product-type discount) from BOTH the standalone kiosk URL and the admin-embedded kiosk tab on staging, iPad Safari"
    expected: "Identical behaviour on both surfaces: terminal charge succeeds, receipt shows, Zoho invoice/payment created with correct discounted total"
    why_human: "Staging calls PROD middleware — this is a real Helcim terminal charge; cannot be automated (48-06 plan, autonomous: false)"
  - test: "Dual-cart / sales-order-import flow on the standalone kiosk (import a held SO, complete sale)"
    expected: "Behaves as before the de-fork"
    why_human: "Requires a real held sales order and live terminal; no staging middleware to mock against"
  - test: "Void-on-failure path: trigger or observe a terminal failure and confirm payment_voided rendering"
    expected: "Void behaviour unchanged post-relocation"
    why_human: "Requires forcing a real terminal failure condition"
  - test: "Manager Override (D-07) on BOTH surfaces: stock-insufficient recipe sale -> 409 conflict -> tap #kiosk-stock-override-btn -> resubmit -> success"
    expected: "Works identically on standalone kiosk (newly revived — was dead pre-phase) and admin-embedded kiosk"
    why_human: "Requires a real recipe/stock state that is insufficient and a live resubmit against prod middleware; automated parity test only proves the payload/DOM-wiring shape, not the live stock-check round trip"
  - test: "Admin recipe-sale with edited ingredient quantities charges the EDITED price (modified_ingredients fix, Pitfall 3) — invoice total matches edited preview"
    expected: "Charged total reflects staff edits, not the base recipe price"
    why_human: "Requires a live Zoho invoice to inspect the actual charged/booked total"
  - test: "Only ONE BrewPad batch created per kit item sold via the admin kiosk tab (Pitfall 2 duplicate-batch fix)"
    expected: "No duplicate batch record in BrewPad 'Needs Scheduling'"
    why_human: "Requires checking BrewPad's live batch list after a real sale"
---

# Phase 48: Kiosk POS De-Fork (kiosk-core.js) Verification Report

**Phase Goal:** The kiosk POS logic exists in a SINGLE shared implementation (`js/kiosk-core.js`) consumed by BOTH the standalone kiosk (`js/kiosk.js`) and the admin-embedded kiosk (`js/admin.js`), so the cart and payment/checkout paths can no longer diverge. Behaviour-preserving: existing kiosk money-path behaviour (terminal charge, Zoho invoice/payment, void-on-failure, dual-cart) unchanged and verified by existing kiosk tests plus an admin-vs-kiosk parity check; the product-type discount is identical on both surfaces. The Manager Override (stock-conflict 409 → override → resubmit) works on BOTH surfaces (D-07).

**Verified:** 2026-07-04T16:40:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `js/kiosk-core.js` exists as a single ES5 IIFE exposing `window.KioskCore` (browser) / `module.exports` (Node) | VERIFIED | `js/kiosk-core.js:4527` `window.KioskCore = KioskCore;`; `:4529-4530` `module.exports = KioskCore;`. 4533 lines. |
| 2 | Both `kiosk.js` and `admin.js` consume `KioskCore` for cart/payment/checkout — no second copy of the money path | VERIFIED (with one disclosed narrow exception, see Anti-Patterns) | `grep -c "function kioskProceedToPayment" js/kiosk.js js/admin.js` = 0/0; `grep -c "kioskProceedToPayment" js/kiosk-core.js` = 6. `KioskCore.init(` called once in each consumer (`js/kiosk.js:41`, `js/admin.js:9827`). `kiosk.js`: 5535→1458 lines; `admin.js`: 12787(pre-phase)→11111 lines. |
| 3 | Auth is injected per-surface, not hard-coded in the core; kiosk sends `x-device-token`, admin sends `credentials:'include'` with no `x-device-token` | VERIFIED | `grep -c "x-device-token" js/admin.js` = 0; `js/admin.js:9827-9829` `buildAuthOptions: function () { return { credentials: 'include' }; }`; `js/kiosk.js:44` `return { headers: { 'x-device-token': kioskDeviceToken() } };`. Locked by the parity test's auth-divergence assertion (passing). |
| 4 | The canonical sale-body forwards `modified_ingredients` and uses `idempotency_key === reference_number` (no `Math.random()` suffix) on both surfaces (D-05) | VERIFIED | `js/kiosk-core.js:2387` `modified_ingredients: Array.isArray(_kcEnv.getModifiedIngredients()) ? ... : undefined`; no `Math.random()` anywhere in kiosk-core.js's sale path (only unrelated hold-ID generator remains in admin.js:2427, non-money-path). Parity test asserts `idempotency_key === reference_number` on both surfaces (passing). |
| 5 | Manager Override (409 → override → resubmit) is single-sourced in `kiosk-core.js` and works on BOTH surfaces, including reviving the previously-dead standalone-kiosk button (D-07) | VERIFIED (automated half); pending human/live confirmation | `grep -c "kiosk-stock-override-btn" js/kiosk.js js/admin.js` = 0/0; present only in `js/kiosk-core.js:2605` (handler) with 409/`conflicts` rendering. Parity test's third suite (409 mock → resubmit with `override:true`) passes on both surfaces. Live stock-check round trip requires 48-06 (human, real terminal). |
| 6 | Product-type discount is identical on both surfaces (12-function subsystem single-sourced; admin gained markup) | VERIFIED | `grep -c "function kioskApplyDiscount" js/kiosk.js js/admin.js` = 0/0; present in kiosk-core.js. `admin.html` gained `kiosk-discount-zone`/`kiosk-discount-popover`/`kiosk-discount-mgmt-modal` (verified: 3 occurrences), `discount-match.js` script tag present. |
| 7 | Dual-cart / sales-order-import logic exists in exactly one place (kiosk-core.js); no SO UI added to admin | VERIFIED | `grep -c "function kioskCollectPayment\|function kioskCreateSalesOrder" js/kiosk.js js/admin.js` = 0/0; `kioskCollectPayment`/`kioskCreateSalesOrder`/`kioskImportSoToCart` present in kiosk-core.js (17 occurrences); `grep -c "kiosk-so-" admin.html` = 0. |
| 8 | An automated admin-vs-kiosk parity test exists and asserts URL+body equality (modulo idempotency/reference) with correct diverging auth, plus D-07 override parity | VERIFIED | `tests/frontend/kiosk-core-parity.test.js` exists, 3 test blocks (plain-product-sale, recipe-sale incl. `modified_ingredients`+`override:false`, 409→override→resubmit). Ran directly: **all 3 pass.** |
| 9 | Full discounted kiosk sale verified identically on both surfaces on real iPad Safari/Helcim hardware, incl. terminal/void/dual-cart/Manager-Override live (SC#5) | **NOT YET VERIFIED — awaits human** | Plan 48-06 (`autonomous: false`, `checkpoint:human-verify`) has not been executed; no 48-06-SUMMARY.md exists. This is expected/by-design per task instructions — cannot be automated (staging calls prod middleware, real money). |

**Score:** 8/9 automatically-verifiable truths verified; 1 requires human execution (by design, not a phase defect).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/kiosk-core.js` | Single shared IIFE, `window.KioskCore` + dual-mode export | VERIFIED | 4533 lines; contains cart/catalog/totals/discount/payment/checkout/terminal/confirm/receipt/dual-cart/override logic |
| `js/kiosk.js` | Slimmed consumer, no duplicated definitions | VERIFIED | 1458 lines (from 5535); `KioskCore.init(` present with `x-device-token` auth |
| `js/admin.js` | Slimmed consumer, no duplicated money-path definitions, cookie auth | VERIFIED (see Anti-Patterns for 3-function disclosed exception) | 11111 lines (from 12787); `KioskCore.init(` present with `credentials:'include'`; 0 `x-device-token` |
| `admin.html` | Discount markup + `discount-match.js`, no SO UI | VERIFIED | `kiosk-discount-zone`/`popover`/`mgmt-modal` present (3 occurrences); `kiosk-so-` = 0 |
| `tests/frontend/kiosk-core-parity.test.js` | Payload+auth+override parity assertions | VERIFIED | Exists, 3 tests, all passing |
| `package.json` / build wiring | `kiosk-core.min.js` terser target + stamp clauses | VERIFIED | `npm run build`/`npm test`/`npm run lint` all exit 0; bundles regenerate |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `js/kiosk.js` | `js/kiosk-core.js` | `KioskCore.init({mwUrl, buildAuthOptions})` | WIRED | `js/kiosk.js:41` |
| `js/admin.js` | `js/kiosk-core.js` | `KioskCore.init({mwUrl, buildAuthOptions: credentials:'include'})` | WIRED | `js/admin.js:9827` |
| `js/kiosk-core.js proceedToPayment` | `pos.js /api/kiosk/sale` | fetch with injected auth | WIRED | Confirmed via parity test capturing `global.fetch.mock.calls` with correct URL on both surfaces |
| `#kiosk-stock-override-btn` (both HTML pages) | `js/kiosk-core.js` override handler | DOM id, no local handler in either consumer | WIRED | `grep` confirms 0 occurrences of the handler string in kiosk.js/admin.js, present only in kiosk-core.js |
| `js/kiosk-core.js discount branch` | `js/lib/discount-match.js` | `typeof discountMatches === 'function'` guard | WIRED | Guard preserved, not reimplemented in core |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `modified_ingredients` in sale body | `_kcEnv.getModifiedIngredients()` | Bridged per-surface to each consumer's own local `_kioskModifiedIngredients` var, set by the UI's ingredient-modify panel | Yes — both kiosk.js and admin.js inject real get/set callbacks into `KioskCore.init`, not stubs | FLOWING |
| `override` in recipe-sale body | `KioskCore._getStockOverride()` | Set by the shared 409-handler's override-button click (single implementation) | Yes | FLOWING |
| Discount amount in cart totals | `_kioskDiscount` | Bridged per-surface (admin gained a brand-new local var for this, kiosk.js already had one) | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frontend Jest suite green | `npm test` | 54 suites / 950 tests passed | PASS |
| Middleware Jest suite green (untouched) | `cd zoho-middleware && npm test` | 77 suites / 1250 tests passed | PASS |
| Lint clean (ES5) | `npm run lint` | `eslint js/ --max-warnings 0` exits 0 | PASS |
| Parity test in isolation | `npx jest tests/frontend/kiosk-core-parity.test.js` | 3/3 passed | PASS |
| Live terminal charge / void / dual-cart / Manager Override on real hardware | n/a | n/a | SKIP (requires real device — routed to human verification) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or discovered for this phase. SKIPPED (no runnable probes for this phase — verification relies on Jest suites + grep-based structural checks + the 48-06 human gate).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|--------------|--------|----------|
| KIOSK-01 | 48-01..48-06 (all plans declare it) | Single shared kiosk POS implementation consumed by both surfaces, behaviour-preserving, discount parity, Manager Override on both surfaces | SATISFIED for the structural/automated criteria (SC#1-SC#4); NEEDS HUMAN for SC#5 (live iPad Safari) | REQUIREMENTS.md:24 traceability row confirms Phase 48 is KIOSK-01's home; REQUIREMENTS.md:81 status table still shows "Pending" — should flip to reflect SC#1-4 done / SC#5 pending human sign-off once 48-06 completes |

No orphaned requirements found — KIOSK-01 is the only requirement ID declared across all 6 plans, matching REQUIREMENTS.md's mapping.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/admin.js` | 10698 (`kioskShowRecipePrompt`), 10565 (`renderKioskModifyRows`), and its `attachKioskModifyRowListeners` helper | Disclosed narrow duplicate — these 3 functions remain fully re-implemented in `admin.js` rather than delegating to `KioskCore.showRecipePrompt`/`renderKioskModifyRows` | WARNING | Expands plan 04's "8 admin-only functions" keep-list to 11 (documented as D-DEV-08 in 48-04-SUMMARY.md). Justified by a genuine, pre-existing, test-asserted coupling: admin's ingredient-modify autocomplete reads the Recipes tab's own `_recipesState.catalog`, not KioskCore's self-contained catalog (`tests/frontend/admin-recipe-modify.test.js` GAP-1 pins this). The actual **money-relevant** state (`modified_ingredients`, target volume, sale type, stock override) is correctly bridged through `KioskCore._get*/_set*` accessors, so the charged price is not at risk — but the recipe-prompt/modify-panel **UI orchestration** itself is a real, disclosed, narrow fork that could silently drift from kiosk-core.js's copy in future edits (e.g., a real pre-existing divergence already exists: core's version calls `escapeHTML(recipe.style)`, admin's does not — traced to be pre-phase-48, not introduced by this phase). Recommend tracking as a follow-up cleanup, not a phase blocker, since it: (a) was disclosed transparently with a specific technical rationale, (b) is bounded to 3 of ~40 migrated functions, (c) does not affect money-path correctness. |
| `js/kiosk-core.js` | 67-69 (`_kcEnv.mwUrl` cached at init) | `mwUrl` cached once at `KioskCore.init` instead of re-evaluated lazily per call (pre-phase `kioskMwUrl()` was lazy) | WARNING (from 48-REVIEW.md WR-01) | Behaviour change if `SHEETS_CONFIG` populates after init — every middleware call would silently no-op. Advisory per code review; no blocker. |
| `js/kiosk-core.js` | 2390-2391, 2535, 2576-2612 | Override resubmit reuses the same `idempotency_key` as the 409'd attempt (old admin regenerated a fresh key) | WARNING (from 48-REVIEW.md WR-02) | Could replay a cached 409 if middleware persists non-terminal responses by idempotency key — needs confirmation server does not. Advisory. |
| `js/kiosk-core.js` | 2593-2670 | Manual-confirm fallback timer stays armed on the 409 early-return, can overlay the conflict panel ~45s later | WARNING (from 48-REVIEW.md WR-03) | Only defended by server's confirm-time stock re-check. Advisory. |
| `js/kiosk-core.js` | 2616-2649 | Admin's recipe-sale terminal flow silently changed from immediate-confirm to poll-based | WARNING (from 48-REVIEW.md WR-04) | Plausible intended unification; not covered by the parity test (stops at initial push). Advisory — should be exercised live in 48-06. |
| `tests/frontend/kiosk-core-parity.test.js` | 307-308 | `modified_ingredients` assertion is tautological in the no-modification case (per 48-REVIEW.md WR-05) | WARNING | The regression guard for Pitfall 3 (the exact bug D-05 fixes) is weaker than it looks — a future regression that drops `modified_ingredients` on one surface when a modification IS present would not be caught by this test. Recommend strengthening per REVIEW.md's suggested fix in a follow-up. |
| — | — | No `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers found in any phase-48-touched file | INFO | `grep` across `js/kiosk-core.js`, `js/kiosk.js`, `js/admin.js`, the parity test — zero matches. |

### Human Verification Required

### 1. iPad Safari full-sale parity (SC#5, plan 48-06)

**Test:** On staging (calls PROD middleware), complete a full kiosk sale — product + recipe + product-type discount — from both the standalone kiosk URL and the admin-embedded kiosk tab.
**Expected:** Identical behaviour on both surfaces; terminal charge succeeds; Zoho invoice/payment created with the discounted total.
**Why human:** Real Helcim terminal transaction; no staging middleware exists to mock this safely.

### 2. Dual-cart / sales-order-import live flow

**Test:** Import a held sales order into the standalone kiosk cart and complete the sale.
**Expected:** Behaves as before the de-fork.
**Why human:** Requires a real held SO and live terminal.

### 3. Void-on-failure live path

**Test:** Trigger or observe a terminal failure; confirm `payment_voided` renders correctly.
**Expected:** Void behaviour unchanged post-relocation.
**Why human:** Requires forcing a real failure condition against the live terminal/Helcim/Zoho stack.

### 4. Manager Override (D-07) live on both surfaces

**Test:** Force a stock-insufficient recipe sale on both the standalone kiosk and admin kiosk tab; confirm 409 → override button → resubmit → success on both.
**Expected:** Identical behaviour on both surfaces; standalone kiosk's override (previously dead) now works.
**Why human:** Requires a real recipe/stock state and a live resubmit round trip against prod middleware — the automated parity test only proves the payload shape and DOM wiring, not the live server round trip.

### 5. Admin modified_ingredients pricing fix live

**Test:** Edit ingredient quantities on an admin recipe sale before charging.
**Expected:** Invoice total matches the edited preview, not the base recipe price.
**Why human:** Requires inspecting the actual booked Zoho invoice.

### 6. Admin single-batch fix live

**Test:** Sell a kit item via the admin kiosk tab; check BrewPad "Needs Scheduling."
**Expected:** Exactly one batch created (no duplicate).
**Why human:** Requires checking BrewPad's live batch list post-sale.

### Gaps Summary

No BLOCKER-level gaps. The structural/automated portion of the phase goal (SC#1 single-source cart/payment/checkout, SC#2 behaviour-preservation via existing tests + new parity test, SC#3 discount parity, SC#4 build/lint/test gate, D-07 Manager Override single-sourced with automated 409→resubmit parity) is fully and verifiably achieved in the codebase — not merely claimed in SUMMARY.md. All grep/structural/test evidence was independently re-derived, not taken from the SUMMARYs.

One WARNING-level anti-pattern was found: `admin.js` retains a disclosed, narrowly-scoped duplicate of `kioskShowRecipePrompt`/`renderKioskModifyRows`/`attachKioskModifyRowListeners` (3 of ~40 migrated functions) rather than delegating fully to `KioskCore`, justified by a genuine pre-existing test-asserted coupling to the admin Recipes-tab ingredient catalog. This does not compromise money-path correctness (the actual charged data flows through `KioskCore` accessors correctly) but does mean this specific UI slice of the recipe-sale flow could still silently drift between surfaces in future edits — the opposite of the phase's stated intent for that slice. Recommend a follow-up cleanup ticket, not a blocking gap for this phase.

The remaining path to `status: passed` is exclusively the human-verification gate (plan 48-06 / SC#5), which cannot be automated by design (staging calls prod middleware; real money movement) and is explicitly scoped as `autonomous: false` in its own plan. This is expected, not a phase defect — routing to `human_needed` per the decision tree (Step 9.2: any non-empty human-verification list forces `human_needed` regardless of automated score).

---

_Verified: 2026-07-04T16:40:00Z_
_Verifier: Claude (gsd-verifier)_
