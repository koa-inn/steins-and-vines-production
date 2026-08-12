---
phase: 70-kiosk-tender-types-cash-tender-change-due-gift-card-split-an
reviewed: 2026-08-12T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - zoho-middleware/routes/pos.js
  - js/kiosk-core.js
  - kiosk.html
  - zoho-middleware/__tests__/pos-cash-tender.test.js
  - zoho-middleware/__tests__/pos-moto-tender.test.js
  - tests/frontend/kiosk-cash-tender.test.js
  - tests/frontend/kiosk-moto-tender.test.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: fixes_applied
fix_outcomes:
  fixed: 4        # CR-01, WR-01, WR-02, WR-03
  skipped: 2      # IN-01, IN-02 (info — out of --fix scope)
  fixed_at: 2026-08-12
  commits:
    - "37c6a656 fix(70-review): CR-01 require APPROVED status + exact-amount in MOTO capture verify"
    - "4c5061d0 fix(70-review): WR-01 add MOTO pending-charge reconciliation backstop"
    - "194cc0f3 fix(70-review): WR-02 tender-scoped idempotency key + WR-03 align Helcim origin allowlist to CSP"
  suites: "frontend 1089/1089, middleware 1387/1387, lint (both) clean"
  follow_ups:
    - "CR-01: bind the verified MOTO txn to its HelcimPay checkout token (full session binding) — needs the token threaded through /confirm; deferred as out-of-scope."
    - "WR-03: js/modules/12-checkout.js public-checkout origin allowlist carries the same bare-myhelcim.com inconsistency; fix under a public-checkout phase."
    - "WR-03 / IN-02: still requires live-staging CSP + postMessage-origin verification before any production force-push."
---

# Phase 70: Code Review Report

**Reviewed:** 2026-08-12
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase 70 cash + MOTO/HelcimPay tender work as a money-path / PCI-sensitive
change. The cash tender is solid: it skips Helcim entirely, carries no `transaction_id`
into any void path, books `payment_mode:'cash'` idempotently, and the change-due panel is
provably display-only (tendered/change never leave the browser — confirmed in both source
and tests). PCI posture is good: the PAN lives only in Helcim's iframe, there is no
card-number input in our DOM, and the postMessage origin check is intact for the primary
`secure.helcim.app` origin.

However, the **single most important control in this phase — the MOTO captured-amount
verify — is incomplete and admits phantom revenue** (CR-01). `verifyMotoCharge` checks the
captured *amount* but never checks the transaction *status*, so a DECLINED / voided /
authorized-but-not-captured Helcim transaction whose `amount` field is large enough passes
verification and books a paid invoice. This is the top priority to fix. Three warnings
follow: MOTO has no orphan-charge reconciliation backstop, a tender-switch-after-abort is
blocked by the shared idempotency key, and the postMessage origin allowlist disagrees with
the new CSP for the `myhelcim.com` fallback origin.

The Promise-chain structure is otherwise correct: `verifyMotoCharge` and `verifyManualCharge`
are genuinely awaited via `Promise.all` *before* any `zohoPost('/invoices')`, failures route
through the existing outer `.catch` void path (no bare-400-after-charge), missing/zero/NaN/
negative captures and `getCardTransactionById` throws are all rejected and voided, and a
`tender:'cash'` confirm never triggers a Helcim poll or void.

## Critical Issues

### CR-01: MOTO capture verify checks amount but not transaction status → phantom revenue

**Resolution:** FIXED (commit 37c6a656, requires human verification — money-path logic
change). `verifyMotoCharge` now asserts `txn.status === 'APPROVED'` (matching
verifyManualCharge's `tr.approved` / the status-poll standard) AND an exact-amount
match (lower + upper bound via `Math.abs(captured - terminalApplied) > tolerance`)
before booking. RED regression tests added for DECLINED / VOIDED / missing-status
transactions that carry a sufficient amount (→ 502, no invoice, no payment, existing
void path); existing mocks updated to carry a `status` field. Full HelcimPay-session
binding (the secondary replay gap) is recorded as a follow-up — it needs the checkout
token threaded through `/confirm`, beyond this fix's scope.

**File:** `zoho-middleware/routes/pos.js:1472-1499`
**Issue:**
`verifyMotoCharge` is the phantom-revenue gate for `tender:'moto'`. It calls
`helcimLib.getCardTransactionById(body.transaction_id)` and then validates **only the
captured amount**:

```js
.then(function (txn) {
  var captured = parseFloat(txn && txn.amount);
  if (!isFinite(captured) || captured <= 0 || captured < terminalApplied - MOTO_CAPTURED_AMOUNT_TOLERANCE) {
    ... throw __motoVerifyFailed ...
  }
})
```

`getCardTransactionById` (lib/helcim.js:304-325) returns an uppercased `status`
(`APPROVED` / `DECLINED` / …) alongside `amount`, but `verifyMotoCharge` ignores it.
A Helcim card-transaction that was **DECLINED, later VOIDED, or authorized-but-not-captured**
still carries the attempted `amount`. If the client POSTs such a `transaction_id` to
`/confirm`, `captured >= terminalApplied` is satisfied and the invoice is booked and marked
paid with `payment_mode:'creditcard'` — **money recorded as collected that Helcim never
captured.** The whole purpose of this server-side gate is to not trust the client's word;
checking amount-without-status defeats it.

This is inconsistent with the rest of the codebase's own standard: the terminal/manual path
(`verifyManualCharge`, pos.js:1445-1456) checks `tr.approved`, and the status-poll route
(pos.js:926) keys off `result.approved`. MOTO alone skips the approval check.

Two secondary gaps in the same check compound the risk:
- **No upper bound / no session binding.** The comparison is lower-bound-only
  (`captured >= terminalApplied - 0.01`) and the transaction is never bound to the
  HelcimPay session that `initializeCheckout` created (no check of session token or
  invoice association). A *reused older* `transaction_id` from a prior sale with an
  `amount` ≥ this cart's `terminalApplied` therefore also passes. Because the confirm
  idempotency key is seeded from `idempotency_key`/`reference_number` (not the txn id),
  a different cart with a fresh ref would not be caught by the replay guard.

**Fix:** Assert the transaction is genuinely approved/captured before booking, and prefer
an exact-amount match:

```js
.then(function (txn) {
  var status = (txn && txn.status ? String(txn.status) : '').toUpperCase();
  if (status !== 'APPROVED') {
    var mStatusErr = new Error('MOTO transaction not approved (status=' + status + ')');
    mStatusErr.__motoVerifyFailed = true;
    throw mStatusErr;
  }
  var captured = parseFloat(txn && txn.amount);
  // lower AND upper bound — captured must equal the amount we initialized the session for
  if (!isFinite(captured) || captured <= 0 ||
      Math.abs(captured - terminalApplied) > MOTO_CAPTURED_AMOUNT_TOLERANCE) {
    var mErr = new Error('MOTO captured amount could not be verified against the recorded total');
    mErr.__motoVerifyFailed = true;
    throw mErr;
  }
})
```

Add a regression test (the existing `pos-moto-tender.test.js` mocks only `{ amount: N }`
with no `status`, so the gap is currently unguarded) that mocks
`getCardTransactionById.mockResolvedValue({ amount: 100, status: 'DECLINED' })` and asserts
**zero** `/invoices` and `/customerpayments` calls plus void-on-failure routing.

## Warnings

### WR-01: MOTO has no orphan-charge reconciliation backstop

**Resolution:** FIXED (commit 4c5061d0). The MOTO `/sale` branch now persists a
`KIOSK_PENDING_CHARGE_PREFIX` record (keyed by refNumber, `KIOSK_PENDING_CHARGE_TTL`)
on a successful `initializeCheckout`, mirroring the terminal branch. The 45-08
reconcile sweep is tender-agnostic: an un-cleared MOTO pending record with no matching
terminal-result cache is flagged as a potential orphan for manual review. A successful
`/confirm` clears the record via the existing tender-agnostic delete keyed on
`reference_number`. Tests: a MOTO `/sale` now writes the pending record; a successful
MOTO `/confirm` clears it.

**File:** `zoho-middleware/routes/pos.js:798-835`
**Issue:**
The `tender:'moto'` `/sale` branch deliberately writes **no** `KIOSK_PENDING_CHARGE_PREFIX`
record (comment lines 799-805: "HelcimPay resolves synchronously … nothing to reconcile").
But the actual card capture happens inside the iframe on the client, and booking only
occurs on a *separate* `/confirm` round-trip. If the network drops (or the iPad sleeps)
between the HelcimPay `SUCCESS` postMessage and a completed `/confirm`, the customer's card
is charged but no invoice exists, no void fires, and — unlike the terminal path
(pending-charge write + Helcim webhook + the 45-08 reconcile sweep) — **there is no
server-side trail to reconcile the orphan charge.** "Same browser tab" is not a guarantee
against a dropped confirm request.

**Fix:** Mirror the terminal path: on a successful `initializeCheckout`, persist a
pending-charge record (ref + amount + idempotency_key) with `KIOSK_PENDING_CHARGE_TTL`, and
have the 45-08 backstop treat an un-cleared MOTO pending record as reconcilable (query the
HelcimPay session / `getCardTransactionById` for a captured txn and void-or-alert). At
minimum, log a durable "MOTO charged, awaiting confirm" marker the sweep can find.

### WR-02: Tender switch after a MOTO abort is blocked by the shared idempotency key

**Resolution:** FIXED (commit 194cc0f3). Cash and MOTO now derive a tender-scoped
idempotency key (`refNumber + ':cash'` / `refNumber + ':moto'`) at the start of their
respective `_kioskGo*` flows; the terminal path resets the shared body's key to the
bare `refNumber`. Switching tenders after an abort therefore issues a distinct
idempotency scope (no stale replay), while a genuine double-tap of the SAME tender
still de-dupes. The bare-refNumber terminal key preserves the D-05 kiosk/admin parity
contract (kiosk-core-parity test stays green). Additive WR-02 regression tests added to
the cash + moto frontend suites; `kiosk-core.min.js` regenerated via terser.

**File:** `js/kiosk-core.js:2774-2788, 3119-3169, 3182-3216`
**Issue:**
`standardSaleBody.idempotency_key` is the checkout-closure-stable `refNumber`
(`'KIOSK-' + Date.now()`, line 2735/2777). All three tender paths reuse the *same* body and
key. When a MOTO attempt reaches `/sale`, the server writes the moto result under that
idempotency key (pos.js:818-820). If the customer then aborts the HelcimPay iframe
(`onAbort` re-shows the tender panel, `cancelled` stays false) and staff pick **Cash**,
`_kioskGoCash` re-POSTs `/sale` with the *same* `idempotency_key` → the server returns a
`201` **replay of the cached moto response** (`moto:true`, no `cash:true`). `_kioskGoCash`'s
guard `result.status === 202 && result.data.cash` is then false, so staff get
"Failed to record the cash sale." and must abandon and start a brand-new sale. The same
stale-replay blocks moto→terminal and repeated-tender switches.

It fails *safe* (no double charge, no phantom booking), but it is a real functional defect
on a plausible shop-floor flow (customer's card declines in the iframe → pay cash instead).

**Fix:** Derive a fresh idempotency key per tender *attempt* (e.g. `refNumber + ':' + tender`
or append an attempt counter) so switching tenders after an abort issues a distinct
idempotency scope, while a genuine double-tap of the *same* tender still de-dupes.

### WR-03: postMessage origin allowlist disagrees with the new CSP (`myhelcim.com` vs `secure.myhelcim.com`)

**Resolution:** FIXED (commit 194cc0f3). The postMessage origin allowlist in
`kiosk-core.js` now accepts `https://secure.helcim.app` and `https://secure.myhelcim.com`
— the SAME origins the kiosk CSP frame-src/connect-src already list (kiosk.html:17
needed no change). The shared `js/modules/12-checkout.js` public-checkout source carries
the same bare-`myhelcim.com` inconsistency and is deliberately left untouched (out of
this phase's scope) as a documented follow-up. Live-staging verification of the actual
Helcim origin (Network + Console) is still required before any production force-push
(see IN-02).

**File:** `js/kiosk-core.js:239` and `kiosk.html:17`
**Issue:**
The postMessage handler accepts only `https://secure.helcim.app` and bare
`https://myhelcim.com` (kiosk-core.js:239, a verbatim port of 12-checkout.js). The new
kiosk CSP `frame-src`/`connect-src` instead lists `https://secure.myhelcim.com` (with the
`secure.` prefix) and does **not** list bare `myhelcim.com`. So for the non-primary Helcim
origin the two disagree in both directions: if Helcim ever serves the iframe from
`secure.myhelcim.com`, the origin check ignores its messages; if it posts from bare
`myhelcim.com`, the CSP blocks the frame. This mirrors a pre-existing inconsistency in
reservation.html (which works in prod because Helcim uses `secure.helcim.app`), so live
impact is latent rather than immediate — but it is exactly the "missing domain silently
breaks a feature" class flagged by CLAUDE.md rule 12 and the phase's own STAGING-VERIFY
note.

**Fix:** Align both the origin allowlist and the CSP to the origin(s) Helcim actually uses.
Confirm on live staging (Network + Console) which Helcim origin posts the SUCCESS message
and framing, then make kiosk-core.js:239 and kiosk.html:17 consistent (and consider fixing
the shared 12-checkout.js source at the same time).

## Info

### IN-01: `/confirm` does not re-validate `tender` against the allow-list

**Resolution:** SKIPPED (Info — out of `--fix` scope, which targets Critical + Warning).
Device-token gated and not a new exploit per the reviewer; deferred for a follow-up
consistency pass.

**File:** `zoho-middleware/routes/pos.js:1086-1133, 1521-1547`
**Issue:**
`/api/kiosk/sale` enforces the `terminal|cash|moto` allow-list (pos.js:317-320), but
`/api/kiosk/sale/confirm` reads `body.tender` and branches on `=== 'cash'` / `=== 'moto'`
without re-validating it. An unknown tender string at confirm silently falls through to the
default creditcard/terminal booking logic. This is device-token gated and not a new
exploit, but the two endpoints should apply the same allow-list for consistency and to keep
the tender-routing invariants explicit.
**Fix:** Apply the same `terminal|cash|moto` allow-list guard at the top of the confirm
handler (400 on unknown), so both endpoints share one validation.

### IN-02: kiosk.html CSP is static-analysis-derived and unverified on live staging

**Resolution:** SKIPPED (Info — out of `--fix` scope). This is a live-staging
verification task, not a code change. It remains an open pre-production action (Network
+ Console on a real kiosk, paying attention to whichever `*helcim*` origin the
iframe/postMessage actually use — see WR-03 follow-up).

**File:** `kiosk.html:17`
**Issue:**
The CSP domain set was authored by static analysis and is explicitly flagged
STAGING-VERIFY. Cross-checking the page's needs: script-src covers all loaded scripts
(self, `accounts.google.com`, `secure.helcim.app`); connect-src covers the Railway
middleware, Apps Script, Google APIs, GSI, and Helcim; img-src `'self' data:` covers the
product images (rendered `src="images/products/…"`, kiosk-core.js:1846) and the QR data
URIs — no remote image origin is needed. The kiosk loads no Sentry browser SDK, so the
Sentry ingest origin present on reservation.html is correctly omitted (client-error beacons
POST to the middleware, not Sentry directly). `script-src` correctly omits `'unsafe-inline'`
(a real hardening — kiosk.html has no inline scripts). No omission found in static review,
but the domain set still must be confirmed on a live staging kiosk (no CSP violations in
Console) before any production force-push, per the phase note and CLAUDE.md rule 12. See
also WR-03 for the `myhelcim.com` discrepancy.
**Fix:** Complete the planned live staging verification (Network + Console) before prod; pay
particular attention to whichever `*helcim*` origin the iframe/postMessage actually use.

---

_Reviewed: 2026-08-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
