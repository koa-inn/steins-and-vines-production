---
phase: 83-postgres-infrastructure
plan: 04
subsystem: middleware
tags: [postgres, store-flag, sheet-mirror, dual-write, sentry, railway]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 01)
    provides: "Recorded RAILWAY_ENVIRONMENT_NAME values (staging=staging, production=production), docs/RUNBOOK.md provisioning record"
  - phase: 83-postgres-infrastructure (plan 02)
    provides: "lib/db.js (isConfigured/query/withTransaction), DATABASE_URL required-in-prod"
provides:
  - "lib/store-flag.js — resolveStoreMode/validateStoreFlags/STORE_ENV_NAMES/VALID_MODES, wired into server.js boot"
  - "lib/sheet-mirror.js — isProductionEnvironment/isMirrorEnabled/mirrorFireAndForget/logMirrorStatus/PRODUCTION_ENVIRONMENT_NAME"
  - "lib/dual-write-compare.js — compareAndReport/diffValues"
affects: [84-gift-cards, 85-recipes, 86-vessels-fermschedules-config, 87-batches, 88-retire-legacy-sheets]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-fast enum/required boot gate (mirrors validateEnv.js's REQUIRED_IN_PROD style) applied to per-store flag validation"
    - "Never-throw wrapper (mirrors sentry-capture.js) applied twice: mirrorFireAndForget's swallow-and-report, and compareAndReport's outer try/catch"

key-files:
  created:
    - zoho-middleware/lib/store-flag.js
    - zoho-middleware/lib/sheet-mirror.js
    - zoho-middleware/lib/dual-write-compare.js
    - zoho-middleware/__tests__/store-flag.test.js
    - zoho-middleware/__tests__/sheet-mirror.test.js
    - zoho-middleware/__tests__/dual-write-compare.test.js
  modified:
    - zoho-middleware/server.js

key-decisions:
  - "PRODUCTION_ENVIRONMENT_NAME = 'production' (frozen literal, no env override) — taken verbatim from docs/RUNBOOK.md's Plan 83-01 provisioning record, not assumed"
  - "validateStoreFlags() defaults to STORE_ENV_NAMES = ['GIFT_CARDS_STORE', 'RECIPES_STORE'] but accepts an explicit array — Phase 84+ can call it with just their own store, or rely on the default list as later phases append to it"
  - "resolveStoreMode returns undefined after process.exit(1) on an invalid value (rather than falling through with the raw invalid string) so a mocked process.exit in tests can't let an invalid mode silently flow into validateStoreFlags' DATABASE_URL check"
  - "dual-write-compare's compareAndReport wraps diffValues + the Sentry report call in ONE outer try/catch (not two nested ones) — a throwing getter during the comparison and captureExceptionSafe itself throwing both collapse to the same { match: null, differences: [] } result, keeping the never-throw contract simple to reason about"
  - "diffValues walks objects via Object.keys(Object.assign({}, a, b)) for the key union — this is also what makes a throwing getter propagate up to compareAndReport's catch (Object.assign invokes getters), rather than needing separate defensive code"

patterns-established:
  - "Store-flag / mirror-gate / dual-write-compare are the three shared primitives every Phase 84-88 store plan imports directly — no store should re-implement env-var validation, environment detection, or Sheets-vs-Postgres comparison"

requirements-completed: [DB-02]

# Metrics
duration: ~35min
completed: 2026-09-30
---

# Phase 83 Plan 04: Store-Flag, Mirror Gate & Dual-Write Comparator Summary

**Three store-agnostic runtime primitives — `<STORE>_STORE` flag resolution with fail-closed boot validation, a production-only (never staging) Sheet-mirror gate keyed to the recorded `RAILWAY_ENVIRONMENT_NAME`, and a generic Sheets-vs-Postgres discrepancy reporter that never throws — proven by 46 new unit tests and two boot-time log lines, with no real store wired to them yet.**

## Performance

- **Duration:** ~35 min (dependency install + full context read dominated; implementation itself was fast on both tasks)
- **Tasks:** 2/2 complete (both `type="auto" tdd="true"`)
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- `lib/store-flag.js`: `resolveStoreMode(envName)` resolves unset/`''` to `'sheets'`, accepts only the exact strings `'sheets'`/`'dual'`/`'postgres'` (reject, never coerce/trim/lowercase), and refuses to boot (`process.exit(1)` + a message naming the env var and the three valid values) on anything else. `validateStoreFlags(envNames?)` resolves every configured store and additionally refuses to boot if any store is `dual`/`postgres` while `DATABASE_URL` is unconfigured, naming both the store variable and `DATABASE_URL` in the error. 18/18 new tests.
- `lib/sheet-mirror.js`: `PRODUCTION_ENVIRONMENT_NAME` is a frozen `'production'` literal (the value recorded in `docs/RUNBOOK.md`'s Plan 83-01 provisioning record — confirmed, not assumed). `isMirrorEnabled()` is `NODE_ENV==='production' && RAILWAY_ENVIRONMENT_NAME===PRODUCTION_ENVIRONMENT_NAME`, strict equality, no override path — tests assert that setting `MIRROR_ENABLED`/`SHEET_MIRROR`/`FORCE_MIRROR` on staging still yields `false`. `mirrorFireAndForget(label, fn)` no-ops when disabled, otherwise fires `fn()` synchronously, returns `undefined` immediately, and swallows+reports (via `captureExceptionSafe`) both a synchronous throw and a rejected promise from `fn`. `logMirrorStatus()` emits exactly one boot-time info line. 11/11 new tests.
- `lib/dual-write-compare.js`: `compareAndReport({store, operation, sheets, postgres, ignoreKeys?, reportValuesFor?})` diffs two values leaf-by-leaf with the money (float vs numeric-string), empty (`''`/`null`/`undefined`), timestamp (`Date` vs ISO string), and boolean (`'TRUE'`/`'FALSE'` vs real boolean) normalisation traps applied before comparing, walks nested objects/arrays with dotted paths, reports a single grouped Sentry warning per call (paths + types only, no raw values unless a key is explicitly listed in `reportValuesFor`), and never throws — a throwing getter, a circular structure in either input, or `captureExceptionSafe` itself throwing all resolve to `{ match: null, differences: [] }` plus a logged warning. 17/17 new tests.
- `server.js`: immediately after the existing `validateEnv();` call, added `validateStoreFlags()`, `logMirrorStatus()`, and one boot-time info line listing the resolved store modes — all boot-time (not per-request), so a misconfigured store or environment fails the deploy, not the first sale.
- Full gate green: middleware 119/119 suites (1773 tests, up from the pre-existing 1756), root frontend 141/141 suites (2048 tests, unaffected — this plan touches middleware only), both lints clean.

## Task Commits

Both tasks followed RED/GREEN TDD:

1. **Task 1: Store-flag helper + production-only mirror gate, wired into boot (D-05, D-06, D-07)**
   - `ed90bdde` test(83-04): add failing tests for store-flag + sheet-mirror (RED — 29/29 failing, modules missing)
   - `032c507c` feat(83-04): store-flag helper + production-only mirror gate, wired into boot (GREEN — 29/29 passing)
2. **Task 2: Generic dual-write discrepancy reporter (D-08)**
   - `e8eb29c9` test(83-04): add failing tests for dual-write discrepancy reporter (RED — module missing)
   - `970fb6ce` feat(83-04): generic dual-write discrepancy reporter (GREEN — 17/17 passing)

_SUMMARY.md is committed as part of this plan's final commit per worktree protocol._

## Files Created/Modified

- `zoho-middleware/lib/store-flag.js` — `resolveStoreMode`/`validateStoreFlags`/`STORE_ENV_NAMES`/`VALID_MODES`
- `zoho-middleware/__tests__/store-flag.test.js` — 18 tests
- `zoho-middleware/lib/sheet-mirror.js` — `isProductionEnvironment`/`isMirrorEnabled`/`mirrorFireAndForget`/`logMirrorStatus`/`PRODUCTION_ENVIRONMENT_NAME`
- `zoho-middleware/__tests__/sheet-mirror.test.js` — 11 tests
- `zoho-middleware/lib/dual-write-compare.js` — `compareAndReport`/`diffValues`
- `zoho-middleware/__tests__/dual-write-compare.test.js` — 17 tests
- `zoho-middleware/server.js` — `validateStoreFlags()` + `logMirrorStatus()` call sites added immediately after `validateEnv();`, plus a boot-time store-modes log line

## Decisions Made

- `PRODUCTION_ENVIRONMENT_NAME` is taken verbatim from `docs/RUNBOOK.md`'s Plan 83-01 provisioning record (`production` for production, distinct from staging's `staging`) rather than assumed — the plan's `<read_first>` explicitly required this and flagged "if the recording is absent, STOP."
- `resolveStoreMode` explicitly `return undefined` after `process.exit(1)` on an invalid value, rather than falling through to `return raw`. Since Jest tests mock `process.exit` as a no-op, without this the invalid raw string would otherwise continue to be treated as the resolved mode by `validateStoreFlags`'s downstream `dual`/`postgres` check — this keeps the test harness and real boot behavior aligned.
- `compareAndReport` uses one outer `try/catch` around the entire function body (diff computation + Sentry report), not separate nested guards, per the plan's explicit instruction ("wraps EVERYTHING in try/catch... same rationale comment as sentry-capture.js"). This means a `captureExceptionSafe` failure on an otherwise-successful comparison downgrades the result from `{match:false, differences:[...]}` to `{match:null, differences:[]}` — accepted as the correct fail-safe semantics per the plan's behavior spec ("captureExceptionSafe itself throwing... compareAndReport still does not throw").
- `.planning/notes/sheets-to-postgres-data-conversion.md` referenced in Task 2's `<read_first>` does not exist anywhere in this repository (confirmed via `git log --all` across all branches) — a pre-existing documentation gap referenced by multiple other phases (51, 83-06, 83-07), not something this plan's scope covers creating. Task 2's `<behavior>` section already fully specified the required normalisation traps inline, so implementation proceeded without it; flagging here for whichever plan is positioned to actually author that note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fresh worktree had no `node_modules` in either package**
- **Found during:** Task 1 verification (full middleware suite run before the first commit)
- **Issue:** `npx jest` failed all 118 suites with `Cannot find module 'express'`/`'axios'`/`'@sentry/node'`/`'google-auth-library'` — neither the repo root nor `zoho-middleware/` had `node_modules` installed in this fresh worktree.
- **Fix:** Ran `npm ci` at the repo root and `cd zoho-middleware && npm ci`, per this plan's explicit "Fresh worktree" instruction.
- **Files modified:** None (dependency install only, no `package.json`/`package-lock.json` changes — `npm ci` matched the committed lockfiles exactly)
- **Verification:** Full middleware suite went from 102 failing/16 passing to 118/118 passing immediately after install
- **Committed in:** N/A (no tracked file changes; `node_modules` is gitignored)

---

**Total deviations:** 1 auto-fixed (Rule 3 — environment setup, not a plan defect)
**Impact on plan:** None on the deliverable. Both tasks otherwise executed exactly as written — every `<behavior>` bullet in both tasks is covered by a passing test on the first implementation pass (no RED-phase surprises, no re-iteration needed).

## Issues Encountered

None beyond the node_modules install noted above. `.planning/notes/sheets-to-postgres-data-conversion.md`'s absence (see Decisions Made) did not block implementation since the plan's own `<behavior>` spec was self-contained.

## User Setup Required

None. Nothing pushed to any remote; nothing deployed. This plan is pure library code + boot wiring — no real store calls any of these three helpers yet (Phase 84+ scope), so there is no new production/staging runtime surface exercised by this plan beyond the two new boot-time log lines.

## Next Phase Readiness

- Phase 84 (GiftCards) can call `require('./lib/store-flag').resolveStoreMode('GIFT_CARDS_STORE')` (or the default `validateStoreFlags()` already covers it), `require('./lib/sheet-mirror').mirrorFireAndForget(...)`, and `require('./lib/dual-write-compare').compareAndReport(...)` directly — all three contracts match `83-RESEARCH.md`'s `<interfaces>` section exactly, no adapter layer needed.
- `STORE_ENV_NAMES` currently lists `GIFT_CARDS_STORE` and `RECIPES_STORE` per the plan's interface spec; later phases (Vessels/FermSchedules/Config, Batches) append their own store env var name to this array as a one-line change when they adopt the flag.
- No Railway variable for any real store (`GIFT_CARDS_STORE` etc.) is set anywhere yet — `validateStoreFlags()` currently always resolves both to `'sheets'` in every environment, so this plan changes zero runtime behavior for real traffic. The only observable change post-deploy is two new `/health`-adjacent boot log lines (`[sheet-mirror] mirror DISABLED (environment=...)` and `[startup] store modes: {...}`).

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/store-flag.js
- FOUND: zoho-middleware/lib/sheet-mirror.js
- FOUND: zoho-middleware/lib/dual-write-compare.js
- FOUND: zoho-middleware/__tests__/store-flag.test.js
- FOUND: zoho-middleware/__tests__/sheet-mirror.test.js
- FOUND: zoho-middleware/__tests__/dual-write-compare.test.js
- FOUND: ed90bdde (git log --oneline --all)
- FOUND: 032c507c (git log --oneline --all)
- FOUND: e8eb29c9 (git log --oneline --all)
- FOUND: 970fb6ce (git log --oneline --all)
