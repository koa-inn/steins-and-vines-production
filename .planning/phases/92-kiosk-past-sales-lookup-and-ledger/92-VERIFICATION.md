---
phase: 92-kiosk-past-sales-lookup-and-ledger
verified: 2026-10-16T00:00:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 92: Kiosk past-sales lookup and ledger Verification Report

**Phase Goal:** Two read-only kiosk views over Zoho invoices: (1) past-order lookup by customer; (2) one-day in-store sales ledger with day picker, count and gross total.
**Status:** passed (human-only checks covered by owner UAT approval 2026-10-16, per 92-08-SUMMARY)
**Re-verification:** No, initial verification

## Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| PSL-01 | Ledger scope, day filter, footer total, voids | SATISFIED | `routes/kiosk-history.js` `buildLedger`: single-day query, `createdDay` filter, `classify` to in-store only (blank reference = in-store per owner decision), `prev_date`/`next_date`, future dates and pre-2020 rejected with 400. `lib/kiosk-history.js` `ledgerTotals` skips Void rows from count and total. Rows sorted newest first via `sortByCreatedDesc`. |
| PSL-02 | Customer lookup, 12-month window, Load older, walk-in | SATISFIED | `/api/kiosk/past-sales/customer`: 12-month window, `before` param for older, 120-month floor, `has_older`. The `customer_id` filter is re-checked server-side. `walk_in: true` is returned for `KIOSK_CONTACT_ID`. Source tag comes from `classify`. Client uses `/api/contacts/search` (`kiosk-core.js` ~4867). |
| PSL-03 | Auth tier, slim allowlist, read-only | SATISFIED | Each handler self-gates with `requireTiers(['legacy','device','session'])`. Only GET routes exist. Paths are added to the device-token allowlist in `lib/authTiers.js:70-100`. `slimInvoiceRow` and `slimInvoiceDetail` return explicit fields only (no email, phone, address, notes or payment refs). Query params are limited to date, customer_id, before and bust. Caps are hard-coded. |
| PSL-04 | Customer View isolation | SATISFIED | `kioskShowView` clears Past Sales state for every view except `past-sales` (`kiosk-core.js:953`). The button is hidden in `browse-customer` (:960), the show function refuses it (:4508), and the lock screen clears data (`kiosk.js:330`). A generation counter drops late responses. |
| PSL-05 | Ledger tender | SATISFIED | One ranged `/customerpayments` query per day, indexed by invoice number via `indexPaymentsByInvoice`, mapped by `tenderLabel` (supports split tender). `tender_incomplete` flag covers truncation. Customer history returns status only. |
| PSL-06 | Inline line items on tap | SATISFIED | `/api/kiosk/past-sales/invoice/:id` returns slim line items. Client fetches on tap (`kiosk-core.js:4764`) and caches in memory. There is no up-front fan-out. |
| PSL-07 | Cache plus refresh | SATISFIED | `cachedOrBuild` with 60 s for today and for customer lists, 3600 s for past days and paid/void details. `bust=1` bypasses the cache. Zoho failures are not cached and return 502. The refresh button is wired (`kiosk.js:1593` to `pastSalesRefresh`). |

No orphaned requirements. PSL-01..07 are all claimed by plans and are defined in ROADMAP, not REQUIREMENTS.md.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Staff can search a name, pick a contact and see invoices (date, number, total, status) | VERIFIED | Customer route plus By-customer tab wiring (`kiosk.js:1589` search, `kiosk-core.js` `pastSalesSelectContact`) |
| 2 | Line items are one tap away | VERIFIED | Invoice detail route plus `pastSalesToggleDetail` |
| 3 | Ledger shows one day, newest first, with day picker, count and gross total | VERIFIED | Ledger route, prev/next/date input wiring (`kiosk.js:1579-1585`) |
| 4 | Read-only | VERIFIED | Only `router.get` in `kiosk-history.js`; no write calls to Zoho |
| 5 | Auth gated, PII-slim | VERIFIED | See PSL-03 |
| 6 | Customer View isolation | VERIFIED | See PSL-04 |
| 7 | Built artifacts regenerated | VERIFIED | `past-sales` present in `js/kiosk-core.min.js` and `js/kiosk.min.js` |

## Artifacts and Wiring

| Artifact | Status |
|----------|--------|
| `zoho-middleware/lib/kiosk-history.js` (pure helpers) | VERIFIED, imported by the router |
| `zoho-middleware/routes/kiosk-history.js` | VERIFIED, mounted at `server.js:791` |
| `lib/authTiers.js` allowlist entries | VERIFIED |
| `kiosk.html` button (`#kiosk-past-sales-btn`) and view (`#kiosk-view-past-sales`) | VERIFIED |
| `js/kiosk-core.js` and `js/kiosk.js` wiring | VERIFIED, exports and listeners present |

Data flows from real Zoho `/invoices` and `/customerpayments` calls to the slim maps and then the client render. There are no hardcoded or static returns.

## Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `jest __tests__/kiosk-history` (middleware, 4 suites) | PASS: 88 passed, 1 skipped |
| `jest tests/frontend/kiosk-past*` (2 suites) | PASS |
| ESLint on the new and changed files | clean |

## Anti-Patterns

No TBD/FIXME/XXX markers introduced. The one `'TBD'` hit at `kiosk-core.js:4130` is a pre-existing day-label string, not a debt marker.

## Notes (not gaps)

- The blank-reference in-store classification is an owner-approved amendment to D-01.
- The week/month view is a deferred follow-up.
- The local Node 20 `vancouver-timezone` failures are a pre-existing environment issue.
- The one skipped middleware test was not investigated.
- Prod deploy is not part of this phase's verification; staging UAT was approved.

## Human Verification Required

None outstanding. iPad rendering and live Zoho data were covered by the owner UAT approval on 2026-10-16.

## Gaps Summary

No gaps. The phase goal is achieved in the codebase.

---

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
