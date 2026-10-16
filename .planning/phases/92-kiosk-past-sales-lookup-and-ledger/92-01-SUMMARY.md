---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 01
subsystem: api
tags: [zoho-books, customerpayments, spike, fixture, sanitizer]

requires: []
provides:
  - Read-only staging spike for Zoho past-sales shapes
  - Sanitized fixture zoho-past-sales-shapes.json with _meta.join_mode = list-join
affects: [92-03, 92-04]

key-files:
  created:
    - zoho-middleware/scripts/spike-past-sales-shapes.js
    - zoho-middleware/__tests__/spike-past-sales-sanitize.test.js
    - zoho-middleware/__tests__/fixtures/zoho-past-sales-shapes.json
  modified: []

key-decisions:
  - "join_mode = list-join (gate not triggered); see caveat on note coverage"

requirements-completed: [PSL-01, PSL-05]

duration: ~40min
completed: 2026-10-16
---

# Phase 92 Plan 01: Past-sales Zoho shape spike Summary

**Live read-only spike of Zoho GET /customerpayments, /invoices and /invoices/:id on staging; payments list links invoices via an `invoice_numbers` comma string and carries note text in `description`, so join_mode is list-join, with a coverage caveat on how often notes are populated.**

## Accomplishments

- Spike script (GET only, staging-only guard, sequential, per_page 5) with a PII sanitizer, covered by 13 tests (9 sanitizer, 4 committed-fixture leak checks).
- Sanitized fixture committed (sample day 2026-10-03, 3 payments and 3 invoices plus one invoice detail).

## Task Commits

1. Task 1: spike script and sanitizer test - d2f8d926
2. Task 2: sanitized fixture, bootstrap and url redaction fixes, fixture tests - b5afa927
3. Task 3: gate not triggered (list-join), no code

## Findings (fixture `_meta`)

- linkage_field: `invoice_numbers` (comma string, e.g. "INV-000171"); `applied_invoices` is present but empty and there is no `invoices[]` array on list rows.
- notes_field: `description` (the money paths write `notes`; Zoho returns it as `description` on the list).
- notes_in_list: true; notes_in_detail: false; notes_available_in: `list`; join_mode: `list-join`.
- payment_modes_seen: `creditcard`, `cash`.
- customerpayments_date_range_honored: true. `date_start`/`date_end` work (Zoho echoes comparator "range"), contrary to the docs.
- Invoice list rows carry `created_time` with offset (e.g. `2026-10-03T15:58:36-0700`); invoice_list_has_created_time: true.
- Invoice detail has `sub_total`, `tax_total`, `total`, `balance`; it has NO `payments[]` key (detail_had_payments false on every day sampled), and no `balance_due` on a paid invoice.
- Payment rows also carry `created_time`, `payment_status`, `payment_type`, `gateway_transaction_id`.
- customer_payments_sampled: false (no SO-pay customer identified).

Assumptions: A1 held (as `invoice_numbers`, not `invoices[]`). A2 held in shape only (see caveat). A3 date filter works; paging not exercised. A4 held except `balance_due` and `payments[]`. A5 held for sampled rows.

## Caveat for 92-03 (important)

Across 12 sampled staging days (2026-09-26 to 2026-10-16, 5 rows per day), only 1 of about 13 payment rows had money-path text in `description` (2026-10-03, "Kiosk POS terminal payment."). Every other payment, including KIOSK- cash and card sales, had a blank `description`. The script derives list-join from "at least one row has a known prefix", so the verdict is technically correct but note coverage is weak, and no SO-pay payment was seen. Rule (b) of the D-01 classifier (SO-pay found by payment note) is therefore unproven in practice. 92-03 should not rely on notes alone, and should treat notes as a best-effort signal on top of the KIOSK- reference rule. Also seen: payment `date` often differs from invoice date or no payment appears on the invoice's day (e.g. 2026-10-12), which supports querying payments across D and D+1 and joining by invoice number rather than by day.

## Join-mode owner decision

decision: list-join (gate not triggered)

## Deviations from Plan

**1. [Rule 3 - Blocking] Spike needed to bootstrap Redis and Zoho auth**
- **Found during:** Task 2, first run failed with "Not authenticated".
- **Fix:** main() now calls cache.init() then zohoAuth.init() (same as replay-collect-webhook.js) before any GET.
- **Commit:** b5afa927

**2. [Rule 2 - Security] Sanitizer leaked `invoice_url` (secure payment link) and `contact_number`**
- **Found during:** reviewing the first live output before committing.
- **Fix:** keys ending in `url` and `contact_number` are now redacted; the raw first-run output was never committed.
- **Commit:** b5afa927

**3. Entry-point guard:** `require.main` is undefined under `node -`, so main() also runs when it is undefined. Fixture additionally includes a `customerpayments_range_list` section and hand-added `_meta.survey_*` fields.

## Issues Encountered

- `cd zoho-middleware && npm test` shows 2 failures in `__tests__/vancouver-timezone.test.js` because the local default is Node 20.20.2 (tzdata); prod and staging run Node 24. Unrelated to this plan. Root `npm test` (2586) and both lints pass.
- No Zoho writes occurred. Staging was only read via `railway ssh` (service sv_middleware). The script was piped via stdin to /tmp/spike.js inside the staging container.

## Self-Check: PASSED

Files exist (script, test, fixture); commits d2f8d926 and b5afa927 present; fixture has no '@', no 10-digit runs, all customer_name REDACTED.
