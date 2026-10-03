---
phase: 84-giftcards-postgres
plan: 04
subsystem: database
tags: [postgres, backfill, gift-cards, ledger, xlsx, money-path, tdd]

# Dependency graph
requires:
  - phase: 84-giftcards-postgres
    plan: 01
    provides: "migrations/0002_gift_cards.sql (gift_cards + gift_card_transactions + gift_card_cert_seq) — the exact target schema this backfill promotes into"
  - phase: 83-postgres-infrastructure
    provides: "scripts/backfill/{read-xlsx,normalize,rejects,backfill}.js primitives, lib/db.js createPool, Testcontainers pg-harness (postgres:18-alpine)"
provides:
  - "scripts/backfill/specs/gift-cards.js — GiftCards sheet column spec (deliberately unregistered in specs/index.js)"
  - "scripts/backfill/gift-cards-backfill.js — pure buildGiftCardBackfillPlan() + runGiftCardBackfill() CLI with one-transaction promote"
  - "Real-Postgres proof of the backfill half of ROADMAP SC2: to-the-cent balances, D-12 invariant, TEST-* exclusion, D-14 sequence seeding, reject-blocks-promotion gate"
affects: [84-10-staging-cutover, 84-11-production-cutover]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-table backfill orchestration lives OUTSIDE the generic single-sheet-to-single-table backfill.js/load.js path when a sheet's promotion requires synthesizing derived rows (opening_balance ledger rows) or importing a second sheet's historical rows into the same target table — reuses normalize.js/rejects.js primitives directly rather than normalizeRow's spec-driven path for the second sheet"
    - "Composite tx_ref minting (saleRef + ':' + cert + ':' + kind) applied uniformly to both live writes (84-01's facade, future) and historical backfilled rows, so an old Phase 51 ref can never collide with a future Postgres-minted one (Pitfall 1)"
    - "In-transaction invariant checks (card count, balance sum, per-card ledger-sum invariant, imported-row count) run AFTER every insert and the sequence setval but BEFORE commit — any failure rolls back the whole promote, naming only the failed check (never row values, D-13)"

key-files:
  created:
    - zoho-middleware/scripts/backfill/specs/gift-cards.js
    - zoho-middleware/scripts/backfill/gift-cards-backfill.js
    - zoho-middleware/__tests__/backfill/gift-cards-backfill-plan.test.js
    - zoho-middleware/__tests__/db/gift-cards-backfill.test.js
    - .planning/phases/84-giftcards-postgres/deferred-items.md
  modified:
    - zoho-middleware/scripts/backfill/backfill.js
    - zoho-middleware/scripts/backfill/README.md

key-decisions:
  - "balance_before/balance_after/created_at/notes are NOT carried over from historical GiftCardTransactions rows into Postgres — only the fields the plan's <behavior> explicitly names (cert_number, tx_ref, kind, amount, imported, actor, source_tx_id) are populated; the DB's own now() default fills created_at, and the nullable balance_before/balance_after columns stay null for imported rows (opening_balance rows DO get them, per spec)"
  - "Ledger rejects carry a cert_number field alongside rowNumber/reasons (cards' rejects do not) — cert_number is a generated gift-card ID, not customer PII, so this doesn't violate the D-13 'names only, never values' rule and directly satisfies the plan's 'needs_manual_review rejects AND its cert added to rejects' requirement"
  - "issued_date has no dedicated normalize.js type (only 'timestamptz' exists) — handled locally in the planner: a JS Date's UTC-named fields are read directly as the calendar date (same wall-clock-in-UTC-fields convention normalize.js already documents for Trap 2), a 'YYYY-MM-DD' string passes through unchanged, anything else rejects 'issued_date_unparseable'"
  - "No --accept-rejects flag on the GiftCards CLI (unlike the generic backfill.js) — D-13 for GiftCards is unconditional: any reject blocks promotion, the owner must fix the sheet and re-run; this is a deliberate narrower contract, not an oversight"

requirements-completed: [DB-03]  # backfill half only — DB-03 spans the full phase; not closeable until the remaining 84-0X plans land

# Metrics
duration: ~35min
completed: 2026-10-03
---

# Phase 84 Plan 04: GiftCards Backfill (Dedicated Two-Table Orchestration) Summary

**Dedicated `gift-cards-backfill.js` CLI promoting the GiftCards + GiftCardTransactions sheets into `gift_cards` + `gift_card_transactions` in one transaction, with D-12's opening-balance invariant and D-13's TEST-*/needs-manual-review exclusion rules proven against a real Postgres 18 container.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-10-03T19:42:38Z
- **Tasks:** 2
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `specs/gift-cards.js` defines the straightforward GiftCards → `gift_cards` column mapping but is deliberately NOT registered in `specs/index.js` — the generic single-table `backfill.js --sheet GiftCards` path would promote cards with no matching `opening_balance` ledger rows and silently break the D-12 invariant, so the dedicated CLI is the only route in (84-RESEARCH.md Pitfall 3).
- `buildGiftCardBackfillPlan(cardSheet, ledgerSheet, opts)` is a pure planner implementing every Task 1 `<behavior>` line: TEST-* exclusion (not rejection) for both cards and their ledger rows; card validation (status enum, malformed cert, non-numeric balance, duplicate cert) via `normalizeRow`; a locally-handled `issued_date` (no 'date' normaliser type exists); ledger validation (`needs_manual_review` truthy set, unsettled claims, cert-not-found, negative-amount sign) via `normalizeNumeric`; composite `tx_ref` minting that reproduces the live facade's Pitfall-1 scheme for historical rows, including the duplicate-collision reject case; `opening_balance` row synthesis (D-12); sequence seeding (D-14); and aggregate totals.
- `runGiftCardBackfill` + its CLI read both sheets, validate headers, write two rejects reports, and gate promotion unconditionally on any reject (D-13 — no `--accept-rejects` escape hatch for this CLI, unlike the generic one). `--promote` confirms the target database name (injectable for tests), checks both tables are empty outside the transaction, then inserts cards + ledger rows + seeds the sequence + runs four in-transaction invariant checks before committing — any failure rolls back and names only the failed check.
- Real-Postgres test (`__tests__/db/gift-cards-backfill.test.js`) proves all three required cases against `postgres:18-alpine`: (a) a clean fixture with active/depleted/void/$0 cards, a Pitfall-1 shared-raw-ref historical pair across two different certs, and `TEST-LEDGER-01` + its 4 probe rows promotes correctly — balances exact to the cent, the invariant holds, TEST-* is absent, and the sequence lands on `GC-000004`; (b) a `needs_manual_review` row blocks promotion with both tables left empty; (c) a second promote run on the same (now non-empty) database aborts cleanly.

## Task Commits

1. **Task 1: Spec + pure backfill planner** — `db9e6d07` (test, RED) / `e88c59b3` (feat, GREEN)
2. **Task 2: CLI orchestration + one-transaction promote + real-Postgres test** — `5f301b45` (test, RED) / `75dac4fc` (feat, GREEN)

_TDD plan: both tasks' RED commits confirmed a genuine failure before any implementation —
Task 1 on "Cannot find module", Task 2 on "runGiftCardBackfill is not a function" (the latter
run against a real started postgres:18-alpine container, not mocked)._

## Files Created/Modified

- `zoho-middleware/scripts/backfill/specs/gift-cards.js` — GiftCards sheet → `gift_cards` column spec, unregistered in `specs/index.js` by design
- `zoho-middleware/scripts/backfill/gift-cards-backfill.js` — pure planner + CLI + one-transaction promote (new file)
- `zoho-middleware/scripts/backfill/backfill.js` — additive export of `assertSnapshotSafePath` + `checkHeaders` (no behaviour change), reused by the new CLI
- `zoho-middleware/scripts/backfill/README.md` — new "GiftCards (Phase 84)" section documenting the dedicated CLI's procedure and why it differs from the generic one
- `zoho-middleware/__tests__/backfill/gift-cards-backfill-plan.test.js` — 26 unit tests covering every planner `<behavior>` line
- `zoho-middleware/__tests__/db/gift-cards-backfill.test.js` — 4 real-Postgres tests (cases a/b/c + dry-run)
- `.planning/phases/84-giftcards-postgres/deferred-items.md` — logged a pre-existing, out-of-scope test gap found while running the full `test:db` suite (see Issues Encountered)

## Decisions Made

See frontmatter `key-decisions`. In short: historical ledger rows carry only the fields the plan's `<behavior>` explicitly names (not balance_before/balance_after/created_at/notes, which stay at their DB defaults/null); ledger rejects carry `cert_number` since it isn't PII; `issued_date` is normalised locally since no `normalize.js` type covers date-only values; and the GiftCards CLI has no `--accept-rejects` override, matching D-13's unconditional-block requirement for this specific migration.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' defensive extras (rejecting an `invalid_kind` ledger row, rejecting a malformed/non-numeric amount as `ledger_amount_invalid`) are within the plan's own instruction to reuse `normalizeNumeric` for ledger cells and do not change any stated `<behavior>` line's outcome; they only harden against sheet data the fixtures don't otherwise exercise (Rule 2 — correctness).

## Issues Encountered

While running the full `npm run test:db` suite (broader than this plan's own scoped verification command, `npm run test:db -- gift-cards-backfill`), found that `__tests__/db/backfill.test.js`'s "table hygiene" test now fails: its hard-coded allow-list of `public` tables (`app_meta`, `pgmigrations`) predates 84-01's `migrations/0002_gift_cards.sql`, which now legitimately creates `gift_cards`/`gift_card_transactions` in every migrated test database. This is a Phase 83 → Phase 84 Plan 01 cross-plan gap, not caused by this plan (84-04 added no migration and did not touch that test file). Logged in `deferred-items.md`, not fixed (out of scope per the scope-boundary rule). This plan's own verification command is unaffected and green.

## User Setup Required

None — no external service configuration required. No deploy of any kind occurred (per environment constraints); this plan is code-only, verified locally against a throwaway Testcontainers Postgres 18 instance. Running this CLI against real staging/production data is explicitly out of scope for this plan (that's 84-10/84-11).

## Next Phase Readiness

- The GiftCards backfill tooling is ready for 84-10 (staging rehearsal) and 84-11 (production cutover) to run for real against an owner-downloaded `.xlsx` snapshot, following the new README section's procedure.
- `lib/gift-card-store.js` (84-05, the live-write facade) and this backfill CLI now share the identical composite `tx_ref` minting convention (`saleRef + ':' + cert + ':' + kind`), so historical and future-live tx_refs can never collide once both land.
- No blockers. This plan's own scoped verification (`npx jest __tests__/backfill/ && npm run test:db -- gift-cards-backfill && npm test && npm run lint`) is fully green: middleware 2170/2170, frontend 2076/2076, lint clean (middleware + root).

## Self-Check: PASSED

- FOUND: zoho-middleware/scripts/backfill/specs/gift-cards.js
- FOUND: zoho-middleware/scripts/backfill/gift-cards-backfill.js
- FOUND: zoho-middleware/__tests__/backfill/gift-cards-backfill-plan.test.js
- FOUND: zoho-middleware/__tests__/db/gift-cards-backfill.test.js
- FOUND: .planning/phases/84-giftcards-postgres/deferred-items.md
- FOUND commit db9e6d07 (test, RED, Task 1)
- FOUND commit e88c59b3 (feat, GREEN, Task 1)
- FOUND commit 5f301b45 (test, RED, Task 2)
- FOUND commit 75dac4fc (feat, GREEN, Task 2)

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
