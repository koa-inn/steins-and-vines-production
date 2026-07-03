---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 01
subsystem: zoho-middleware/lib (auth primitives)
tags: [auth, security, session, device-token, tdd]
requires: []
provides:
  - zoho-middleware/lib/deviceToken.js (getKey, matches)
  - zoho-middleware/lib/session.js (createSession, getSession, destroySession, touchSession)
  - zoho-middleware/lib/validateEnv.js REQUIRED_IN_PROD entries for STAFF_EMAILS, KIOSK_DEVICE_TOKEN, SHEETS_CLIENT_ID
affects:
  - 46-02 (Google sign-in exchange — will consume session.js + validateEnv's SHEETS_CLIENT_ID)
  - 46-03 (three-tier guard — will consume deviceToken.js + session.js as the kiosk/session tiers)
tech-stack:
  added:
    - google-auth-library@10.9.0 (zoho-middleware only)
    - cookie-parser@1.4.7 (zoho-middleware only)
  patterns:
    - Constant-time credential comparison (crypto.timingSafeEqual, length-checked first) mirrored verbatim from lib/apiKey.js
    - Redis-primary / in-process-Map-fallback mirrored from lib/cache.js's acquireLock/acquireInProcessLock pattern
key-files:
  created:
    - zoho-middleware/lib/deviceToken.js
    - zoho-middleware/lib/session.js
    - zoho-middleware/__tests__/device-token-guard.test.js
    - zoho-middleware/__tests__/session.test.js
  modified:
    - zoho-middleware/package.json
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/__tests__/validateEnv.test.js
decisions:
  - "touchSession's sliding-expiry refresh cadence is coarse (>1h since lastRefresh) per 46-RESEARCH.md open-question #3 recommendation — avoids a Redis write on every request"
  - "Session id is NOT HMAC-signed — a crypto.randomBytes(32) opaque id has no client-controlled structure to forge (T-46-12); matches 46-RESEARCH.md anti-pattern guidance"
metrics:
  duration: "~2 min"
  completed: "2026-07-02"
---

# Phase 46 Plan 01: Auth Primitives — Device Token + Session Store Summary

Built the two net-new backend credential primitives Phase 46's auth model rests on: a constant-time kiosk device-token guard (`lib/deviceToken.js`, verbatim `lib/apiKey.js` shape) and a Redis-backed opaque session store with in-process fallback (`lib/session.js`, mirrors `lib/cache.js`'s lock-fallback pattern) — plus registered the three new auth env vars (`STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID`) in boot validation and installed `google-auth-library`/`cookie-parser` under `zoho-middleware/` only.

## What Was Built

**Task 1 — Dependencies + env registration:** Installed `google-auth-library@10.9.0` and `cookie-parser@1.4.7` in `zoho-middleware/package.json` (both pre-approved in 46-RESEARCH.md's Package Legitimacy Audit — no legitimacy checkpoint needed). Root `package.json` is unchanged (verified via `git diff --stat`). Added `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, and `SHEETS_CLIENT_ID` to `validateEnv.js`'s `REQUIRED_IN_PROD` array; retained `API_SECRET_KEY` and the `MW_API_KEY` legacy-alias `OPTIONAL` entry for the dual-accept window.

**Task 2 — `lib/deviceToken.js` (TDD RED → GREEN):** A near-verbatim copy of `lib/apiKey.js`'s `getKey()`/`matches()` shape, reading a single `KIOSK_DEVICE_TOKEN` env var (no legacy alias — net-new). `matches()` does the identical length-check-then-`crypto.timingSafeEqual` comparison, fails closed when the env var is unset/empty, and rejects non-string input.

**Task 3 — `lib/session.js` (TDD RED → GREEN):** `createSession(email)` generates a 64-hex-char opaque id (`crypto.randomBytes(32).toString('hex')`), writes `session:<id>` to `cache.set` at a 7-day TTL, and write-throughs to an in-process `Map` (`inProcessSessions`). `getSession(id)` consults `cache.isConnected()`: when true, reads via `cache.get`; when false (Redis blip), falls back to the in-process entry so a brief outage does not sign anyone out. `destroySession(id)` clears both stores. `touchSession(id)` implements coarse sliding expiry — only re-writes (Redis + in-process) when the stored `lastRefresh` is more than 1 hour old.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Updated `validateEnv.test.js` fixtures for the new REQUIRED_IN_PROD vars**
- **Found during:** Task 1, immediately after editing `validateEnv.js`
- **Issue:** Three pre-existing tests ("does NOT exit when NODE_ENV=production and all prod secrets are present" x2, plus the RAILWAY_ENVIRONMENT+production variant) set a fixed list of "all prod secrets" that did not include the three vars this task added to `REQUIRED_IN_PROD`. Adding those vars to `REQUIRED_IN_PROD` is precisely what Task 1 asked for, but it made those three existing tests fail (validateEnv now correctly exits when the newly-required vars are absent from the test fixture).
- **Fix:** Extended the `PROD_SECRETS` array and the two inline `setEnv({...})` fixture blocks in `validateEnv.test.js` to include `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID`. Also added three new explicit test cases (mirroring the existing per-var pattern) asserting `process.exit(1)` when each new var is individually missing in production — closing the same coverage gap the plan's acceptance criteria implied.
- **Files modified:** `zoho-middleware/__tests__/validateEnv.test.js`
- **Commit:** dfb015b

None other — Tasks 2 and 3 executed exactly as written; no refactor step needed (both files were minimal from the first GREEN pass).

## TDD Gate Compliance

- Task 2: `test(46-01): add failing test for kiosk device-token guard` (597a8e3, RED — confirmed module-not-found failure) → `feat(46-01): implement constant-time kiosk device-token guard` (962a826, GREEN — 8/8 tests pass).
- Task 3: `test(46-01): add failing test for Redis-backed session store` (be473c9, RED — confirmed module-not-found failure) → `feat(46-01): implement Redis-backed session store with in-process fallback` (9f6fcbd, GREEN — 9/9 tests pass).
- No REFACTOR commits — both implementations were minimal and clean on first GREEN pass; no cleanup needed.

## Verification

- `cd zoho-middleware && npx jest __tests__/device-token-guard.test.js __tests__/session.test.js` → 17/17 pass.
- `grep -n "KIOSK_DEVICE_TOKEN\|STAFF_EMAILS\|SHEETS_CLIENT_ID" zoho-middleware/lib/validateEnv.js` → all three present in `REQUIRED_IN_PROD`.
- `git diff --stat -- package.json` (repo root) → no change (deps landed only in `zoho-middleware/package.json`).
- Full middleware suite: `cd zoho-middleware && npm test` → 57 suites / 1144 tests pass.
- Full frontend suite: `npm test` (repo root) → 50 suites / 931 tests pass (unaffected — no frontend files touched).
- `cd zoho-middleware && npm run lint` → 0 errors, 60 pre-existing warnings (none introduced by this plan; `lib/deviceToken.js`, `lib/session.js`, and the two new test files lint clean individually).

## Known Stubs

None — both primitives are fully implemented and unit-tested; no data source is stubbed.

## Threat Flags

None — all new surface (device-token comparison, session Redis key namespace, npm installs) is already covered by the plan's own `<threat_model>` (T-46-01, T-46-10, T-46-12, T-46-13, T-46-SC).

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/deviceToken.js
- FOUND: zoho-middleware/lib/session.js
- FOUND: zoho-middleware/__tests__/device-token-guard.test.js
- FOUND: zoho-middleware/__tests__/session.test.js
- FOUND commit dfb015b (feat: install auth deps and register new env vars)
- FOUND commit 597a8e3 (test: RED device-token guard)
- FOUND commit 962a826 (feat: GREEN device-token guard)
- FOUND commit be473c9 (test: RED session store)
- FOUND commit 9f6fcbd (feat: GREEN session store)
