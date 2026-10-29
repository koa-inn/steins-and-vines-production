---
phase: 100-limited-releases-page-and-online-deposits
plan: 04
subsystem: middleware
tags: [limited-releases, deposits, validation, email]
requires: []
provides:
  - zoho-middleware/lib/limited-releases.js (allowlist, constants, validateBasket, computeDeposit, computeDepositCents, expandUnits)
  - mailer.sendPreorderDepositConfirmation / sendPreorderDepositNotification / sendPreorderCleanupAlert
affects: [100-05, 100-06]
key-files:
  created:
    - zoho-middleware/lib/limited-releases.js
    - zoho-middleware/__tests__/limited-releases-config.test.js
    - zoho-middleware/__tests__/mailer-preorder.test.js
  modified:
    - zoho-middleware/lib/mailer.js
decisions:
  - "Drift test reads content JSON from the repo path, overridable via LIMITED_RELEASES_JSON env var"
metrics:
  tasks: 2
  completed: 2026-10-29
---

# Phase 100 Plan 04: Server config and deposit emails Summary

Server-authoritative ten-kit allowlist with strict basket validation (D-18: max 10 kits and 10 lines per order, per-item `cap` hook) plus three plain-text deposit emails with CR/LF-flattened customer strings.

## Commits
- e54bbc3d: feat(100): limited-releases server config and basket validation
- (next): feat(100): limited-release deposit emails

## Deviations from Plan
- Tests and implementation for Task 1 were committed together (no separate RED commit).
- Drift test needs `content/limited-releases-2026-27.json`, which is not in this worktree (committed by plan 100-01). It was verified here with `LIMITED_RELEASES_JSON` pointing at the main checkout copy. Once 100-01 merges, the default repo-relative path works and the test fails until then if the JSON is absent.

## Verification
- New tests: 22 + 6 green. Frontend suite 3206 green, lint clean.
- Middleware full suite: one pre-existing failure in `vancouver-timezone.test.js` (Node tzdata, unrelated to this plan).

## Known Stubs
None.

## Self-Check: PASSED
