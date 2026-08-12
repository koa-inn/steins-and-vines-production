---
phase: 70-kiosk-tender-types
plan: 02
subsystem: payments
tags: [kiosk, moto, card-not-present, helcimpay, pci-saq-a, captured-amount-verify, csp, zoho-books, express, es5, pos]

# Dependency graph
requires:
  - phase: 70-kiosk-tender-types (plan 01)
    provides: tender-aware /api/kiosk/sale route guard + tender allow-list ('terminal'/'cash'/'moto') + the sibling-branch template in processSaleWithPrices/runConfirm that the moto branch slots into
  - phase: 49-money-path-hardening (checkout captured-amount verify)
    provides: the MONEY-01/H2 getCardTransactionById captured-amount readback pattern ported verbatim into pos.js as verifyMotoCharge
  - phase: 45-money-path-hardening
    provides: moneyPath.acquireIdempotencyLock / voidWithTimeout primitives reused unchanged for moto
  - phase: 44-gift-card-split-tender
    provides: gift-card real-balance clamp + split-tender payment chain the moto leg slots into
provides:
  - "tender:'moto' branch in /api/kiosk/sale (in-process helcimLib.initializeCheckout, responds {moto:true, checkout_token}, no KIOSK_PENDING_CHARGE write) and /api/kiosk/sale/confirm (verifyMotoCharge captured-amount gate before booking, payment_mode:'creditcard' with card-not-present note)"
  - "kiosk phone-order tender button (initial + gift-card-applied rows) that mounts the HelcimPay hosted iframe and drives confirmSale(txnId,'moto') via an origin-validated postMessage listener"
  - "kiosk.html's first scoped CSP (HelcimPay + kiosk runtime domains, no trackers, no 'unsafe-inline') + the HelcimPay.js start.js script"
affects: [70-03-live-verify, kiosk-reconciliation, zoho-books-payment-reporting, pci-scope]

# Tech tracking
tech-stack:
  added: []  # zero npm installs; one external <script src> to Helcim's own CDN (already live on reservation.html)
  patterns:
    - "MOTO captured-amount verify (verifyMotoCharge) is a SEPARATE unconditional gate for tender:'moto', combined with verifyManualCharge via Promise.all so it resolves BEFORE any zohoPost('/invoices') — a real (non-manual-confirm) transaction_id makes isManualConfirm false, so verifyManualCharge alone would NOT check the capture (phantom-revenue trap avoided)"
    - "MOTO reuses the terminal customerpayment shape (payment_mode:'creditcard', reference_number:txnId) — only the notes text differs ('card-not-present') because Zoho's payment_mode enum has no CNP value"
    - "HelcimPay session token comes from the /api/kiosk/sale 202 response (server initializes in-process); the kiosk client does NOT fetch /api/payment/initialize a second time"
    - "Single module-scope HelcimPay postMessage listener bound once in kcInit, dispatching to per-sale onSuccess/onAbort handlers installed by _kioskGoMoto (avoids per-payment listener leaks while preserving the 12-checkout.js origin-check semantics)"
    - "kiosk.html scoped CSP omits 'unsafe-inline' from script-src (zero inline scripts) — a hardening opportunity unavailable to the tracker/GTM public pages"

key-files:
  created:
    - zoho-middleware/__tests__/pos-moto-tender.test.js
    - tests/frontend/kiosk-moto-tender.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - kiosk.html
    - docs/TRACKING.md

key-decisions:
  - "verifyMotoCharge is chained via Promise.all([verifyManualCharge, verifyMotoCharge]) rather than defined in parallel — for a real MOTO txn isManualConfirm is false so verifyManualCharge resolves immediately; a separate gate is required so the captured-amount check always runs before invoice creation (checker WR-2 / RESEARCH Pitfall 1)"
  - "MOTO route guard requires helcimLib.isEnabled() (API token only), NOT isTerminalEnabled() (API token + device code) — phone-order card sales work on a kiosk with no physical terminal configured"
  - "No KIOSK_PENDING_CHARGE_PREFIX record for MOTO (RESEARCH Pitfall 3) — HelcimPay resolves synchronously via postMessage in the same browser tab that calls /confirm; the terminal's async-webhook reconcile backstop has no failure mode to protect against here, and writing one risks a spurious reconcile void"
  - "Failure routes through the EXISTING outer .catch void-on-failure block (pos.js) via a tagged __motoVerifyFailed error — no new void path introduced (audit H5/L18); voidWithTimeout fires for any body.transaction_id present on failure"
  - "kiosk.html gains a scoped first CSP (defense-in-depth for the PCI 'PAN never touches our DOM' invariant) rather than staying CSP-free — script-src has no 'unsafe-inline' since the page has zero inline scripts"

patterns-established:
  - "Client MOTO flow: tender button -> _kioskGoMoto POSTs tender:'moto' -> 202 checkout_token -> appendHelcimPayIframe -> origin-validated postMessage SUCCESS -> confirmSale(txnId,'moto'); the PAN lives only in Helcim's iframe, no card field in our DOM"
  - "Static-analysis-derived CSP domain sets MUST be flagged for live staging verification (STAGING-VERIFY comment) before a production force-push — the 2026-07-22 Meta-pixel incident pattern"

requirements-completed: [KIOSK-MOTO]

# Metrics
duration: ~40min (across a session-limit resume)
completed: 2026-08-12
---

# Phase 70 Plan 02: Kiosk Phone-Order (MOTO) Card Tender Summary

**Kiosk phone-order (card-not-present) tender: the card is keyed ONLY into Helcim's hosted HelcimPay.js iframe (PCI SAQ-A), the server initializes the session in-process and — before booking anything — verifies the Helcim-captured amount covers the recorded total (±$0.01) via `getCardTransactionById`, and the rest of the kiosk pipeline (stock, batch, invoice, gift-card split) is unchanged; only the payment leg swaps terminal → HelcimPay.**

## Performance

- **Duration:** ~40 min (interrupted by a session limit after Task 1; resumed cleanly)
- **Started:** 2026-08-12 (baseline commit `bd72650c`)
- **Completed:** 2026-08-12 (`b4ded8a0`)
- **Tasks:** 3 (Tasks 1 & 2 `type="auto" tdd="true"`; Task 3 config)
- **Files modified:** 7 (2 created test files, 5 modified source/config files)

## Accomplishments
- A MOTO sale books the Zoho invoice + a `payment_mode:'creditcard'` (card-not-present note) customerpayment ONLY after the server verifies the Helcim captured amount covers the recorded total (±$0.01). A short capture, an unverifiable/throwing readback, a non-finite/≤0 amount, or a missing `transaction_id` are all rejected with **zero** invoice and **zero** payment, routed through the existing void-on-failure path — the mandatory phantom-revenue guard.
- The PAN is entered ONLY inside Helcim's hosted iframe (`secure.helcim.app`); there is no card-number field anywhere in `kiosk.html`/`kiosk-core.js`, and the raw postMessage is never logged (only `transactionId` is read).
- The full kiosk pipeline (stock decrement, batch creation, kiosk invoice, gift-card split) still runs for MOTO — only the payment leg differs. MOTO + gift-card split books the verified creditcard leg before the gift-card `'others'` leg (Pitfall-1 ordering preserved).
- MOTO writes NO `KIOSK_PENDING_CHARGE_PREFIX` record and introduces no new void path.
- `kiosk.html` gained its first scoped CSP (HelcimPay + kiosk runtime domains, no trackers, no `'unsafe-inline'`) plus the HelcimPay.js script; `docs/TRACKING.md` rule 4 updated to reflect that kiosk.html now carries a CSP.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server MOTO branch — HelcimPay init + captured-amount verify before booking (phantom-revenue guard)** - `3cdb4e7d` (feat, tdd)
2. **Task 2: Kiosk phone-order tender button + HelcimPay iframe mount + origin-validated postMessage + rebuild min** - `5d81b9e3` (feat, tdd)
3. **Task 3: kiosk.html first scoped CSP + HelcimPay.js script; update docs/TRACKING.md** - `b4ded8a0` (feat)

_Tasks 1 & 2 are `tdd="true"` at the task level: each test file was written first and observed to drive the new branch RED→GREEN before a single `feat` commit (matching the plan's one-commit-per-task protocol, as in 70-01). See TDD Gate Compliance below._

## Files Created/Modified
- `zoho-middleware/routes/pos.js` — MOTO route guard (`isEnabled()`, not `isTerminalEnabled()`); `body.tender === 'moto'` branch in `processSaleWithPrices` (in-process `helcimLib.initializeCheckout`, responds `{pending:false, moto:true, checkout_token, reference}`, no pending-charge write); `verifyMotoCharge` in `runConfirm` (requires `transaction_id`, reads back `getCardTransactionById`, fail-closed on throw/non-finite/≤0/short, tagged `__motoVerifyFailed`), chained via `Promise.all([verifyManualCharge, verifyMotoCharge])` before `zohoPost('/invoices')`; MOTO customerpayment reuses the terminal `payment_mode:'creditcard'` shape with a `'card-not-present'` notes string.
- `zoho-middleware/__tests__/pos-moto-tender.test.js` — 12 tests: MANDATORY phantom-revenue guard (short capture → no booking, routes to void), fail-closed on throw / zero-amount / missing txn id, happy-path booking shape (creditcard, reference_number=verified txn, card-not-present notes, stock decremented), `/sale` initializeCheckout + moto:true + no pending-charge, terminal-disabled-but-API-enabled, isEnabled()-false → 503, gift-card + moto split ordering, and no-tender/cash regressions. The `../lib/helcim` mock adds `initializeCheckout` + `getCardTransactionById` (the base pos mock omits both).
- `js/kiosk-core.js` — ported `extractHelcimTransactionId` (verbatim) + a single origin-validated `message` listener (bound once in `kcInit`) dispatching to per-sale MOTO handlers; new `_kioskGoMoto` sibling to `_kioskGoCash` (POST tender:'moto', mount `appendHelcimPayIframe(checkout_token)` from the 202 — no `/api/payment/initialize` fetch, `confirmSale(txnId,'moto')` on SUCCESS, return-to-tender on ABORTED); "Phone Order" buttons in the initial + gift-card-applied rows.
- `js/kiosk-core.min.js` — rebuilt via `npm run build`; unrelated `?v=`/timestamp stamp churn on 20 other HTML/JS files (and the admin BUILD_TIMESTAMP) produced by the same build run was reverted before committing (70-01/64-0x precedent).
- `tests/frontend/kiosk-moto-tender.test.js` — 6 tests: Phone Order control present, no card-number input (PCI), `/sale` posts tender:'moto' + mounts the iframe with no init fetch (through `_kcMergeAuth`), foreign-origin postMessage ignored, valid SUCCESS confirms with tender:'moto' + the extracted txn id, ABORTED does not confirm.
- `kiosk.html` — HelcimPay.js `start.js` `<script>` + first CSP `<meta>` (script/connect/frame-src include `secure.helcim.app`; script-src has no `'unsafe-inline'`); a `STAGING-VERIFY (70-03)` HTML comment flags the CSP for live staging verification before production.
- `docs/TRACKING.md` — rule 4: removed kiosk.html from the no-CSP internal-surface list; documented the new scoped CSP + the keep-in-sync / staging-live-verify requirement.

## Decisions Made
- **`verifyMotoCharge` as a separate Promise.all gate (checker WR-2, RESEARCH Pitfall 1):** the existing `verifyManualCharge` only runs when `isManualConfirm` is true. A real MOTO `transaction_id` makes `isManualConfirm` false, so `verifyManualCharge` resolves immediately without touching the capture. A separate, unconditional `verifyMotoCharge` — combined via `Promise.all([verifyManualCharge, verifyMotoCharge])` so it MUST resolve before `zohoPost('/invoices')` — is what prevents a phantom-revenue booking on an unverified client-supplied txn id.
- **`isEnabled()` not `isTerminalEnabled()` for MOTO:** MOTO needs only the Helcim API token; a kiosk with no physical terminal device can still take a phone-order card.
- **No pending-charge for MOTO (Pitfall 3):** HelcimPay is synchronous; the terminal's async-webhook reconcile backstop has no MOTO failure mode, and writing a pending-charge record risks a spurious reconcile void.
- **Single bound postMessage listener:** registered once in `kcInit` (idempotent flag) with per-sale handlers, rather than re-adding a listener each time the payment view is shown — avoids listener leaks while keeping the 12-checkout.js origin-check semantics verbatim.
- **kiosk.html scoped CSP with no `'unsafe-inline'`:** the page has zero inline scripts, so the first CSP is a genuine hardening (defense-in-depth for the PCI PAN-isolation invariant) rather than a like-for-like copy of the tracker-heavy public-page CSP.

## Deviations from Plan

None — plan executed as written. No Rule 1–4 deviations were required; every task's actions and acceptance criteria were met directly.

## Issues Encountered
- A `docs/TRACKING.md` acceptance grep (`kiosk.html.*no CSP` must be 0) initially matched because the phrase "no CSP violations" appeared after "kiosk.html" on the rule-4 line. Reworded to "zero CSP violations" so the grep-assert passes without weakening the meaning. (Documentation-only wording fix, not a behavior change.)

## Threat Model Coverage
- **T-70-06 (phantom revenue):** mitigated — `verifyMotoCharge` captured-amount gate before any booking; MANDATORY top-priority test asserts short/unverifiable/missing-txn → zero invoice, zero payment, routed to void.
- **T-70-07 (postMessage spoofing):** mitigated — origin check `=== 'https://secure.helcim.app' || 'https://myhelcim.com'` ported unchanged; foreign-origin test asserts it is ignored.
- **T-70-08 (PCI / card data):** mitigated — PAN only in Helcim's iframe; no card-number input (grep-assert + DOM test); raw postMessage never logged.
- **T-70-09 (CSP silently blocking a kiosk feature):** partially in place — explicit domain inventory + STAGING-VERIFY flag; **the live staging Network/Console verification is Plan 70-03** (see Live-Verify Required below).
- **T-70-10 (orphaned MOTO charge):** mitigated — existing `moneyPath.voidWithTimeout` catch fires for any `body.transaction_id`; no new void path.
- **T-70-11 (spurious reconcile void):** mitigated — no `KIOSK_PENDING_CHARGE` write for MOTO.

## Live-Verify Required (Plan 70-03)
The kiosk.html CSP domain set is **static-analysis-derived** (RESEARCH Assumption A1). It MUST be verified on a live staging kiosk session (Network + Console tabs, zero CSP violations) covering: Google Sign-In, product/catalog load, gift-card lookup (Apps Script), and a real HelcimPay MOTO charge (refunded) — BEFORE any production force-push. A missing domain would silently break a kiosk feature exactly like the 2026-07-22 Meta-pixel incident. This is the explicit scope of Plan 70-03.

## TDD Gate Compliance
Tasks 1 and 2 are `tdd="true"` at the individual-task level (not a plan-level `type: tdd`). Per the plan's task-commit protocol (one commit per task), each task's test file was authored first and run RED-then-GREEN against the new branch before a single `feat(70-02): ...` commit — no separate `test(...)` commit exists, matching the 70-01 precedent. This is expected, not a gate violation.

## User Setup Required
None — no new environment variables. MOTO reuses the existing `HELCIM_API_TOKEN` (already required in prod for the public checkout). The physical `HELCIM_DEVICE_CODE` is NOT needed for MOTO.

## Next Phase Readiness
- Plan 70-03 (live-verify) can proceed: it must live-verify the kiosk.html CSP on staging and run a real refunded HelcimPay MOTO charge on the kiosk before any production deploy.
- Both suites green (frontend 77 suites / 1087 tests; middleware 91 suites / 1383 tests); both lints clean; `js/kiosk-core.min.js` rebuilt from source with no unrelated build-stamp churn.

---
*Phase: 70-kiosk-tender-types*
*Completed: 2026-08-12*

## Self-Check: PASSED

All created/modified files verified present on disk; all three task commits (`3cdb4e7d`, `5d81b9e3`, `b4ded8a0`) verified present in `git log --all`. Both full suites green (frontend 77/1087, middleware 91/1383) and both lints clean at completion.
