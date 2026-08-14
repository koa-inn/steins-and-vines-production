---
status: diagnosed
created: 2026-08-14
source: owner handoff (SO-000076 / INV-000169 / Payment #170, org 110002406307, 2026-08-14)
severity: high
area: kiosk money-path (SO collection → Zoho reconciliation)
---

# Kiosk "collect payment on SO" leaves invoice DRAFT + payment UNAPPLIED

## Confirmed root cause (code)

The SO-collection flow books the customer payment against the **sales order**, not the **invoice** — so Zoho never reconciles it.

- Flow: `POST /api/pos/collect` (`routes/collect.js`) pushes the SO balance to the Helcim terminal and caches a pending context. On the APPROVED Helcim webhook, `routes/webhooks.js:198-218` creates the customer payment.
- **The bug is at `webhooks.js:206`:** the payment is created with `salesorders_to_apply: [{ salesorder_id, amount_applied }]`. Zoho Books customer payments reconcile against **invoices** via the `invoices: [{ invoice_id, amount_applied }]` array — `salesorders_to_apply` does not apply the payment to any bookable invoice, so the payment lands as an **unapplied advance** (`applied_invoices: []`, `unused_amount` = full amount). Matches Payment #170 exactly.
- The collect flow also never **finalizes the invoice**: it does not convert the SO to an invoice, nor mark the existing draft invoice `sent`/open. A draft invoice can't accept a payment, so INV-000169 stays `draft`, balance unpaid.
- No fail-closed: the webhook block's only error handling is `.catch(log.warn)` (webhooks.js:230-231). A failure after the Helcim charge leaves money collected with no alert and no reconcile record — and even the "success" path produces the orphaned state silently.

## The correct pattern already exists in-repo (reuse it)

`processSale` (the normal kiosk POS path) and `pos-recipe.js` both do it right:
- Create/finalize the invoice, then book the payment with `invoices: [{ invoice_id, amount_applied }]` — e.g. `pos.js:1576/1592/1611`, `pos-recipe.js:782`, `pos.js:2039`.
- The codebase even has SO→invoice conversion: `zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})` at `pos.js:2482`, followed by an `invoices:[...]` apply at `pos.js:2485-2489`.

So the fix is to make the collect webhook path mirror that finalized end-state, using building blocks already present.

## Sibling bug (flag, likely same fingerprint)

`routes/checkout.js:693` — the online **deposit-on-a-salesorder** path also books `salesorders_to_apply` on a customerpayment. Same class of bug; likely leaves the same orphaned-advance + draft state. Worth auditing/fixing in the same pass.
(`pos.js:2465` also references `salesorders_to_apply`, but is immediately followed by the `/invoices/fromsalesorder` convert + `invoices:[...]` apply at 2482-2489 — verify whether that path is actually correct or a third variant before touching it.)

## Suggested fix (code)

In the collect APPROVED path (webhooks.js) — or better, a shared finalize helper reused by both `processSale` and collect so they can't drift:
1. Ensure an invoice exists and is **open/sent** for the SO — convert via `/invoices/fromsalesorder?salesorder_id=` (mark sent) or mark the existing draft invoice sent — never leave `draft`.
2. Create the customer payment linked to that invoice: `invoices: [{ invoice_id, amount_applied }]` — NOT `salesorders_to_apply`.
3. Fail-closed: if finalization fails after a successful Helcim charge, surface a clear error to the kiosk AND write a reconcile record (SO#, invoice#, Helcim txn) so the 45-08-style backstop / a human can recover it — do not silently leave a draft + unapplied payment. (The collect flow currently writes no `KIOSK_PENDING_CHARGE`-equivalent for this recovery.)

## Tests to add
- SO-collection happy path → invoice ends `open`→`paid` (balance 0); payment `applied_invoices` non-empty, `unused_amount` 0.
- Payment created linked to the invoice (never an orphaned advance / `salesorders_to_apply`).
- Simulated failure after charge → error surfaced + reconcile log entry; no silent draft.
- Regression on checkout.js:693 deposit path if fixed in the same pass.

## Data cleanup (SEPARATE from the code fix — money-path, owner-gated)
Historical audit for the same fingerprint: invoices with `status: draft` + `reference_number` starting `SO-`, AND a same-customer, same-amount customer payment with `unused_amount > 0` and empty `applied_invoices`.
Repair per the manual INV-000169 fix: Mark invoice Sent → Apply Credits (the unapplied payment) → invoice Paid, SO flips to paid. **These are mutations on live accounting data — do them read-only-audit first, then owner-confirm each repair; do not auto-apply.** No re-charge.

## Recovery already performed (owner)
INV-000169 fixed by hand (Mark As Sent → Apply Credits $649.74 / txn 53184102 → Paid, balance $0). This doc is about preventing recurrence + finding/repairing siblings.
