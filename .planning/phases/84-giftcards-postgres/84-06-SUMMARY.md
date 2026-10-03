---
phase: 84-giftcards-postgres
plan: 06
subsystem: infra
tags: [redis, sentry, railway, gated-deploy, reconcile, health-check, postgres]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: "lib/db.js, lib/store-flag.js (GIFT_CARDS_STORE/RECIPES_STORE), /health database field (D-02)"
provides:
  - "recordGiftCardReconcileFailure(record) — durable giftcard:pending:<tx_ref> Redis record (D-11)"
  - "sweepGiftCardPending(deps) — 5-minute replay sweep consuming lib/gift-card-store.js's replayPending(record) contract (84-05)"
  - "/health database_required field + throttled Sentry alert on DB-down while a store requires it (D-10)"
  - "gated-deploy.yml smoke check gated on database_required/database, backward-compatible with pre-Phase-84 middleware"
affects: [84-05-gift-card-store, 84-cutover, docs/RUNBOOK.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-charge failure recording keyed by tx_ref (not Date.now()) so a sweep can target and idempotently replay the exact failed write"
    - "In-process timestamp throttle (module-level var) for a recurring alert condition on a frequently-polled endpoint"

key-files:
  created:
    - zoho-middleware/__tests__/reconcile-giftcard-pending.test.js
    - zoho-middleware/__tests__/health-database-required.test.js
  modified:
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/server.js
    - .github/workflows/gated-deploy.yml

key-decisions:
  - "sweepGiftCardPending lazy-requires lib/gift-card-store.js only once there is at least one giftcard:pending:* key to process, so this plan has zero hard dependency on 84-05 landing in the same tree — tests always inject deps.giftCardStore"
  - "isDatabaseRequired() re-resolves storeFlag.resolveStoreMode() per store name at request time (per plan's literal instruction) rather than reusing the boot-time storeModes snapshot — safe since resolveStoreMode only reads process.env and re-validates, it does not mutate state"

requirements-completed: [DB-03]

# Metrics
duration: 24min
completed: 2026-10-03
---

# Phase 84 Plan 06: Gift-card operational safety nets (D-10/D-11) Summary

**Durable giftcard:pending:<tx_ref> Redis record + 5-minute replay sweep for post-charge gift-card write failures (D-11), plus a database_required /health field that gates gated-deploy.yml's smoke check — never /health's own status — on a Postgres outage while any store is dual/postgres (D-10).**

## Performance

- **Duration:** 24 min
- **Started:** 2026-10-03T19:06:53Z (worktree base commit 1ccf5782)
- **Completed:** 2026-10-03T19:19:54Z
- **Tasks:** 2 completed
- **Files modified:** 5 (2 new test files, 3 modified)

## Accomplishments

- `recordGiftCardReconcileFailure(record)` never rejects into an already-charged sale; writes a durable Redis record at `giftcard:pending:<tx_ref>` (30-day TTL, reusing the existing `VOID_FAILURE_TTL` constant — no new TTL invented), logs CRITICAL, emits a Sentry error with `tags.component:'giftcards'`, and sends the staff `sendVoidFailureAlert` email. Logs never carry the raw `params` object (T-84-35 — may contain a staff email in `actor`).
- `sweepGiftCardPending(deps)` replays every `giftcard:pending:*` record through the injected (or lazily-required) gift-card store via the record's own `tx_ref`: success deletes the key and logs `giftcard.pending_replayed`; a business rejection (`{ok:false, error}`) sets `manual_review_required` + `last_error`, alerts once, and is skipped by all future sweeps; an infrastructure rejection increments `attempts` and keeps the record for the next cycle with no Sentry spam; a malformed record (missing `tx_ref`/`op`) is logged and left in place, never silently deleted.
- `/health` gains `database_required: true` whenever `GIFT_CARDS_STORE` or `RECIPES_STORE` resolves to `dual`/`postgres`. `status` stays `'ok'` unconditionally (Phase 83 D-02 invariant preserved — no Railway restart loop). A DB-down-while-required state logs CRITICAL and fires one `captureExceptionSafe` call per 10-minute window (module-level throttle timestamp).
- `gated-deploy.yml`'s "Smoke-check /health" step now reads `database`/`database_required` alongside `redis`/`authenticated`, hard-failing when `database_required=true` and `database!=true`, while still passing on `redis=true` alone when a response has no `database_required` field at all (`jq` `null` — pre-Phase-84 middleware compatibility).
- The 5-minute `sweepGiftCardPending()` backstop is registered in `server.js` next to the existing `sweepPendingCharges()` kiosk-charge sweep.

## Task Commits

Each task was committed atomically (tests + implementation together per commit — see Deviations):

1. **Task 1: D-11 durable pending record + replay sweep in lib/reconcile.js** - `a47326f0` (feat)
2. **Task 2: D-10 /health database_required + DB-down alert, sweep registration, smoke-check gate** - `273d9b11` (feat)

## Files Created/Modified

- `zoho-middleware/lib/reconcile.js` - Added `GIFT_CARD_PENDING_PREFIX`, `recordGiftCardReconcileFailure`, `sweepGiftCardPending`; added `require('./sentry-capture')`
- `zoho-middleware/__tests__/reconcile-giftcard-pending.test.js` - 10 tests covering every `<behavior>` line (record shape/TTL, logging/Sentry/email, cache.set-rejects path, no-params-in-logs, all 6 sweep branches)
- `zoho-middleware/server.js` - `storeFlag` module reference kept at boot; `isDatabaseRequired()`; `/health` gains `database_required` + throttled DB-down alert; registered `reconcile.sweepGiftCardPending()` 5-min interval; updated D-02 code comment to point at Phase 84 D-10
- `zoho-middleware/__tests__/health-database-required.test.js` - 4 tests covering every `<behavior>` line (unset flags, dual+DB-down+alert, 10-min throttle, postgres+DB-up+no-alert)
- `.github/workflows/gated-deploy.yml` - Smoke-check step reads `DB`/`DBREQ`, gates on `redis=true AND (DBREQ!=true OR DB=true)`, updated header comment, added a Postgres-unreachable possible-cause line pointing at `docs/RUNBOOK.md` Gift cards rollback (not yet written — later phase/plan in 84 owns that doc content)

## Decisions Made

- `sweepGiftCardPending`'s `require('./gift-card-store')` is deferred until after the "any keys present" check, specifically so this plan has zero hard dependency on `lib/gift-card-store.js` (84-05) existing in the tree — at the time this plan ran, 84-05 was executing concurrently in a sibling worktree and had not landed here. Every test injects `deps.giftCardStore` directly; the lazy path is exercised safely in production once 84-05 ships, since there will always be at least a zero-key case first.
- `isDatabaseRequired()` calls `storeFlag.resolveStoreMode(name)` directly (literal plan instruction) rather than reusing the `storeModes` object already computed once at boot. Confirmed safe: `resolveStoreMode` is a pure read of `process.env` plus revalidation (no mutation, no side effect beyond a `process.exit` on an already-booted-successfully value, which cannot occur post-boot since the value doesn't change at runtime).
- The three jq smoke-check cases from the acceptance criteria, evaluated locally:
  - `{"redis":true,"database":false,"database_required":true}` → **FAILS** (`DBREQ="true"` and `DB!="true"`)
  - `{"redis":true,"database":false,"database_required":false}` → **PASSES** (`DBREQ!="true"`)
  - `{"redis":true,"database":false}` (no `database_required` key) → **PASSES** (`jq` yields `"null"`, which is `!="true"` — backward compatible with pre-Phase-84 middleware)

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were found beyond what the plan already specified.

### Process note (not a Rule 1-4 deviation)

Both tasks are marked `tdd="true"` in the plan. Sibling plans in this phase (84-02) split RED and GREEN into separate `test(...)`/`feat(...)` commits. This plan's two tasks were each committed as a single combined `feat(84-06): ...` commit containing both the new test file and the implementation, after confirming RED (10/10 and 4/4 new tests failing) then GREEN (all passing) at each step. The RED→GREEN discipline was followed in practice; only the commit granularity differs from the sibling-plan convention. No functional impact — flagging for consistency awareness only.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None — plan executed exactly as written functionally; only a cosmetic commit-granularity note above.

## TDD Gate Compliance

Plan frontmatter `type: execute` (not `type: tdd`), so the strict plan-level RED/GREEN/REFACTOR gate sequence does not apply. Both tasks individually followed RED (new test file added, confirmed failing against the pre-change `lib/reconcile.js`/`server.js`) then GREEN (implementation added, full new-test-file + adjacent existing-test-file suites passing) before commit, consistent with `tdd="true"` task-level intent.

## Issues Encountered

None. The worktree required `git reset --hard` to the plan's base commit at startup (base was behind by several Phase 83 commits — this orchestrator-provided base-sync step, not an issue with the plan itself). `npm ci` was required in both `zoho-middleware/` and the repo root (worktree had no `node_modules`).

## User Setup Required

None — no external service configuration required. `docs/RUNBOOK.md`'s "Gift cards rollback" section referenced in the smoke-check's failure message does not exist yet; it is explicitly out of this plan's `files_modified` list and is expected to be authored by a later plan/phase in 84 (the cutover/rollback plan).

## Next Phase Readiness

- D-11's pending-record format (`{op, params, tx_ref, cert_number, amount, error, needs_manual_review, attempts, created_at}`) and the `replayPending(record) -> Promise<{ok, error?}>` contract are fixed and ready for 84-05 (`lib/gift-card-store.js`) to implement against.
- D-10's deploy gate is live in `gated-deploy.yml`; once any store flips to `dual`/`postgres` in production, a DB outage will correctly block the next deploy instead of silently succeeding.
- No blockers for sibling/downstream plans in Phase 84.

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
