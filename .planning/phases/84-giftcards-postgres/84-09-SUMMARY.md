---
phase: 84-giftcards-postgres
plan: 09
subsystem: database
tags: [postgres, gift-cards, backfill, verify, rollback, runbook, money-path, tdd]

# Dependency graph
requires:
  - phase: 84-giftcards-postgres
    plan: 04
    provides: "scripts/backfill/gift-cards-backfill.js — buildGiftCardBackfillPlan, reused
      here for the sheet-side card normalisation + TEST-* exclusion rule so verify and the
      backfill CLI can never silently disagree on what a 'real' card is"
  - phase: 84-giftcards-postgres
    plan: 05
    provides: "lib/gift-card-store.js — buildMirrorPayload(card, ledger), the exact 84-02
      mirror_gift_card_state contract shape the replay script's payloads must match"
provides:
  - "scripts/backfill/gift-cards-verify.js — read-only Postgres-vs-sheet verifier (D-15):
    compareGiftCards (pure) + runVerify (CLI), to-the-cent, cert+field-only output"
  - "scripts/backfill/gift-cards-replay-to-sheet.js — Postgres -> sheet ledger replay for
    rollback (D-04): buildReplayBatches (pure) + runReplay (CLI), dry-run by default"
  - "docs/RUNBOOK.md 'Gift cards -> Postgres (Phase 84)' section — the full owner-run
    cutover/dual-window/flip/rollback procedure, including the D-02 $1 test-card runsheet"
  - ".planning/phases/84-giftcards-postgres/84-DUAL-LOG.md — the dual-window log template
    (op-coverage table, discrepancy table with a classification column, flip-decision block)"
affects: [84-10-staging-cutover, 84-11-production-cutover]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A read-only verifier opens exactly one `begin transaction read only` / `commit` pair
      and issues only `select` statements — grepped at verification time
      (`grep -ciE \"insert |update |delete \"` must be 0) rather than only tested, so a
      future edit that accidentally adds a write statement fails CI-visibly even without a
      new test"
    - "A rollback/replay script is dry-run by default and requires an explicit --apply flag
      to make any HTTP call — mirrors the D-13 backfill CLI's --promote gate, applied here
      to the write-to-sheet direction instead of write-to-Postgres"
    - "Verify and backfill share the exact same sheet-side card normalisation
      (buildGiftCardBackfillPlan) rather than verify re-implementing its own parsing — two
      independent interpretations of the same sheet cell would be a silent D-15 hole"

key-files:
  created:
    - zoho-middleware/scripts/backfill/gift-cards-verify.js
    - zoho-middleware/scripts/backfill/gift-cards-replay-to-sheet.js
    - zoho-middleware/__tests__/backfill/gift-cards-verify.test.js
    - zoho-middleware/__tests__/backfill/gift-cards-replay-to-sheet.test.js
    - .planning/phases/84-giftcards-postgres/84-DUAL-LOG.md
  modified:
    - docs/RUNBOOK.md

key-decisions:
  - "compareGiftCards filters TEST-* certs from both its pgCards/sheetCards/
    pgInvariantViolations inputs itself (defense in depth) rather than trusting every caller
    to have already excluded them — the pure function's own guarantee, independently testable"
  - "buildReplayBatches orders ALL eligible ledger rows globally by created_at (not per-cert)
    before appending the no-rows-in-range cards (sorted by cert_number) — matches the plan's
    'in created_at order' wording literally rather than a per-cert grouping that would have
    been equally defensible but wasn't what was asked"
  - "runReplay's HTTP posting is sequential via a promise chain (not Promise.all), matching
    the plan's 'stops on the first {ok:false}' requirement — parallel posting could not honor
    a deterministic stop point"
  - "Neither new script was added to jest.config.js's collectCoverageFrom (scripts/backfill/
    is not in that glob, matching every other backfill script) — no coverage-floor edit was
    needed or made"

requirements-completed: [DB-03]  # operational tooling half; DB-03 overall closes once 84-10/84-11 cutovers land

# Metrics
duration: ~15min
completed: 2026-10-03
---

# Phase 84 Plan 09: GiftCards Verify/Replay Tooling + Runbook Summary

**A read-only Postgres-vs-sheet verifier and a dry-run-by-default ledger-replay script (both to-the-cent, cert+field-only output), plus the full RUNBOOK cutover/dual-window/flip/rollback procedure and dual-window log template that the D-15 production cutover depends on.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-10-03
- **Tasks:** 2
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- `gift-cards-verify.js` exports a pure `compareGiftCards(pgCards, sheetCards,
  pgInvariantViolations)` implementing every Task 1 `<behavior>` line: identical sets ->
  `{ok:true, compared:N}`; a `current_balance` or `status` mismatch; `missing_in_sheet` /
  `missing_in_postgres` for a cert on only one side; `ledger_invariant` for every cert in the
  invariant-violation list; TEST-* excluded from all three inputs; money always compared as
  integer cents (`'10.10'` vs `10.1` match). `runVerify` opens a single
  `begin transaction read only`, fetches `gift_cards` plus the per-card ledger-sum invariant,
  reuses 84-04's `buildGiftCardBackfillPlan` for the sheet-side card list so verify and the
  backfill CLI can never drift on normalisation, and prints either `"Verified N cards: 0
  mismatches"` or one `MISMATCH cert=... field=...` line per mismatch — never a balance or a
  name. Exits `EXIT.OK` or `EXIT.CHECKS_FAILED`; refuses an argv connection string.
- `gift-cards-replay-to-sheet.js` exports a pure `buildReplayBatches(cards, ledgerRows, opts)`:
  one payload per counted (non-imported) ledger row with `created_at >= since` (or every
  counted row if `since` is omitted), globally ordered by `created_at`, each built via the
  real `lib/gift-card-store.js` `buildMirrorPayload` carrying the card's CURRENT Postgres
  state — plus exactly one `ledger_entry: null` payload for any card with zero eligible rows.
  `runReplay` reads Postgres read-only, dry-runs by default (zero HTTP calls, prints the
  built count), and with `--apply` posts each payload sequentially to
  `APPS_SCRIPT_URL` as `{action: 'mirror_gift_card_state', server_token, ...payload}`,
  stopping at the first `{ok:false}` response (or a rejected HTTP call) and reporting only
  the cert + error.
- `docs/RUNBOOK.md` gained a full "Gift cards → Postgres (Phase 84)" section: the
  `GIFT_CARDS_STORE` flag semantics (incl. staging's no-sheet-leg caveat in `dual` mode), the
  staging rehearsal, the numbered D-15 after-hours production cutover checklist
  (`gift-cards-backfill.js --dry-run` → zero rejects → `--promote` → `dual` → `/health`
  `database_required` → fresh `.xlsx` → `gift-cards-verify.js` must be clean), the
  D-01/D-02/D-03 dual window + flip bar, the D-02 scripted $1 test-card runsheet (all six ops:
  issue, lookup, redeem, reload, adjust, void — CASH tender only), the D-04 flip to `postgres`
  (including a fill-in table for the Apps Script active/rollback version numbers), both
  rollback directions (dual→sheets via a replay-if-needed branch; postgres→sheets via
  `gift-cards-replay-to-sheet.js --since <flip time>`), the D-10 deploy gate, D-11
  `giftcard:pending:*` handling, and the Phase 83 prerequisites 84-11 checks. Contains no
  secrets or connection strings (verified by grep).
- `.planning/phases/84-giftcards-postgres/84-DUAL-LOG.md` created with header fields, an
  op-coverage table (all six ops), a discrepancy table with a classification column, and a
  flip-decision block, ready for the owner to fill in during the real dual window.

## Task Commits

1. **Task 1: gift-cards-verify.js and gift-cards-replay-to-sheet.js with tests** —
   `699e5348` (test, RED — confirmed both suites failed on "Cannot find module" before the
   implementation files existed) / `ce8184cf` (feat, GREEN — 27/27 new tests passing)
2. **Task 2: RUNBOOK section + dual-window log** — `dfb44ec4` (docs)

_TDD plan: Task 1's RED commit confirmed a genuine failure (module-not-found, not a false
pass) before any implementation line was written — both implementation files were
temporarily moved out of the worktree, the test run reconfirmed the "Cannot find module"
failure, then restored before the GREEN commit._

## Files Created/Modified

- `zoho-middleware/scripts/backfill/gift-cards-verify.js` — pure `compareGiftCards` + CLI
  `runVerify` (new file)
- `zoho-middleware/scripts/backfill/gift-cards-replay-to-sheet.js` — pure `buildReplayBatches`
  + CLI `runReplay` (new file)
- `zoho-middleware/__tests__/backfill/gift-cards-verify.test.js` — 15 tests: 9 pure
  `compareGiftCards` behavior-line tests, 2 `parseArgs` tests, 4 `runVerify` integration
  tests against a mocked pool/client + a real `.xlsx` fixture
- `zoho-middleware/__tests__/backfill/gift-cards-replay-to-sheet.test.js` — 12 tests: 6 pure
  `buildReplayBatches` behavior-line tests, 2 `parseArgs` tests, 4 `runReplay` integration
  tests against a mocked pool/client + mocked axios
- `docs/RUNBOOK.md` — new "Gift cards → Postgres (Phase 84)" section (11 subsections per the
  plan's `<action>`)
- `.planning/phases/84-giftcards-postgres/84-DUAL-LOG.md` — new dual-window log template

## Decisions Made

See frontmatter `key-decisions`. In short: `compareGiftCards` filters TEST-* on all three
inputs itself rather than trusting callers; `buildReplayBatches` orders every eligible row
globally by `created_at` (not per-cert) before appending the no-rows-in-range cards sorted by
cert; `runReplay`'s HTTP posting is a sequential promise chain so the "stop on first failure"
requirement has a deterministic, testable order; and neither script needed a
`jest.config.js` coverage-floor edit since `scripts/backfill/` is outside
`collectCoverageFrom`.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<behavior>`/`<action>` lines were
specific enough (exact SQL shapes implied by the interfaces section, exact payload contract
via `buildMirrorPayload`, exact RUNBOOK subsection list) that no interpretation gaps arose.

## Issues Encountered

The worktree needed a `git reset --hard` to the orchestrator's pinned base commit
(`cff19b2d`) at startup — the worktree branch's own history had diverged ahead of that base
(an unrelated real-Postgres-harness commit, `092b0a4f`, from a different concurrent session).
This is the orchestrator-provided base-sync step working as intended, not a defect in this
plan. `node_modules` was symlinked from the main checkout in both the repo root and
`zoho-middleware/` per the environment's disk-space constraint (not committed — verified via
`git status` before every commit, and removed before returning).

## User Setup Required

None — no external service configuration required. No deploy of any kind occurred (per
environment constraints); this plan is code + documentation only, verified against mocked
unit tests. The owner-run procedures this plan documents (staging rehearsal, production
cutover, dual window, flip, rollback) are explicitly out of scope for this plan — they are
84-10/84-11's job to execute for real.

## Next Phase Readiness

- `gift-cards-verify.js` and `gift-cards-replay-to-sheet.js` are ready for 84-10 (staging
  rehearsal) and 84-11 (production cutover) to invoke for real against an owner-downloaded
  `.xlsx` snapshot and a real `BACKFILL_DATABASE_URL`/`APPS_SCRIPT_URL`/
  `APPS_SCRIPT_SERVER_TOKEN`, following the new RUNBOOK section's numbered steps.
- `84-DUAL-LOG.md` is ready for the owner to start filling in the moment
  `GIFT_CARDS_STORE=dual` is first set in production.
- The RUNBOOK's flip-to-postgres subsection has a fill-in table for the Apps Script
  active/rollback version numbers — 84-11 (or whichever plan performs the real redeploy)
  must populate it at flip time, not leave it as a placeholder.
- No blockers. This plan's own scoped verification
  (`cd zoho-middleware && npx jest __tests__/backfill/gift-cards-verify.test.js
  __tests__/backfill/gift-cards-replay-to-sheet.test.js && npm test && npm run lint`, plus
  root `npm test && npm run lint`) is fully green: middleware 142/142 suites (2237/2237
  tests), frontend 144/144 suites (2076/2076 tests), both linters clean.

## Self-Check: PASSED

- FOUND: zoho-middleware/scripts/backfill/gift-cards-verify.js
- FOUND: zoho-middleware/scripts/backfill/gift-cards-replay-to-sheet.js
- FOUND: zoho-middleware/__tests__/backfill/gift-cards-verify.test.js
- FOUND: zoho-middleware/__tests__/backfill/gift-cards-replay-to-sheet.test.js
- FOUND: .planning/phases/84-giftcards-postgres/84-DUAL-LOG.md
- FOUND: docs/RUNBOOK.md modified (section "Gift cards → Postgres (Phase 84)" present)
- FOUND commit 699e5348 (test(84-09), RED)
- FOUND commit ce8184cf (feat(84-09), GREEN)
- FOUND commit dfb44ec4 (docs(84-09))
- `grep -c "read only" scripts/backfill/gift-cards-verify.js` → 3
- `grep -ciE "insert |update |delete " scripts/backfill/gift-cards-verify.js` → 0
- `grep -c "buildMirrorPayload" scripts/backfill/gift-cards-replay-to-sheet.js` → 3
- `grep -c -- "--apply" scripts/backfill/gift-cards-replay-to-sheet.js` → 7
- `grep -c "GIFT_CARDS_STORE" docs/RUNBOOK.md` → 10
- `grep -c "gift-cards-verify.js" docs/RUNBOOK.md` → 6
- `grep -c "gift-cards-replay-to-sheet.js" docs/RUNBOOK.md` → 2
- `grep -c "gift-cards-backfill.js --dry-run" docs/RUNBOOK.md` → 1
- `grep -c "mirror_gift_card_state" docs/RUNBOOK.md` → 5
- `grep -c "giftcard:pending:" docs/RUNBOOK.md` → 2
- `grep -c "database_required" docs/RUNBOOK.md` → 1
- `grep -nE "postgres(ql)?://[^ <]*@" docs/RUNBOOK.md` → no matches
- `cd zoho-middleware && npx jest __tests__/backfill/gift-cards-verify.test.js
  __tests__/backfill/gift-cards-replay-to-sheet.test.js`: 27/27 passed
- `cd zoho-middleware && npm test`: 142/142 suites, 2237/2237 tests passed
- `cd zoho-middleware && npm run lint`: clean (0 warnings)
- Root `npm test`: 144/144 suites, 2076/2076 tests passed
- Root `npm run lint`: clean (0 warnings)

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
