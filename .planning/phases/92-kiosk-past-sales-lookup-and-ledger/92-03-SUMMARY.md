---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 03
subsystem: middleware
tags: [kiosk, past-sales, ledger, zoho, express]
requires: [92-01, 92-02]
provides:
  - GET /api/kiosk/past-sales/ledger (kiosk-scoped, read-only)
  - routes/kiosk-history.js scaffold (gate, cachedOrBuild, fetchPages, validateConfig) for 92-04
  - hist.indexPaymentsByInvoice
affects: [92-04, 92-06]
key-files:
  created:
    - zoho-middleware/routes/kiosk-history.js
    - zoho-middleware/__tests__/kiosk-history-ledger.test.js
  modified:
    - zoho-middleware/lib/kiosk-history.js
    - zoho-middleware/lib/authTiers.js
    - zoho-middleware/server.js
    - zoho-middleware/__tests__/kiosk-history-lib.test.js
key-decisions:
  - "JOIN_MODE = list-join; NONE_BLANK_POLICY = null; owner decision list-join-blank-in-store (92-01)"
  - "One ranged /customerpayments call (date_start=D, date_end=D+1) per A-05 since date range is honored"
metrics:
  completed: 2026-10-16
---

# Phase 92 Plan 03: Ledger route Summary

Kiosk-scoped, read-only `GET /api/kiosk/past-sales/ledger` returning one Vancouver day of in-store sales with tender, void-excluded totals, hard Zoho caps, 60 s/1 h cache with bust, and never-cached 502s.

## Config implemented

- JOIN_MODE `list-join`, NONE_BLANK_POLICY `null`, linkage `invoice_numbers` (comma string), notes read from `description`.
- Owner decision id: `list-join-blank-in-store` (92-01-SUMMARY "Join-mode owner decision").
- `validateConfig` runs at require time (bad config throws at load).

## Ledger response contract (for 92-06)

`GET /api/kiosk/past-sales/ledger?date=YYYY-MM-DD[&bust=1]` (only `date` and `bust` are read)

200: `{ date, today, prev_date, next_date (null when date === today), invoices: [row...] (newest first), count, gross_total, truncated, tender_incomplete, classification_incomplete (always false), unclassified_count (always 0) }`

row: `{ invoice_id, invoice_number, date, time, customer_name, source ('in-store'), status ('Paid'|'Partial'|'Void'|'Draft'|'Unpaid'), tender, total, balance }`

400 `{ error: 'bad_request', message }` (bad format, impossible, future, before 2020-01-01); 401/403 from requireTiers; 502 `{ error: 'Unable to fetch sales' }`.
`tender_incomplete` is true when payments paging was truncated or any Paid/Partial row has an empty tender.

## Tasks

| Task | Commit |
|------|--------|
| 1 Router scaffold, kiosk route registration, mount, payments index | 308a73d8 |
| 2 Ledger route, classification, tender, totals, cache, caps | 523de301 |

## Deviations from Plan

1. **[Owner decision] classify changed.** `hist.classify` in `lib/kiosk-history.js` now returns in-store for any blank reference regardless of payment note; KIOSK-/POS- in-store; all-digit online unless an in-store note; else other (an in-store note still marks a non-blank, non-digit ref in-store). Updated the Phase-92 `kiosk-history-lib.test.js` blank-ref expectations (online-note and "other"/null cases) accordingly and added tests. A blank-ref back-office invoice with no payment is now in the ledger (owner accepted).
2. **A-05 resolved to one ranged call** (`date_start=D, date_end=D+1`), as the fixture shows range is honored; D-14 deviation dropped.
3. **detail-fallback and none modes not built.** The plan's tests for those modes were not written because the owner chose list-join and the fixture shows invoice detail has no `payments[]` (fallback would be useless). `validateConfig` still accepts those values (per the plan's behavior spec), but the ledger rejects any non-list-join mode with a loud 502 plus log, tested.
4. Test fixtures adjusted for the owner decision (blank-ref invoice with no payment is in the ledger as in-store).

## Notes / smells

- Cached payloads embed `today`; across Vancouver midnight a cached past day (1 h TTL) can show a stale `next_date`. Minor; 92-06 can derive arrows from its own clock if it matters.
- Verification: new tests 24 pass; root `npm test` 2605 pass; both lints pass; middleware full suite only the 2 known `vancouver-timezone` failures (Node 20). server.js diff adds only the mount line; no write routes, no Promise.all, no request-controlled paging.

## Known Stubs

None.

## Self-Check: PASSED
