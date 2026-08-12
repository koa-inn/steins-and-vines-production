# Phase 70: Kiosk Tender Types (Cash + Phone-Order MOTO) - Research

**Researched:** 2026-08-12
**Domain:** Zoho Books customerpayment booking + Helcim HelcimPay.js hosted-iframe payment integration, kiosk client (ES5 vanilla JS) + Express middleware money-path
**Confidence:** HIGH (all claims grounded in this codebase; Helcim MOTO/CNP semantics MEDIUM — official docs consulted but do not use the term "MOTO" for HelcimPay.js)

## Summary

Both tenders reuse existing, hardened infrastructure — no new npm packages, no new payment rails. **Cash** is a pure booking-path branch: skip `helcimLib.terminalPurchase()`, book `payment_mode: 'cash'` (confirmed valid for this Zoho org — see Q3), reuse every other primitive (idempotency lock, catalog price-anchoring, gift-card split-tender clamp, stock decrement, batch creation) untouched. **Phone-order card (MOTO via HelcimPay)** is the harder piece, but the codebase already contains a battle-tested, PCI-scoped hosted-iframe flow (`js/modules/12-checkout.js` + `zoho-middleware/routes/checkout.js`, Phase 49) that can be transplanted onto the kiosk almost mechanically: HelcimPay.js is a single `<script src="https://secure.helcim.app/helcim-pay/services/start.js">` tag that injects global `appendHelcimPayIframe(token)` / `removeHelcimPayIframe()` functions; the frontend listens for a `window.postMessage` from `https://secure.helcim.app` and extracts a `transactionId`; the server never sees the card.

The cleanest server composition (recommendation, not the only option — see Q2) is to **extend `processSaleWithPrices` (pos.js:626) with a third tender branch** that calls `helcimLib.initializeCheckout()` **in-process** (pos.js already `require`s `lib/helcim.js` — no HTTP hop through `routes/payments.js` is needed) instead of `terminalPurchase()`, and to **extend `runConfirm` (pos.js:1057)** with a new verification branch — parallel to the existing `isManualConfirm` branch — that calls `helcimLib.getCardTransactionById()` and asserts the captured amount covers `grandTotal` (mirroring `checkout.js`'s MONEY-01/H2 pattern exactly) before booking. This keeps ONE kiosk booking pipeline (`/api/kiosk/sale` → `/api/kiosk/sale/confirm`) for all three tenders (terminal, cash, MOTO) rather than forking a fourth endpoint, which is exactly what CONTEXT.md and the `kiosk-manual-card-entry-moto.md` todo both warn against.

The other major finding is that **the terminal-specific pending-charge/reconcile backstop (`lib/reconcile.js`, D-13) does NOT apply to MOTO** — it exists solely because a physical terminal can approve asynchronously via webhook up to 90+ seconds after the request; HelcimPay.js resolves synchronously within the browser tab via `postMessage`, exactly like the public checkout, which has no reconcile backstop either. MOTO only needs the synchronous void-on-failure path (`moneyPath.voidWithTimeout`), which the confirm path's catch block already provides for any `body.transaction_id`.

Finally: `kiosk.html` currently has **no CSP `<meta>` tag at all** (this is documented and intentional — `docs/TRACKING.md:50` calls it an "internal surface with no CSP"). Adding the HelcimPay.js iframe changes that calculus: it's now handling a real payment surface and should get a scoped CSP (kiosk.html has zero inline `<script>` tags, so `'unsafe-inline'` is not needed for script-src, unlike the public pages). This is a recommendation, not a locked decision — flagged as an open question for the planner/owner.

**Primary recommendation:** Extend the existing `/api/kiosk/sale` → `/api/kiosk/sale/confirm` pipeline with a `tender` field (`'terminal'` default / `'cash'` / `'moto'`) rather than building new endpoints; reuse `helcimLib.initializeCheckout` + `getCardTransactionById` in-process from `pos.js`; add a scoped CSP to `kiosk.html` alongside the HelcimPay.js script tag.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tender selection UI (cash / terminal / phone-card) | Browser (kiosk-core.js) | — | Client-side state, mirrors existing gift-card panel pattern (kiosk-core.js:3046-3225) |
| Change-due calculation | Browser (kiosk-core.js) | — | Explicitly client-only per CONTEXT.md — "NOT sent to the server" |
| Price anchoring / catalog lookup / discount / gift-card clamp | API/Backend (pos.js `processSale`/`processSaleWithPrices`) | — | Already server-authoritative; unchanged for all 3 tenders |
| Cash booking (`payment_mode:'cash'`) | API/Backend (pos.js `runConfirm`) | Database (Zoho Books) | No charge-capture risk; atomicity via existing idempotency lock |
| HelcimPay session init (`initializeCheckout`) | API/Backend (pos.js, in-process call to `lib/helcim.js`) | External (Helcim API) | Avoid an extra HTTP hop through `routes/payments.js`; same lib already required by pos.js |
| HelcimPay hosted iframe (PAN entry) | External (Helcim's `secure.helcim.app` origin, framed in Browser) | — | PCI SAQ-A boundary — PAN never reaches our DOM or server |
| Captured-amount verification before booking | API/Backend (pos.js `runConfirm`, via `getCardTransactionById`) | External (Helcim API) | Mirrors checkout.js MONEY-01/H2 — never book on trust |
| Stock decrement / batch creation / gift-card redemption | API/Backend (pos.js `runConfirm`, `lib/inventory-ledger.js`, `lib/brewpad-integration.js`) | Database (Zoho Books) | Unchanged — identical for all 3 tenders, this is the whole point of not forking the pipeline |
| Terminal-specific pending-charge/reconcile backstop | API/Backend (`lib/reconcile.js`) | — | Does NOT apply to cash or MOTO — terminal-webhook-specific (see Pitfalls) |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Build BOTH cash and MOTO tenders in this phase.
- MOTO uses the HelcimPay hosted iframe (Option B) — NOT a custom card form (Option C, PCI-rejected) — and the physical-terminal keypad-entry option (Option A) is a separate, code-free owner check, out of scope.
- Cash tender: new `tender: 'cash'` branch in the kiosk sale path, reusing `/api/kiosk/sale`'s price anchoring/pre-charge assertion/idempotency lock; skips `terminalPurchase`/poll; books `payment_mode: 'cash'`.
- Cash must be ATOMIC and IDEMPOTENT via the existing kiosk idempotency lock (no charge-capture risk, but partial-booking must still be guarded).
- Change-due is client-side UX only — NOT sent to the server, NOT a payment line; only the sale total is booked. Guard: tendered ≥ total before allowing completion.
- Cash + gift card (split tender): reuse the existing gift-card split-tender clamping (D-12); cash covers any post-gift-card remainder.
- Auth: cash and MOTO both use the same staff-present device-token tier as other kiosk money actions.
- MOTO: initialize a HelcimPay session for the cart total, render the iframe on the kiosk, staff keys the card into HELCIM'S iframe, server VERIFIES captured amount covers invoice total (±$0.01, reuse Phase 49 `getCardTransactionById` readback) BEFORE booking.
- MOTO pipeline must still run stock decrement, batch creation, kiosk invoice, gift-card split — only the payment leg differs. RESEARCH (this document) determines the cleanest wiring.
- Do NOT fork the kiosk booking logic; adopt the money-path primitives (idempotency lock, captured-amount verify, void-on-failure via `moneyPath.voidWithTimeout`, pending-charge/reconcile) rather than re-implementing them.
- PCI/security invariants (NON-NEGOTIABLE): PAN entered ONLY inside Helcim's hosted iframe; our code/middleware never sees, logs, or stores a card number; `kiosk.html` gets the HelcimPay.js script + CSP entries it needs (update CSP on all relevant public pages per CLAUDE.md rule 12); captured-amount verification before booking; client-supplied amounts never trusted.
- Card-not-present liability (chargebacks fall on the shop) is owner-accepted; consider recording the tender type on the Zoho payment for dispute traceability.
- Cash tender is its own track/wave(s), can ship first. MOTO is its own track after research, with a live-verify checkpoint (real hosted-iframe charge on the kiosk, refunded).

### Claude's Discretion
- Cash: exact change-due UI; how the cash tender button sits alongside the existing terminal/gift-card panel; the precise atomic booking mechanism (reuse confirm path with a synthetic non-terminal marker).
- MOTO: the exact endpoint composition (extend kiosk sale vs new MOTO endpoint) — this document's recommendation: extend, don't fork; the iframe mount point on the kiosk; how the HelcimPay session token is passed.

### Deferred Ideas (OUT OF SCOPE)
- MOTO Option A (terminal keypad entry) — owner side-check, zero code if it exists; not a dependency of this phase.
- Recording who-took-the-payment / a reference note — revisit only if a till-count audit needs it.
- Broader tender-type refactor (a unified tender abstraction) — only if cash + MOTO additions make the payment screen unwieldy.

## Project Constraints (from CLAUDE.md)

- Frontend is ES5 vanilla JS, concatenated by `npm run build` from `js/modules/` — never edit `js/main.js`/`js/main.min.js` directly; `kiosk-core.js`/`kiosk.js` are separately built (`js/kiosk-core.min.js`, `js/kiosk.min.js`) and must be rebuilt after any change.
- Middleware has its own `node_modules` — always `cd zoho-middleware` before running middleware commands/tests.
- Before every commit: `npm test` AND `cd zoho-middleware && npm test`, and `npm run lint`.
- Bug fixes: write a regression test FIRST.
- Rule 12 (CSP): every public HTML page has a CSP `<meta>` tag; adding/removing any third-party service requires updating the CSP on ALL public pages, or a domain is silently blocked. `kiosk.html` is documented as an internal-surface exception with NO CSP today (`docs/TRACKING.md:50`) — this phase's decision to add HelcimPay.js is a deliberate exception to that "no CSP" pattern, not a violation of rule 12 (there is no existing kiosk CSP to "keep in sync" — this is additive). See Open Questions.
- Never commit `.env` files or credentials.

## Standard Stack

### Core
No new libraries. This phase is 100% composition of existing, already-live infrastructure.

| Component | Version/Source | Purpose | Why Standard (already proven here) |
|-----------|-----------------|---------|--------------------------------------|
| `zoho-middleware/lib/helcim.js` | in-repo | `initializeCheckout`, `getCardTransactionById`, `voidTransaction` | Already used by `routes/payments.js` + `routes/checkout.js` (Phase 49, live in prod) |
| `zoho-middleware/lib/money-path.js` | in-repo | `acquireIdempotencyLock`, `voidWithTimeout`, `assertTxnNotReplayed` | Shared primitive extracted from checkout.js specifically so pos.js could reuse it (D-11, "pos.js is wired to this lib in plans 45-06/07/08") |
| HelcimPay.js (`https://secure.helcim.app/helcim-pay/services/start.js`) | external, Helcim-hosted | Renders the PCI-scoped hosted card-entry iframe | Already loaded on `reservation.html` (`reservation.html:306`), proven live (Phase 49, UAT-RUNSHEET §0) |
| Zoho Books `payment_mode` enum | Zoho Books API v3 | `cash` value for the cash tender | Official Zoho Books API doc confirms valid values: `check, cash, creditcard, banktransfer, bankremittance, autotransaction, others` [CITED: zoho.com/books/api/v3/customer-payments] |

### Supporting
None — no new supporting libraries needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `/api/kiosk/sale` + `/confirm` with a `tender` field | A dedicated `/api/kiosk/moto-sale` endpoint | Rejected by CONTEXT.md explicitly ("Do NOT fork the kiosk booking logic") — would duplicate price-anchoring, gift-card clamp, stock decrement, batch creation (~600 lines) a second time, exactly the anti-pattern the `kiosk-manual-card-entry-moto.md` todo warns against ("a MOTO path must adopt, not re-implement") |
| pos.js calling `helcimLib.initializeCheckout()` in-process | Kiosk client calling `POST /api/payment/initialize` directly (like the public site does) | Both work (see Q1/Q2 below) — in-process avoids a redundant HTTP round-trip and keeps the charge amount anchored to the SAME server-computed `grandTotal` that `/sale` already produced, instead of the client independently re-deriving/re-sending an amount to a second endpoint |

**Installation:** None — no `npm install` needed for this phase.

**Version verification:** N/A — no package.json changes.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new npm packages. It reuses in-repo modules (`lib/helcim.js`, `lib/money-path.js`) and a single external `<script src>` tag pointing at Helcim's own CDN (`secure.helcim.app`), which is not an npm dependency and is already loaded on `reservation.html` in production. No `npm view` / `pip` / `cargo` verification is applicable, and slopcheck was not run because there is nothing to check.

## Architecture Patterns

### System Architecture Diagram — MOTO tender flow (recommended composition)

```
Kiosk browser (kiosk-core.js)                Middleware (pos.js)                    Helcim
──────────────────────────────               ─────────────────────                  ──────
1. Staff taps "Phone Order Card" ──POST──►  /api/kiosk/sale
   {items, tender:'moto', ...}                 │
                                                 ├─ price-anchor from catalog cache (unchanged)
                                                 ├─ resolve discount (unchanged)
                                                 ├─ gift-card real-balance clamp (unchanged)
                                                 ├─ compute terminal_amount = grandTotal - gift_amount
                                                 │
                                                 ├─ tender==='moto' branch (NEW, parallel to the
                                                 │  existing `if (terminal_amount > 0)` block at
                                                 │  pos.js:758):
                                                 │     helcimLib.initializeCheckout(terminal_amount,'CAD')
                                                 │     ──────────────────────────────────────────► POST /helcim-pay/initialize
                                                 │     ◄────────────────────────────────────────── { checkoutToken, secretToken }
                                                 │
                              ◄──202───  { pending:false, moto:true, checkout_token, reference }
   │
2. appendHelcimPayIframe(checkout_token)
   (global fn injected by HelcimPay.js
    <script>, loaded once on kiosk.html)
   ──► renders Helcim's iframe in-page
                                                                                     ┌─────────────────────┐
3. Staff reads card details off the phone,   ◄─────── iframe framed from ──────────►│ secure.helcim.app    │
   types them INTO HELCIM'S IFRAME (never                                            │ (PAN captured here,  │
   our DOM/JS/server)                                                                │ never touches us)    │
                                                                                     └─────────────────────┘
4. window.addEventListener('message', ...)
   origin === 'https://secure.helcim.app'
   eventStatus === 'SUCCESS'
   → extractHelcimTransactionId(data)
   removeHelcimPayIframe()

5. POST /api/kiosk/sale/confirm ──────────► runConfirm(body)
   {items, transaction_id, tender:'moto',      │
    reference_number, idempotency_key, ...}    ├─ rebuild lineItems/discount/gift-card (unchanged)
                                                 ├─ tender==='moto' verification branch (NEW,
                                                 │  parallel to the existing `isManualConfirm`
                                                 │  branch at pos.js:1352):
                                                 │     helcimLib.getCardTransactionById(transaction_id)
                                                 │     ─────────────────────────────────────────► GET /card-transactions/{id}
                                                 │     ◄───────────────────────────────────────── { status, amount, ... }
                                                 │     assert captured amount >= grandTotal - $0.01
                                                 │     (mirrors checkout.js MONEY-01/H2 exactly)
                                                 │     on failure → throw tagged error → outer .catch
                                                 │     → moneyPath.voidWithTimeout (SAME void path
                                                 │       used for terminal-failure recovery today)
                                                 │
                                                 ├─ zohoPost('/invoices', ...) (unchanged)
                                                 ├─ zohoPost('/customerpayments', {payment_mode:
                                                 │     'creditcard', reference_number: transaction_id,
                                                 │     notes: 'Kiosk phone-order (card-not-present)
                                                 │     payment. Ref: ...'})  (payment_mode UNCHANGED
                                                 │     from the terminal path — see Q4)
                                                 ├─ ledger.decrementStock(...) (unchanged)
                                                 ├─ brewpadIntegration.createBatchesFromSale(...) (unchanged)
                              ◄──201───  { ok:true, invoice_id, invoice_number, ... }
6. kioskShowReceipt(...) (unchanged)
```

### Recommended Project Structure (files touched, no new files needed)
```
zoho-middleware/routes/pos.js        # tender branch in processSaleWithPrices() + runConfirm()
zoho-middleware/lib/helcim.js        # UNCHANGED — initializeCheckout/getCardTransactionById already exported
zoho-middleware/lib/money-path.js    # UNCHANGED — voidWithTimeout/acquireIdempotencyLock already exported
js/kiosk-core.js                     # tender-selection UI (~2840-3230, alongside the GC panel);
                                      # HelcimPay postMessage listener + extractHelcimTransactionId
                                      # (port from js/modules/12-checkout.js:59-68, 1803-1836)
kiosk.html                           # + <script src="https://secure.helcim.app/helcim-pay/services/start.js">
                                      # + new (or first) CSP <meta> — see Open Questions
```

### Pattern 1: Cash tender (server composition)
**What:** In `processSaleWithPrices` (pos.js:626), branch on `body.tender === 'cash'` immediately after `terminal_amount` is computed (pos.js:752). Skip the entire `if (terminal_amount > 0) { helcimLib.terminalPurchase(...) }` block (pos.js:758-810) and respond `{ pending: false, cash: true, reference: refNumber }` — mirroring the EXISTING gift-card-100%-coverage branch at pos.js:811-830 almost exactly (that branch already proves "skip Helcim, respond non-pending, let the client go straight to confirm" is a supported shape in this pipeline).

In `runConfirm` (pos.js:1057), when `body.tender === 'cash'`: skip `verifyManualCharge` entirely (no Helcim proof needed — the cash IS the proof, per CONTEXT.md) and book:
```js
// Mirrors pos.js:1383-1390 (terminal payment) but no reference_number = txnId
// (there is no Helcim txn); use the kiosk reference_number instead.
if (cashApplied > 0) {
  return zohoPost('/customerpayments', {
    payment_mode: 'cash',
    amount: cashApplied,
    date: today,
    reference_number: refNumber,
    invoices: [{ invoice_id: invoiceId, amount_applied: cashApplied }],
    notes: 'Kiosk cash payment. Ref: ' + refNumber
  });
}
```
Everything downstream (`ledger.decrementStock`, `brewpadIntegration.createBatchesFromSale`, the confirm idempotency cache write, the pending-charge cleanup) is untouched — cash never writes a `KIOSK_PENDING_CHARGE_PREFIX` record in the first place (it's only written inside the `terminal_amount > 0` branch, pos.js:781-789), so there is nothing to reconcile.

**When to use:** Any kiosk sale where staff physically receive cash. Gift-card + cash split: `cashApplied = grandTotal - gcApplied` (same `terminalApplied` formula pos.js:1319 already uses, just renamed/routed to a cash payment_mode instead of creditcard).

### Pattern 2: MOTO server composition (recommended)
**What:** See the System Architecture Diagram above. Two insertion points in `pos.js`:
1. `processSaleWithPrices` (pos.js:626), parallel to the `terminal_amount > 0` branch (pos.js:758): when `body.tender === 'moto'`, call `helcimLib.initializeCheckout(terminal_amount, 'CAD')` in-process instead of `terminalPurchase`, and respond with `{ pending: false, moto: true, checkout_token, secret_token, reference: refNumber }`. No `KIOSK_PENDING_CHARGE_PREFIX` write (there is nothing async/webhook-driven to reconcile — see Pitfall 3).
2. `runConfirm` (pos.js:1057), parallel to the `isManualConfirm` branch (pos.js:1352-1364): when `body.tender === 'moto'`, REQUIRE `body.transaction_id` (the Helcim txn id extracted client-side from the HelcimPay `postMessage`) and run a captured-amount verify:
```js
// New branch, sibling to `verifyManualCharge` (pos.js:1353), same tagged-error idiom
// so it flows through the EXISTING outer .catch's void-on-failure block (pos.js:1587-1668).
var verifyMotoCharge = (body.tender === 'moto')
  ? helcimLib.getCardTransactionById(body.transaction_id).then(function (txn) {
      var captured = parseFloat(txn && txn.amount);
      var TOL = 0.01;
      if (!isFinite(captured) || captured <= 0 || captured < terminalApplied - TOL) {
        var mErr = new Error('MOTO captured amount could not be verified against the recorded total');
        mErr.__motoVerifyFailed = true;
        throw mErr;
      }
    })
  : Promise.resolve();
```
This is a direct port of `checkout.js:613-634` (MONEY-01/H2) — same tolerance constant, same "throw a tagged error so the existing void-on-failure catch block handles it" idiom already used for `__manualVerify` and `__taxUnresolved` in this exact function.

**When to use:** Phone-order / customer-not-present card sales, staff-facilitated, card keyed into Helcim's own iframe.

### Anti-Patterns to Avoid
- **A new `/api/kiosk/moto-sale` endpoint that duplicates price/discount/gift-card/stock/batch logic:** explicitly forbidden by CONTEXT.md and the source todo — this is the exact "two-tier money path maturity" mistake Phase 50 was built to close (`kiosk-manual-card-entry-moto.md`: "checkout.js is the gold standard and the kiosk re-implemented the same flow without its guards... adding a fourth payment path before Phase 50 lands would repeat that mistake by hand").
- **Trusting `body.transaction_id` for MOTO without a captured-amount verify:** the existing `isManualConfirm` logic (pos.js:1352) trusts a real `transaction_id` WITHOUT re-verification when it is not `'manual-confirm'` — but that trust is earned because the terminal path's `transaction_id` was already fetched from Helcim's own `pollTerminalResult` API (server-authoritative), never supplied raw by the client. A HelcimPay `transaction_id` arrives via client-side `postMessage` — it is the client's word, not yet server-verified — so it MUST go through the same captured-amount check `checkout.js` already does for the public site's identical postMessage-sourced token. Do not conflate the two trust models.
- **Building a card-number form anywhere in kiosk-core.js/kiosk.html:** REJECTED (Option C) by CONTEXT.md and the todo — would drag the kiosk into PCI SAQ A-EP scope.
- **Writing a `KIOSK_PENDING_CHARGE_PREFIX` record for MOTO:** unnecessary — that mechanism exists solely for the terminal's async webhook-approval race (see Pitfall 3). Copying it for MOTO adds complexity with no failure mode it protects against (HelcimPay resolves synchronously in the same request/response cycle the confirm call is part of).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card-not-present payment capture | A card-number input field | HelcimPay.js hosted iframe (`appendHelcimPayIframe`) | PAN never touches our code — PCI SAQ-A boundary (explicitly non-negotiable per CONTEXT.md) |
| Captured-amount verification | A "trust the client-supplied amount" shortcut | `helcimLib.getCardTransactionById()` + the exact tolerance/compare pattern in `checkout.js:613-634` | This is literally the money-path lesson the whole `checkout.js` vs `pos.js` divergence audit (Phase 45/49/50) was built to prevent |
| Void-on-failure after a MOTO charge that can't be booked | A bespoke `helcimLib.voidTransaction()` call | `moneyPath.voidWithTimeout()` | Audit findings H5/L18 explicitly forbid raw `voidTransaction` calls outside this primitive — it's already wired into `runConfirm`'s catch block (pos.js:1651) and needs zero new code to cover a MOTO `transaction_id` |
| Idempotent double-tap protection | A new lock scheme for MOTO | The existing `moneyPath.acquireIdempotencyLock` calls already wrapping `/api/kiosk/sale` (pos.js:336) and `/api/kiosk/sale/confirm` (pos.js:1035) | Tender-agnostic — works identically for cash/terminal/MOTO since it locks on `idempotency_key`, not on payment method |

**Key insight:** Every money-path primitive this phase needs (idempotency, captured-amount verify, void-with-timeout) already exists and is already imported into `pos.js` (`var moneyPath = require('../lib/money-path');`, pos.js:15). This phase is pure composition, not new infrastructure.

## Common Pitfalls

### Pitfall 1: Booking the invoice/payment before verifying the MOTO capture (phantom revenue)
**What goes wrong:** An invoice + customerpayment get created against a HelcimPay charge that was never actually captured (or captured for less than the invoice total) — the exact class of bug MONEY-01/H2 was built to close in `checkout.js`.
**Why it happens:** The `isManualConfirm` branch in `runConfirm` (pos.js:1352) is easy to misread as "any real `transaction_id` is trusted" and copy that shortcut for MOTO — but as explained in Anti-Patterns above, that trust is earned by the terminal path's server-side poll, not present for a client-supplied HelcimPay token.
**How to avoid:** Always run the captured-amount verify (Pattern 2) for `tender === 'moto'`, unconditionally, even when `transaction_id` "looks real."
**Warning signs:** A MOTO sale books successfully with `needs_manual_review` never set and no corresponding Helcim transaction in the merchant dashboard for that amount.

### Pitfall 2: CSP breakage on kiosk.html
**What goes wrong:** Adding a CSP `<meta>` tag to a page that has never had one is high-risk — it can silently block existing kiosk functionality (Google Sign-In `accounts.google.com`, the middleware `svmiddleware-production.up.railway.app`, `script.google.com` Apps Script calls used by `admin-config.js`/gift-card lookups, Google Fonts) the same way a missing domain silently killed Meta pixel tracking sitewide until 2026-07-22 (CLAUDE.md rule 12's own cautionary example).
**Why it happens:** kiosk.html currently has zero CSP restrictions — every network call "just works." The moment a CSP is added, ANY domain not explicitly allow-listed breaks silently (no console warning visible to staff during a live sale).
**How to avoid:** Build the CSP from an explicit inventory of every external domain kiosk.html actually contacts (this research found: `accounts.google.com` for GSI, `svmiddleware-production.up.railway.app` for the middleware, `script.google.com` for Apps Script calls, `fonts.googleapis.com`/`fonts.gstatic.com` for fonts — see grep evidence in Sources) PLUS `secure.helcim.app`/`secure.myhelcim.com` for HelcimPay (script-src, connect-src, frame-src) — then verify via a real browser session on staging (Network tab, watch for CSP violation console errors) before shipping. `kiosk.html` has NO inline `<script>` tags today, so `script-src` does not need `'unsafe-inline'` (unlike `reservation.html`/`index.html`, which need it for their GTM inline snippets) — a real, if minor, security improvement opportunity if a CSP is added.
**Warning signs:** Kiosk sign-in, product catalog refresh, or gift-card lookup silently fails in production immediately after this ships, with no obvious code-level cause (classic CSP-block symptom).

### Pitfall 3: Assuming the terminal's pending-charge/reconcile backstop covers MOTO
**What goes wrong:** Believing `lib/reconcile.js` (D-13) needs to be extended for MOTO, or — the opposite and more dangerous mistake — believing a MOTO charge has NO orphan-recovery path at all and skipping the void-on-failure wiring.
**Why it happens:** `reconcile.js`'s doc comment (lib/reconcile.js:1-36) is specific to the terminal's async webhook-approval race (a Smart Terminal charge can approve up to 90+ seconds after the poll timeout, arriving via webhook after the client has given up). HelcimPay.js has no equivalent async webhook path for a kiosk-initiated hosted-iframe charge — the `transactionId` only exists client-side, delivered synchronously via `postMessage`, in the SAME browser tab that immediately calls `/confirm`. There is no "late webhook approval" scenario to reconcile.
**How to avoid:** Do NOT write a `KIOSK_PENDING_CHARGE_PREFIX` record for MOTO (Pattern 2 already omits this). DO rely on `moneyPath.voidWithTimeout` in `runConfirm`'s existing catch block (pos.js:1651) — it already fires for ANY `body.transaction_id` present when the invoice/payment step fails, MOTO included, with zero additional code.
**Warning signs:** N/A if Pattern 2 is followed correctly — this is a design-time pitfall, not a runtime one.

### Pitfall 4: Double-booking a cash sale on a double-tap (no charge to make idempotency "obviously" necessary)
**What goes wrong:** Staff double-tap "Confirm" (network lag, distracted customer) → two Zoho invoices + two cash customerpayments for the same sale, with no card charge to "catch" the duplicate (unlike terminal/MOTO, where a stuck idempotency key at least corresponds to a single real charge).
**Why it happens:** It's tempting to think "cash has no charge-capture risk, so idempotency matters less" — CONTEXT.md explicitly warns against this ("a double-tap can't double-book an invoice/payment... a partial-booking must be handled with the same care as the card path").
**How to avoid:** Cash MUST flow through the exact same `idempotency_key` / `acquireIdempotencyLock` gates as every other tender (pos.js:336 for `/sale`, pos.js:1035 for `/confirm`) — no special-casing to skip the lock for cash.
**Warning signs:** Duplicate Zoho invoices with identical line items + `payment_mode: 'cash'` seconds apart.

### Pitfall 5: Recomputing prices between `/sale` and `/confirm` diverging for a gift-card + cash split
**What goes wrong:** `runConfirm` independently re-resolves discount/tax/gift-card-balance from the catalog cache (pos.js:1109-1194, 1245-1317) rather than trusting the amounts computed at `/sale` time — this is EXISTING, intentional behavior (comment at pos.js:1248: "server-authoritative re-clamp... prices may differ from sale quote"), but it means the cash-remainder amount must be recomputed the same way (`cashApplied = grandTotal - gcApplied`, mirroring `terminalApplied` at pos.js:1319), not carried over from the `/sale` response.
**Why it happens:** Copy-pasting the `/sale`-time `terminal_amount` into the confirm body instead of recomputing.
**How to avoid:** Compute `cashApplied`/MOTO's verify-target the same way `terminalApplied` is already computed in `runConfirm` — from the re-resolved `grandTotal` and `gcApplied`, not from a value cached client-side.

## Code Examples

### HelcimPay.js frontend integration (existing, to be ported to kiosk-core.js)
```js
// Source: js/modules/12-checkout.js:59-68 — extracts the txn id from Helcim's postMessage payload
function extractHelcimTransactionId(postMessageData) {
  var em = postMessageData && postMessageData.eventMessage;
  if (typeof em === 'string') { try { em = JSON.parse(em); } catch (e) { return ''; } }
  // Helcim wraps the response: { data: { hash, data: { transactionId, ... } }, status: 200 }
  var inner = em && em.data && em.data.data;
  if (inner && inner.transactionId) return String(inner.transactionId);
  var flat = em && em.data;
  return (flat && flat.transactionId) ? String(flat.transactionId) : '';
}

// Source: js/modules/12-checkout.js:1806-1836 — postMessage listener (origin-validated)
window.addEventListener('message', function (event) {
  // H4: Validate postMessage origin — only accept from Helcim payment iframe
  if (event.origin !== 'https://secure.helcim.app' && event.origin !== 'https://myhelcim.com') return;
  var data = event.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
  var nameMatches = _helcimCheckoutToken && data.eventName === 'helcim-pay-js-' + _helcimCheckoutToken;
  if (!nameMatches) return;
  if (data.eventStatus === 'SUCCESS') {
    var txnId = extractHelcimTransactionId(data);
    if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe();
    // → proceed to POST /api/kiosk/sale/confirm with { transaction_id: txnId, tender: 'moto' }
  } else if (data.eventStatus === 'ABORTED') {
    // → staff cancelled inside the iframe; return to tender selection
  }
});
```

### Server-side captured-amount verify (existing pattern to mirror for MOTO)
```js
// Source: zoho-middleware/routes/checkout.js:613-634 (MONEY-01/H2) — the pattern
// Pattern 2 above ports into pos.js runConfirm for tender==='moto'.
if (transactionId && depositAmount > 0) {
  var CAPTURED_AMOUNT_TOLERANCE = 0.01;
  var captured;
  try {
    var capturedTxn = await helcimLib.getCardTransactionById(transactionId);
    captured = parseFloat(capturedTxn && capturedTxn.amount);
  } catch (captureReadErr) {
    captured = NaN;
  }
  if (!isFinite(captured) || captured <= 0 || captured < depositAmount - CAPTURED_AMOUNT_TOLERANCE) {
    var mismatchErr = new Error('Captured amount could not be verified against the recorded total');
    mismatchErr.isCapturedAmountMismatch = true;
    throw mismatchErr; // caught by the existing void-on-failure block
  }
}
```

### Existing gift-card-only skip-terminal branch (the shape cash/MOTO's "skip terminal" response mirrors)
```js
// Source: zoho-middleware/routes/pos.js:811-830
} else {
  // Gift card covers 100% — skip terminal entirely.
  var gcOnlyResponseBody = { pending: false, gift_card_only: true, reference: refNumber };
  // ... cache write, then res.status(202).json(gcOnlyResponseBody)
}
```

### Existing terminal customerpayment booking (the shape cash's booking call mirrors)
```js
// Source: zoho-middleware/routes/pos.js:1382-1390
if (terminalApplied > 0) {
  return zohoPost('/customerpayments', {
    payment_mode: 'creditcard',
    amount: terminalApplied,
    date: today,
    reference_number: txnId,
    invoices: [{ invoice_id: invoiceId, amount_applied: terminalApplied }],
    notes: 'Kiosk POS terminal payment. Ref: ' + refNumber
  });
}
```

## State of the Art

Not applicable in the "library has a newer major version" sense — this is a pure internal-composition phase. The one relevant "current vs legacy" distinction found in-repo:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Legacy `/api/pos/sale` recording ANY terminal charge as `payment_mode: 'cash'` regardless of actual tender (a documented bug, `docs/assessments/code-review-2026-03-09.md` finding #6) | `/api/kiosk/sale/confirm` detects card type and books `creditcard`/`debitcard` correctly | Route quarantined/410'd 2026-07-03 (pos.js:1713-1726) | Confirms `payment_mode: 'cash'` was already accepted by this Zoho org's API in production (it ran without a Zoho rejection) — corroborates Q3's finding, though the review flagged it as a MISLABELING bug (charging a card but recording cash), not an invalid-value bug. This phase's use of `'cash'` is the CORRECT use of that same value for an ACTUAL cash sale. |

**Deprecated/outdated:** N/A.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The CSP domain list proposed in Pitfall 2 (accounts.google.com, svmiddleware-production.up.railway.app, script.google.com, fonts.googleapis.com/fonts.gstatic.com, secure.helcim.app/secure.myhelcim.com) is COMPLETE for kiosk.html's actual runtime network calls | Common Pitfalls (Pitfall 2) | Was derived via static `grep` of source files, not a live browser network trace. A dynamically-constructed URL or a domain contacted only from a rarely-hit kiosk code path (e.g. an admin-embedded-kiosk fallback) could be missed, silently breaking that feature in production exactly like the Meta-pixel CSP incident CLAUDE.md warns about. |
| A2 | Adding a CSP to kiosk.html is the right call (vs. leaving it CSP-free and relying on the fact that HelcimPay.js will render fine either way) | Summary, User Constraints, Pitfall 2 | If the planner/owner decides kiosk.html should stay CSP-free (it is an internal-only, PIN/device-token-gated surface, not indexed or public-facing the way `docs/TRACKING.md` implies), this recommendation is unnecessary extra scope. The functional MOTO flow works identically with or without a CSP — CSP here is defense-in-depth, not a functional requirement. |
| A3 | `payment_mode: 'creditcard'` (unchanged from the terminal path) plus a distinguishing `notes` string is the right way to record MOTO tender type for dispute traceability, rather than Zoho supporting some other distinct mode | Q4, Pattern 2, Code Examples | Zoho Books' official `payment_mode` enum (cash, creditcard, banktransfer, bankremittance, check, autotransaction, others) [CITED] has no CNP/MOTO-specific value — `creditcard` + notes is the only available option without inventing an unsupported enum value. Low risk: this mirrors the EXISTING pattern for terminal payments (pos.js:1389's `notes` field), so it is consistent with prior art, not a novel choice. |
| A4 | The public-facing WebSearch/WebFetch summary of Helcim's `HelcimPayInitializeRequest` schema (paymentType/amount/currency/customerCode/invoiceNumber/paymentMethod/etc.) is complete and current | Q4 (HelcimPay MOTO/CNP support) | If Helcim has since added a CNP-specific parameter not surfaced by the fetched docs, this phase would be missing an opportunity to flag the transaction more explicitly on Helcim's side (cosmetic risk only — `checkout.js`'s existing `paymentType: 'purchase'` call already works without one, so functionality is not at risk, only Helcim-side reporting/categorization). |

## Open Questions

1. **Should `kiosk.html` get a CSP `<meta>` tag as part of this phase, or stay CSP-free?**
   - What we know: `docs/TRACKING.md:50` documents the current no-CSP state as intentional for internal surfaces (`admin.html`, `kiosk.html`, `brewpad.html`, `batch.html`). CONTEXT.md's MOTO decision explicitly says "`kiosk.html` gets the HelcimPay.js script + the CSP entries it needs" — implying SOME CSP change is expected, but doesn't resolve whether that means "add a first CSP" vs. "no CSP needed because there isn't one to update."
   - What's unclear: whether the owner considers this internal/staff-only surface to warrant the same public-page CSP discipline now that it handles a real payment iframe (PCI defense-in-depth argument) or whether the "internal surface, no CSP" exception should simply continue.
   - Recommendation: add a scoped CSP (see Pitfall 2's domain list) as defense-in-depth — the incremental cost is low (kiosk.html has zero inline scripts, so it's a comparatively clean page to CSP-scope) and it directly serves the PCI "PAN never touches our DOM" invariant this phase is built around. Verify against a live staging kiosk session (Network + Console tabs) before shipping — do not trust static analysis alone (see Assumption A1).

2. **Confirm with the owner: is Helcim MOTO enablement actually needed for THIS build?**
   - What we know: Helcim's own terminology distinguishes true "MOTO" (staff manually keys a card into a Virtual Terminal or a Smart Terminal's manual-entry mode) from HelcimPay.js/online checkout (customer- or staff-facilitated entry into a hosted iframe, which Helcim's docs treat as an ordinary "online checkout" `purchase` transaction, not a flagged MOTO transaction type) — this phase builds the LATTER (Option B from the todo), reusing the exact same `paymentType: 'purchase'` call the public website already makes successfully in production.
   - What's unclear: whether Helcim's backend risk/interchange systems classify a staff-facilitated HelcimPay.js charge (where the cardholder is not present in-session, unlike the public checkout) any differently for fraud-risk or interchange purposes — official docs found via WebFetch did not address this distinction.
   - Recommendation: this phase's build does not need any account setting change to function technically (the API call is identical to the already-live public checkout path). The `kiosk-manual-card-entry-moto.md` todo's "Business facts to confirm with Helcim" list (different interchange, liability shift) remains a valid owner-facing conversation for cost/liability awareness, but it does NOT block or change this phase's implementation.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `HELCIM_API_TOKEN` | `helcimLib.isEnabled()` — gates both terminal AND HelcimPay/MOTO calls | ✓ (already required in prod per `validateEnv.js:21`) | — | none — MOTO/checkout already depend on this today |
| `HELCIM_DEVICE_CODE` | Terminal tender only (`isTerminalEnabled()`) | ✓ (already configured for the existing terminal flow) | — | Cash and MOTO do NOT depend on this — only the pre-existing terminal tender does; `/api/kiosk/sale` currently 503s at the top (pos.js:313) if the terminal isn't enabled, which would need to be relaxed to allow cash/MOTO-only sales when no terminal is configured (see planner note below) |
| `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` | Gift-card split-tender leg (cash+GC or MOTO+GC) | ✓ (already required, `validateEnv.js:69`) | — | none — unchanged from existing gift-card behavior |
| HelcimPay.js CDN script (`secure.helcim.app/helcim-pay/services/start.js`) | MOTO iframe rendering | ✓ (already loaded successfully on `reservation.html` in prod) | — | none |

**Missing dependencies with no fallback:** None identified for cash/MOTO themselves.

**Planner note (not a missing dependency, a code-path gate to check):** `router.post('/api/kiosk/sale', ...)` currently returns `503` immediately if `!helcimLib.isTerminalEnabled()` (pos.js:313-315) — BEFORE any tender branching. If cash or MOTO should be usable in an environment where the physical terminal is deliberately disabled (e.g. a test/staging kiosk with no terminal hardware), this top-of-function guard needs to become tender-aware (only require `isTerminalEnabled()` when `tender` is the default/terminal case). Flag for the plan.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | Existing kiosk device-token / staff-session 3-tier guard (`lib/authTiers.js`) — unchanged; `/api/kiosk/sale` and `/api/kiosk/sale/confirm` are already in `KIOSK_ROUTES` (authTiers.js), so no auth-tier change is needed for the recommended in-process `initializeCheckout` composition (Pattern 2) |
| V4 Access Control | yes | Cash/MOTO tender selection gated behind the same staff-present device-token tier as the existing terminal tender (per CONTEXT.md) — no new route to add to `KIOSK_ROUTES` if Pattern 2's in-process composition is used (no separate client call to `/api/payment/initialize` needed) |
| V5 Input Validation | yes | `tender` field must be validated against an explicit enum (`'terminal'`/`'cash'`/`'moto'`, default `'terminal'`) server-side — never trust a client-supplied string without allow-listing, mirroring the existing `gift_cert`/`custom` line-item validation pattern already in `pos.js` |
| V6 Cryptography | n/a | No new cryptographic operations — Helcim's HMAC webhook verification (`verifyWebhookSignature`) is unrelated to the HelcimPay.js synchronous flow this phase uses |
| V9 Communications | yes | HelcimPay.js iframe MUST be served over HTTPS from `secure.helcim.app` (already true — Helcim's own CDN); `postMessage` origin validation (`event.origin === 'https://secure.helcim.app'`) is mandatory and already proven correct in `12-checkout.js:1808` |
| V11 Business Logic | yes | Captured-amount verification (Pattern 2) is the core business-logic control preventing phantom revenue — this is the single most important control in this entire phase |
| V12 Files/PCI | yes | PAN never enters our DOM, JS, or server logs — enforced structurally by using Helcim's iframe (SAQ-A scope), not procedurally; NEVER log the raw `postMessage` event data verbatim in a way that could capture tokenized/partial card data — mirror `12-checkout.js`'s extraction pattern which only ever reads `transactionId`, never card fields |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Phantom revenue (book invoice/payment on an unverified or under-captured MOTO charge) | Repudiation / Integrity | `getCardTransactionById` captured-amount verify before booking (Pattern 2) — mirrors `checkout.js` MONEY-01/H2 |
| Double-booking on a double-tap (all 3 tenders) | Integrity | `moneyPath.acquireIdempotencyLock` — already wraps both `/sale` and `/confirm` |
| Orphaned charge (MOTO card charged, Zoho booking fails) | Integrity / Availability | `moneyPath.voidWithTimeout` — already wired into `runConfirm`'s catch block for any `body.transaction_id` |
| postMessage spoofing (a malicious page/extension injects a fake `SUCCESS` event) | Spoofing | Origin check (`event.origin === 'https://secure.helcim.app'`) — already proven in `12-checkout.js`, must be ported unchanged to kiosk-core.js |
| CSP-domain-omission silently breaking a kiosk feature (if a CSP is added per Open Question 1) | Availability | Explicit domain inventory (Pitfall 2) + live staging verification before rollout, exactly the process failure that caused the documented Meta-pixel CSP incident |
| Tender-field tampering (client claims `tender:'cash'` to skip a card charge, or claims `tender:'moto'` with a stale/foreign `transaction_id` to get a free item) | Tampering | Cash never claims a charge happened (no verify needed — it's a manual staff action, same trust model as staff physically taking cash today); MOTO's captured-amount verify (Pattern 2) inherently defeats a replayed/foreign `transaction_id` unless it happens to belong to a transaction ALSO captured for ≥ the current grandTotal — combine with `moneyPath.assertTxnNotReplayed`-style dedup if reusing a previously-used real Helcim txn id becomes a concern (not currently wired into `runConfirm` for the terminal path either — parity, not a new gap) |

## Sources

### Primary (HIGH confidence — this codebase)
- `zoho-middleware/routes/pos.js` (3597 lines) — full trace of `/api/kiosk/sale` (line 312), `processSale`/`processSaleWithPrices` (406/626), `/api/kiosk/sale/status` (840), `/api/kiosk/sale/confirm` (1008), `runConfirm` (1057-1669), customerpayment booking sites (1383, 1397, 1828, 2253), gift-card split-tender clamp (677-832, 1243-1342), idempotency lock usage (336, 1035), pending-charge write/cleanup (781-789, 1567-1577)
- `zoho-middleware/routes/checkout.js` — hardened HelcimPay verify path, MONEY-01/H2 captured-amount check (604-642), void-on-failure (764-882), `rejectWithVoid`
- `zoho-middleware/routes/payments.js` — `POST /api/payment/initialize` thin wrapper over `helcimLib.initializeCheckout`
- `zoho-middleware/lib/helcim.js` — `initializeCheckout` (111-129), `getCardTransactionById` (304-325), `voidTransaction` (144-157), `terminalPurchase`/`pollTerminalResult` (200-292)
- `zoho-middleware/lib/money-path.js` (full file, 267 lines) — `acquireIdempotencyLock`, `assertTxnNotReplayed`, `markTxnUsed`, `rejectWithVoid`, `voidWithTimeout`
- `zoho-middleware/lib/reconcile.js` (full file, 468 lines) — confirmed terminal-webhook-specific, does not apply to MOTO
- `zoho-middleware/server.js` — 3-tier auth guard (255-342), `KEYLESS_POSTS` including `/payment/initialize` (281), `requireAllowedReferer` (86-106), CORS allowlist (60-77)
- `zoho-middleware/lib/authTiers.js` — `KIOSK_ROUTES` allowlist confirming `/api/kiosk/sale`, `/api/kiosk/sale/confirm` are already device-token-accessible; `/api/payment/initialize` is NOT in this list but doesn't need to be (it's keyless)
- `js/modules/12-checkout.js` — `extractHelcimTransactionId` (59-68), postMessage listener (1806-1836), `appendHelcimPayIframe`/`removeHelcimPayIframe` usage (2000, 2080, 1820)
- `js/kiosk-core.js` — payment/tender panel (2570-3230), gift-card panel injection pattern (3046-3225), `_kioskPushToTerminal` (2844-3035), `_kcMergeAuth` (101-115)
- `reservation.html` — CSP `<meta>` (line 19) and HelcimPay.js `<script>` tag (line 306) proving the exact domains needed: `secure.helcim.app`, `secure.myhelcim.com`, `api.helcim.com`
- `kiosk.html` — confirmed no CSP `<meta>` tag exists; confirmed no inline `<script>` tags
- `docs/TRACKING.md:50` — documents kiosk.html's no-CSP state as intentional
- `docs/assessments/code-review-2026-03-09.md` (finding #6, lines 109-119) — confirms `payment_mode: 'cash'` was already sent to Zoho's API in production (as a mislabeling bug for card charges, not a rejected-value error), corroborating `'cash'` validity for this org
- `zoho-middleware/__tests__/pos-gift-card.test.js`, `pos-money-defects.test.js` — existing `payment_mode` assertions (`'creditcard'`, `'others'`)
- `.planning/phases/70-.../70-CONTEXT.md`, `.planning/todos/pending/kiosk-cash-tender.md`, `.planning/todos/pending/kiosk-manual-card-entry-moto.md`

### Secondary (MEDIUM confidence — verified via WebSearch/WebFetch against official Helcim docs)
- [Zoho Books Customer Payments API](https://www.zoho.com/books/api/v3/customer-payments/) — `payment_mode` enum confirmed: `check, cash, creditcard, banktransfer, bankremittance, autotransaction, others` [CITED]
- [HelcimPay.js Initialize Endpoint](https://devdocs.helcim.com/docs/initialize-helcimpayjs) and [full reference](https://devdocs.helcim.com/v2.2/reference/checkout-init) — confirmed `paymentType` values are `purchase`/`preauth`/`verify` only; no MOTO/CNP-specific parameter exists [CITED]
- [HelcimPay.js Payment Types and Methods](https://devdocs.helcim.com/docs/available-payment-types-and-methods-through-helcimpayjs) — confirms `cc`/`ach`/`cc-ach` payment methods, no card-present/not-present distinction surfaced at the API level [CITED]
- [Helcim: What are MOTO transactions?](https://www.helcim.com/guides/what-are-moto-transactions/) — clarifies Helcim's own product terminology: true "MOTO" = merchant keys card into a Virtual Terminal or Smart Terminal manual-entry mode; HelcimPay.js/online checkout is a separate category, functionally card-not-present but not flagged as "MOTO" in Helcim's own docs; confirms liability/interchange characteristics apply to CNP transactions generally [CITED]

### Tertiary (LOW confidence)
- None used as load-bearing claims — all Helcim-specific findings above were cross-checked against official `devdocs.helcim.com`/`helcim.com` pages, not community sources.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse strategy: HIGH — every primitive cited by exact file/line, already live in production for the analogous public-checkout flow.
- Architecture (server composition, insertion points): HIGH — both insertion points (processSaleWithPrices tender branch, runConfirm verify branch) are directly parallel to existing, tested branches in the same functions.
- Pitfalls: HIGH for money-path pitfalls (grounded in existing code + comments explaining prior incidents); MEDIUM for the CSP domain inventory (static analysis only, flagged as Assumption A1 — needs live verification).
- Helcim MOTO/CNP terminology: MEDIUM — official docs consulted directly, but Helcim's docs don't use the word "MOTO" for HelcimPay.js at all, so the mapping from CONTEXT.md's colloquial "MOTO" to Helcim's actual product taxonomy required interpretation (flagged in Open Question 2).

**Research date:** 2026-08-12
**Valid until:** 30 days (stable internal composition; re-verify Helcim API docs if this phase's implementation slips past ~2026-09-12)
