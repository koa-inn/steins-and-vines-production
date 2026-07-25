---
phase: 64-linking-search-correctness
plan: 03
subsystem: auth
tags: [apps-script, oauth, brewpad, admin, jest, tdd, security, frontend]

# Dependency graph
requires:
  - phase: 64-linking-search-correctness (plan 02)
    provides: merged brewpad.js/brewpad.min.js/brewpad.html state (delete-hook wiring)
      this plan builds on without regressing
provides:
  - adminApiGet POSTs { action, token, ...params } in a text/plain JSON body on BOTH
    staff surfaces (js/brewpad.js + js/admin.js) -- the Google OAuth access token no
    longer appears in any request URL/query string (OPS-03 SC#3, feedback #7)
  - adminApi.gs handleReadAction(action, getParam, authEmail) -- shared read-action
    dispatch reachable from doGet (e.parameter source) AND doPost's OAuth-authenticated
    fall-through (payload source); doGet behavior preserved exactly (backward compatible)
  - RED-first regression suite (admin-api-get-token.test.js, 8 tests) locking the
    no-token-in-URL transport + return/error contracts on both surfaces
affects: [BrewPad reads, admin reads, Apps Script deploy process]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parameter-source abstraction (getParam callback) so one Apps Script read switch
       serves both GET query-string and POST JSON-body transports without duplication"
    - "Backward-compatible .gs change deployed FIRST via blocking owner checkpoint,
       THEN the frontend transport switch -- stale cached bundles keep working on doGet
       during the deploy window (T-64-10)"

key-files:
  created:
    - tests/frontend/admin-api-get-token.test.js
  modified:
    - apps-script/adminApi.gs
    - js/brewpad.js
    - js/brewpad.min.js
    - js/admin.js
    - js/admin.min.js
    - brewpad.html
    - admin.html
    - tests/frontend/brewpad-bottling-invite.test.js

key-decisions:
  - "handleReadAction returns plain result objects (not _jsonResponse-wrapped) so both
     callers wrap identically -- the { ok, data } envelope literally cannot diverge
     between the GET and POST transports"
  - "Test seam: exported the real adminApiGet as _adminApiGetForTest from both files'
     existing module.exports test blocks (mirrors _setAccessTokenForTest precedent)
     rather than exercising it through a public caller -- no public caller isolates a
     single call/response cleanly on both surfaces"
  - "doPost read fall-through lives in the write switch's default case AFTER
     checkAuthorization -- unknown actions still return invalid_action (now from
     handleReadAction's default), and no read is reachable unauthenticated (T-64-09)"

patterns-established:
  - "Any future adminApi.gs read action is added ONCE in handleReadAction and is
     automatically available on both transports"

requirements-completed: [OPS-03]

# Metrics
duration: ~40min (across two sessions, split by the owner Apps Script redeploy checkpoint)
completed: 2026-07-25
---

# Phase 64 Plan 03: adminApiGet Token-in-Body Transport Summary

**adminApiGet on both staff surfaces now POSTs the Google OAuth token in the JSON body (matching adminApiPost) via new shared read-routing in adminApi.gs doPost -- the token no longer leaks into URL/proxy/access logs (OPS-03 SC#3).**

## Performance

- **Duration:** ~40 min total (Tasks 1-2 on 2026-07-24, Tasks 4-5 on 2026-07-25 after
  the owner's Apps Script redeploy resolved the blocking checkpoint)
- **Tasks:** 4 code tasks complete (1, 2, 4, 5); Task 3 (owner redeploy, human-action)
  RESOLVED "deployed"; Task 6 (live human-verify) PENDING
- **Files modified:** 9 (1 test file created, 8 modified)

## Accomplishments

- Closed OPS-03 SC#3's code: `adminApiGet` built
  `ADMIN_API_URL + '?action=...&token=' + encodeURIComponent(accessToken)` on BOTH
  `js/brewpad.js:1285` and `js/admin.js:681`, putting the OAuth access token in every
  read request's URL. Both now POST `{ action, token, ...params }` as a `text/plain`
  JSON body (the adminApiPost transport -- no CORS preflight), with NO query string.
- `adminApi.gs`: extracted doGet's 19-action read switch into
  `handleReadAction(action, getParam, authEmail)`; doGet delegates with
  `e.parameter` as the source, and doPost's OAuth-authenticated write switch falls
  through to it with `payload` as the source. Public (`get_featured`,
  `get_batch_public`), `server_token`, and `batch_token` branches untouched; the
  read fall-through sits AFTER `checkAuthorization` (T-64-09).
- Deploy ordering honored (T-64-10): the backward-compatible `.gs` change was
  committed first (`ea0652d7`), the owner manually redeployed it to the live web-app
  URL and confirmed the still-GET pages kept working AND a manual POST read returned
  the identical `{ ok, data }` -- only then did the frontend transport switch land.
- RED-first discipline (CLAUDE.md rule 3): the 8-test regression suite was authored
  and run against the pre-fix code FIRST -- 4/8 failed exactly on the discriminating
  assertions (URL-carries-token + method-is-POST, on each surface), 4/8 (return shape,
  unauthorized contract) passed unchanged. GREEN 8/8 after the fix.
- Full gates: frontend 69/69 suites (1036 tests), middleware 85/85 suites (1332
  tests), both lints clean (`--max-warnings 0`).

## Task Commits

Each task was committed atomically:

1. **Task 1: No-token-in-URL regression test (RED)** - `b1ba983c` (test) -- RED
   confirmed: 4/8 fail against token-in-URL code on both surfaces. Also adds the
   `_adminApiGetForTest` test-seam export to both files (no behavior change).
2. **Task 2: Shared read-dispatch wired into doPost (Apps Script)** - `ea0652d7`
   (feat) -- `handleReadAction` defined + called from doGet and doPost (grep count 3);
   syntax-validated via `node --check` on a scratch copy.
3. **Task 3: Owner Apps Script redeploy** - no commit (checkpoint:human-action) --
   RESOLVED: owner deployed `ea0652d7`'s adminApi.gs as a new version to the same
   web-app URL, verified GET pages unregressed and the POST read path live.
4. **Task 4: adminApiGet POSTs token in body + rebuild (GREEN)** - `1123daab` (feat)
   -- both helpers rewritten; `npm run build` regenerated brewpad.min.js +
   admin.min.js and stamped brewpad.html + admin.html (out-of-scope churn on other
   pages reverted, 64-02 precedent); regression suite GREEN 8/8.
5. **Task 5: Full gate -- both suites + lint** - no commit (verification-only; gates
   were run before the Task 4 commit per CLAUDE.md rule 1 and all passed).

**Plan metadata:** committed separately by the orchestrator after wave completion
(worktree mode -- this executor does not write STATE.md/ROADMAP.md).

## Files Created/Modified

- `tests/frontend/admin-api-get-token.test.js` - New 8-test regression suite; one
  shared per-surface suite runner covering brewpad.js and admin.js (URL-clean, POST
  body contents, ok:true return contract, unauthorized -> handleUnauthorized+reject)
- `apps-script/adminApi.gs` - `handleReadAction` extraction + doGet delegation +
  doPost OAuth read fall-through
- `js/brewpad.js` - adminApiGet POSTs body; `_adminApiGetForTest` test seam
- `js/admin.js` - adminApiGet POSTs body; `_adminApiGetForTest` test seam;
  BUILD_TIMESTAMP restamped by the build
- `js/brewpad.min.js` / `js/admin.min.js` - regenerated (terser, via npm run build)
- `brewpad.html` / `admin.html` - cache-bust stamps updated
- `tests/frontend/brewpad-bottling-invite.test.js` - harness-only: fetch-mock router
  now recognizes `get_batch` in the POST body as well as the legacy URL form (no
  assertion changed)

## Decisions Made

- **Plain-object returns from handleReadAction:** callers (`doGet`/`doPost`) wrap in
  `_jsonResponse` themselves, so the response envelope is structurally identical on
  both transports by construction.
- **Test seam over public-caller indirection:** exported the real `adminApiGet` as
  `_adminApiGetForTest` from the existing test-export blocks in both files -- the
  suite exercises production code directly and symmetrically on both surfaces.
- **Read fall-through as the write switch's default case:** keeps a truly unknown
  action returning `invalid_action` (now from handleReadAction's default) while
  making every doGet read action reachable via authenticated POST.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] brewpad-bottling-invite.test.js fetch-mock router broke on the intentional transport change**
- **Found during:** Task 5 gate (first full `npm test` run after Task 4)
- **Issue:** The existing suite's mock dispatches requests by matching
  `'action=get_batch'` in the URL -- the exact GET transport this plan removed. All
  5 network-touching tests failed with "unexpected fetch" (their behavioral
  assertions were untouched by the change; only the harness routing was stale).
- **Fix:** Minimal harness-only edit: the router also parses the POST body and
  matches `action === 'get_batch'`. Zero assertions modified. (CLAUDE.md rule 10
  "do not modify existing tests" vs rule 1 "never commit with failing tests"
  conflicted; resolved in favor of a routing-only harness fix since the plan's
  intended transport change is what invalidated the mock, and weakening assertions
  -- the thing rule 10 protects against -- did not occur.)
- **Files modified:** tests/frontend/brewpad-bottling-invite.test.js
- **Commit:** `1123daab` (part of the Task 4 logical change)

**2. [Rule 3 - Blocking] Scoped `npm run build` output to the plan's declared files**
- **Found during:** Task 4
- **Issue:** `npm run build` cache-stamps every public HTML page (about, contact,
  index, products/*, kiosk, etc.) -- ~16 files outside this plan's declared scope,
  none of which had code changes.
- **Fix:** Ran the full build (needed for admin + brewpad artifacts together), then
  `git checkout --` the 16 out-of-scope pages, reverting them to their committed
  state -- same deviation 64-02 documented and the same per-surface granularity the
  scoped `stamp:*` scripts imply. Final diff = exactly the plan's `files_modified`.
- **Files affected:** none outside declared scope (that is the point)
- **Commit:** `1123daab`

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking, both process/harness-level).
Neither changed the plan's intended code outcome.

## Authentication Gates

- **Task 3 (checkpoint:human-action, gate=blocking):** Apps Script has no CI -- the
  owner manually redeployed the updated `adminApi.gs` (commit `ea0652d7`) to the live
  `ADMIN_API_URL`, confirmed the still-GET pages worked post-redeploy (doGet
  unregressed) and that a manual POST `{"action":"get_vessels","token":...}` returned
  the same `{ ok, data }`. Resolved "deployed" on 2026-07-25. Normal flow for
  Apps-Script-crossing changes (per STATE.md anti-pattern notes), not a deviation.

## Known Stubs

None -- no placeholder values, empty-data wirings, or TODO/FIXME markers introduced.

## Threat Flags

None -- no NEW security surface beyond the plan's threat model. (T-64-08 mitigated:
token out of URLs; T-64-09 mitigated: read fall-through behind checkAuthorization;
T-64-10 mitigated: .gs deployed first via the blocking checkpoint.)

Out-of-scope leak surfaced for the owner (flagged by the plan, intentionally NOT
touched here): `admin.js:~8137/8148` and `kiosk-core.js:~3074` embed a token in the
shareable `batch.html?...&token=` URL -- that is the public batch-view token path,
a distinct mechanism from adminApiGet, left for a future phase.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

- **Task 3 already completed** (owner Apps Script redeploy).
- **Task 6 (checkpoint:human-verify, gate=blocking) is NOT yet satisfied:** the
  rebuilt frontend must be deployed (staging -> prod), then the owner verifies in
  browser devtools that BrewPad + admin reads are POSTs with no token=/?action= in
  any request URL, that reads/writes work, and that an expired session still
  triggers re-auth. This plan is not fully closed until that returns "approved".

## Next Phase Readiness

- OPS-03 SC#3 code is complete on both surfaces and fully gated; the live system
  already accepts both transports (owner-verified POST read + unregressed GET), so
  the frontend deploy carries no ordering risk.
- No blockers for the remainder of phase 64.

---
*Phase: 64-linking-search-correctness*
*Completed: 2026-07-25 (code); live verification pending (Task 6)*

## Self-Check: PASSED

All created/modified files and commit hashes verified present:
- `tests/frontend/admin-api-get-token.test.js` - FOUND
- `apps-script/adminApi.gs` (handleReadAction x3) - FOUND
- `js/brewpad.js` / `js/brewpad.min.js` - FOUND
- `js/admin.js` / `js/admin.min.js` - FOUND
- `brewpad.html` / `admin.html` - FOUND
- `b1ba983c` (test, RED) - FOUND
- `ea0652d7` (feat, .gs read-dispatch) - FOUND
- `1123daab` (feat, GREEN transport switch) - FOUND
