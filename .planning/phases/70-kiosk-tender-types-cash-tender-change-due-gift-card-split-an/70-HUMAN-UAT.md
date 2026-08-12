---
status: partial
phase: 70-kiosk-tender-types
source: [70-03-PLAN.md checkpoints (live CSP + real cash/MOTO charge — need staff-auth kiosk)]
started: 2026-08-12T00:00:00Z
updated: 2026-08-12T00:00:00Z
---

## Current Test

[awaiting staging kiosk verification — code verified 12/12 must-haves; deployed to STAGING only. PROD PUSH IS GATED on the CSP live-verify below.]

## Tests

### 1. CSP live-verify on staging (BLOCKING before prod)
expected: On staging.steinsandvines.ca/kiosk.html (staff-authenticated), open DevTools → Console + Network. Load the kiosk, ring a normal terminal sale, ring a cash sale, and open the phone-order (MOTO) tender so the HelcimPay iframe mounts. Confirm ZERO CSP violations ("Refused to load / violates the following Content Security Policy") and that all existing kiosk functionality (product load, terminal, gift card, Google session, Apps Script reads) still works. The CSP domain set was static-analysis-derived — this is the check that it's complete. Do NOT force-push prod until this is clean.
result: [pending]

### 2. Cash tender — real sale
expected: Ring a cash sale on the kiosk (with change-due: enter amount tendered, confirm change shown). Confirm the Zoho invoice is created and marked paid with payment_mode "cash", stock decremented, no terminal interaction. Try a cash + gift-card split (gift cert covers part, cash the remainder).
result: [pending]

### 3. MOTO phone-order card — real refunded charge
expected: On the kiosk, choose "Phone order / card not present", key a test card into Helcim's hosted iframe (a refundable amount), complete. Confirm: the sale books ONLY after Helcim approves+captures (a declined attempt books nothing); the Zoho invoice total == the HelcimPay captured amount; stock/batch created as normal. Refund the test charge + reverse the invoice afterward.
result: [pending]

### 4. Phantom-revenue negative check (optional but valuable)
expected: If safe to simulate, confirm a declined/cancelled HelcimPay attempt produces NO Zoho invoice and NO payment (the captured-amount+APPROVED-status guard).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

None — code verified 12/12. Documented follow-ups (NOT gaps): full HelcimPay-session binding of the verified txn (currently amount+status+exact-match; session-token binding threaded through /confirm is a future hardening); MOTO Option A terminal-keypad entry (owner side-check, zero-code alternative). Deploy rule: PROD force-push is gated on test #1 (CSP) passing on staging.
