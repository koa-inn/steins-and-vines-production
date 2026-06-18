---
phase: 32-fail-closed-hardening-access-control
plan: "02"
subsystem: middleware
tags: [security, hardening, webhooks, fail-closed, harden-02]
dependency_graph:
  requires: [31-03]
  provides: [HARDEN-02]
  affects: [lib/helcim.js, lib/calcom.js, routes/webhooks.js]
tech_stack:
  added: []
  patterns: [isProd-gate, TDD-RED-GREEN, NODE_ENV-production-gate]
key_files:
  created:
    - zoho-middleware/__tests__/helcim-webhook.test.js (Phase 31; worktree gained via merge)
  modified:
    - zoho-middleware/lib/helcim.js
    - zoho-middleware/lib/calcom.js
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/__tests__/helcim-webhook.test.js
    - zoho-middleware/__tests__/calcom.test.js
    - zoho-middleware/__tests__/calcom-webhook.test.js
decisions:
  - "isProd gate added inline in verifier functions (not extracted) per D-04 — matches logger.js:11 pattern"
  - "afterEach cleans up NODE_ENV in both test files to prevent cross-test leakage"
  - "calcom-webhook.test.js: existing 401 assertions flipped to 403 (ROADMAP criterion 2 — non-negotiable)"
  - "Task 3 (full-suite + lint gate) run against this worktree only per parallel-executor note"
metrics:
  duration: "422s"
  completed: "2026-06-18"
  tasks: 3
  files_modified: 5
---

# Phase 32 Plan 02: Webhook Fail-Closed Hardening (HARDEN-02) Summary

**One-liner:** Helcim and Cal.com webhook verifiers now return false (fail closed) in production when signing secret is absent, and both route consume sites reject unsigned events with HTTP 403 (ROADMAP criterion 2).

## What Was Built

HARDEN-02 implemented across three files and three test files via TDD:

**Task 1 — Verifier fail-closed prod gate (lib/helcim.js + lib/calcom.js)**

Added `isProd` gate (`process.env.NODE_ENV === 'production'`) in the unset-secret branch of both webhook verifiers:

- `lib/helcim.js#verifyWebhookSignature` (~line 311): if `!secret && isProd` → `return false`. Dev keeps the `log.warn + return true` path.
- `lib/calcom.js#verifyWebhook` (~line 141): identical transform. `createHmac + timingSafeEqual` bodies unchanged.

**Task 2 — Route rejection status 401 → 403 (routes/webhooks.js)**

Both consume sites changed from `res.status(401)` to `res.status(403)` on `verifyWebhookSignature`/`verifyWebhook` returning false — matching the ROADMAP criterion 2 verbatim ("400/403"):

- Helcim consume site (~line 40)
- Cal.com consume site (~line 226)

**Task 3 — Full middleware suite + lint gate**

Full suite: 35 test suites, 695 tests passed (3 pre-existing todo markers from other plans). Lint: 0 errors (53 pre-existing warnings in unmodified files). All coverage floors held:

| File | Measured | Floor |
|------|---------|-------|
| `routes/webhooks.js` | 62.96% | 62% |
| `lib/helcim.js` | 28% | 25% |
| `routes/checkout.js` | 53.08% | 52% |
| `routes/payments.js` | 37.20% | 36% |
| `lib/validate.js` | 100% | 98% |
| `lib/logger.js` | 100% | 98% |
| Global | 63.07% | 62% |

## Test Coverage

TDD followed with RED commits before GREEN commits:

- `helcim-webhook.test.js`: converted `test.todo` HARDEN-02 at line 101 (unit) to real assertion: `NODE_ENV=production + secret unset → verifyWebhookSignature returns false`. Added dev-preserved counterpart. Converted `test.todo` at line 260 (route) to real assertion: verifier false → route returns 403.
- `calcom.test.js`: added HARDEN-02 prod/dev assertions for `verifyWebhook`: prod→false, dev→true.
- `calcom-webhook.test.js`: updated 401→403 expectations; added HARDEN-02 route assertion (verifier false → 403, event not processed).

No `test.todo` markers remain for HARDEN-02 in any file.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| c87d365 | test | RED: failing prod-gate assertions for HARDEN-02 verifiers (Task 1) |
| de2d692 | feat | GREEN: isProd gate in helcim.js + calcom.js verifiers |
| 9b92505 | test | RED: failing 403-status assertions for webhook routes (Task 2) |
| f638a63 | feat | GREEN: 401→403 at both webhook consume sites |

## Deviations from Plan

**Worktree merge prerequisite (not a deviation, but infrastructure work):**

The worktree was branched from commit 5a2a203 (before Phase 31). Phase 31 added `helcim-webhook.test.js`, `checkout-route.test.js`, updated `jest.config.js` with per-file coverage floors, added `supertest` dependency, and modified `server.js`. Without these, the test suite could not run. Applied `git merge main` (fast-forward) as the first action, matching the pattern used by sibling worktree `agent-a33bdd658628113aa`. This is standard worktree initialization, not a plan deviation.

None — plan executed exactly as written after the prerequisite merge.

## Threat Flags

No new threat surface introduced. All changes narrow the attack surface:

| Flag | File | Description |
|------|------|-------------|
| threat_mitigated: T-32-05 | lib/helcim.js | Helcim webhook verifier now fails closed in prod (D-04) |
| threat_mitigated: T-32-06 | lib/calcom.js | Cal.com webhook verifier now fails closed in prod (D-04) |

## Self-Check

### Created/Modified Files Exist

- [x] `zoho-middleware/lib/helcim.js` — contains `process.env.NODE_ENV === 'production'`
- [x] `zoho-middleware/lib/calcom.js` — contains `process.env.NODE_ENV === 'production'`
- [x] `zoho-middleware/routes/webhooks.js` — both consume sites return `status(403)`
- [x] `zoho-middleware/__tests__/helcim-webhook.test.js` — HARDEN-02 assertions real (no todo)
- [x] `zoho-middleware/__tests__/calcom.test.js` — HARDEN-02 assertions present
- [x] `zoho-middleware/__tests__/calcom-webhook.test.js` — 403 assertions present

### Commits Exist

- [x] c87d365 — test RED Task 1
- [x] de2d692 — feat GREEN Task 1
- [x] 9b92505 — test RED Task 2
- [x] f638a63 — feat GREEN Task 2

## Self-Check: PASSED
