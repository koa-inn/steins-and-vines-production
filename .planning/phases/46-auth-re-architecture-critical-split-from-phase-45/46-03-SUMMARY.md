---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 03
subsystem: auth
tags: [express, middleware, cookie-parser, session-auth, device-token, api-key]

# Dependency graph
requires:
  - phase: 46-01
    provides: lib/deviceToken.js (KIOSK_DEVICE_TOKEN constant-time match), lib/session.js (getSession/touchSession)
  - phase: 46-02
    provides: routes/auth.js (POST /auth/google session creation, POST /auth/logout, sv_session cookie contract)
provides:
  - lib/authTiers.js — unified 3-tier credential dispatcher (legacy/device/session), explicit KIOSK_ROUTES allowlist, requireTiers() middleware factory for 46-04
  - server.js 3-tier /api guard replacing the single-branch key check
  - cookie-parser mounted globally (req.cookies available on every request, including GETs)
  - keyless public POSTs: /bookings, /contacts, /payment/initialize (referer + rate-limit only)
  - requirePiiApiKey extended to accept legacy key OR session (device token still rejected)
affects: [46-04, 46-05, 46-06, 46-07, 46-08, 46-09, 46-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit route allowlist over path-prefix matching for privilege scoping (KIOSK_ROUTES, not /api/kiosk/*)"
    - "Sync-fast-path / async-fallback middleware split to preserve a pre-existing synchronous 401 test contract while adding async credential sources"
    - "Fail-closed async guard: explicit try/catch around every await in Express 4 middleware (unhandled rejections don't propagate to Express error handling)"

key-files:
  created:
    - zoho-middleware/lib/authTiers.js
    - zoho-middleware/__tests__/auth-tiers-guard.test.js
  modified:
    - zoho-middleware/server.js

key-decisions:
  - "requireAllowedReferer was NOT given a matching exemption for /bookings, /contacts, /payment/initialize — only the API-key guard exempts them. The plan's must_haves truth requires these routes stay 'referer + rate-limit only' (matching /promo/validate, which is also not referer-exempt); exempting them from requireAllowedReferer too would leave them with zero protection, contradicting that truth."
  - "Boot-config fail-closed check uses apiKeyGuard.getKey() (which resolves both API_SECRET_KEY and its MW_API_KEY alias) instead of a raw process.env.API_SECRET_KEY check, preserving the original guard's alias-aware semantics while adding KIOSK_DEVICE_TOKEN/STAFF_EMAILS as alternate never-succeeds-without-any-credential conditions."
  - "/api/kiosk/discounts/:id (PUT/DELETE) is treated as kiosk-scoped via a prefix match, extending the plan's literal '/api/kiosk/discounts' entry to match assumption A1 (full discount-preset CRUD is kiosk-scoped)."

patterns-established:
  - "lib/authTiers.js is the single source of truth for credential tier resolution and kiosk-route scoping — server.js's global guard and future in-route requireTiers() calls (46-04) both consult it, so classification logic can never drift between the two call sites."

requirements-completed: [AUDIT-CRITICAL-AUTH, D-46-02, D-46-06, D-46-10, D-46-11]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 46 Plan 03: 3-Tier Auth Guard Summary

**Restructured the single-branch `/api` key guard into a 3-tier credential dispatcher (legacy key / kiosk device token / session cookie) via a new `lib/authTiers.js`, with cookie-parser mounted globally, three public POSTs made keyless, and PII GET routes extended to accept a session while still rejecting a bare device token.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-03T00:56:09Z
- **Tasks:** 3/3 completed
- **Files modified:** 2 (server.js, plus 2 new files: lib/authTiers.js, __tests__/auth-tiers-guard.test.js)

## Accomplishments
- `lib/authTiers.js`: `KIOSK_ROUTES` explicit allowlist, `isKioskRoute()`, `resolveTier()` (legacy → device → session dispatch, self-contained so it works on GET routes the global guard skips), `allowKiosk()`/`allowAdmin()`, and `requireTiers()` — an Express middleware factory for 46-04's in-route use that preserves the existing synchronous-401 contract for the 13+ tests that call route handlers directly.
- `server.js`: cookie-parser mounted before the auth router and the `/api` guard; the guard is now an `async` 3-tier dispatcher (`await authTiers.resolveTier(req)` wrapped in try/catch → fail-closed 403 on rejection, never a hang); device tokens are rejected 403 on any route not in `KIOSK_ROUTES`; `/bookings`, `/contacts`, `/payment/initialize` are keyless; `requirePiiApiKey` now accepts legacy key OR session, still rejects device.
- `__tests__/auth-tiers-guard.test.js`: 9 integration tests covering dual-accept, device-vs-kiosk scoping, device-vs-admin rejection, session-on-admin acceptance, keyless public POST passthrough, PII-route session-vs-device, and the fail-closed rejection path.
- Full middleware suite: **60/60 suites, 1162/1162 tests green**. `npm run lint`: 0 errors (60 pre-existing warnings in unrelated files, none in the files this plan touched).

## Task Commits

Each task was committed atomically:

1. **Task 1: lib/authTiers.js — unified credential dispatch + kiosk route allowlist** - `c2fdde7` (feat)
2. **Task 2: server.js — 3-tier /api guard, cookie-parser, keyless exemptions, PII session acceptance** - `57f729b` (feat)
3. **Task 3: Integration tests for the 3-tier guard** - `66d7cc6` (test — also includes a Rule-1 bugfix to server.js found while writing the tests)

## Files Created/Modified
- `zoho-middleware/lib/authTiers.js` - New module: KIOSK_ROUTES allowlist, isKioskRoute, resolveTier, allowKiosk/allowAdmin, requireTiers middleware factory
- `zoho-middleware/server.js` - cookie-parser mount, 3-tier async `/api` guard, keyless-POST exemptions, requirePiiApiKey session support
- `zoho-middleware/__tests__/auth-tiers-guard.test.js` - New integration test suite (9 tests)

## Decisions Made
- See `key-decisions` in frontmatter (requireAllowedReferer exemption scope, boot-check alias-awareness, discounts/:id kiosk scoping).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Device-vs-kiosk route check compared against a mount-relative path**
- **Found during:** Task 3 (writing/running the integration tests — test (2) failed)
- **Issue:** The 3-tier guard is mounted via `app.use('/api', async function (req, res, next) {...})`. Express strips the `/api` mount prefix from `req.path` inside that middleware, so a request to `POST /api/kiosk/verify-pin` saw `req.path === '/kiosk/verify-pin'`. `authTiers.isKioskRoute(req.path)` was called with that stripped path against a `KIOSK_ROUTES` list defined in absolute form (`/api/kiosk/verify-pin`), so it never matched — every valid device-token request to a real kiosk route was incorrectly rejected with 403.
- **Fix:** Reconstruct the full path (`'/api' + req.path`) before calling `isKioskRoute()` in the global guard. `lib/authTiers.js` itself is unaffected — it's designed to be called with the full absolute path (as 46-04 will do from inside route files, where `req.path` is already absolute).
- **Files modified:** `zoho-middleware/server.js`
- **Verification:** Test (2) ("valid x-device-token on a kiosk-scoped route — not 403") failed before the fix and passed after; full suite re-run confirmed no regressions (60/60 suites, 1162/1162 tests).
- **Committed in:** `66d7cc6` (Task 3 commit)

**2. [Clarification, not Rule 4] requireAllowedReferer NOT given a matching exemption**
- **Found during:** Task 2
- **Issue:** The task's action text literally said to add the 3 new keyless-POST exemptions to BOTH the key guard and `requireAllowedReferer`. But `requireAllowedReferer` currently only exempts `/checkout` (protected instead by reCAPTCHA) — it does NOT exempt `/promo/validate`, contradicting the task text's implication that `/promo/validate` was already exempted there. The plan's own `must_haves.truths` states these 3 routes must stay "referer + rate-limit only, matching /promo/validate" — i.e. still gated by Referer, only exempt from the API key.
- **Fix:** Added the 3 routes to the API-key guard's `KEYLESS_POSTS` list only, left `requireAllowedReferer` untouched (still only exempts `/checkout`), with an inline comment explaining why. This satisfies the must_haves truth exactly; following the literal action text would have removed all protection from these public POSTs.
- **Files modified:** `zoho-middleware/server.js`
- **Verification:** `requireAllowedReferer` grep confirms no new exemption; `pii-access.test.js` and `redis-failclosed.test.js` (which exercise `/api/payment/initialize` without a Referer header) still pass, since the "no Referer header at all" case is already a pass-through for server-to-server calls — this behavior is unchanged.
- **Committed in:** `57f729b` (Task 2 commit)

---

**Total deviations:** 2 (1 auto-fixed bug, 1 documented clarification favoring the plan's own truths over an internally-inconsistent action instruction)
**Impact on plan:** Both necessary for correctness. No scope creep — no files touched beyond `zoho-middleware/lib/authTiers.js`, `zoho-middleware/server.js`, and the new test file, exactly as specified in the plan's frontmatter `files_modified`.

## Issues Encountered
- The worktree had no `node_modules` installed for either the repo root or `zoho-middleware` (no committed `package-lock.json`, and this is a fresh worktree checkout). Since `package.json` in both locations is byte-identical to the main repo's, symlinked `node_modules` from the main repo (`/Users/koa/dev/steins-and-vines-website/node_modules` and `/Users/koa/dev/steins-and-vines-website/zoho-middleware/node_modules`) rather than running a fresh `npm install`, to avoid an unnecessary network-dependent reinstall. These symlinks are untracked (gitignored `node_modules/` doesn't match a symlink target by name, so they show as `??` in `git status`, but they were never staged — every commit in this plan added files individually by explicit path).

## User Setup Required

None — no external service configuration required. (`KIOSK_DEVICE_TOKEN`, `STAFF_EMAILS`, `API_SECRET_KEY` are pre-existing/prior-plan env vars; no new ones introduced by this plan.)

## Next Phase Readiness

- `req.authTier` is now set on every non-GET `/api/*` request (and by `requirePiiApiKey` for the 4 PII GETs) — 46-04 can consume `authTiers.requireTiers([...])` inline on the GET routes the global guard skips, per the interface contract this plan established.
- `lib/authTiers.js`'s `KIOSK_ROUTES` explicit list should be reviewed against assumption A1 (`/api/kiosk/discounts*` classified kiosk-scoped) at the 46-10 cutover review, as flagged in the plan's threat model.
- No blockers for 46-04 through 46-10.

---
*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/authTiers.js
- FOUND: zoho-middleware/__tests__/auth-tiers-guard.test.js
- FOUND commit: c2fdde7
- FOUND commit: 57f729b
- FOUND commit: 66d7cc6
