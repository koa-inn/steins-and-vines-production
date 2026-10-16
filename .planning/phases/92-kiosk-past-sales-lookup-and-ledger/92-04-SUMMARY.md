---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 04
subsystem: middleware
tags: [kiosk, past-sales, customer-history, invoice-detail, express]
requires: [92-03]
provides:
  - GET /api/kiosk/past-sales/customer
  - GET /api/kiosk/past-sales/invoice/:id
affects: [92-07, 92-08]
key-files:
  modified:
    - zoho-middleware/routes/kiosk-history.js
  created:
    - zoho-middleware/__tests__/kiosk-history-customer.test.js
    - zoho-middleware/__tests__/kiosk-history-invoice.test.js
requirements-completed: [PSL-02, PSL-03, PSL-06, PSL-07]
metrics:
  completed: 2026-10-16
---

# Phase 92 Plan 04: Customer history and invoice detail Summary

Two read-only, kiosk-tier GET routes: 12-month source-tagged customer history with Load-older paging and server-side walk-in exclusion, and a validated, allowlisted invoice detail with status-dependent caching.

## Commit

| Task | Commit |
|------|--------|
| 1 + 2 (customer route, invoice route, tests) | 89a9f2af |

## Contract (matches 92-07 frontend)

- `GET /api/kiosk/past-sales/customer?customer_id&before&bust` returns `{ walk_in:false, customer_id, window_start, window_end, has_older, truncated, invoices }` or `{ walk_in:true, invoices:[] }`.
- `GET /api/kiosk/past-sales/invoice/:id` returns `{ invoice }` with DETAIL_KEYS; 400/404/502 as planned.
- Verified against js/kiosk-core.js (lines ~4620-4930): the frontend reads `walk_in`, `invoices`, `window_start`, `has_older`, `truncated`, and per-row `invoice_id/invoice_number/date/status/source/total`; for detail `invoice.line_items[name,quantity,rate,amount]`, `sub_total`, `tax_total`, `total`. Status labels Paid/Unpaid/Partial/Void are handled by `kioskPsStatusLabel`/`kioskPsBadgeClass`. No mismatch found; no server or frontend change needed.

## Deviations from Plan

1. **[Owner decision 92-01] Payments lookup only for all-digit references.** Blank references classify in-store with no lookup (`hist.classify`), so `/customerpayments` is fetched only when a window has an all-digit reference. The plan's blank-ref-with-note tests were replaced by blank -> in-store tests.
2. **detail-fallback / none-mode customer tests skipped.** Only list-join exists (92-03); other modes return 502, covered by a test.
3. **Payments call is date-ranged.** `/customerpayments` is sent with `customer_id` plus the same `date_start`/`date_end` as the invoice window (honored per 92-01) to reduce truncation; plan only specified `customer_id`.
4. **Single commit for both tasks.** Both routes live in one file, so tasks 1 and 2 were committed together.
5. `before` is accepted up to window end (today + 1); a `before` below the 10-year floor is 400, and a window starting below the floor is clamped to the floor with `has_older:false`.

## Verification

New tests pass (customer + invoice + ledger + lib: 88 pass). Root `npm test` 2619 pass; middleware full suite only the 2 known `vancouver-timezone` Node 20 failures; both lints clean. No write routes, no `/salesorders`, no `customer_name` queries.

## Known Stubs

None.

## Self-Check: PASSED
