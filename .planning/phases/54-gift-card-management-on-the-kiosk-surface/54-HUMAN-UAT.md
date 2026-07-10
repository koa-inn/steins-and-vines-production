---
status: complete
phase: 54-gift-card-management-on-the-kiosk-surface
source: [54-VERIFICATION.md, 54-SECURITY.md]
started: 2026-07-10T17:58:00Z
updated: 2026-07-10T18:20:00Z
---

## Current Test

[human iPad run completed 2026-07-10 — standalone kiosk, gift-card management panel under the device token.]

## Tests

### 1. Gift Cards — open + balance lookup (D-54-GC, device-token scope)
expected: Tap Gift Cards on the kiosk top bar → panel opens with no admin/Google login → enter a known cert (GC-NNNNNN) → Look Up → result card shows cert #, status, face value, balance. Proves the lookup runs under the kiosk device token.
result: PASS. Panel opened and looked up under the device token; balance card rendered; no login prompt, no 403. D-54-GC device-token scope confirmed live.

### 2. Gift Cards — void a certificate (D-54-GC money-path change)
expected: Look up a disposable/test cert → Void Certificate → enter reason → Confirm Void → re-look-up shows status = voided. Void now works from the kiosk device token (owner-accepted scope widening, supersedes D-46-02/T-46-07).
result: PASS. Void succeeded under the device token; re-lookup showed voided. The money-path scope change works live.

### 3. Gift Cards — reason-required gate
expected: Void with an empty reason field → blocked with inline "reason required"; NO void happens; adding a reason then proceeds.
result: SKIP (not run). Covered by automated regression test (54-03: device-token + void-reason gate); NOT live-verified.

## Summary

total: 3
passed: 2
issues: 0
pending: 0
skipped: 1

## Gaps

- Test 3 (reason-required gate) skipped live; relies on the 54-03 automated regression test for coverage.
- Note: the gift certs used here (incl. GC-000001 lineage) were test certs; the GiftCards Google Sheet is a separate system from Zoho Books and was not reconciled as part of the invoice cleanup.
