---
phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety
plan: 01
subsystem: payments
tags: [eventLog, kiosk, telemetry, observability, helcim, tdd]

# Dependency graph
requires:
  - phase: 67-kiosk-tax-quote-charge-correctness
    provides: the pre-charge assertion + kiosk.total_mismatch eventLog idiom this plan extends with per-stage timing
provides:
  - kiosk.sale_stage_timing eventLog events at lock-acquired, catalog-read (hit vs cold-cache rebuild), assertion-done, gc-lookup-done (own duration), terminal-push-sent, response-202
  - a new bounded, no-side-effect POST /api/kiosk/telemetry sink emitting kiosk.terminal_push_latency
  - a client-side wall-time beacon (_kcReportTerminalPushLatency) measuring terminal-prompt-shown → 202 response
affects: [68-02-cancel-safety, 68-03-live-verify, future latency-reduction phase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server per-stage timing via emitStageTiming() helper wrapping the existing eventLog.logEvent('kiosk.*', ...) idiom (log.info THEN eventLog.logEvent) — observation-only, never inside a money-moving conditional"
    - "New telemetry sink routes (client-error, telemetry) are bounded, no-side-effect, hostile-input-scrubbed, and mirror each other's rate-limit + KIOSK_ROUTES allowlist registration"

key-files:
  created:
    - zoho-middleware/__tests__/kiosk-telemetry.test.js
    - tests/frontend/kiosk-push-latency.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/lib/authTiers.js
    - zoho-middleware/server.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js

key-decisions:
  - "Client latency rides a NEW sibling beacon (_kcReportTerminalPushLatency → /api/kiosk/telemetry), never the pinned 6-key /api/kiosk/client-error shape"
  - "gc_lookup_done stage timing is only emitted when a real Apps Script lookup ran (gcLookup !== null) — no lookup, no fabricated duration"
  - "response_202 timing is emitted on BOTH the terminal-charged path and the gift-card-covers-100% path for symmetry, though only the former is relevant to the reported terminal-lag symptom"

patterns-established:
  - "emitStageTiming(stage, stageStart, extra) helper in pos.js — reusable insertion point for any future stage timing without duplicating the log.info+eventLog.logEvent pairing"

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-08-12
---

# Phase 68 Plan 01: Kiosk Sale Pipeline Instrumentation Summary

**Per-stage eventLog timing across `/api/kiosk/sale` (lock/catalog-hit-vs-rebuild/assertion/gc-lookup/terminal-push/202) plus a new client-to-server wall-time beacon (`/api/kiosk/telemetry`) that measures real "reader isn't picking up" latency instead of guessing — zero change to money-path control flow.**

## Performance

- **Duration:** 6 min (05:34:08 → 05:39:22 PDT)
- **Started:** 2026-08-12T12:34:08Z
- **Completed:** 2026-08-12T12:39:22Z
- **Tasks:** 4 (RED test, GREEN server, RED test, GREEN client)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `/api/kiosk/sale` now emits `kiosk.sale_stage_timing` events (via the existing `eventLog.logEvent` channel, same `log.info` + `eventLog.logEvent` idiom as `kiosk.total_mismatch`) at six stage boundaries: `lock_acquired`, `catalog_read` (carrying `cache: 'hit'|'rebuild'` — the prime latency suspect), `assertion_done`, `gc_lookup_done` (carrying its own `gc_lookup_duration_ms` — the secondary, up-to-12s suspect), `terminal_push_sent`, and `response_202`. All emits sit outside every money-moving conditional; the existing WR-03/F2/CR-01/CR-02 money-path regression tests (`pos-money-defects.test.js`, `pos-precharge-assertion.test.js`) pass unmodified, proving control flow is unchanged.
- A new `POST /api/kiosk/telemetry` sink mirrors `/api/kiosk/client-error` exactly: bounded/scrubbed payload (`stage` sliced to 40 chars, `reference_number` sliced to 64, `duration_ms` clamped 0-300000ms), no side effects, 204 response, hostile-body-input posture. A non-numeric `duration_ms` is silently ignored (no event emitted, no throw). Registered in the same `KIOSK_ROUTES` allowlist and given its own dedicated rate limiter (`telemetryLimiter`, same shape as `clientErrorLimiter`) so the two telemetry classes never share a bucket.
- On the client, `_kioskPushToTerminal` now stamps `Date.now()` the moment the terminal prompt ("Tap, insert, or swipe card...") is shown, and — once the sale-push response is confirmed `202` + `pending: true` (i.e. past the cancelled/saleCompleted/conflict/error early-returns) — fires a fire-and-forget `_kcReportTerminalPushLatency({ duration_ms, reference_number, stage: 'push_to_202' })` beacon to `/api/kiosk/telemetry`. This is a brand-new sibling function to `_kcReportClientError`, using the identical defensive `try { fetch(...).catch(()=>{}) } catch {}` wrapping so a beacon failure can never throw into the payment flow — verified by a dedicated regression test.
- `js/kiosk-core.min.js` rebuilt via `npm run build` only (never hand-edited); the build's incidental stamping of unrelated pages/`admin.js`/`admin.min.js` was reverted via `git checkout --` so the final diff is limited to this plan's `files_modified`.

## Task Commits

1. **RED — telemetry regression tests** - `898bad54` (test)
2. **GREEN — server stage-timing + `/api/kiosk/telemetry` sink** - `680ffec4` (feat)
3. **RED — client push-latency beacon test** - `d4e44672` (test)
4. **GREEN — client latency emitter + rebuild min** - `8cde294a` (feat)

_TDD gate sequence verified in git log: test → feat → test → feat._

## Files Created/Modified

- `zoho-middleware/__tests__/kiosk-telemetry.test.js` - Server regression suite: stage-timing events on a normal sale (catalog hit/rebuild distinguisher, terminal-push presence) + `/api/kiosk/telemetry` sink (valid payload emits `kiosk.terminal_push_latency` + 2xx no-side-effect; malformed `duration_ms` ignored without throwing)
- `zoho-middleware/routes/pos.js` - `emitStageTiming()` helper; `stageStart` threaded through `processSale`/`processSaleWithPrices`; six stage-timing call sites; new `POST /api/kiosk/telemetry` route mirroring `/api/kiosk/client-error`'s scrub/bound/no-side-effect contract
- `zoho-middleware/lib/authTiers.js` - `/api/kiosk/telemetry` added to the `KIOSK_ROUTES` explicit allowlist (device-token reachable, same threat posture as client-error)
- `zoho-middleware/server.js` - `telemetryLimiter` (same shape/budget as `clientErrorLimiter`, separate Redis bucket) mounted on `/api/kiosk/telemetry`
- `js/kiosk-core.js` - `_kcReportTerminalPushLatency` sibling beacon function; `_kioskPushToTerminal` stamps push-shown time and fires the beacon on confirmed 202-pending
- `js/kiosk-core.min.js` - Rebuilt via `npm run build` (terser); no hand edits
- `tests/frontend/kiosk-push-latency.test.js` - Client regression suite: 202-pending sale-push fires a beacon to `/api/kiosk/telemetry` (never `/api/kiosk/client-error`) with numeric `duration_ms` + string `stage`; a rejecting beacon fetch never throws into the payment flow

## Decisions Made

- Stage names use `snake_case` (`lock_acquired`, `catalog_read`, `assertion_done`, `gc_lookup_done`, `terminal_push_sent`, `response_202`) consistent with the `kiosk.<snake_case>` event-naming convention already established by `kiosk.total_mismatch` / `kiosk.gift_card_redeemed` etc.
- `/api/kiosk/telemetry` got its own dedicated rate limiter rather than reusing `clientErrorLimiter`'s bucket directly — keeps the two telemetry classes independently bounded (a wedged reader retry-looping the latency beacon can't crowd out real error reports, and vice versa), per T-68-01-2's "bounded payload validation + same rate-limit/auth mount as client-error" (same *shape*, separate bucket).
- `gc_lookup_done` timing is conditioned on `gcLookup !== null` (a real network call occurred) rather than always firing with a near-zero duration when no gift card is applied — an unconditional emit would pollute the signal the phase exists to capture (whether the ~12s lookup is the dominant slow-case stage).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Registered `/api/kiosk/telemetry` in the auth allowlist + rate limiter**
- **Found during:** Task 2 (server GREEN)
- **Issue:** The plan's task text explicitly calls for registering the new route "in the same auth/route allowlist as client-error" — without this, the route would be unreachable from a device-token-authenticated kiosk (403) and unprotected by any rate limit (DoS surface, T-68-01-2).
- **Fix:** Added `/api/kiosk/telemetry` to `KIOSK_ROUTES` in `zoho-middleware/lib/authTiers.js`, and added a dedicated `telemetryLimiter` (mirroring `clientErrorLimiter`'s config) mounted in `zoho-middleware/server.js`.
- **Files modified:** `zoho-middleware/lib/authTiers.js`, `zoho-middleware/server.js`
- **Verification:** Full middleware suite green (88/88 suites, 1355/1355 tests); route reachable via the `handlers['/api/kiosk/telemetry']` test harness.
- **Committed in:** `680ffec4` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed the new test's `mockRes()` helper — missing `.end()` mock**
- **Found during:** Task 2 (server GREEN, first test run against the real implementation)
- **Issue:** The `/api/kiosk/telemetry` sink responds via `res.status(204).end()` (mirroring `/api/kiosk/client-error`'s existing pattern), but the RED test's `mockRes()` helper (cloned from `pos-money-defects.test.js`, which never exercises a `.end()`-responding route) only stubbed `.json`/`.status` — the sink call threw `res.status(...).end is not a function`.
- **Fix:** Added an `.end` jest.fn() to `mockRes()`, matching the precedent in `pos-client-error-itemid.test.js`'s own `mockRes()`.
- **Files modified:** `zoho-middleware/__tests__/kiosk-telemetry.test.js`
- **Verification:** All 3 tests in the file pass; no change to test *assertions*, only the harness stub.
- **Committed in:** `680ffec4` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 harness bug)
**Impact on plan:** Both auto-fixes were necessary for the route to be reachable/secure and for the test harness to accurately exercise it. No scope creep — no cancel-safety or pipeline-reorder work was touched (that's 68-02/deferred).

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required. `/api/kiosk/telemetry` uses the existing `KIOSK_DEVICE_TOKEN` auth mechanism and existing Redis-backed rate-limit store; no new env vars.

## Next Phase Readiness

- Live kiosk sales will now produce greppable `kiosk.sale_stage_timing` + `kiosk.terminal_push_latency` events in Railway logs, giving the deferred latency-reduction follow-up phase real data (catalog-rebuild vs gc-lookup vs client-perceived wall-time) instead of a guess.
- Money-path control flow is unchanged — every existing money-path regression test (WR-03, F2, CR-01, CR-02, pos-precharge-assertion) passes unmodified, satisfying the plan's "instrumentation is observation-only" must-have.
- Ready for 68-02 (cancel/orphan-charge safety) — that plan's `/api/pos/cancel` fix is independent of this instrumentation and does not need to wait on it.

---
*Phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety*
*Completed: 2026-08-12*

## Self-Check: PASSED

All files_modified files verified present on disk; all 4 task commit hashes (898bad54, 680ffec4, d4e44672, 8cde294a) verified present in git log.
