# Phase 71: Kiosk SO-Collect Reconciliation - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Source:** Owner handoff 2026-08-14 (SO-000076 / INV-000169 / Payment #170). Full root-cause diagnosis: **`.planning/debug/kiosk-so-collect-draft-unapplied.md`** (planner + executor MUST read it — it has the exact line anchors, the reuse pattern, tests, and the sibling bug).

<domain>
## Phase Boundary
Fix the kiosk "collect payment on an existing sales order" money-path so a charged SO collection actually reconciles in Zoho (paid invoice, applied payment) — matching the normal POS `processSale` end-state. Today the customer is charged but the invoice is left `draft` and the payment is created as an unapplied advance, silently.

Root cause (confirmed): `routes/webhooks.js:198-218` books the collect-flow customerpayment with `salesorders_to_apply: [{ salesorder_id, amount_applied }]` — which does NOT apply a payment to any bookable invoice in Zoho (payments reconcile against invoices via `invoices: [{ invoice_id, amount_applied }]`). The path also never finalizes the SO's invoice (never converts/marks it `sent`/open), and its only error handling is `log.warn` (no fail-closed, no reconcile record).

In scope: `zoho-middleware/routes/webhooks.js` (collect APPROVED path), possibly `zoho-middleware/routes/collect.js`, a shared finalize helper if extracted, `zoho-middleware/routes/checkout.js` (the sibling deposit bug — see below), and middleware tests. Out of scope: the kiosk client (this is a server/webhook reconciliation fix); the historical Zoho DATA cleanup (owner-gated, separate — see below).

## Confirmed correct pattern to reuse (already in-repo)
- `processSale`/`pos-recipe.js` book payments with `invoices: [{ invoice_id, amount_applied }]` (e.g. `pos.js:1576/1592/1611`, `pos-recipe.js:782`).
- SO→invoice conversion exists: `zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})` at `pos.js:2482`, then apply via `invoices:[...]` at `pos.js:2485-2489`.
</domain>

<decisions>
## Implementation Decisions
1. **Finalize the invoice, never leave draft.** In the collect APPROVED path, ensure an open/sent invoice exists for the SO — convert via `/invoices/fromsalesorder?salesorder_id=` (marked sent) or mark the existing draft invoice sent. Reuse the existing conversion/finalize approach from pos.js so the two paths can't drift; prefer extracting/using a shared finalize helper if clean.
2. **Apply the payment to the invoice.** Create the customerpayment with `invoices: [{ invoice_id, amount_applied }]` — NOT `salesorders_to_apply`. Result must be: invoice `paid` (balance 0), payment `applied_invoices` non-empty, `unused_amount` 0.
3. **Fail-closed after a successful charge.** If finalization fails after the Helcim charge, surface a clear error AND write a reconcile record (SO#, invoice#, Helcim txn) so a human / backstop can recover — do not silently leave a draft + unapplied payment. (Money-path doctrine from phases 45/49/68: a charge that can't book must be recoverable, not orphaned.)
4. **Sibling bug — include if low-risk:** `routes/checkout.js:693` (online deposit-on-a-salesorder) uses the same `salesorders_to_apply` construct — same class of orphaned-advance bug. Fix it in the same pass (apply to an invoice) OR, if it needs its own investigation, flag it and scope out with a note. Do NOT touch `pos.js:2465` (it's followed by a convert+apply and may be a correct third variant) without verifying it's actually broken.

## Claude's Discretion
- Whether to extract a shared finalize helper vs inline the convert+apply in the webhook path; exact reconcile-record shape (mirror KIOSK_PENDING_CHARGE / the 45-08 backstop where sensible); error surfacing mechanism for a webhook-time failure (the collect result reaches the kiosk via the terminal-result poll — surface there).

## Explicitly out of scope
- **Historical data cleanup** (find + repair existing draft `SO-` invoices with unapplied payments). This is live-accounting mutation, owner-gated, done read-only-audit-first then per-record confirm — NOT part of this code phase. A follow-up.
</decisions>

<canonical_refs>
- `.planning/debug/kiosk-so-collect-draft-unapplied.md` — the diagnosis (PRIMARY)
- `zoho-middleware/routes/webhooks.js:188-232` — the broken collect APPROVED path
- `zoho-middleware/routes/collect.js` — `POST /api/pos/collect` (pending-context setup)
- `zoho-middleware/routes/pos.js` — the correct finalize+apply pattern (1551 invoice create, 1576/1592/1611 apply; 2482 fromsalesorder convert, 2485-2489 apply)
- `zoho-middleware/routes/pos-recipe.js:766/782` — another correct invoice+apply
- `zoho-middleware/routes/checkout.js:693` — sibling `salesorders_to_apply` deposit bug
- Money-path doctrine: phases 45/49/68 (no orphaned charge; fail-closed; reconcile backstop). `CLAUDE.md` — regression-test-first, `cd zoho-middleware && npm test`.
</canonical_refs>

<specifics>
- Confirmed example: SO-000076 → INV-000169 stuck `draft` $649.74, Payment #170 unapplied advance (`unused_amount: 649.74`), Helcim txn 53184102 (charged fine). INV-000169 already hand-repaired by owner.
- This is server/webhook only — no js/ or kiosk.html changes expected; no min rebuild.
</specifics>

<deferred>
- Historical Zoho data audit + repair (owner-gated).
- A broader "SO/deposit finalize" unification if checkout.js turns out to need deeper rework.
</deferred>

---
*Phase: 71-kiosk-so-collect-reconciliation*
