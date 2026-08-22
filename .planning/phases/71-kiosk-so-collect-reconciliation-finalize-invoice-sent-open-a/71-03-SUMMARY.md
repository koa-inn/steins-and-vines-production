---
phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a
plan: 03
subsystem: payments
tags: [checkpoint, human-verify, live-verification, zoho-books, staging, webhook-replay, money-path]

# Dependency graph
requires:
  - phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a
    provides: "71-01's finalize-invoice-and-apply money-path fix (ensureOpenInvoiceForSalesOrder + apply customerpayment via invoices[]), deployed to the staging Railway middleware on origin/main"
provides:
  - "Live-Zoho confirmation that a kiosk SO collection reconciles to a single finalized, fully-paid invoice with the payment applied (unused_amount 0) and no duplicate — exercised against the deployed Aug-19 fix, not mocks"
affects: [71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Terminal-webhook-dependent money-path cannot be verified end-to-end on staging by a physical card tap: Helcim delivers the terminal webhook to a single URL (production), so a staging-kiosk tap seeds the pending key in staging Redis while the approval webhook lands on prod and never reconciles through the staging code."
    - "Verify such flows via the staging-gated replay helper (zoho-middleware/scripts/replay-collect-webhook.js) run INSIDE the staging container — it synthesises a signed cardTransaction webhook, reuses an existing APPROVED Helcim txn as the correlation key (no new charge), and drives the real staging finalize+apply logic against the live Zoho org (Option B)."
    - "Independent verification of a checkpoint PASS by re-reading the Zoho end-state (SO -> invoices[], customerpayment unused_amount + reference) rather than trusting the helper's self-reported PASS alone."

key-files:
  created: []
  modified: []

key-decisions:
  - "SO-000076 (owner's recollection of a prior successful collect) was REJECTED as 71-03 evidence: it was charged/reconciled 2026-08-14, five days before the Phase-71 fix commits landed on main (2026-08-19: 94056cd1, 9a90e961, dd08c1e3, 5ec852f0). Its clean end-state could not have been produced by the code under test, so a fresh run against the deployed staging fix was required."
  - "A real terminal tap was NOT used to verify: the collect flow completes via /api/webhooks/terminal, which Helcim delivers only to production — a staging tap cannot reconcile through the staging middleware. Verified instead via the replay helper (the purpose-built path)."
  - "Reused Helcim txn 53184102 (the original SO-000076/INV-000169 charge) purely as the webhook correlation key — NO new charge occurred. Consequently do NOT refund/void txn 53184102 in cleanup (that would reverse the original SO-000076 payment); cleanup is limited to voiding INV-000180 + payment #181."

requirements-completed: ["71-D1-finalize-invoice", "71-D2-apply-to-invoice"]

# Metrics
completed: 2026-08-22
---

# 71-03 — Live SO-collect reconciliation (staging) — VERIFIED PASS

## What was verified
The Phase-71 money-path fix (SO invoice finalized via `ensureOpenInvoiceForSalesOrder`,
customerpayment applied to that invoice via `invoices:[{invoice_id, amount_applied}]`,
never the old `salesorders_to_apply` advance) was exercised end-to-end against the
**deployed staging middleware** (`svmiddleware-staging.up.railway.app`, `SENTRY_ENVIRONMENT=staging`,
running `origin/main` @ `43d49378`) and the **live Zoho org** (Option B).

## Method
Physical terminal tap is not verifiable on staging (Helcim terminal webhook → prod only),
so verification used the staging-gated replay helper inside the staging container:

```
railway ssh --environment staging --service sv_middleware
cd zoho-middleware
node scripts/replay-collect-webhook.js --txn 53184102 --so 109900000001219004 --confirm-so
```

- `--so 109900000001219004` = **SO-000079**, a fresh $0.22 draft test SO (owner-created 2026-08-22).
- `--txn 53184102` = reused APPROVED Helcim txn (correlation key only — **no new charge**).
- Helper seeded `collect:pending:SO-000076` (the reused txn's invoiceNumber) → posted a signed
  `cardTransaction` webhook to staging `/api/webhooks/terminal` (200 `{received:true}`) → the
  handler finalized the SO invoice and applied the payment.

## Result (independently re-checked in Zoho, not just the helper's PASS)

| Check | Observed |
|---|---|
| SO end-state | SO-000079 — `invoiced` / `closed` / **paid**, balance **$0.00** |
| Invoice | **INV-000180** — status **paid**, total $0.22, balance **$0.00**, reference `SO-000079` |
| Duplicate invoice? | **No** — exactly one invoice linked to the SO |
| Payment | Payment **#181** — creditcard, $0.22, `invoice_numbers: INV-000180`, **`unused_amount 0`** |
| Helcim reference | `53184102` present on the payment reference |

Success criterion — "a real kiosk SO collection reconciles in Zoho to a paid invoice with the
payment applied (unused_amount 0) and no duplicate invoice" — **met**.

## Owner disposition
Verified live on staging by the owner (koainn@gmail.com), replay PASS + independent Zoho
re-check by the assistant. **Approved.**

## Cleanup (test data — hits live books under Option B)
- [ ] Void **INV-000180** and delete/void **payment #181** (SO-000079 test).
- Do **NOT** refund/void Helcim txn `53184102` — no new charge was made; it is the original
  SO-000076/INV-000169 payment reused only as a correlation key.
- SO-000079 itself is a throwaway "test" customer SO; void/close as desired after the invoice+payment are removed.

## Downstream
- v4.5 money-path (Phase 71) live-verified on staging → **unblocks the production cutover**
  (`docs/PROD-DEPLOY-70-71.md`): `railway up --environment production --service sv_middleware`
  first (middleware, verify `/health`), then `git push production main`. Not part of this plan;
  per CLAUDE.md, prod happens only after staging approval — now satisfied.
