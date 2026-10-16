---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 07
subsystem: kiosk-frontend
tags: [kiosk, past-sales, by-customer, d-11]
requirements: [PSL-02, PSL-04, PSL-06, PSL-07]
key-files:
  modified:
    - js/kiosk-core.js
    - js/kiosk.js
    - js/kiosk-core.min.js
    - js/kiosk.min.js
    - kiosk.html
  created:
    - tests/frontend/kiosk-past-sales-customer.test.js
metrics:
  tasks: 2
  completed: 2026-10-16
---

# Phase 92 Plan 07: By-customer tab Summary

By-customer tab on the kiosk Past Sales view: debounced contact search, 12-month source-tagged invoice history with Load older, walk-in message, shared detail expand, bust-refresh and D-11 clearing.

## Commits
- 424eb682: kiosk-core.js customer tab, kiosk.js search/Load-older wiring, 14 jsdom tests
- 313a28ef: rebuilt kiosk-core.min.js, kiosk.min.js, restamped kiosk.html

## Details
- Replaced the 92-06 no-op hooks with real `_kioskPsCustomerClear` (resets contact, history count, window start, debounce timer) and `_kioskPsCustomerRefresh` (reloads with bust=1 and no `before`).
- Contact search: 2-char minimum, 300 ms debounce, `/api/contacts/search?q=` via the generation-guarded `_kioskPsFetch`; dropdown shows contact name only (email/phone never rendered; discretion choice per plan).
- History rows reuse `kioskPsRowHtml` with new opts: `showSource` (In-store/Online/Other badge, any unknown source renders as Other) replaces the tender and customer-name spans, `dateInstead` shows the date. Row click uses the shared `kioskPsToggleDetail`.
- Load older fetches `before=<window_start>` and appends; hidden when `has_older` is false or no window_start.
- Walk-in message is the exact D-09 string. Error state has a Retry button.
- Exports: `pastSalesSearch`, `pastSalesSelectContact`, `pastSalesLoadOlder`; `_getPastSalesState` now also returns `contact`, `historyCount`.
- Status badge for `partially_paid` renders "Partial" (existing 92-06 mapping).

## API contract expected by the frontend
- `GET /api/contacts/search?q=<>=2 chars>` -> `{ contacts: [{ contact_id, contact_name, ... }] }` (existing; only id and name used).
- `GET /api/kiosk/past-sales/customer?customer_id=<id>[&before=YYYY-MM-DD][&bust=1]` -> `{ walk_in:false, customer_id, window_start, window_end, has_older, truncated, invoices:[{ invoice_id, invoice_number, date, source ('in-store'|'online'|'other'), status, total, ... }] }` or `{ walk_in:true, invoices:[] }`. Non-2xx -> error message with retry.
- `GET /api/kiosk/past-sales/invoice/<id>` -> `{ invoice:{ line_items, sub_total, tax_total, total, ... } }` (92-06 shared detail).
- All requests use device-token auth via `_kcMergeAuth`.

## Deviations from Plan
- Wiring test filters fetch URLs with `some()` because kiosk init also fetches `/api/kiosk/discounts`. No functional deviation.
- `npm run build` restamped ~25 unrelated HTML files and admin.js/admin.min.js; only kiosk.html, kiosk-core.min.js, kiosk.min.js committed, the rest left uncommitted.
- Middleware `vancouver-timezone.test.js` fails 2 tests on Node 20 (pre-existing, ignored). Root `npm test` (2619) and `npm run lint` pass.

## Known Stubs
None. The API (92-04) was not merged in this worktree, so integration with the real endpoint is untested here (fetch mocked per plan).

## Self-Check: PASSED
