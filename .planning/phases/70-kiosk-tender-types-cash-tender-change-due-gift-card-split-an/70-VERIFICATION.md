---
phase: 70-kiosk-tender-types-cash-tender-change-due-gift-card-split-an
verified: 2026-08-12T22:47:11Z
status: human_needed
score: 12/12 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Live-verify kiosk.html CSP on a real staging kiosk session (Network + Console) — GSI, catalog load, gift-card lookup, fonts all still work with zero CSP violations"
    expected: "No 'Refused to load / connect / frame' CSP console errors for any exercised kiosk feature"
    why_human: "The CSP domain set is static-analysis-derived (RESEARCH Assumption A1); only a live browser trace against real staging traffic can confirm no domain was omitted (2026-07-22 Meta-pixel-class regression risk). This is Phase 70-03 Task 1, gated `checkpoint:human-verify`, not yet executed (no 70-03-SUMMARY.md exists)."
  - test: "Real cash sale on the staging kiosk"
    expected: "Zoho invoice created, marked paid, customerpayment payment_mode:'cash' for the sale total, stock decremented, no Helcim transaction created"
    why_human: "Requires a real device/session and a real Zoho Books lookup; static analysis + unit/integration tests cannot exercise the live Zoho org or physical kiosk hardware. Phase 70-03 Task 1."
  - test: "Real HelcimPay MOTO (phone-order) charge on the staging kiosk, then refunded"
    expected: "Helcim's hosted iframe renders with no card-number field in our page; a real card charge is captured; Zoho books the invoice only after server-side capture verification, with payment_mode:'creditcard' and a card-not-present note; the charge is refunded and the test invoice/payment reversed"
    why_human: "Requires a real Helcim merchant account charge and a real staging kiosk session — cannot be exercised by unit tests or grep. Phase 70-03 Task 2, gated `checkpoint:human-verify`, not yet executed (no 70-03-SUMMARY.md exists)."
---

# Phase 70: Kiosk Tender Types — Cash + Phone-Order Card (MOTO via HelcimPay) Verification Report

**Phase Goal:** Add two kiosk tenders safely: (a) CASH — books Zoho `payment_mode:'cash'`, skips terminal, idempotent, change-due display-only, cash+gift-card split, cash confirm carries no `transaction_id`; (b) MOTO phone-order card via HelcimPay hosted iframe — PAN only in Helcim's iframe (never our DOM/JS/server/logs), booked ONLY after a captured-amount+APPROVED-status verify, failure via the existing void path, no new endpoint, and (post-review) a `KIOSK_PENDING_CHARGE` backstop for a dropped confirm.

**Verified:** 2026-08-12T22:47:11Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cash tender books `payment_mode:'cash'`, skips terminal entirely, zero Helcim calls | ✓ VERIFIED | `pos.js:1572` `payment_mode: 'cash'`; cash branch (pos.js:775-796) responds 202 without calling `terminalPurchase`; `pos-cash-tender.test.js` asserts `terminalPurchase`/`pollTerminalResult` never called for cash |
| 2 | Cash double-tap cannot double-book (idempotency lock reused) | ✓ VERIFIED | Cash `/sale` and `/confirm` reuse the same `moneyPath` idempotency-lock/cache-set code paths as terminal (pos.js:775-796, cache write shape unchanged); `pos-cash-tender.test.js` double-tap replay test passes |
| 3 | Cash confirm carries no `transaction_id`; void-on-failure never fires for cash | ✓ VERIFIED | `verifyManualCharge` explicitly excludes `body.tender !== 'cash'` (pos.js:1470); two additional `voidWithTimeout` call sites guarded with `body.tender !== 'cash'` (pos.js:1402, 1445); confirmed by test |
| 4 | Change-due is client-side display-only; tendered/change never sent to server | ✓ VERIFIED | `_kioskGoCash` (kiosk-core.js:3132) builds `standardSaleBody` with only `tender:'cash'` + `gift_card` — no `tendered`/`change` keys anywhere in the fetch body; `kiosk-cash-tender.test.js` asserts this |
| 5 | Gift-card + cash split books gift-card leg unchanged, cash covers clamped remainder | ✓ VERIFIED | `cashApplied` re-resolved server-side at confirm (pos.js:1431, same formula as `terminalApplied`); cash payment booked before the `'others'` gift-card leg (pos.js:1570); split test passes |
| 6 | No-tender sale still hits the existing terminal path unchanged | ✓ VERIFIED | `pos-money.test.js` (unmodified regression suite) passes unchanged; tender defaults to `'terminal'` (pos.js:317) |
| 7 | MOTO books ONLY after captured-amount verify AND APPROVED status (±$0.01, both bounds) — no phantom revenue | ✓ VERIFIED | `verifyMotoCharge` (pos.js:1497-1544) asserts `status === 'APPROVED'` THEN `Math.abs(captured - terminalApplied) > MOTO_CAPTURED_AMOUNT_TOLERANCE` (exact-match, both bounds); gated via `Promise.all([verifyManualCharge, verifyMotoCharge])` (pos.js:1550) BEFORE `zohoPost('/invoices')`; CR-01 regression tests for DECLINED/VOIDED/short/missing-status all assert zero invoice, zero payment |
| 8 | MOTO failure routes through the EXISTING void-on-failure path — no new void path | ✓ VERIFIED | `__motoVerifyFailed`-tagged errors thrown by `verifyMotoCharge` flow into the same outer `.catch` block (pos.js:1587+) that handles `__manualVerify`; no new `voidWithTimeout` call site introduced |
| 9 | PAN only in Helcim's hosted iframe; no card-number field in our DOM/JS/server/logs | ✓ VERIFIED | `grep -nE 'type="tel"|card-number|<input[^>]*card'` on `kiosk.html`/`kiosk-core.js` returns only an unrelated phone-number field (`kiosk-new-phone`, `type="tel"`); MOTO verify reads only `transactionId`/`status`/`amount`, never logs the raw postMessage |
| 10 | MOTO writes a `KIOSK_PENDING_CHARGE` record on init and clears it on confirm (WR-01 backstop) | ✓ VERIFIED | `pos.js:832-841` writes `motoPendingKey`/`motoPendingContext` on successful `initializeCheckout`; `pos.js:1775-1783` clears `KIOSK_PENDING_CHARGE_PREFIX + reference_number` tender-agnostically on any successful confirm (fires for MOTO too); `pos-moto-tender.test.js` WR-01 tests for both write and clear pass |
| 11 | Tender-scoped idempotency key so a tender switch after abort isn't blocked (WR-02) | ✓ VERIFIED | `kiosk-core.js:3146` `refNumber + ':cash'`, `kiosk-core.js:3210` `refNumber + ':moto'`; terminal path resets to bare `refNumber` (kiosk-core.js:2945); WR-02 regression tests in both frontend suites pass |
| 12 | postMessage origin allowlist aligned with CSP frame-src (`secure.myhelcim.com`, WR-03) | ✓ VERIFIED | `kiosk-core.js:244` checks `event.origin !== 'https://secure.helcim.app' && event.origin !== 'https://secure.myhelcim.com'`; `kiosk.html` CSP `frame-src`/`connect-src` list the same two origins, no bare `myhelcim.com` in either |

**Score:** 12/12 truths verified at the code level. Two of the phase's `must_haves` (kiosk.html's CSP being non-breaking on a real device, and a real Helcim charge behaving correctly) are **inherently unverifiable by static analysis or unit test** — they require a live kiosk session and are explicitly the subject of the separate 70-03 human checkpoint (see Human Verification below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | `tender:'cash'`/`tender:'moto'` branches, `verifyMotoCharge` with `__motoVerifyFailed`, `payment_mode:'cash'` | ✓ VERIFIED | All present and wired; confirmed via grep + read (lines cited above) |
| `js/kiosk-core.js` | Cash button + change-due panel, MOTO button + iframe mount + origin-checked postMessage listener | ✓ VERIFIED | `_kioskGoCash` (3132), `_kioskGoMoto`/MOTO listener (239-260 origin check; button injection ~3319+); no card-number input |
| `js/kiosk-core.min.js` | Rebuilt bundle reflecting source | ✓ VERIFIED | `npm run build` reproduces an identical bundle (only cache-buster `?v=` stamp differs, which was discarded — not a content diff) |
| `kiosk.html` | First CSP + HelcimPay.js script | ✓ VERIFIED | CSP present (line 17) with `secure.helcim.app`/`secure.myhelcim.com` in script/connect/frame-src, no `'unsafe-inline'`; `start.js` script tag present (line 39) |
| `docs/TRACKING.md` | kiosk.html removed from no-CSP list | ✓ VERIFIED | Rule 4 updated (line 50) — but see Anti-Patterns note on wording below |
| `zoho-middleware/__tests__/pos-cash-tender.test.js` | Cash regression suite | ✓ VERIFIED | Exists, all tests pass |
| `zoho-middleware/__tests__/pos-moto-tender.test.js` | MOTO regression suite incl. mandatory phantom-revenue guard + CR-01/WR-01 additions | ✓ VERIFIED | Exists, includes DECLINED/VOIDED/short/missing-status tests, all pass |
| `tests/frontend/kiosk-cash-tender.test.js` | Cash UI regression suite | ✓ VERIFIED | Exists, includes WR-02 test, all pass |
| `tests/frontend/kiosk-moto-tender.test.js` | MOTO UI regression suite | ✓ VERIFIED | Exists, includes WR-02 test, all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `js/kiosk-core.js` cash Complete handler | `/api/kiosk/sale` → `/confirm` | `fetch` with `tender:'cash'`, no tendered/change | ✓ WIRED | Confirmed in `_kioskGoCash` body construction |
| `zoho-middleware/routes/pos.js runConfirm` cash branch | `zohoPost('/customerpayments')` | `payment_mode:'cash'`, `reference_number:refNumber` | ✓ WIRED | pos.js:1570-1580 |
| `runConfirm` moto branch | `helcimLib.getCardTransactionById` | captured-amount + status verify before any `zohoPost('/invoices')` | ✓ WIRED | `Promise.all([verifyManualCharge, verifyMotoCharge]).then()` gates the invoice creation call |
| `js/kiosk-core.js` message listener | `confirmSale(txnId,'moto')` | origin check + `extractHelcimTransactionId` | ✓ WIRED | Origin check present, `__motoVerifyFailed`-tagged failures never reach booking |
| `pos.js` MOTO `/sale` branch | `KIOSK_PENDING_CHARGE` cache | write on init, delete on confirm success | ✓ WIRED | pos.js:832-841 (write), pos.js:1775-1783 (tender-agnostic clear) |

### Behavioral Spot-Checks / Automated Test Results

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full middleware suite | `cd zoho-middleware && npm test` | 91 suites / 1387 tests passed | ✓ PASS |
| Full frontend suite | `npm test` | 77 suites / 1089 tests passed | ✓ PASS |
| Frontend lint | `npm run lint` | clean | ✓ PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean | ✓ PASS |
| CR-01 phantom-revenue guard (DECLINED/VOIDED with sufficient amount) | `pos-moto-tender.test.js` | asserts zero invoice, zero payment, routes to void | ✓ PASS |
| WR-01 pending-charge write + clear | `pos-moto-tender.test.js` | write on `/sale`, delete on `/confirm` success | ✓ PASS |
| WR-02 tender-scoped idempotency key | `kiosk-cash-tender.test.js`, `kiosk-moto-tender.test.js` | `refNumber:cash` / `refNumber:moto` asserted | ✓ PASS |
| `npm run build` reproduces `kiosk-core.min.js` from source | `npm run build` then `git diff` | only cache-buster `?v=` stamps differ (discarded, not committed) | ✓ PASS |

### Probe Execution

No dedicated `scripts/*/tests/probe-*.sh` files exist for this phase; verification relied on the full middleware + frontend automated suites (above), which is the project's equivalent probe mechanism per CLAUDE.md. Step 7c: SKIPPED (no dedicated probe scripts declared or found).

### Requirements Coverage

No ROADMAP requirement IDs map to this phase (owner-ticket sourced; confirmed no `Phase 70` entries in `.planning/REQUIREMENTS.md`). Plan-level tags `KIOSK-CASH` (70-01) and `KIOSK-MOTO` (70-02) are both satisfied per the truths above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `docs/TRACKING.md` | 50 | Wording states the kiosk.html CSP "was...live-verified on staging per Plan 70-03...before production" in past tense, but Plan 70-03 has not been executed (no `70-03-SUMMARY.md` exists — confirmed by directory listing) | ⚠️ WARNING | Documentation inaccuracy: a reader trusting this line could believe the live-staging CSP check already happened and skip it before a prod deploy. Does not affect code correctness. `kiosk.html`'s own inline comment is correctly worded as pending ("STAGING-VERIFY (70-03) before prod... MUST be confirmed"), so the two docs disagree. Recommend fixing the TRACKING.md wording to future/conditional tense before closing 70-03. |
| `zoho-middleware/routes/pos.js` | 245-253 (`/confirm`) | `IN-01` (documented, skipped by design): `/confirm` does not re-validate `body.tender` against the `terminal\|cash\|moto` allow-list that `/sale` enforces | ℹ️ INFO | Reviewer-assessed as device-token-gated, not a new exploit; explicitly deferred as a follow-up consistency pass, not a phase must-have. Not a blocker. |
| `js/modules/12-checkout.js` | n/a | Public-checkout postMessage origin allowlist still carries the bare-`myhelcim.com` inconsistency that kiosk-core.js just fixed | ℹ️ INFO | Explicitly out of this phase's scope (kiosk-only); documented follow-up in 70-REVIEW.md. Not a phase must-have. |
| `zoho-middleware/routes/pos.js` | 1497-1544 | Full HelcimPay-session binding (asserting the verified txn belongs to the checkout token `initializeCheckout` created) is not implemented — comment documents it as a deferred follow-up | ℹ️ INFO | Explicitly documented deferral in both 70-REVIEW.md and CR-01 fix commit; owner-accepted scope boundary per the task instructions (deferrals not gaps). |

No debt markers (`TBD`/`FIXME`/`XXX`) were introduced by this phase's file changes — the one `'TBD'` string match in `js/kiosk-core.js:3702` is a pre-existing (Phase 48) UI display-label value unrelated to Phase 70.

### Human Verification Required

### 1. Live-verify kiosk.html CSP on a real staging kiosk session

**Test:** Open the staging kiosk with DevTools Console + Network open; exercise Google Sign-In, product catalog load, gift-card lookup (Apps Script), and font rendering.
**Expected:** Zero "Refused to load/connect/frame ... violates the following Content Security Policy" console errors.
**Why human:** The CSP domain set (`kiosk.html:17`) is static-analysis-derived (RESEARCH Assumption A1). Only a live browser trace against real traffic can confirm no domain was omitted — this is exactly the class of regression that broke Meta-pixel tracking site-wide on 2026-07-22 per CLAUDE.md rule 12. This is Phase 70-03 Task 1 (`checkpoint:human-verify`, gate: blocking), not yet executed — no `70-03-SUMMARY.md` exists in the phase directory.

### 2. Real cash sale on the staging kiosk

**Test:** Ring a small cart on the staging kiosk, choose Cash, enter a tendered amount, confirm change-due displays correctly, complete the sale.
**Expected:** One Zoho invoice created and marked paid with a `payment_mode:'cash'` customerpayment for the sale total; stock decremented; batch created if applicable; NO Helcim transaction exists for this sale.
**Why human:** Requires a real Zoho Books org lookup and physical kiosk hardware — outside the reach of unit/integration tests. Phase 70-03 Task 1.

### 3. Real HelcimPay MOTO (phone-order) charge on the staging kiosk

**Test:** Ring a small real-amount cart, choose "Phone order / card not present," key a real card into Helcim's iframe, complete the charge, then refund it.
**Expected:** Helcim's hosted iframe renders with no card-number field on our page; the Zoho invoice books only after server-side captured-amount + APPROVED-status verification, with `payment_mode:'creditcard'` and a card-not-present note; one Helcim transaction matches one Zoho payment; charge is refunded and test invoice/payment reversed afterward.
**Why human:** Requires a real Helcim merchant-account charge on real hardware — cannot be exercised by static analysis or unit tests. Phase 70-03 Task 2 (`checkpoint:human-verify`, gate: blocking), not yet executed.

### Gaps Summary

No code-level gaps found. All 12 derived observable truths for the Phase 70 goal (cash tender safety/idempotency/no-terminal-interaction/display-only change-due/split-tender; MOTO PCI isolation/status+amount-verified booking/existing-void-path-only/no-new-endpoint/pending-charge backstop) are verified present, substantive, and wired in the codebase, with passing regression tests covering the exact scenarios named in the post-review fix commits (CR-01, WR-01, WR-02, WR-03). Both automated test suites (91/91 middleware suites, 1387 tests; 77/77 frontend suites, 1089 tests) and both lints pass.

The phase cannot reach `passed` status because two of its own explicitly-scoped deliverables — a live CSP staging check and a real refunded MOTO charge — are, by design, human-only verification steps assigned to the separate 70-03 checkpoint plan, which has not yet been executed (no `70-03-SUMMARY.md` present). This is the expected/designed state, not a regression; status is `human_needed`, not `gaps_found`.

One documentation wording issue was found (`docs/TRACKING.md` describes the CSP as already "live-verified... per Plan 70-03" in past tense, while it is still pending) — flagged as a WARNING anti-pattern, recommended for a quick fix before or during 70-03 closure, but not blocking.

Documented deferrals — Option A (terminal keypad MOTO entry), full HelcimPay-session binding of the verified transaction to its checkout token, and the who-took-payment note — are intentional out-of-scope decisions recorded in 70-CONTEXT.md / 70-REVIEW.md follow-ups, not gaps.

---

_Verified: 2026-08-12T22:47:11Z_
_Verifier: Claude (gsd-verifier)_
