---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: "01"
subsystem: build-tooling
tags: [cleanup, dead-code, build, assets]
dependency_graph:
  requires: []
  provides: [dead-weight-removed]
  affects: [package.json, 404.html, zoho-middleware/jest.config.js, content/]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - 404.html
    - package.json
    - zoho-middleware/jest.config.js
  deleted:
    - sw.js
    - test-subpage.html
    - docs-validation-report.md
    - images/products/unmatched/ (12 bottle mockup PNGs)
    - zoho-middleware/lib/gp.js
    - content/products.csv
    - content/ingredients.csv
    - content/services.csv
    - content/admin.json
    - content/contact.json
    - content/ingredients.json
    - content/products.json
    - content/reservation.json
    - content/services.json
decisions:
  - "[30-01]: stamp:sw removed — sw.js was the only dead service worker; offline fallback (navigator.onLine check) kept intact in 404.html"
  - "[30-01]: 9 content/ files confirmed dead via zero-reference grep before deletion"
  - "[30-01]: !lib/gp.js jest exclusion removed; !lib/mailer.js retained (still-needed exclusion)"
metrics:
  duration: 420s
  completed_date: "2026-06-15"
  tasks_completed: 2
  files_modified: 3
  files_deleted: 23
---

# Phase 30 Plan 01: Dead-Weight Removal (items #10–14) Summary

Removed ~26 MB of unreferenced assets and several dead files that were shipping publicly via GitHub Pages, plus their build-script and config references. Two executable tasks; third task is a staging verification checkpoint.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete unreferenced assets and dead files (#10, #11, #14) | 0a0a541 | 404.html, package.json, sw.js, test-subpage.html, docs-validation-report.md, images/products/unmatched/ (12 files) |
| 2 | Delete dead Global Payments lib and 9 dead content files (#12, #13) | 1cca83e | zoho-middleware/lib/gp.js, zoho-middleware/jest.config.js, 9 content/ files |

## What Was Built

Dead-weight removal batch: items #10 (26 MB bottle mockups), #11 (test-subpage + docs report), #12 (Global Payments lib), #13 (9 dead content/ files), and #14 (service worker + stamp:sw script) all deleted from the public site surface. Both test suites green after deletions.

## Key Decisions

- `stamp:sw` npm script removed entirely; the only thing that referenced `sw.js` was the service worker registration in `404.html` (also removed) and the script itself.
- The offline fallback (`navigator.onLine` check) in `404.html` was preserved — only the `serviceWorker.register('/sw.js')` block was removed.
- All 9 content/ files confirmed zero live references via `grep -rn` across all `.js`, `.html`, `.json` (excluding node_modules and minified files) before deletion.
- `!lib/mailer.js` coverage exclusion intentionally left in `jest.config.js` — it belongs to item #21 (Plan 06).

## Test Results

- Frontend: 657 tests, 31 suites — all passed
- Middleware: 648 tests, 31 suites — all passed
- ESLint: 0 errors (123 pre-existing warnings, none new)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this plan only removes files from the public surface, reducing attack surface.

## Checkpoint (Task 3)

Checkpoint `checkpoint:human-verify` reached — staging deploy and verification required before proceeding.

**To resume:** Push to staging, verify the site loads correctly, confirm deleted paths 404, then type "approved".

## Self-Check: PASSED

- 0a0a541 exists: confirmed
- 1cca83e exists: confirmed
- sw.js absent: confirmed
- test-subpage.html absent: confirmed
- images/products/unmatched/ absent: confirmed
- zoho-middleware/lib/gp.js absent: confirmed
- 9 content/ files absent: confirmed
- 404.html has no serviceWorker reference: confirmed
- package.json has no stamp:sw: confirmed
- zoho-middleware/jest.config.js has no !lib/gp.js: confirmed
