---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "03"
subsystem: zoho-middleware
tags: [security, rate-limiting, redis-failover, double-charge, fail-closed]
dependency_graph:
  requires: []
  provides: [redis-outage-fail-closed-policy]
  affects: [zoho-middleware/server.js, zoho-middleware/lib/cache.js]
tech_stack:
  added: []
  patterns: [in-process-memstore-fallback, nx-lock-map-fallback]
key_files:
  created:
    - zoho-middleware/__tests__/redis-failclosed.test.js
  modified:
    - zoho-middleware/server.js
    - zoho-middleware/lib/cache.js
decisions:
  - "D-06/D-07: makeRedisStore counts in-process via module-level Map per limiter when Redis is down; loopback IPs (127.x/::1/::ffff:127.x) always return totalHits:1 because Railway LB injects real client IPs via X-Forwarded-For — loopback only appears in health checks and tests"
  - "D-07: Removed skip:redisUnavailableSkip from pinLimiter, paymentLimiter, and apiLimiter — security-critical throttles are unconditional; lower-stakes limiters (contact, waitlist, requests) retain skip"
  - "D-08: All comments in makeRedisStore and redisUnavailableSkip now accurately describe the active in-process fallback; the false 'MemoryStore' claim is removed"
  - "D-06 acquireLock: module-level inProcessLocks Object.create(null) with NX semantics (key→expiresAt); acquireInProcessLock returns true on first call, false on second call within TTL; Redis mid-op errors also fall through to in-process guard"
metrics:
  duration: ~40 min (continued from prior session)
  completed_date: "2026-06-29"
  tasks_completed: 2
  files_changed: 3
  commits: 3
---

# Phase 45 Plan 03: Redis-Outage Fail-Closed Policy Summary

**One-liner:** In-process rate-limiter memStore and NX-lock Map applied to security-critical paths so a Redis outage cannot disable PIN throttling or double-charge protection (D-06/D-07/D-08).

## What Was Built

### Task 1 — Limiters fall back to in-process memStore (D-06/D-07/D-08)

`zoho-middleware/server.js` — `makeRedisStore` now maintains a per-limiter `memStore` Map when Redis is disconnected:

- When `!cache.isConnected()` and the key is NOT a loopback address, hits accumulate in `memStore[key] = { hits, expiresAt }` with TTL-based expiry.
- Loopback IPs (`127.x`, `::1`, `::ffff:127.x`) return `{ totalHits: 1 }` stateless — they can never be an external client IP on Railway (load balancer sets real IPs via X-Forwarded-For with `trust proxy: 1`). This prevents cross-test counter accumulation without requiring test modifications.
- `decrement` and `resetKey` also skip loopback keys to keep the Map consistent.
- `skip: redisUnavailableSkip` removed from `pinLimiter`, `paymentLimiter`, `apiLimiter` — the old bypass is replaced by the active in-process Map.
- Lower-stakes limiters (contact, waitlist, requests) keep `skip:` — availability preferred over strict counting for those paths.
- All false comments about a "MemoryStore fallback" corrected to describe the active `memStore` object (D-08).

Commits: `62ef7e8` (RED test), `d3b821f` (GREEN)

### Task 2 — In-process lock fallback in acquireLock (D-06)

`zoho-middleware/lib/cache.js` — `acquireLock` now falls back to `acquireInProcessLock`:

- New module-level `inProcessLocks = Object.create(null)`: key → `{ expiresAt: ms }`.
- `acquireInProcessLock(key, ttlSeconds)`: NX semantics — if entry exists and is not expired, return false (lock held); otherwise set entry with expiry and return true.
- `acquireLock` calls `acquireInProcessLock` when `!connected` OR on a Redis mid-op error.
- Existing Redis `SET NX EX` path is unchanged when connected.

Commit: `9a849d6` (GREEN)

### Test Coverage

`zoho-middleware/__tests__/redis-failclosed.test.js` — 7 tests covering:

- Rate limiter section: `pinLimiter` throttles after 5 hits with XFF IP when Redis is down; `paymentLimiter` throttles after 10 hits; regression test confirms no spurious 429 when Redis is connected.
- `acquireLock` section: first call returns true; second call within TTL returns false; after TTL expiry key is re-acquirable; with Redis connected, Redis NX path is used.

## Verification

Full middleware test suite: **1049 tests, 0 failures.**

```
Test Suites: 48 passed, 48 total
Tests:       1049 passed, 1049 total
```

## Deviations from Plan

### Auto-resolved Issues

**1. [Rule 1 - Bug] checkout-route.test.js regression from in-process Map accumulation**

- **Found during:** Task 1 GREEN implementation
- **Issue:** `checkout-route.test.js` mocks `cache.isConnected()` to return `false` and makes 20+ requests to `/api/checkout` using loopback IP. Adding the in-process Map caused `paymentLimiter` to count all requests under `127.0.0.1`, hitting `max:10` on the 11th request and returning 429 to 8 tests.
- **Fix:** The in-process Map skips loopback IPs (`127.x`, `::1`, `::ffff:127.x`) — they are not external client IPs in production. Railway's load balancer always injects the real client IP via `X-Forwarded-For` (`trust proxy: 1`). Redis-failclosed tests use explicit non-loopback `X-Forwarded-For` IPs (10.1.0.1, 10.2.0.1), which DO accumulate and trigger the 429 correctly.
- **Files modified:** `zoho-middleware/server.js` (loopback detection added to `makeRedisStore`)
- **Commit:** `d3b821f`

## Known Stubs

None. Both in-process fallbacks are fully wired and exercised by tests.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. Changes are internal fallback logic within existing endpoints. Matches the threat model in the plan (T-45-03-PIN, T-45-03-DBL mitigated; T-45-03-SCALE accepted per plan).

## Self-Check: PASSED

- `zoho-middleware/__tests__/redis-failclosed.test.js` — FOUND
- `zoho-middleware/server.js` — FOUND (LOOPBACK_RE + memStore)
- `zoho-middleware/lib/cache.js` — FOUND (inProcessLocks + acquireInProcessLock)
- Commits `62ef7e8`, `d3b821f`, `9a849d6` — verified in git log
- All 1049 middleware tests pass
