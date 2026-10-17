---
phase: 93-kiosk-ledger-week-and-month-views
plan: 06
subsystem: kiosk-frontend
tags: [gap-closure, kiosk, past-sales, regression-tests]
requires: [93-04]
provides: [PSL-11 stepping correctness, PSL-14 / D-10 partial-day drill-in]
affects: [js/kiosk-core.js, js/kiosk-core.min.js, kiosk.html]
key-files:
  modified:
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - kiosk.html
    - tests/frontend/kiosk-past-sales-range-drill.test.js
requirements-completed: [PSL-11, PSL-14]
completed: 2026-10-17
---

# Phase 93 Plan 06: Gap closure (WR-01, WR-02) Summary

kioskPsLoadRange now drops a range payload of the other type and disables stepping while none is loaded (WR-01), and partial zero-count range days are tappable so their exact day ledger is reachable (WR-02). Both are closed on staging.

## Commits

- 855c4ed8 fix(93-06): drop stale range payload on Week/Month switch (WR-01)
- bb14a9dd fix(93-06): let partial zero-count range days open the day ledger (WR-02)
- 003342e0 build(93-06): rebuild kiosk core for WR-01/WR-02 fixes (js/kiosk-core.min.js, kiosk.html stamp)
- Staging push: origin/main = 003342e0 (verified with ls-remote). Production not pushed.

## RED evidence

- WR-01: tests A, B, C, D and E all failed before the fix, and all passed after it.
- WR-02: tests F and G failed before the fix. Test H (non-partial zero day stays inert, D-05) passed before and after.

## Gates

- `npm test`: 204 suites, 2684 tests pass.
- `npm run lint`: clean.
- Middleware: 3546 pass, 2 fail. Both failures are the known Node 20 vancouver-timezone tzdata tests. Middleware is untouched.
- Build: other stamped files (HTML pages, admin.*) were reverted by explicit path. Only kiosk-core.min.js and kiosk.html were committed.
- links.html: unchanged and unstaged (verified with cmp against the backup).

## Deviations from Plan

None. The plan was executed as written.

## Owner checkpoint

None was run, as the plan specified. Neither defect can be reproduced on demand on the iPad, and the jsdom tests drive both states through the real kiosk.html markup.

## Open items

- WR-03 and IN-01..IN-05 remain open as advisory items in 93-REVIEW.md.
- Production promotion is still pending (owner decision).

## Self-Check: PASSED
