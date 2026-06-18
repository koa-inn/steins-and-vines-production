---
phase: 31-money-path-test-coverage
plan: "01"
subsystem: zoho-middleware
tags: [testing, coverage, infrastructure, supertest]
dependency_graph:
  requires: []
  provides: [importable-app, supertest-installed, routes-coverage-glob]
  affects: [zoho-middleware/server.js, zoho-middleware/package.json, zoho-middleware/jest.config.js]
tech_stack:
  added: [supertest@7.2.2]
  patterns: [require.main-guard, module.exports-app, jest-coverage-glob]
key_files:
  modified:
    - zoho-middleware/server.js
    - zoho-middleware/package.json
    - zoho-middleware/jest.config.js
decisions:
  - "[D-02] require.main === module guard (not an env var) wraps entire startup chain in server.js"
  - "[D-03] supertest ^7.0.0 added to devDependencies; installed version 7.2.2"
  - "[D-05] routes/**/*.js added to collectCoverageFrom alongside existing lib/**/*.js"
  - "[D-08] Verified: no stale !-prefix exclusions existed in jest.config.js — nothing to remove"
  - "[Threshold] Global coverageThreshold.lines left at 35; per-file money-path thresholds deferred to Plan 04"
metrics:
  duration: 196s
  completed: "2026-06-17"
  tasks: 3
  files: 3
---

# Phase 31 Plan 01: Express App Export Refactor + Supertest Foundation Summary

Express app made importable for supertest (require.main guard + module.exports), supertest 7.2.2 installed as dev dependency, and routes/**/*.js added to Jest coverage collection so no route file is silently excluded.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor server.js to export app and guard listen (D-02) | 8b4f49d | zoho-middleware/server.js |
| 2 | Add supertest dev dependency and install it (D-03) | 0afa20b | zoho-middleware/package.json |
| 3 | Expand jest coverage to include routes/** (D-05, D-08, TEST-03) | 48b7d6f | zoho-middleware/jest.config.js |

## What Was Done

**Task 1 — server.js export refactor:**
Wrapped the entire startup chain (`helcimLib.init()` through the `process.on('SIGTERM', ...)` handler) in `if (require.main === module) { ... }` and added `module.exports = app` as the final statement. `var app = express()` at line 33 is unchanged. Running `node server.js` directly continues to start the HTTP server normally; importing `server.js` from a test file returns the Express app without binding PORT or scheduling cron jobs.

**Task 2 — supertest installation:**
Added `"supertest": "^7.0.0"` to devDependencies in `zoho-middleware/package.json`. Ran `npm install`; resolved to 7.2.2. `require('supertest')` resolves from `zoho-middleware/node_modules`.

**Task 3 — coverage glob expansion:**
Added `'routes/**/*.js'` to `collectCoverageFrom` in `jest.config.js`. The routes section now appears in the coverage report. No `!`-prefix exclusions existed in the config (D-08 verified). Global `coverageThreshold.lines` stays at 35 — per-file money-path thresholds are deferred to Plan 04 after route tests exist.

## Verification Results

- `grep -c "require.main === module" server.js` → 2 (1 in comment, 1 in guard — acceptance criteria: >= 1)
- `grep -c "module.exports = app" server.js` → 1
- Import test: `node -e "require('./server')"` (with required env vars) exits 0 without binding port
- `supertest` declared `^7.0.0`, installed `7.2.2` (major version 7 confirmed)
- Both `lib/**/*.js` and `routes/**/*.js` present in `collectCoverageFrom`
- No `!`-prefix exclusions in `collectCoverageFrom`
- `npm test` → 674 tests passed, 0 failed (global line coverage 55.14% > threshold 35%)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no stub patterns introduced.

## Threat Flags

None — changes do not introduce new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

- `zoho-middleware/server.js` exists and contains `require.main === module` guard and `module.exports = app`
- `zoho-middleware/package.json` contains `"supertest": "^7.0.0"` in devDependencies
- `zoho-middleware/jest.config.js` contains both `lib/**/*.js` and `routes/**/*.js` in collectCoverageFrom
- Commits 8b4f49d, 0afa20b, 48b7d6f all present in git log
