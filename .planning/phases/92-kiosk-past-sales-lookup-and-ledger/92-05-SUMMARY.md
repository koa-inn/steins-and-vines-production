---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 05
subsystem: kiosk-frontend
tags: [kiosk, html, css, past-sales]
requirements: [PSL-02, PSL-04]
key-files:
  modified:
    - kiosk.html
    - css/kiosk.css
    - css/kiosk.min.css
metrics:
  tasks: 2
  completed: 2026-10-16
---

# Phase 92 Plan 05: Past Sales view shell Summary

Static Past Sales header button, two-tab view markup (By customer / Ledger) and `.kiosk-ps-*` styles for the standalone kiosk, with all ids from the 92-06/92-07 DOM contract.

## Commits
- 8bf29d2c: Task 1, button and view markup in kiosk.html
- 0af18761: Task 2, `.kiosk-ps-*` CSS, rebuilt kiosk.min.css, re-stamped kiosk.html cache-busters

## Details
- `#kiosk-past-sales-btn` sits after Sales Orders; `#kiosk-view-past-sales` follows `#kiosk-view-collect`. Every contract id appears exactly once.
- No action controls (D-13), CSP meta unchanged, admin.html untouched.
- CSS mirrors the Sales Orders card and chip styles, includes void row (reduced opacity, line-through amount), all badge modifiers, 44px day-arrow targets and a 600px mobile override. View uses `display:flex` like `#kiosk-view-collect` (inline `display:none` hides it).
- `npm test` (2586 passed) and `npm run lint` pass at the root.

## Deviations from Plan
- Worktree base predated the phase 92 plan commits, so the plan was read via `git show main:...`. The plan has no dependencies, so no merge was needed.
- `npm run build` also restamped cache-busters in ~25 unrelated HTML files and rebuilt `js/admin.js`/`admin.min.js`. These were not committed (unrelated churn); only kiosk.html, kiosk.css and kiosk.min.css were.
- `links.html` was not touched.

## Known Stubs
None. The panels are intentionally empty shells; 92-06 and 92-07 wire behaviour.

## Self-Check: PASSED
