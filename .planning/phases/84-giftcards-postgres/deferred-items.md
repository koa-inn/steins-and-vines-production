# Deferred Items — Phase 84 (giftcards-postgres)

Out-of-scope discoveries found during plan execution, logged per the scope-boundary rule
(not fixed — pre-existing, not caused by the current plan's changes).

## 84-04: `backfill.test.js` "table hygiene" test is stale after 84-01's migration

**Found during:** 84-04 Task 2, running the full `npm run test:db` suite (not the plan's own
scoped verification command, which only runs `-- gift-cards-backfill`).

**Symptom:** `__tests__/db/backfill.test.js` → `table hygiene` → "no table other than the
test-created target exists in public except app_meta and pgmigrations" fails:
`gift_cards`/`gift_card_transactions` now exist in `public` (via `applyMigrations`, which
applies every file under `migrations/`), but the test's allow-list was written in Phase 83
before `migrations/0002_gift_cards.sql` (Phase 84 Plan 01) existed.

**Root cause:** Phase 83's rehearsal-sheet test hard-codes an allow-list of `public` tables
that predates Phase 84's additive migration. This is a cross-plan gap between 83-07 and 84-01,
not something introduced by 84-04 — 84-04 added no migration and did not modify this test file.

**Reproduction:** `cd zoho-middleware && npm run test:db` (full suite) on current `main`
(commit `849996b1` or later) fails this one assertion; `npm run test:db -- gift-cards-backfill`
(the actual verification command for 84-04) is unaffected and passes.

**Suggested fix (not applied here, out of scope):** update the allow-list in
`__tests__/db/backfill.test.js`'s `table hygiene` test to include `gift_cards` and
`gift_card_transactions` (and any further tables added by later Phase 84-88 migrations), or
derive the expected set from `migrations/*.sql` instead of a hard-coded list.
