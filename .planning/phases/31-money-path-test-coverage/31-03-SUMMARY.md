---
phase: 31-money-path-test-coverage
plan: "03"
subsystem: zoho-middleware
tags: [testing, security, hmac, webhook, supertest]
dependency_graph:
  requires: [31-01]
  provides: [helcim-webhook-unit-tests, helcim-webhook-route-tests]
  affects: [zoho-middleware/__tests__/helcim-webhook.test.js]
tech_stack:
  added: []
  patterns: [jest-resetModules-unmock-isolation, supertest-route-test, characterization-tests, test-todo-gap-markers]
key_files:
  created:
    - zoho-middleware/__tests__/helcim-webhook.test.js
decisions:
  - "[Unit block isolation] jest.unmock('../lib/helcim') + jest.unmock('../lib/logger') in unit beforeEach required to get real module after file-scope jest.mock for route block"
  - "[Two-block structure] Unit block uses jest.resetModules+unmock per test; route block uses file-scope mock + require('../server') once at top"
  - "[Symlink workaround] node_modules symlink in worktree zoho-middleware/ needed to run jest from worktree (worktrees don't inherit node_modules); symlink is gitignored"
metrics:
  duration: 305s
  completed: "2026-06-17"
  tasks: 2
  files: 1
---

# Phase 31 Plan 03: Helcim Webhook HMAC Verification Tests Summary

Unit + route tests for Helcim HMAC webhook signature verification: valid sig accepted, tampered body rejected, missing-secret fail-open documented honestly with HARDEN-02 todo, and base64 key decoding proven correct via supertest and direct calls.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Unit tests for verifyWebhookSignature (D-09a — 4 cases) | a709d73 | zoho-middleware/__tests__/helcim-webhook.test.js |
| 2 | Route-level webhook tests via supertest (D-09b) | a709d73 | zoho-middleware/__tests__/helcim-webhook.test.js |

## What Was Done

**Both tasks committed together** (same file, both complete before commit):

Created `zoho-middleware/__tests__/helcim-webhook.test.js` with a two-block structure:

**Block A — Unit tests for `lib/helcim.js#verifyWebhookSignature`:**
- `makeValidSig(webhookId, timestamp, rawBody, secretBase64)` helper mirrors helcim.js payload assembly (`webhookId + '.' + timestamp + '.' + rawBody`) and base64 key derivation exactly.
- **valid signature**: `makeValidSig`-produced sig with `FAKE_SECRET_B64` → `verifyWebhookSignature` returns `true`.
- **tampered body**: same sig but rawBody mutated by one character → returns `false` (proves sig mismatch is caught).
- **missing secret**: `HELCIM_WEBHOOK_SECRET` unset → returns `true` (current fail-open behavior asserted honestly) + `test.todo('HARDEN-02: ...')` documenting Phase 32 gap.
- **base64 key decoding**: two signatures computed (one via base64-decoded key, one via raw utf8 secret string) — proved they differ, then verified `verifyWebhookSignature` returns true for the base64-key signature, proving the base64 decode path is exercised.

**Block B — Route tests for `POST /api/webhooks/terminal` via supertest:**
- Full server-boot mock set: `zohoAuth`, `validateEnv`, `checkRedis`, `checkMailer`, `brewpad-integration`, `node-cron`, `@sentry/node`, `cache`, `eventLog`, `logger`.
- `helcim.verifyWebhookSignature` mocked at file scope as `jest.fn()`.
- **valid sig (mock returns true)**: `POST /api/webhooks/terminal` → 200 `{ received: true }`.
- **tampered body (mock returns false)**: same route → 401 `{ error: 'Invalid signature' }`.
- No `x-api-key` header needed — route is exempt via `/webhooks/` prefix check (`server.js` line 260).
- `test.todo('HARDEN-02: ...')` documents Phase 32 gap in the route block too.

## Verification Results

- `helcim-webhook.test.js` in isolation (with `--no-coverage`): 6 passed, 2 todo, exit 0.
- Full middleware suite (`cd zoho-middleware && npm test`): 34 test suites, 680 passed, 2 todo, exit 0. No regressions.
- Coverage thresholds satisfied in full suite run (global 58.34% > threshold 35%).

## Deviations from Plan

**1. [Rule 1 - Bug] jest.unmock required to isolate unit block from file-scope helcim mock**

- **Found during:** Task 1 (GREEN phase — unit tests returned `undefined` instead of `true`/`false`)
- **Issue:** The file-scope `jest.mock('../lib/helcim', ...)` needed by the route block is hoisted and applies to all `require` calls in the file, including the unit block's `jest.resetModules()` + `require('../lib/helcim')`. The re-required helcim module returned the mock object (with no `verifyWebhookSignature` implementation) instead of the real module.
- **Fix:** Added `jest.unmock('../lib/helcim')` and `jest.unmock('../lib/logger')` in each `beforeEach` (and inline for tests that re-require the module), so the unit block always loads the real helcim implementation.
- **Files modified:** `zoho-middleware/__tests__/helcim-webhook.test.js`
- **Commit:** a709d73

**2. [Rule 3 - Blocking] Worktree missing node_modules required symlink**

- **Found during:** Task 1 setup — `jest` could not find `node-cron` when running from worktree directory.
- **Issue:** Git worktrees share the git object store but do not inherit `node_modules` from the main checkout. The worktree's `zoho-middleware/` has no `node_modules/` directory.
- **Fix:** Created `zoho-middleware/node_modules` as a symlink to the main repo's `zoho-middleware/node_modules/`. This is gitignored (root `.gitignore` contains `node_modules/`) and does not appear in the commit.
- **Files modified:** none committed (symlink is gitignored)
- **Commit:** n/a

**3. Single-file coverage threshold exits non-zero**

- Running `npm test -- helcim-webhook.test.js` exits 1 because coverage thresholds apply globally (35% lines, 98% validate.js, 98% logger.js) but only one test file runs, leaving all other files at 0%.
- This is expected Jest behavior when `collectCoverage: true` with thresholds is in `jest.config.js`. The full suite (`npm test`) exits 0 — thresholds are satisfied there.
- No fix needed — the verification command from the plan is satisfied by `npm test` (full suite).

## Known Stubs

None — this plan only adds test files with no stub patterns.

## Threat Flags

None — test-only change; no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `zoho-middleware/__tests__/helcim-webhook.test.js` exists
- Commit `a709d73` present in git log
- Full test suite: 34 suites, 680 passed, exit 0
- File contains `verifyWebhookSignature` (key_links requirement)
- File line count: 261 lines (> min_lines: 100)
- `test.todo(` referencing HARDEN-02 present (2 instances)
