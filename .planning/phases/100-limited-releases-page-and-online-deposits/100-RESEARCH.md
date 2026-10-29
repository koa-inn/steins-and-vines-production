# Phase 100: Limited Releases page and online deposits - Research

**Researched:** 2026-10-29
**Domain:** Zoho Books advance payments on sales orders, Helcim server-side verification, Express money path, vanilla-ES5 static page
**Confidence:** MEDIUM overall. HIGH on codebase facts (read directly). MEDIUM on Zoho API shapes. LOW on what Zoho does with a `salesorders_to_apply` advance. That behaviour is undocumented, and a live spike must settle it before the money-path plans are final.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Locked by owner before the discussion (handoff §0, restated, not re-asked)**
- Ten kits: LE26 + RQ27 (not VineCo Passport). One page for both collections.
- $50 per kit, non-refundable, **no cap**. Keep a per-item cap easy to add in `zoho-middleware/lib/limited-releases.js`, which holds the ten-item_id allowlist and `DEPOSIT_PER_KIT = 50`. The server never reads the frontend JSON.
- Launch everything together. The nav link and sitemap entry are held back on production until launch day (beer page hold-back commit `6e05a60d` is the pattern).
- The server flow follows handoff §4: validate the allowlist (qty 1-10 per line, total >= 1), take the `moneyPath.acquireIdempotencyLock` on the Helcim `transaction_id`, verify the Helcim amount equals the server-computed deposit to the cent (otherwise void + 400), void on any failure after capture with the `sendVoidFailureAlert` fallback, never call `createBatchesFromSale`, and keep PII out of logs.
- First step: commit the supplier images and the content JSON **unchanged** as their own commit.

**Deposit booking in Zoho and brew day**
- **D-01: Book the deposit as an unapplied advance.** Record the customer payment with `salesorders_to_apply`, as handoff §4.6 says. This is a **deliberate, documented exception** to the codebase rule "NEVER salesorders_to_apply" (`lib/money-path.js:357-366` and the Phase 71 tests). The existing ban tests must keep passing for checkout, collect and kiosk SO-pay. Put the deposit booking in its own clearly named helper with its own test, explaining why an advance is correct here (the deposit is a liability until the kit is invoiced). Don't loosen the existing guards.
- **D-02: The kiosk applies the advance automatically on brew day.** When staff take payment on a limited-release SO through the kiosk SO-pay path (`routes/pos.js` `/api/kiosk/salesorder-pay` -> `moneyPath.finalizeSalesOrderInvoiceAndApplyPayment`), the $50 advance is applied to the new invoice and the terminal charges only the remainder. Today that path charges `so.balance` (`pos.js:2617`) and ignores existing advances, so the customer would pay full price and the deposit would stay stranded. Research must confirm how Zoho reports an SO's balance and the advance once a `salesorders_to_apply` payment exists, and how to apply that advance to an invoice. Staff must not need to do anything by hand in Zoho.
- **D-03: Put the fees on the SO.** Each kit's SO carries the kit at its Zoho item rate (zero-rated) plus the Maker's Fee (`MAKERS-FEE`, $45) and the Materials Fee (`MAT-FEE`, $5), taxed as usual. The kiosk SO-pay path does not add fees, so this keeps the brew-day balance right. The fees are only invoiced when the SO converts. Document this in the SO notes and the runbook.
- **D-04: One SO per kit.** A checkout with several kits takes **one** Helcim charge ($50 x total kits), then creates one SO per kit unit (qty 2 of Ember = 2 SOs). Each SO has a $50 advance against it and reference `LIMITED-2026-27`. Every brew day converts exactly one SO, which matches one batch per kit. The response and both emails list every SO number. The response shape changes from the handoff's single `salesorder_number` to a list (planner picks the field name).
  - Implication for failure handling: if creating the SOs or payments fails part-way after capture, void the whole charge **and** clean up (void or delete) any SOs or payments already created. Never leave a partial set. The idempotency lock covers the whole multi-SO operation.

**Launch policy (handoff §8)**
- **D-05: Refund in full if the supplier can't deliver.** Keep the existing copy line. Add a runbook entry in `docs/RUNBOOK.md`: refund in Helcim, then remove the advance in Zoho (and void the SO).
- **D-06: Hold for 60 days.** A kit is held 60 days after it arrives; after that the deposit is forfeited. State this on the page's deposit terms, in `refunds.html` and in `terms.html`. Forfeited-deposit accounting stays case by case with the accountant (§8 item 4, not a build item).
- **D-07: Switching is staff-handled.** Before the kit's release month, a customer may ask to move a deposit to another limited kit, subject to availability. Staff edit the SO in Zoho. No self-serve UI. Add this to the deposit terms and the policy pages.
- **D-08: Show LE26 brew times only when known.** The card shows weeks only when the JSON `weeks` is non-null. LE26 kits are `null` today, RQ27 kits are 6. The owner fills them in later, with no code change.
- Updating the deposit terms in the content JSON (adding the hold-period and switching lines, removing `open_decisions_for_owner`) is a **separate commit after** the unchanged-assets commit. The owner approves the final policy wording before launch.

**Reservation basket and form**
- **D-09: A +/- stepper on each kit card (0-10).** The flow is standalone, not the site cart (`js/modules/11-cart.js`) or `/api/checkout`, so limited kits never mix with regular orders. One reservation form near the bottom lists the chosen kits and the deposit total.
- **D-10: A sticky bottom bar on mobile.** It appears once at least one kit is chosen: "N kits · $X deposit -> Reserve". Tapping it scrolls to the form.
- **D-11: Confirm in the page.** After payment the form is replaced with a summary: kits, release months, deposit paid, SO references, and what happens next. The same content goes in the customer email. No separate thank-you page.
- **D-12: No reserved counts or scarcity indicators.** The copy's "once they're gone, they're gone" is enough.
- The pay button stays disabled until the non-refundable checkbox is ticked and at least one kit is chosen (handoff §3). Store the checkbox text and a timestamp in the SO notes.

**Contact and spam protection**
- **D-13: Use the existing contact helper as it is.** Use the same find-or-create contact helper as `/api/checkout` (`lib/checkout-helpers.js` `buildContactPayload` plus the lookup-by-`contact_name` logic). **Do not** fold in the "Last, First" fix from `HANDOFF-contact-name-format.md`. Deposits pick that fix up automatically when it lands. Don't fork the helper.
- **D-14: reCAPTCHA v3, fail-closed, like `/api/checkout`.** A reject after capture voids the charge. Also mount the existing payment rate limiter on the new route. The `reservation.html` CSP already allows reCAPTCHA and Helcim, so copy it.
- **D-15: Newsletter opt-in is optional and unticked by default.** Use the existing CASL wording and send to MailerLite only when ticked, the same as checkout.

### Claude's Discretion
- Card layout details within the asset rules: a bottle shot on every card, and the scene image as a header band only when present.
- The pairings presentation (a list, or an expandable "Pairs with" on mobile) and the release calendar's visual form.
- The response field names and the staff email layout.
- The JSON-LD shape within handoff §7: a `Product` per kit, `PreOrder`, and `availabilityStarts` set to the release month.

### Deferred Ideas (OUT OF SCOPE)
- BrewPad Dashboard v2: restore Today's Tasks and Ready to Bottle sections (unrelated; filed as a todo).
- A staff-only reservation summary (count per kit) in BrewPad admin.
- Self-serve kit switching and public reserved counts (rejected: D-07, D-12).
- The contact-name "Last, First" fix (`HANDOFF-contact-name-format.md`).
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal IDs. ROADMAP Phase 100 draft success criteria (SC) 1-5 and CONTEXT D-01..D-15 serve as the requirements.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC1 | Supplier images + content JSON committed unchanged, own commit, first | Sequencing section; terms-update is a second commit |
| SC2 | Page renders all ten kits with the asset rules | Frontend pattern, page-list edits, tests in assets handoff §5 |
| SC3 | $50/kit deposit via `POST /api/preorder/deposit`, end to end on staging, no cap, cap stays easy | Money-path findings 1-6; LIVE-VERIFY spike |
| SC4 | New page carries a sibling CSP (rule 12) | CSP copy from `reservation.html` (verified present: Helcim, reCAPTCHA) |
| SC5 | Supplier-failure refund question resolved | D-05 locked; runbook entry |
| D-01..D-04 | Advance booking, brew-day application, fees on SO, one SO per kit | Findings 1-4 and the D-02 design |
</phase_requirements>

## Summary

The phase has two halves. The page (static HTML, a standalone ES5 module, a CSS file) is routine, and a finished UI-SPEC already exists (`100-UI-SPEC.md`). The money path is the risk. Three facts drive the plan.

1. **`salesorders_to_apply` is undocumented in Zoho's public API.** The public Create-a-payment page lists `invoices[]` as required. It lists no sales-order field and does not mention `unused_amount` or excess. The page documents `description`. It documents `notes` only as a list filter. [CITED: zoho.com/books/api/v3/customer-payments] The repo has live evidence that Zoho accepts the shape `salesorders_to_apply:[{salesorder_id, amount_applied}]` without error. The result was Payment #170, with `applied_invoices: []` and `unused_amount` equal to the full amount. [VERIFIED: `.planning/debug/kiosk-so-collect-draft-unapplied.md`] **Nothing in the repo or the docs shows whether Zoho links that advance to the SO. Nothing shows whether it changes the SO's `balance`, or whether converting the SO to an invoice applies it.** D-02's design therefore must not depend on any of those answers.
2. **The documented way to apply an unused customer payment to an invoice is `POST /invoices/{invoice_id}/credits`.** The body is `{ invoice_payments: [{ payment_id, amount_applied }] }`. This matches the owner's manual repair ("Mark Sent -> Apply Credits") for INV-000169. [MEDIUM: Windmill's "Zoho verified" script; the official page was not retrievable] The middleware token has `ZohoBooks.fullaccess.all`, so scope is not a blocker. [VERIFIED: `lib/zohoAuth.js:100`]
3. **Several things the CONTEXT assumes do not exist as described.**
   - There is **no shared contact find-or-create helper.** `resolveCustomerId` is a closure inside `processCheckout` in `routes/checkout.js:267`. `pos.js:3865` and `bookings.js:452` carry their own copies.
   - There is **no `zohoDelete`** in `lib/zoho-api.js`.
   - `zohoPost` **retries on timeout and 5xx** (3 retries, via `withRetry`). A lost response can silently create a duplicate SO.
   - `rejectWithVoid` voids whatever `payment_token` the **client** names, with no ownership proof (see Pitfall 1).

**Primary recommendation:**
- Build `routes/preorder.js` and `lib/limited-releases.js` as the handoff says.
- Put the single `salesorders_to_apply` call in one new helper file, guarded by a new repo-scan test. One payment per SO, $50 each, `reference_number` = Helcim txn id.
- Make brew-day D-02 independent of Zoho's undocumented behaviour. Compute the amount due as `(open invoice balance_due, or SO total) minus the advance payment's still-unused amount`. Apply the credit with `POST /invoices/{id}/credits` after the invoice is finalized and before the payment is applied. Do this by adding an optional `advance` argument to `finalizeSalesOrderInvoiceAndApplyPayment`. Existing callers stay byte-identical.
- Make **Wave 0 a staging live spike** (see the `[LIVE-VERIFY]` section). Do not finalize plans 3+ until the spike has run.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Kit browsing, cards, calendar, JSON-LD | Browser (static HTML + JS render from `content/*.json`) | CDN/static (GitHub Pages) | Display-only data. The server never reads it. |
| Basket, stepper, deposit total, button state | Browser | n/a | UX only. The server recomputes everything. |
| reCAPTCHA token | Browser (collect), API (verify) | n/a | Fail-closed on the server. |
| Card capture | Helcim iframe (third party) | API (`/api/payment/initialize`) | PAN never touches our code. |
| Amount, allowlist, idempotency, void | API / Backend | n/a | Server-authoritative. The client amount is untrusted. |
| SO + advance booking, contact, cleanup | API -> Zoho Books | n/a | Zoho is the system of record. |
| Brew-day advance application | API (`pos.js` SO-pay) | Kiosk UI (display) | The server computes the charge. The client sends only `salesorder_id`. |
| Customer + staff emails | API (`lib/mailer.js`, Resend) | n/a | Fire-and-forget after success. |
| Hold-back (nav, sitemap, noindex) | Static HTML | n/a | Launch commit flips it. |

## Standard Stack

No new npm packages are required. Everything below already exists in the repo. [VERIFIED: codebase read]

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | existing | New `routes/preorder.js` | Same as all routes |
| `lib/money-path.js` | in-repo | Lock, void-with-timeout, replay guard, SO finalize | The mandated primitives |
| `lib/zoho-api.js` | in-repo | `zohoGet/Post/Put` | Add `zohoDelete` (see Pitfall 4) |
| `lib/helcim.js` | in-repo | `getCardTransactionById`, `voidTransaction`, `initializeCheckout` | Existing |
| `lib/mailer.js` (Resend) | in-repo | Customer + staff emails | Add 2 functions |
| `lib/eventLog.js`, `lib/redact.js` | in-repo | PII-free events, `maskEmail` | Zero-PII policy |
| `lib/mailerlite.js` | in-repo | Optional newsletter | Copy checkout.js:820-851 |
| Jest 29 (+ jsdom on the frontend) | existing | Tests | Existing harness |
| Playwright | existing | `tests/e2e/static-pages.spec.js` | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `salesorders_to_apply` advance (D-01, locked) | Zoho **retainer invoices**. The payments page documents an optional `retainerinvoice_id`, and the nav lists "Apply retainer invoice payments to invoices". [CITED: customer-payments page; MEDIUM] | This is Zoho's documented deposit mechanism, but it is a separate feature that may be disabled in the org. **Plan B only if the live spike shows the advance is dropped or unlinked.** Do not build it speculatively. |
| One customerpayment per SO | One payment with N `salesorders_to_apply` entries | Fewer Zoho calls (N+1 versus 2N) and it mirrors the single Helcim charge. But multi-entry is untested. Per-SO payments use the only shape with live history, give a 1:1 SO <-> payment mapping, and make "remove the advance" a single delete. **Recommend per-SO.** The multi-entry variant is an optimization to test in the spike. |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed in this phase, so slopcheck does not apply.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Browser: limited-releases.html (+ js/modules/18-limited-releases.js, css/limited-releases.css)
  fetch /content/limited-releases-2026-27.json -> render ten cards, steppers, calendar
  basket (item_id -> qty) -> total = 50 x kits (display only)
  [Pay] -> grecaptcha.execute -> POST /api/payment/initialize {amount}    (existing route)
        -> appendHelcimPayIframe(token) -> postMessage SUCCESS -> transactionId
        -> POST /api/preorder/deposit {transaction_id, items[], customer, consent, recaptcha_token}
                                       |
Express (server.js guards: apiLimiter -> referer -> zoho-auth gate -> auth-tier bypass -> paymentLimiter)
                                       v
 routes/preorder.js
   1 shape-validate (no void yet; see Pitfall 1)
   2 reCAPTCHA fail-closed         -- reject => void ONLY if ownership is provable
   3 allowlist/qty/total (lib/limited-releases.js)  expected = 50 x kits
   4 acquireIdempotencyLock(preorder:idem:<txn>, ttl 900)  replay => 200 cached
   5 assertTxnNotReplayed across ALL checkout suffixes
   6 Helcim readback: APPROVED && type=purchase && cents(amount)==cents(expected)
        no => voidWithTimeout + 400 {voided}
   7 write pending sentinel (preorder:pending:<txn>, 7d)
   8 resolve contact (extracted helper)       \
   9 for each kit unit k=1..N (sequential):    |  any throw =>
       POST /salesorders (kit + MAKERS-FEE +   |  cleanup(created[]) THEN
        MAT-FEE, ref LIMITED-2026-27, notes)   |  voidWithTimeout(helcim)
       POST /customerpayments (advance, $50)  /   THEN {voided} response
  10 markTxnUsed, cache response 24h, delete sentinel
  11 fire-and-forget: customer email, staff email, newsletter, eventLog (no PII)
  12 201 {ok, deposit_total, salesorders:[{salesorder_number, item_id, release}]}

Brew day: kiosk -> POST /api/kiosk/salesorder-pay {salesorder_id}
   GET SO -> LIMITED-? -> find deposit payment -> amountDue
   terminalPurchase(amountDue) -> poll -> approved
   finalizeSalesOrderInvoiceAndApplyPayment(soId, {..., advance})
        ensureOpenInvoice -> POST /invoices/{id}/credits (advance) -> GET invoice
        -> POST /customerpayments {invoices:[{invoice_id, amount_applied}]}
   createBatchesFromSale (fee lines on SO => exactly 1 batch)
```

### Recommended Project Structure
```
zoho-middleware/
  routes/preorder.js                  # POST /api/preorder/deposit (new)
  lib/limited-releases.js             # ALLOWLIST (10 ids), DEPOSIT_PER_KIT, MAX_QTY_PER_LINE, MAX_KITS_PER_ORDER (per-item cap hook)
  lib/limited-releases-deposit.js     # the ONLY module that emits salesorders_to_apply; also advance lookup + cleanup
  lib/zoho-api.js                     # + zohoDelete (shared lib => full-suite rule)
  lib/money-path.js                   # finalize...: optional `advance` arg; comment cross-ref (shared lib)
  lib/mailer.js                       # + sendPreorderDepositConfirmation, sendPreorderDepositNotification
  routes/pos.js                       # salesorder-pay: advance-aware amountDue (+ optional read-only preview route)
  __tests__/preorder-*.test.js        # new files only
js/modules/18-limited-releases.js     # standalone, NOT in concat:js (same pattern as 14-17)
css/limited-releases.css (+ .min)     # per UI-SPEC
limited-releases.html
```
Module 18 is a separate file and separate terser step, like `14-labels`, `15-hops`, `16-catalog-subpage`, `17-search-overlay`. `concat:js` lists main.js modules explicitly. [VERIFIED: package.json] Guard it with `if (typeof module !== 'undefined' && module.exports)` so Jest can `require` it, as `16-catalog-subpage.js` does.

### Pattern 1: Deposit booking helper (D-01 carve-out)
**What:** One file, one function, one loud comment. A new test scans `zoho-middleware/{lib,routes}` for the literal `salesorders_to_apply`. It allows only (a) `lib/limited-releases-deposit.js` for code and (b) comment lines elsewhere. This is a new test file, not an edit to the Phase 71 ban tests.
**Why this keeps the ban intact:** The ban tests are behavioural and flow-scoped.
- `checkout-so-deposit-reconcile.test.js` checks the checkout payment body.
- `kiosk-salesorders.test.js` checks the `salesorder-pay` handler.
- `collect-webhook-reconcile.test.js` checks the collect webhook flow.

None of them scan source files. I grepped `readFileSync` against money-path, pos and checkout in the tests and found nothing. [VERIFIED: grep] A new module that only `routes/preorder.js` imports cannot trip them.
```js
// lib/limited-releases-deposit.js  (ES5, Source: repo history 438400bb / 0f879a54^ for the proven request shape)
// WHY ADVANCE: a limited-release deposit is a customer liability until the kit is invoiced on brew day.
// This is the ONE sanctioned use of salesorders_to_apply (see money-path.js header). Never import elsewhere.
function bookSalesOrderDepositAdvance(args) {
  return zohoPost('/customerpayments', {
    customer_id: args.customerId,
    payment_mode: 'creditcard',                    // same deposit-to as other online card payments
    amount: args.amount,                           // DEPOSIT_PER_KIT
    date: args.date,
    reference_number: args.helcimTxnId,            // [LIVE-VERIFY] duplicate refs accepted across N payments
    description: 'LIMITED-2026-27 deposit ' + args.soNumber + ' (Helcim ' + args.helcimTxnId + ')',
    salesorders_to_apply: [{ salesorder_id: args.soId, amount_applied: args.amount }]
  });
}
```
Use `description`, not `notes`. `description` is the documented field. `notes` is documented only as a list filter. Existing repo code sends `notes`, which may be silently dropped. [CITED: Zoho customer-payments page] [LIVE-VERIFY]

### Pattern 2: D-02 brew-day design (extend, do not fork)
**Gate:** apply advance logic only when `so.reference_number` starts with `LIMITED-`. A general "apply any customer credit" rule is **less safe**:
- It would consume unrelated credits, such as refund credits, credit notes, or orphaned pre-Phase-71 advances like Payment #170. Staff should resolve those by hand.
- Ordinary SOs keep identical behaviour, so the existing `kiosk-salesorders` tests (no `reference_number` in their mocks) are untouched.

**Amount due, robust to every unknown Zoho behaviour:**
```
base   = (SO has a non-void linked invoice) ? invoice.balance_due : so.total
unused = deposit payment's CURRENT unused_amount     // GET /customerpayments/{payment_id}
due    = round2(base - min(unused, base))
```
Check each case:
- Fresh SO: base = total, unused = 50, so due = total - 50. OK.
- Retry after a voided attempt where the credit was never applied: invoice.balance_due = total, unused = 50. OK.
- Retry after the credit was applied but the charge failed: balance_due = total - 50, unused = 0. OK.
- Zoho auto-applied the advance on conversion: same arithmetic. OK.

Do **not** use `so.balance` for LIMITED SOs. Zoho may or may not net the advance, and the formula above makes that irrelevant.

**Finalize extension:** add optional `payment.advance = { payment_id, amount }` to `finalizeSalesOrderInvoiceAndApplyPayment`.
1. `ensureOpenInvoiceForSalesOrder(soId)` (unchanged).
2. If `advance`: re-read the payment's `unused_amount`. If it is >= the amount, `POST /invoices/{id}/credits { invoice_payments:[{payment_id, amount_applied}] }`. Skip if unused is already 0.
3. `GET /invoices/{id}`, which now returns the real `balance_due`. This **must** happen before the existing clamp, or `amount_applied` is clamped against the full total and the invoice is left $50 short.
4. Existing `POST /customerpayments` with `invoices:[...]` for the remainder.

When `advance` is absent the function must be byte-identical in behaviour. Pin this with a test.

**Pre-charge stays read-only.** Compute `due` before `terminalPurchase` using only GETs. Converting the SO before the charge would leave a half-state if the card declines. Post-charge failure falls into the existing void-on-failure catch (`pos.js:2783-2840`).

Other changes in `processSalesOrderPay`:
- The pending-charge sentinel `amount` must be `due`, not `balance`.
- The response `amount` is `due`, and add `deposit_applied`.
- `eventLog` `kiosk.salesorder_payment` gets `depositApplied`.
- If `due < 0.01` (advance covers the order), return a clear 400 instead of calling the terminal with $0. This cannot happen at $200+ kits, so do not build a zero-charge path.

**Staff-visible gap:** the kiosk SO list shows `balance` (`pos.js:2430`, rendered in `kiosk-core.js`). For a LIMITED SO the figure may show the full total while the terminal charges less. Recommend a small read-only preview (a `due` field on `GET /api/kiosk/salesorders` for LIMITED SOs only, or a tiny GET route) and a "Deposit held: $50" line. The pay route must recompute and never trust the preview. A new route must be added to the device-token allowlist in `lib/authTiers.js` (lines 62/84). Changes to `kiosk-core.js` need `npm run build`.

**Also:** `/api/pos/collect` -> webhook -> the same shared finalize helper has no caller today (per a comment in `kiosk-salesorders.test.js`). If it is ever used on a LIMITED SO it would strand the advance. Add a guard that refuses LIMITED SOs, or document it.

### Pattern 3: Multi-SO creation and all-or-nothing cleanup (D-04)
- **Sequential, per kit unit:** create SO_k, then its payment_k. Record each returned `salesorder_id` and `payment_id` in a `created[]` array immediately.
- **Total kit bound:** add `MAX_KITS_PER_ORDER` in `lib/limited-releases.js`. The handoff allows 10 lines x qty 10 = 100 kits, which would be about 200 sequential Zoho calls plus cleanup against daily API quotas and a browser waiting on one request. I suggest 10 total, and it is a technical request-size bound rather than an inventory cap. [ASSUMED: needs owner nod] Reject over-limit requests as 400. This is safe because the 400 happens before any irreversible step only if the client enforces the same bound before opening the iframe. The UI-SPEC stepper caps at 0-10 per kit; make the page enforce the total bound too.
- **Cleanup order on any failure:** delete payments first, then void the SO (a payment-bearing SO may refuse deletion; [LIVE-VERIFY]). Documented: `DELETE /customerpayments/{id}`. [CITED: Zoho customer-payments page] SO void/delete endpoints could not be fetched (docs returned 403). [ASSUMED: `POST /salesorders/{id}/status/void`, `DELETE /salesorders/{id}`.]
  - Each cleanup step is best-effort. A failing step is logged, accumulated, and reported to staff in one alert email listing the leftover SO/payment ids. Reuse the `sendVoidFailureAlert` style.
  - Void the Helcim charge **after** cleanup is attempted, or in parallel. The void must never be skipped because cleanup threw.
- **Duplicate-SO hazard:** `zohoPost` retries on timeout and 5xx. A request that succeeded server-side but timed out can be retried into a duplicate SO. Mitigations, in order of preference:
  1. Add an opt-out (a `retries: 0` option on a new `zohoPostOnce`) for the two creating POSTs.
  2. In cleanup, sweep by `GET /salesorders?customer_id=...&reference_number=LIMITED-2026-27` filtered to those created in this request (date + notes containing the txn id) and void all matches, not only the ones whose responses were received.
- **Lock scope:** key `preorder:idem:<txn_id>` via `acquireIdempotencyLock(cache, key, 900)`. The 600 s default may be short for large N. Cache the final response under the same key for 24 h so a retry (browser refresh after a lost response) returns the original confirmation. That matches the UI-SPEC "already processed -> show original confirmation" state.
- **Durable sentinel:** after the Helcim readback passes, write `preorder:pending:<txn>` (7 d) holding only ids and counts (no PII). Delete it on success or on a confirmed void and cleanup. A process crash mid-request otherwise leaves a captured card with no record. Staff can then find leftovers. Extending `lib/reconcile.js`'s sweep is optional; a runbook "check Helcim vs Zoho daily" line is the minimum.

### Pattern 4: Frontend page
- **Wiring:** `limited-releases.html` copies the shell and CSP from `reservation.html` (it has `secure.helcim.app`, `secure.myhelcim.com`, google.com/gstatic for reCAPTCHA, and the Railway middleware in `connect-src`). Copy `<script src="https://secure.helcim.app/helcim-pay/services/start.js">` and the reCAPTCHA `api.js?render=` tag from `reservation.html:319-320`. Load `js/sheets-config.js` (for `SHEETS_CONFIG.MIDDLEWARE_URL` and `RECAPTCHA_SITE_KEY`) and `main.min.js` (nav, consent, search). Add `js/consent.js` in `<head>` and the "Cookie settings" footer button.
- **Self-sufficient module:** do not depend on `getRecaptchaToken` from `12a-checkout-validation.js`, so Jest can load the file alone. It is eight lines (`grecaptcha.execute(window.RECAPTCHA_SITE_KEY, {action})`). Use action `preorder_deposit`.
- **Helcim postMessage:** copy the pattern from `12-checkout.js:1824-1851`. Check `event.origin`, match `eventName === 'helcim-pay-js-' + checkoutToken` or the secretToken, handle `SUCCESS` (call `extractHelcimTransactionId`, then `removeHelcimPayIframe()`) and `ABORTED`. The existing code allows origins `https://secure.helcim.app` and `https://myhelcim.com` only; copy that exactly because it works in production.
- **State:** keep the txn id alive across retries (mirrors "C2 fix" in checkout) and clear it only on a server response that confirms `voided: true`. Add `beforeunload` while an iframe is open or verifying (UI-SPEC).
- **Server error JSON:** include `voided: true | false`. UI-SPEC requires it so the client can pick the honest copy branch; "not charged" only on `voided:true`.
- **Page lists to extend (call out in commit message):** `tests/frontend/cookie-consent.test.js` PAGES (~l.199), `tests/frontend/legal-pages.test.js` ROOT_PAGES (footer-legal nav, exactly once), `tests/frontend/page-search-consistency.test.js` PUBLIC_PAGES, `tests/e2e/static-pages.spec.js` (a new describe), and `package.json` `stamp:pages`. [VERIFIED: files read] `stamp:pages` is a long inline regex script. It must also learn `limited-releases\.min\.css` and `18-limited-releases\.min\.js` cache-bust tokens (UI-SPEC open item 4). Add the terser line for module 18 and the cleancss line for the new CSS.
- **Hold-back (pattern of `6e05a60d`):** the page ships unlinked: no nav item on any page, no sitemap entry, `<meta name="robots" content="noindex">`. Add a new `tests/frontend/limited-releases-holdback.test.js` asserting exactly that. Launch = one commit that adds the nav link on every page and the sitemap entry, removes `noindex`, and deletes the holdback test. (The beer hold-back test was deleted in the launch commit `5948fb0b`.) Production and staging deploy from the same `main` branch, so "staging only" is achieved by being unlinked and `noindex`, not by branch differences. [VERIFIED: git show 6e05a60d; CLAUDE.md deployment]
- **Policy wording:** `refunds.html` line 106 says "we do not take a separate deposit." This is inside section A (sessions), and still true for sessions. Add a new **Limited Release deposits** section rather than editing that sentence. The same goes for `terms.html` (new numbered section; Reservations is section 4). `legal-pages.test.js` forbids `[CONFIRM`/`DRAFT` markers, and the policy pages' CSP must equal `about.html`'s, so do not leave markers for owner review in those files. Draft the wording in the plan summary for owner approval before committing.

### Anti-Patterns to Avoid
- **Reading the frontend JSON on the server** (locked: the server holds its own allowlist).
- **Using `so.balance` for LIMITED SOs** in the kiosk path.
- **Calling `createBatchesFromSale`, `ledger.decrementStock`, or `notifyAdminPanel`** from the preorder route. Deposits are not timeslot reservations, and the kits have stock 0.
- **Copying the `rejectWithVoid`-on-any-400 pattern** (Pitfall 1).
- **Retrying creating POSTs blindly** (Pitfall 5).
- **Editing existing tests.** Everything new goes in new test files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotency / replay | A new lock | `moneyPath.acquireIdempotencyLock`, `assertTxnNotReplayed`, `markTxnUsed` | Fail-closed in prod, tested |
| Charge reversal | Raw `voidTransaction` | `moneyPath.voidWithTimeout` | 8 s timeout, alert on failure, returns `{ok}` |
| Void-failure alert | A new email | `mailer.sendVoidFailureAlert` | Existing staff process |
| reCAPTCHA | New verify | `checkout-helpers.verifyRecaptcha` | Fail-closed in prod, 5 s timeout |
| SO -> invoice -> apply | A parallel path | Extend `finalizeSalesOrderInvoiceAndApplyPayment` | Two regressions already caught on staging |
| Apply unused payment to invoice | Editing the payment (`PUT /customerpayments`) | `POST /invoices/{id}/credits` | Documented apply-credits flow; matches the owner's manual repair |
| Rate limiting | New limiter | Existing `paymentLimiter`: `app.use('/api/preorder', paymentLimiter)` | Shared 10/min/IP bucket |
| Newsletter | New CASL text | Copy `reservation.html#res-newsletter` label and checkout.js:820-851 | CASL wording is already approved |
| Product JSON-LD | Hand-built strings | Build objects, `JSON.stringify` once, inject a single `ld+json` script | UI-SPEC section SEO |

**Key insight:** every dangerous operation here (charge, void, SO conversion, invoice apply) already has a hardened primitive. The new work is orchestration and the one advance-booking carve-out.

## Runtime State Inventory

Not a rename or migration phase. Omitted. The one runtime-state concern, the new Redis keys, is covered above:
- `preorder:idem:<txn>`
- `preorder:pending:<txn>`
- `helcim:txn:<txn>*`

## Common Pitfalls

### Pitfall 1: Client-named void target (security, HIGH)
**What goes wrong:** `moneyPath.rejectWithVoid` voids `body.payment_token` without proving the caller owns it. Helcim transaction ids are numeric and near-sequential (the repo cites ids like 50641064 and 56129650). An attacker who sends a malformed `/api/checkout` body naming someone else's open-batch transaction triggers a reversal of that sale. This happens before reCAPTCHA. [ASSUMED: exploitability not tested; the code path is verified at `money-path.js:149-175` and `checkout.js:97-127`]
**Why it matters here:** the new route must not copy it. A mismatch-driven void has the same weakness: send the victim's txn id with a basket whose total differs and it gets voided.
**How to avoid (recommended):** bind the transaction to this route with a server-minted nonce.
- Add `POST /api/preorder/initialize {items}`. The server computes the amount from the basket and calls Helcim initialize with `invoiceRequest.invoiceNumber = 'LR-' + nonce`. [CITED: devdocs.helcim.com, "Managing customers and invoices"; field name MEDIUM] It stores the nonce -> {amount, kits} in Redis for 1 h.
- Deposit requests carry the nonce. The server requires the Helcim readback `invoiceNumber` to match, and only then voids on failure.
- This also removes the client-chosen-amount weakness of `/api/payment/initialize` for this flow.
- **Cost:** it deviates from the handoff and UI-SPEC wording (they call `/api/payment/initialize`); `getCardTransactionById` already returns `invoiceNumber`. [LIVE-VERIFY that HelcimPay propagates `invoiceRequest.invoiceNumber` to the card-transaction readback.]
**Minimum fallback if nonce binding is rejected:** void only transactions whose readback is APPROVED + `purchase`, never on pure validation failures, and flag the residual risk to the owner.
**Surface to the owner separately:** the existing `/api/checkout` exposure (global CLAUDE.md rule 3: surface design smells). Do not fix it in this phase.

### Pitfall 2: Cross-route transaction reuse
**What goes wrong:** a legitimate $50 purchase (any route) is replayed as a free deposit, or a deposit txn is replayed as a $50 checkout. Checkout's replay key is `helcim:txn:<id>` + a `:cart_key` suffix (`'' | :sv-cart-ferment | :sv-cart-ingredients`). The preorder route would check only one namespace.
**How to avoid:** check `assertTxnNotReplayed` against all three suffixes and `markTxnUsed` under all three after success. Also require the readback `status` to be `APPROVED` **and** `type` to be `purchase`: a reversal or refund also reads back as APPROVED (`helcim.js:386-390`, verified 2026-10-06). Compare cents as integers (`Math.round(x * 100)`), not floats.

### Pitfall 3: Zoho-unauthenticated 401 before the route runs
**What goes wrong:** `server.js:457-468` returns 401 for all `/api` POSTs when Zoho is not authenticated, except `OFFLINE_CAPABLE_POSTS = ['/contacts','/bookings','/checkout']`. The 2026-09-23 refresh-token incident shows this can happen in production. If a customer pays between `initialize` and `deposit`, the card is charged and the route never runs.
**How to avoid:**
- Add `/preorder/deposit` to the offline list so `req.zohoOffline` is set. In the route, when it is set, immediately void the Helcim charge and return 503 `{voided}`. Test it.
- Optionally add a pre-flight `GET /api/preorder/ready` that the page calls before opening the iframe. It checks Zoho auth, the fee items, and the 10 items' rates. This is better than charge-then-void for known config failures.

### Pitfall 4: Missing tooling in `lib/zoho-api.js`
Only `zohoGet/Post/Put` exist. Cleanup needs `zohoDelete` (and ideally a no-retry POST). It is a shared-lib change, so run the FULL suite on both sides (CLAUDE.md rule 7). Add it in its own commit with its own test.

### Pitfall 5: `withRetry` can duplicate SOs
See Pattern 3. Never loop-retry the creating POSTs on top of `zohoPost`'s internal 3 retries.

### Pitfall 6: Public-route plumbing in `server.js` (three places)
A new public POST needs:
- (a) a bypass in the API-key/auth-tier guard (`server.js:505`: `if (req.path === '/checkout') return next();`), otherwise public customers get 403;
- (b) a `paymentLimiter` mount next to `server.js:792`;
- (c) the offline-list entry from Pitfall 3.

`requireAllowedReferer` should **remain** active for this route (do not copy checkout's exemption at `server.js:106`). Write a test that `/api/preorder/deposit` is reachable without a key while an unrelated POST is still 403.

### Pitfall 7: No shared contact helper (D-13 premise is off)
CONTEXT says use "the same find-or-create contact helper". Only `buildContactPayload` is shared. The lookup/create/duplicate-name-fallback logic lives in `checkout.js:267-305`, and `pos.js:3865` and `bookings.js:452` have their own variants.
**Recommendation:** extract a verbatim `resolveOrCreateContact` into `lib/checkout-helpers.js` (lazy-require `zoho-api` and `cache` the way `money-path.js` does, so existing Jest mocks still bite). Let `checkout.js` delegate to it in a separate refactor commit that passes the existing checkout tests unmodified. If that proves risky, fall back to a verbatim copy plus a TODO and note the copy in the contact-name handoff. This is not a fork of behaviour, only of location, and it keeps the "Last, First" fix to one edit. Flag to the owner (see Open Questions).

### Pitfall 8: Item rates are not in the product cache
The ten kits have stock 0, so "the normal catalog hides them" (handoff §1). `checkout.js` prices from `PRODUCTS_CACHE_KEY`, so it cannot price these items. Fetch each kit's rate from Zoho (`GET /items/{item_id}`, Redis-cached about 10 min) and send an explicit `rate`. Fail closed if the item is missing, inactive or has rate <= 0. Omitting `rate` and letting Zoho default it is unverified; test it in the spike but do not rely on it.
- Fee items come from `SERVICES_CACHE_KEY` (`findMakersFeeItem` / `findMaterialsFeeItem`, env `MAKERS_FEE_ITEM_ID` / `MATERIALS_FEE_ITEM_ID`). Reuse the checkout guards: snapshot-fallback item_ids are SKU strings, so require `/^\d+$/` and void on failure. Quantity 1 of each per SO.
- Leave `tax_id` off the lines, as checkout does, so Zoho applies each item's default (kit zero-rated, fees taxed). The deposit itself is flat $50 with no tax, so the entity-level rounding rule (memory: Zoho tax rounding) does not touch the deposit. It matters only at brew day, where D-02 uses Zoho's own SO/invoice totals and never recomputes tax locally.

### Pitfall 9: Staging is the live Zoho org and the live Helcim account ("Option B")
[VERIFIED: `docs/STAGING-MIDDLEWARE-SETUP.md`, `71-03-SUMMARY.md`] Every staging run creates real SOs and payments in the live books and real Helcim charges. The handoff's "Helcim test mode" may not exist. The setup doc says "Use Helcim test mode if available, else a small refundable real charge". Plan the run as real $50 / $150 charges that are voided or refunded afterwards, with SOs voided and payments deleted. Tag test customers clearly. The spike script and the staging run both need a cleanup checklist.

### Pitfall 10: Smaller traps
- **Payment `date`:** the repo uses `new Date().toISOString().slice(0,10)` (UTC). A deposit made on a Pacific evening is dated tomorrow. This matches existing code; mention it to the accountant rather than diverging.
- **Kits sheet registry:** `brewpad-integration` narrows kit lines to SKUs on the Kits sheet and falls back to "keep all" if none match. Batch creation is still safe, but the 10 new SKUs should be added to the Kits sheet so the batch carries product data. [ASSUMED: ops item for the owner]
- **Fees on the SO are what trigger the batch:** `detectKitItems` requires a Maker's Fee line in the SO's `line_items`. D-03 is therefore also what makes a brew-day batch appear. One kit + one fee line per SO gives exactly one batch.
- **Per-file coverage floors:** `jest.config.js` requires `routes/pos.js` >= 80% lines and `routes/checkout.js` >= 52%. New branches in `pos.js` need tests or the suite fails.
- **Jest runs coverage by default.** Single-file runs need `--coverage=false` or thresholds fail.
- **Local Node is v20.20.2; `package.json` pins 24.x.** Known gotcha from memory; do not trust a local-only green for Node-24-specific behaviour.
- **Lock never released on failure:** the idempotency lock stays held for its TTL. After a confirmed void the client must start a new payment, not retry the old txn id (it would get 409).

## Code Examples

### Server-side Helcim verification (preorder route)
```js
// Pattern source: routes/checkout.js:616-654 (MONEY-01/H2), tightened per Pitfall 2.
var expectedCents = Math.round(DEPOSIT_PER_KIT * totalKits * 100);
var txn;
try { txn = await helcimLib.getCardTransactionById(transactionId); } catch (e) { txn = null; }
var okTxn = txn && txn.status === 'APPROVED' && txn.type === 'purchase' &&
            Math.round(parseFloat(txn.amount) * 100) === expectedCents;
if (!okTxn) { /* voidWithTimeout ONLY if ownership provable (Pitfall 1); respond 400/402 {voided} */ }
```

### Create one SO (per kit unit)
```js
// Source: shape of checkout.js:524-529 salesOrder; fees per D-03
var so = await zohoPost('/salesorders', {
  customer_id: customerId,
  date: today,
  reference_number: 'LIMITED-2026-27',
  line_items: [
    { item_id: kitId, quantity: 1, rate: kitRate },
    { item_id: makersFee.item_id, quantity: 1, rate: makersFee.rate },
    { item_id: matFee.item_id,    quantity: 1, rate: matFee.rate }
  ],
  notes: 'Limited Release deposit $50 (Helcim ' + txn + '). Release: ' + releaseLabel +
         '. Consent: "' + consentText + '" at ' + isoTimestamp +
         '. Fees ($45 + $5) are on this SO and are invoiced on brew day.'
});
```

### Apply the advance at brew day
```js
// Source: Windmill "Apply credits (Zoho)" script; official page not retrievable -> [LIVE-VERIFY]
await zohoPost('/invoices/' + invoiceId + '/credits', {
  invoice_payments: [{ payment_id: advance.payment_id, amount_applied: advance.amount }]
});
```

### Money-path event log (zero PII)
```js
eventLog.logEvent('preorder.deposit_completed', { txnId: txn, kitCount: n, soCount: n, grandTotal: total });
// Never name, email, phone, payment_token. Use redact.maskEmail for the newsletter event as checkout does.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Online deposit on SO via `salesorders_to_apply` in checkout | Removed from checkout in Phase 71-02 (dead code) and banned | 2026-08/09 | Phase 100 reintroduces it in exactly one isolated helper |
| Collect booked against SO | Invoice finalized + `invoices[]` apply | Phase 71 | Brew-day path stays on this pattern |
| Helcim initialize with amount only | `invoiceRequest` / `customerRequest` supported | Helcim changelog, Oct 2024 [MEDIUM] | Enables nonce binding (Pitfall 1) |

**Deprecated/outdated:** the handoff's single `salesorder_number` response and "one SO per order" (replaced by D-04); the handoff's "check whether the kiosk adds fees" (resolved by D-03).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `POST /invoices/{id}/credits` body `{invoice_payments:[{payment_id, amount_applied}]}` works for an unused payment | Pattern 2 | Brew-day plan fails; Plan B retainer invoice or manual apply |
| A2 | SO void is `POST /salesorders/{id}/status/void`; SO delete is `DELETE /salesorders/{id}` | Pattern 3 | Cleanup fails; staff alert fires; leftovers need manual removal |
| A3 | Deleting a payment before voiding its SO is the right order | Pattern 3 | Order may need reversing |
| A4 | A technical total-kit bound (10) is acceptable to the owner | Pattern 3 | Owner wants larger orders; raise the constant |
| A5 | HelcimPay `invoiceRequest.invoiceNumber` propagates to the card-transaction readback | Pitfall 1 | Nonce binding unusable; use the fallback |
| A6 | The `/api/checkout` early-void exposure is exploitable as described | Pitfall 1 | Lower severity; still avoid copying it |
| A7 | `description` is persisted by Zoho and searchable via `search_text` | Pattern 2 | Use `reference_number` + SO notes parsing instead |
| A8 | Duplicate `reference_number` across the N payments is accepted | Pattern 1 | Suffix `-k` on the reference |
| A9 | Kits sheet needs the 10 SKUs for rich batches | Pitfall 10 | Cosmetic; batches still create |
| A10 | BC consumer law (BPCPA future-performance rules) may constrain a "non-refundable" deposit for goods delivered later | Open Q 6 | Wording or terms must change; lawyer review |
| A11 | Google reads JSON-LD injected by JS | Frontend | SEO only; static fallback possible |

## Open Questions / [LIVE-VERIFY] items (RESOLVED)

> Planner annotation (2026-10-29): every owner question below is RESOLVED by a CONTEXT decision or routed to a named plan; every LV item is routed to the plan that verifies it. Research substance is unchanged.

### Wave 0 live spike (staging, live org, throwaway customer; clean up afterwards)
Write a staging-gated script modelled on `scripts/replay-collect-webhook.js` (refuses unless `SENTRY_ENVIRONMENT === 'staging'`, run via `railway ssh`) and the read-only style of `spike-past-sales-shapes.js`. It creates a $1 test SO and payment, then records answers, and deletes everything. Do the SO-state matrix both as draft and after `/status/confirmed`.

| # | Question | Why it matters | Planned handling | Resolution |
|---|----------|----------------|------------------|------------|
| LV1 | After `salesorders_to_apply`, does `GET /customerpayments/{id}` show `unused_amount` = full amount and any SO linkage field? | Confirms the advance exists and what identifies it | If unlinked or dropped, switch to Plan B (retainer invoice) before building | ROUTED — Plan 02 Task 2 (spike); go/no-go Plan A/B in Plan 02 Task 3 |
| LV2 | Does `GET /salesorders/{id}` change `balance`, or show any payments field? | Decides whether the kiosk list needs a preview | Design is robust either way | ROUTED — Plan 02 Task 2; consumed by Plans 08/09 |
| LV3 | Does `POST /invoices/fromsalesorder` auto-apply the advance? | Decides whether the credit step is a no-op | The re-read `unused_amount` guard handles both | ROUTED — Plan 02 Task 2; consumed by Plan 08 |
| LV4 | Does `POST /invoices/{id}/credits` apply the payment, and do `balance_due` and the payment's `unused_amount` update? | Core of D-02 | A1 | ROUTED — Plan 02 Task 2 (go/no-go gate); consumed by Plan 08 |
| LV5 | Is a payment accepted against a stock-0 item's SO, a draft SO, and a confirmed SO? Does SO creation with stock-0 items succeed? | Gate for the whole flow | | ROUTED — Plan 02 Task 2 |
| LV6 | Is `description` stored and searchable via `search_text=<SO number>`? Is `notes` dropped? Does `reference_number` accept duplicates across N payments? | Advance lookup design | A7, A8 | ROUTED — Plan 02 Task 2; "Deposit lookup" consumed by Plan 05 |
| LV7 | Does the list payments response include `unused_amount`? (The docs do not list it.) | Else use `GET /customerpayments/{id}` per candidate | | ROUTED — Plan 02 Task 2; consumed by Plan 05 |
| LV8 | Do `DELETE /customerpayments/{id}`, SO void and SO delete work on an SO that carries an advance, and in which order? | Cleanup | A2, A3 | ROUTED — Plan 02 Task 2 ("Confirmed endpoints"); consumed by Plans 05/07/13 |
| LV9 | Does omitting `rate` on a kit line pull the item rate and its zero tax? | Simplifies the SO build | Explicit rate remains the default | ROUTED — Plan 02 Task 2 |
| LV10 | Does a multi-entry `salesorders_to_apply` (N SOs in one payment) work? | Optional optimization | Default stays per-SO payments | ROUTED — Plan 02 Task 2 (optional) |
| LV11 | Does HelcimPay carry `invoiceRequest.invoiceNumber` into `getCardTransactionById().invoiceNumber`? | Nonce binding | A5 | ROUTED — Plan 02 Task 3 (hard gate: yes / no→replan per Pitfall 1 minimum fallback / deferred only with owner acceptance); Plan 06 Task 0 enforces; if deferred, Plan 13 Task 2 step 2 verifies on the first staging deposit with a stop condition |
| LV12 | Full dress rehearsal on staging, then brew day: take a staging LIMITED SO through the kiosk SO-pay path and confirm the advance is applied, only the remainder is charged, and exactly one BrewPad batch is created | Acceptance for D-02 | CONTEXT "Specifics" | ROUTED — Plan 13 Task 2 step 4 (live terminal payment required; a decline is recorded as D-02 OPEN RISK gating Plan 14) |

**Zoho Books MCP:** I did not have it in this session, so nothing was inspected read-only. If you can reach it, the cheapest first check is Payment #170 in org 110002406307 (reference Helcim txn 53184102, SO-000076 / INV-000169). It was booked with `salesorders_to_apply` on 2026-08-14. Look at whether it shows any SO linkage. Historical online-deposit SOs from before 2026-05-07 (checkout commit `438400bb` era) may also exist and show how Zoho treated them.

### Questions for the owner / planner
1. **D-13 premise:** there is no shared contact helper. Approve the extraction (Pitfall 7)? — **RESOLVED:** D-13 amended (extract `resolveOrCreateContact` verbatim; Plan 03 Task 3).
2. **Pitfall 1 nonce binding:** approve a small `POST /api/preorder/initialize` that deviates from the handoff and UI-SPEC wording, or accept the weaker fallback? — **RESOLVED:** D-17 (nonce binding approved; Plans 03, 06, 12; LV11 gate in Plans 02/06).
3. **Total-kit bound** per order (A4). — **RESOLVED:** D-18 (10 kits per order; Plan 04 validateBasket).
4. **Helcim "test mode":** staging shares the live Helcim account and Zoho org (Option B). Is a real $50-$150 charge, voided or refunded, acceptable for the staging run? — **RESOLVED:** D-16 (real money on staging approved; Plans 02 and 13 void/refund everything).
5. **Kiosk preview:** how much brew-day UI is wanted (a "Deposit held / charging $X" line)? — **RESOLVED:** planner discretion under D-02 — badge plus "Deposit applied" remainder line via a read-only preview (Plan 09).
6. **Legal:** a "non-refundable" deposit for goods delivered months later may fall under BC consumer-protection rules for future-performance contracts. The existing Terms already cite BPCPA sections. Have the lawyer or owner confirm the wording before launch (A10). — **DEFERRED** to the owner at sign-off: Plan 13 Task 2 step 6 records whether the lawyer reviews "non-refundable" before launch.
7. **Forfeited-deposit accounting and tax** stays with the accountant (D-06, not a build item). Note that a UTC `date` can shift a late-evening deposit to the next day. — **RESOLVED:** D-06 (accountant, case by case; not a build item); UTC date note in the Plan 13 RUNBOOK item 11.
8. **The 11 untracked `HANDOFF-*.md` files** in the working tree: only the two limited-release handoffs relate to this phase. Decide whether to commit them with the assets commit. — **RESOLVED:** only the two limited-release handoffs are committed, with the assets (Plan 01); the other handoffs stay out of this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | Build, tests | ✓ | v20.20.2 / 10.8.2 (project pins 24.x) | Use CI for Node-24 confidence |
| Frontend `node_modules` | Jest, terser, cleancss | ✓ | n/a | n/a |
| `zoho-middleware/node_modules` | Middleware tests | ✓ | n/a | n/a |
| `railway` CLI | Running the spike in the staging container | ✓ | n/a | Dashboard shell |
| `gh` | Staging deploy checks | ✓ | n/a | n/a |
| `redis-cli` | Inspecting keys | ✓ | n/a | n/a |
| Live Zoho org (Option B) | Spike + staging run | ✓ (shared with prod) | n/a | None. There is no sandbox org. |
| Helcim test mode | Staging deposits | ? unknown | n/a | Small real charge, then void or refund |
| Zoho Books MCP | Read-only inspection | ✗ not available to me | n/a | Owner or the Zoho UI |
| Gemini CLI | n/a | ✗ (broken per memory) | n/a | grep + Read (used) |

**Missing with no fallback:** none blocking. **Missing with fallback:** Helcim test mode; Zoho MCP.

## Validation Architecture

Note: `.planning/config.json` has `workflow.nyquist_validation: false`. This section is included because the orchestrator explicitly asked for it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29: middleware (`node` env), frontend (`jsdom`); Playwright for e2e |
| Config file | `zoho-middleware/jest.config.js`, root `jest.config.js`, `playwright.config.*` |
| Quick run (middleware) | `cd zoho-middleware && npx jest __tests__/preorder-deposit.test.js --coverage=false` |
| Quick run (frontend) | `npx jest tests/frontend/limited-releases.test.js --coverage=false` |
| Full suite | `npm test` and `cd zoho-middleware && npm test`, plus `npm run lint` (CLAUDE.md pre-commit) |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| D-04 / §9 | Unknown item, qty bounds, empty basket -> 400 | unit | `npx jest __tests__/preorder-deposit.test.js -t validate --coverage=false` | ❌ Wave 0 |
| §9 | Server computes 50 x kits; off-by-one-cent -> void + 400 | unit | `-t amount` | ❌ |
| Pitfall 2 | Readback must be APPROVED + `purchase`; reversal/refund rejected; replay across all cart suffixes -> 409 | unit | `-t replay` | ❌ |
| §9 / D-04 | Same txn twice -> one set of SOs; replay returns cached confirmation | unit | `-t idempotent` | ❌ |
| §9 / D-04 | Fail at each step (contact, SO k, payment k) -> cleanup + void; void failure -> alert; response carries `voided` | unit | `-t failure` | ❌ |
| §9 | Never calls `createBatchesFromSale` / `decrementStock` / `notifyAdminPanel` | unit | `-t no-batch` | ❌ |
| D-01 | Payment body has `salesorders_to_apply` with the right ids, not `invoices` | unit | `-t advance` | ❌ |
| D-01 | Repo-scan guard: `salesorders_to_apply` appears in code only in `lib/limited-releases-deposit.js` | unit | `__tests__/salesorders-to-apply-guard.test.js` | ❌ |
| D-01 | **Existing ban tests unchanged and green** | regression | `npx jest __tests__/checkout-so-deposit-reconcile.test.js __tests__/kiosk-salesorders.test.js __tests__/collect-webhook-reconcile.test.js __tests__/helcim-terminal-success.test.js --coverage=false` | ✅ |
| D-14 | reCAPTCHA reject / network error in prod -> void + 400; rate limiter mounted; public reachability without API key; Zoho-offline -> void + 503 | unit/integration | `-t recaptcha`, `-t server-plumbing` | ❌ |
| D-15 | Newsletter only on strict `true` | unit | `-t newsletter` | ❌ |
| §9 | No email, phone or name in logs or events | unit | `-t pii` | ❌ |
| D-02 | LIMITED SO: charge = total - unused advance; credit applied between finalize and apply; amount_applied = remainder | unit | `__tests__/kiosk-salesorder-advance.test.js` | ❌ |
| D-02 | Non-LIMITED SO path identical (no extra Zoho calls) | regression | existing `kiosk-salesorders.test.js` | ✅ |
| D-02 | Retry cases (credit never applied; credit applied but charge failed) charge the same remainder | unit | `-t retry` | ❌ |
| D-02 | `finalize...` without `advance` is byte-identical (calls and order) | unit | new file, existing `money-path.test.js` stays | ❌ / ✅ |
| Frontend (assets §5) | All ten kits render in release order; alt non-empty; `scene_image:null` renders no empty frame; pairings; attribution; LE26 hero has no overlay text; every JSON path exists on disk | unit (jsdom) | `npx jest tests/frontend/limited-releases.test.js --coverage=false` | ❌ |
| Frontend (handoff §9, D-08, D-10) | Pay disabled until consent + >= 1 kit; total = 50 x kits; weeks shown only when non-null; sticky bar at >= 1 kit | unit | same | ❌ |
| Frontend (UI-SPEC) | "not charged" copy only when `voided:true` | unit | same | ❌ |
| Hold-back | No nav link on other pages, `noindex`, no sitemap entry | unit | `npx jest tests/frontend/limited-releases-holdback.test.js --coverage=false` | ❌ (deleted at launch) |
| Existing page tests | cookie-consent, legal-pages, page-search lists include the page | unit | `npx jest tests/frontend/cookie-consent.test.js tests/frontend/legal-pages.test.js tests/frontend/page-search-consistency.test.js --coverage=false` | ✅ (edit lists only) |
| SC3 / D-02 | Staging end-to-end and brew day (LV12) | manual UAT | owner-run runsheet | n/a |

### Sampling Rate
- **Per task commit:** the targeted `--coverage=false` run plus `npm run lint`.
- **Per wave merge:** both full suites. Any change to `lib/*` runs the full suite on both sides (rule 7).
- **Phase gate:** both suites green, `npm run build` regenerates artifacts, then the owner-signed staging run.

### Wave 0 Gaps
- [ ] `zoho-middleware/__tests__/preorder-deposit.test.js` (+ helper tests): copy the harness of `checkout-so-deposit-reconcile.test.js` (server-boot mocks plus the money-path mocks).
- [ ] `zoho-middleware/__tests__/salesorders-to-apply-guard.test.js`
- [ ] `zoho-middleware/__tests__/kiosk-salesorder-advance.test.js`
- [ ] `tests/frontend/limited-releases.test.js`, `tests/frontend/limited-releases-holdback.test.js`
- [ ] The staging spike script (Open Questions).
- [ ] Shared fixture: a minimal `content/limited-releases-2026-27.json` read, with no copy kept.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (public customer route) | n/a; the kiosk route keeps its device-token tier |
| V3 Session Management | No | n/a |
| V4 Access Control | Yes | Public-route allowlist in `server.js`; new kiosk route (if any) added to `authTiers` |
| V5 Input Validation | Yes | Strict allowlist, integer qty, string length caps, strict `consent.accepted === true`, strict-boolean newsletter |
| V6 Cryptography | No new crypto | Helcim hash or nonce binding is optional hardening |
| V7 Error handling / logging | Yes | Zero-PII `eventLog`; generic client errors (checkout M9 pattern) |
| V11 Business logic | Yes | Server-computed amount, replay guards, lock, bound transaction ownership |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered amount via `/api/payment/initialize` | Tampering | Server readback equal to 50 x kits, in cents |
| Replayed or cross-route transaction id | Spoofing/Tampering | Lock + replay guard across all suffixes; APPROVED + `purchase` |
| Void of someone else's charge | Tampering/DoS | Pitfall 1: nonce binding, no void without proof |
| Bots / card testing | Abuse | reCAPTCHA v3 fail-closed + `paymentLimiter` |
| PII in logs | Info disclosure | `redact.maskEmail`, event allowlist |
| Header/body injection into emails | Tampering | `emailLine`-style flattening (checkout.js), `htmlEscape` in mailer |
| Captured card with no record | Repudiation | Void + alert; pending sentinel; daily Helcim-vs-Zoho check |

## Sources

### Primary (HIGH confidence, codebase read directly)
- `zoho-middleware/lib/money-path.js`, `routes/checkout.js` (l.97-215, 217-305, 524-740, 853-974), `routes/pos.js` (l.2380-2860), `routes/payments.js`, `server.js` (l.100-122, 455-540, 700-800), `lib/zoho-api.js`, `lib/helcim.js`, `lib/checkout-helpers.js`, `lib/brewpad-integration.js`, `lib/reconcile.js`, `lib/mailer.js`, `lib/eventLog.js`, `lib/zohoAuth.js:100`
- Tests: `kiosk-salesorders.test.js`, `collect-webhook-reconcile.test.js`, `checkout-so-deposit-reconcile.test.js`, `money-path.test.js`; frontend `cookie-consent`, `legal-pages`, `page-search-consistency`
- `.planning/debug/kiosk-so-collect-draft-unapplied.md`, Phase 71 `71-03-SUMMARY.md`, `docs/STAGING-MIDDLEWARE-SETUP.md`, git history (`438400bb`, `0f879a54`, `5faf4ddb`, `6e05a60d`, `5948fb0b`), `package.json`, `100-CONTEXT.md`, `100-UI-SPEC.md`, both handoffs, `content/limited-releases-2026-27.json`

### Secondary (MEDIUM confidence)
- https://www.zoho.com/books/api/v3/customer-payments/ (create-payment args: `invoices` required, `description`, `retainerinvoice_id`; list filters; delete endpoint; `salesorders_to_apply` absent)
- https://www.zoho.com/books/api/v3/invoices/ (nav lists "Apply credits", "creditsapplied"; body not retrievable)
- https://hub.windmill.dev/scripts/zoho/21075/apply-credits-zoho (`POST /invoices/{id}/credits`, body shape)
- https://devdocs.helcim.com/docs/managing-customers-and-invoices (`invoiceRequest`, `customerRequest`)

### Tertiary (LOW confidence)
- Zoho sales-order docs returned 403/404, so SO void/delete endpoints and SO response fields (`balance`, payments) are unverified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No new packages; all in-repo.
- Money-path architecture: MEDIUM. Orchestration is solid; Zoho advance behaviour is LOW until the spike.
- Frontend: HIGH. Patterns are verified in the repo and a UI-SPEC exists.
- Pitfalls: HIGH for code-verified items (1-8). MEDIUM for exploitability claims.

**Research date:** 2026-10-29
**Valid until:** 2026-11-12 (the Zoho behaviours are stable but unverified; the suppliers' deadlines make the schedule short)
