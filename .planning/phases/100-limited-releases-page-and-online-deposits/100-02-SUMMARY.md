---
phase: 100-limited-releases-page-and-online-deposits
plan: 02
subsystem: payments
tags: [zoho-books, helcim, helcimpay, spike, customer-payments, advance]

requires:
  - phase: 100-limited-releases-page-and-online-deposits
    provides: phase context, research LV1-LV11 questions
provides:
  - Staging-gated live spike script for Zoho advance behaviour and Helcim nonce propagation
  - 100-SPIKE-RESULTS.md with LV1-LV11 answers, confirmed endpoints, deposit lookup decision, cleanup ledger
  - Go/no-go - Plan A (owner confirmed 2026-10-29)
affects: [100-05, 100-06, 100-07, 100-08, 100-12, 100-13]

tech-stack:
  added: []
  patterns:
    - "Deposit found by description text + unused_amount in list rows (no SO linkage in Zoho)"
    - "Nonce bound via invoiceRequest.invoiceNumber, read back from top-level invoiceNumber"

key-files:
  created:
    - zoho-middleware/scripts/spike-limited-release-advance.js
    - .planning/phases/100-limited-releases-page-and-online-deposits/100-SPIKE-RESULTS.md
  modified: []

key-decisions:
  - "Plan A: salesorders_to_apply advance + /invoices/{id}/credits (owner confirmed 2026-10-29)"
  - "LV11 propagates: yes - D-17 nonce binding works"
  - "Deposit payment located by description (marker + SO number), one payment per SO"

requirements-completed: [D-01, D-02, D-16, D-17]

duration: multi-session
completed: 2026-10-29
---

# Phase 100 Plan 02: Live Spike Summary

**Live spike proved Zoho customer-payment advances apply via /invoices/{id}/credits and that HelcimPay carries invoiceRequest.invoiceNumber into the card-transaction readback, so Plan A is a go.**

## Accomplishments

- Spike script (1db398fa), refuses to run unless SENTRY_ENVIRONMENT is staging, self-cleaning.
- LV1-LV10 answered against the live Zoho org: advance exists (`unused_amount` 50) but `salesorders_to_apply` does not link it to the SO; conversion does not auto-apply; `/credits` applies it; description persists, notes do not; duplicate reference_number accepted; list rows carry `unused_amount`; two-entry `salesorders_to_apply` rejected.
- LV11: owner paid $1.00 (txn 57428079), nonce `LR-SPIKE-2bd2028e` returned in both the postMessage payload and the `invoiceNumber` field of the readback. Charge voided.
- Cleanup ledger clean: all Zoho records deleted/voided, Helcim charge voided; Helcim customer CST1211 left in place.

## Task Commits

1. Task 1 spike script - 1db398fa
2. Task 1b fix invoiceRequest.lineItems required - d236e357
3. Task 2 Zoho half LV1-LV10 - 09c2f286
4. Task 3 LV11 and go/no-go - see final commit "docs(100): spike results LV11 and go/no-go (Plan A)"

## Deviations from Plan

**1. [Rule 1 - Bug] Helcim requires lineItems with invoiceRequest**
- Found during: Task 3 (first --helcim-init)
- Issue: invoiceRequest with only invoiceNumber is rejected 400; top-level invoiceNumber rejected "Invalid Invoice Number".
- Fix: spike script now sends invoiceRequest.lineItems (d236e357).
- Follow-up: `zoho-middleware/lib/helcim.js` (Plan 03) still sends invoiceRequest with invoiceNumber only and no lineItems; Plan 06 Task 0 must add lineItems.

**2. [Rule 3 - Blocking] Localhost iframe harness failed**
- Chrome rendered a broken frame for the Helcim iframe from http://localhost:8765 (cause unconfirmed). First token expired unused, never charged.
- Workaround: orchestrator injected start.js + appendHelcimPayIframe at runtime into https://staging.steinsandvines.ca/robots.txt (nothing committed or deployed). Plan 13 deposits run from the real page.

**3. Cleanup leftovers fixed by hand (Task 2)**
- Script cleanup ran the invoice step before deleting its payment, leaving invoice, SO-B and contact; a manual second pass from the container cleared them. Script ordering (payment before invoice) could be tidied but the script is throwaway.

**4. Zoho numbering gaps**
- INV-000254 and SO-000082..084 were consumed by the spike; gaps will appear in the books.

## Ops note

Staging container: repo root `/app`, middleware `/app/zoho-middleware`; run `railway ssh -e staging -s sv_middleware -- sh -c 'cd zoho-middleware && node scripts/...'`.

## Known Stubs

None.

## Self-Check: PASSED
