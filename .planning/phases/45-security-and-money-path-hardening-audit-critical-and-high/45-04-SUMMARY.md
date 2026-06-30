---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "04"
subsystem: ci-infra
tags: [ci, artifact-drift, build-integrity, security]
dependency_graph:
  requires: []
  provides: [AUDIT-H-CI]
  affects: [.github/workflows/tests.yml, scripts/check-artifact-drift.sh]
tech_stack:
  added: []
  patterns: [bash-drift-check, github-actions-parallel-job]
key_files:
  created:
    - scripts/check-artifact-drift.sh
  modified:
    - .github/workflows/tests.yml
decisions:
  - "Scope artifact check to js/main.js, js/main.min.js, js/kiosk.min.js, css/*.min.css — excludes js/admin.min.js which carries the BUILD_TIMESTAMP ISO stamp that changes every build"
  - "Run npm ci inside the script (guarded by node_modules presence check) rather than as a separate CI step — keeps the check self-contained"
  - "Parallel job (not a step inside test-frontend) — artifact check is independent of unit tests and can fail fast without waiting for tests"
  - "ISO 8601 timestamp sed normalisation applied as defense-in-depth even though current checked artifacts carry no stamp token"
metrics:
  duration: "~10 min"
  completed: "2026-06-29"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 45 Plan 04: CI Artifact-Drift Check Summary

**One-liner:** Drift-prevention CI gate that rebuilds JS/CSS bundles from source and fails on any divergence from committed artifacts, with ISO-timestamp normalization so the Date.now() cache-buster stamp never causes false positives.

## What Was Built

A new `scripts/check-artifact-drift.sh` bash script and a matching `artifact-drift` GitHub Actions job that together ensure a tested, merged money-path or kiosk fix cannot silently ship behind a stale committed bundle.

**Before this plan:** CI never ran `npm run build` or verified that committed `.min.js` / `main.js` artifacts matched their source modules. A developer could fix a kiosk money-path bug, pass all tests (which run against source modules), and merge — but if the built artifact was not recommitted, the live GitHub Pages site would continue serving the old bundle indefinitely.

**After this plan:** Every PR and push triggers a full `npm run build` in CI, followed by a `git diff` scoped to the tracked artifacts. Any divergence fails the workflow and names the drifted file.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create the artifact-drift check script | cf02d28 | scripts/check-artifact-drift.sh (created, +123 lines, chmod 755) |
| 2 | Wire the drift check into CI | 67967bb | .github/workflows/tests.yml (+10 lines, new parallel job) |

## Verification Results

- **Clean tree (artifacts in sync):** `bash scripts/check-artifact-drift.sh` exits 0. The ISO timestamp stamp in `js/admin.js` / `js/admin.min.js` changes but those files are outside the check scope.
- **Real drift (source edited, artifact not rebuilt):** Appending `// drift-test-2` to `js/modules/13-init.js` without rebuilding caused the script to exit 1, print "Drifted files: js/main.js", and show the normalised diff.
- **CI wiring:** `node -e` check confirms `check-artifact-drift` appears in `tests.yml`. The `artifact-drift` job has no `if:` guard, so it runs on both push and pull_request triggers.

## Stamp Exclusion Design (D-10 / T-45-04-STAMP)

The `npm run stamp` step injects `BUILD_TIMESTAMP = 'YYYY-MM-DDTHH:MM:SS.sssZ'` into `js/admin.js`, which propagates into `js/admin.min.js`. This ISO timestamp changes on every build. The check deliberately excludes `js/admin.min.js` from its scope. A sed normalisation pass that strips ISO 8601 datetime literals is applied to the diff as defense-in-depth (currently has no effect on the checked artifacts, which carry no stamp token).

## Artifacts Checked by the Script

| Artifact | Source | Stamp? |
|----------|--------|--------|
| js/main.js | concat:js of js/lib/*.js + js/modules/01..13.js | None |
| js/main.min.js | terser js/main.js | None |
| js/kiosk.min.js | terser js/kiosk.js | None |
| css/styles.min.css | clean-css css/styles.css | None |
| css/admin.min.css | clean-css css/admin.css | None |
| css/batch.min.css | clean-css css/batch.css | None |
| css/brewpad.min.css | clean-css css/brewpad.css | None |
| css/catalog-subpage.min.css | clean-css css/catalog-subpage.css | None |
| css/hops.min.css | clean-css css/hops.css | None |
| css/kiosk.min.css | clean-css css/kiosk.css | None |
| css/labels.min.css | clean-css css/labels.css | None |
| css/search-overlay.min.css | clean-css css/search-overlay.css | None |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, or trust-boundary surface.

## Self-Check: PASSED

- [x] `scripts/check-artifact-drift.sh` exists and is executable (chmod 755)
- [x] `.github/workflows/tests.yml` contains `check-artifact-drift`
- [x] Commit cf02d28 exists: `git log --oneline | grep cf02d28`
- [x] Commit 67967bb exists: `git log --oneline | grep 67967bb`
- [x] All 928 frontend tests pass
- [x] All 1049 middleware tests pass
