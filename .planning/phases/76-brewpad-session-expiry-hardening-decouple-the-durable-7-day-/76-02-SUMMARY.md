---
phase: 76-brewpad-session-expiry-hardening
plan: 02
subsystem: api
tags: [express, middleware, auth, session, redis, apps-script, brewpad]

requires:
  - phase: 76-brewpad-session-expiry-hardening (plan 01)
    provides: "Apps Script doPost server_token allowlist extended to reach BrewPad's write actions (update_batch, update_batch_schedule, etc.), live-verified on the deployed instance"
provides:
  - "POST /api/batch/admin-proxy — single session/legacy-tier-gated, allow-listed, token-stripping proxy for all BrewPad batch/dashboard/reading/schedule reads and writes"
  - "session.touchSession(sid) wired into authTiers.resolveTier's 'session' path — sv_session now slides its 7-day Redis TTL on every authenticated hit instead of hard-cliffing"
affects: [76-03-brewpad-frontend-migration]

tech-stack:
  added: []
  patterns:
    - "Hardcoded action allow-list object (ADMIN_PROXY_ACTIONS) gating a generic Apps-Script proxy route — never a free-form req.body.action passthrough"
    - "Fire-and-forget self-throttling session touch on every tier resolution (no await, swallowed rejection) — matches the codebase's existing advisory/best-effort idiom (stampBottlingInviteSent)"

key-files:
  created:
    - zoho-middleware/__tests__/batch-admin-proxy.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/lib/authTiers.js
    - zoho-middleware/__tests__/auth-tiers-guard.test.js

key-decisions:
  - "Mocked lib/session (not lib/authTiers/lib/apiKey/lib/deviceToken) in the new proxy test file, mirroring __tests__/pos-auth-tier.test.js's precedent — keeps the real tier-resolution logic under test while avoiding a real Redis dial from session.getSession's cache fallthrough."
  - "touchSession wiring added as a new test in the existing __tests__/auth-tiers-guard.test.js suite (not a new file) since it directly extends resolveTier's already-covered behavior — no existing assertions were modified (CLAUDE.md rule 10)."
  - "ADMIN_PROXY_ACTIONS placed as a module-scope object literal directly above the route (not in lib/constants.js) since it is a single-route allow-list, matching the file's existing per-route constant style (e.g. KIOSK_PENDING_CHARGE_TTL, KIOSK_CANCELLED_TTL declared near their sole consumer)."

patterns-established:
  - "Any future Apps-Script-proxying route in this codebase should reuse the ADMIN_PROXY_ACTIONS-style hardcoded allow-list plus the stampBottlingInviteSent axios.post(url, JSON.stringify(payload), {headers, timeout, maxRedirects:5}) shape — do not invent a 5th transport variant."

requirements-completed: [STAFF-AUTH]

duration: 25min
completed: 2026-08-27
---

# Phase 76 Plan 02: BrewPad Admin-Proxy + Sliding Session Expiry Summary

**Single allow-listed `POST /api/batch/admin-proxy` route (17-action hardcoded allow-list, session/legacy tier gate, client-token strip, server_token forward) plus `touchSession` wired into `resolveTier` so `sv_session` slides its 7-day TTL instead of hard-cliffing.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-27T14:02:00Z
- **Completed:** 2026-08-27T14:27:00Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Built `POST /api/batch/admin-proxy` — the single transport BrewPad's frontend migration (Plan 76-03) will repoint every `adminApiGet`/`adminApiPost` call onto, replacing the direct-to-Apps-Script dual-credential path.
- Hardcoded `ADMIN_PROXY_ACTIONS` allow-list (6 reads + 11 writes, including the two live write flows `create_batch` and `update_batch_schedule`) — any other action is rejected 400 `invalid_action` with Apps Script never called.
- Closed the sliding-expiry gap: `session.touchSession(sid)` (already written, already unit-tested, zero prior callers) is now invoked fire-and-forget on every `'session'`-tier resolution.
- New middleware test file (`batch-admin-proxy.test.js`, 7 tests) plus one new test extending the existing tier-guard suite — full middleware suite (94 suites / 1459 tests) and full frontend suite (85 suites / 1147 tests) both green, both lint-clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write RED middleware tests for the admin-proxy** - `d202f4a1` (test)
2. **Task 2: Implement POST /api/batch/admin-proxy in pos.js** - `85ce6a93` (feat)
3. **Task 3: Wire touchSession into resolveTier + full both-suite gate** - `2f3f6404` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `zoho-middleware/__tests__/batch-admin-proxy.test.js` - New RED→GREEN test file: 7 tests covering auth (session valid/none/device-only), allow-list accept/reject, client-token strip, server_token forward, and 502 upstream-failure envelope.
- `zoho-middleware/routes/pos.js` - New `ADMIN_PROXY_ACTIONS` allow-list object + `POST /api/batch/admin-proxy` route, gated by `authTiers.requireTiers(['legacy','session'])`, forwarding via the canonical `stampBottlingInviteSent` axios shape.
- `zoho-middleware/lib/authTiers.js` - `resolveTier`'s `'session'` branch now calls `session.touchSession(sid).catch(function(){})` fire-and-forget before returning.
- `zoho-middleware/__tests__/auth-tiers-guard.test.js` - Added test (12) asserting a valid session resolution invokes `session.touchSession` with the resolved sid; no existing assertions modified.

## Decisions Made
- See `key-decisions` in frontmatter above.

## Deviations from Plan

None — plan executed exactly as written. The one file touched beyond the frontmatter's `files_modified` list (`zoho-middleware/__tests__/auth-tiers-guard.test.js`) was explicitly directed by Task 3's own `<action>` text ("locate an existing authTiers/session unit test to extend... add a new it/test for the touch call") — not an unplanned addition.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (The Apps Script `.gs` redeploy required for the write actions to be reachable was already completed and live-verified under Plan 76-01, per the dependency context supplied to this plan.)

## Next Phase Readiness
- `POST /api/batch/admin-proxy` is live in `pos.js`, tested, and ready for Plan 76-03 to repoint `js/brewpad.js`'s `adminApiGet`/`adminApiPost` onto it, dropping the direct-to-Apps-Script Google-token path entirely.
- `sv_session` now slides on every authenticated hit — no further server-side work needed for the 7-day-cliff fix; Plan 76-03's frontend changes (dropping the client-side `login_at` hard-cliff check) can proceed knowing the server-side backstop already exists.
- No blockers.

---
*Phase: 76-brewpad-session-expiry-hardening*
*Completed: 2026-08-27*

## Self-Check: PASSED

All created/modified files and all 3 task commit hashes (d202f4a1, 85ce6a93, 2f3f6404) verified present.
