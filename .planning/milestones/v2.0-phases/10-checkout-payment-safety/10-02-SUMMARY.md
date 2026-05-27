---
phase: 10-checkout-payment-safety
plan: 02
subsystem: checkout-email
tags: [email, fallback, smtp, resilience, eventLog]
dependency_graph:
  requires: []
  provides: [smtp-fallback-email, email-failure-monitoring]
  affects: [zoho-middleware/routes/checkout.js, zoho-middleware/lib/mailer.js]
tech_stack:
  added: []
  patterns: [fire-and-forget-with-fallback, eventLog-for-monitoring]
key_files:
  created:
    - zoho-middleware/__tests__/checkout-fallback-email.test.js
  modified:
    - zoho-middleware/lib/mailer.js
    - zoho-middleware/routes/checkout.js
decisions:
  - "Plain-text SMTP fallback only fires when Zoho email API fails — not a redundant send"
  - "eventLog entries contain orderNumber and truncated error message only — zero PII"
metrics:
  duration_seconds: 167
  completed: "2026-05-06T00:33:14Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 10 Plan 02: SMTP Fallback Email and Email Failure Monitoring Summary

SMTP fallback confirmation email via nodemailer when Zoho email API fails, plus eventLog monitoring for both staff and customer email failures.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add sendCustomerConfirmation and wire fallback + eventLog | 19b0e47 | zoho-middleware/lib/mailer.js, zoho-middleware/routes/checkout.js |
| 2 | Unit tests for fallback email behaviors | c2ff108 | zoho-middleware/__tests__/checkout-fallback-email.test.js |

## Changes Made

### Task 1: SMTP Fallback + EventLog Wiring

- Added `sendCustomerConfirmation(data)` function to `mailer.js` — sends plain-text order confirmation via SMTP with order number, item list, and timeslot
- Modified customer email `.catch()` in `checkout.js` — on Zoho email failure, calls `mailer.sendCustomerConfirmation()` as fallback; if fallback also fails, logs via `eventLog.logEvent('checkout.customer_email_failed', ...)`
- Modified staff email `.catch()` in `checkout.js` — added `eventLog.logEvent('checkout.staff_email_failed', ...)` for monitoring visibility
- Customer always sees success page regardless of email delivery (D-06 confirmed — response sent before email fire-and-forget)

### Task 2: Unit Tests

- Created `checkout-fallback-email.test.js` with 5 tests covering:
  - Correct subject line with order number
  - Item names appear in email body
  - Rejects with error when no email provided
  - Timeslot included when provided
  - replyTo set from CONTACT_TO env var
- All 5 tests pass; full middleware suite (431 tests) passes with 0 failures

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. `grep -c "sendCustomerConfirmation" zoho-middleware/lib/mailer.js` = 2 (function def + exports)
2. `grep -c "SMTP fallback" zoho-middleware/routes/checkout.js` = 1
3. `grep -c "staff_email_failed" zoho-middleware/routes/checkout.js` = 1
4. `npx jest __tests__/checkout-fallback-email.test.js` = 5 passed, 0 failed
5. `npm test` (full suite) = 431 passed, 0 failed

## Threat Surface Scan

No new threat surfaces introduced. The SMTP fallback uses existing `createTransport()` with existing credentials. Email body contains only order number and item names — no PII beyond customer's own email address (which they provided). eventLog entries contain only orderNumber and truncated error strings, compliant with zero-PII policy.

## Known Stubs

None. All functions are fully implemented and wired.

## Self-Check: PASSED
