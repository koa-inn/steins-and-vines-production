---
phase: 83-postgres-infrastructure
plan: 10
subsystem: database
tags: [node-pg-migrate, postgres, migration-guard, security, tdd]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: "83-03's additive-only migration guard (D-04) and its existing regression test suite"
provides:
  - "Single left-to-right tokenizer in migration-guard.js that mirrors node-pg-migrate 9's exact Up/Down marker regex and slicing semantics"
  - "Recursive scanning of dollar-quoted bodies (DO blocks, LANGUAGE sql function bodies) for hidden destructive statements"
  - "Unanchored delete/update rules plus new do-block, execute, merge, upsert, sequence-reset rules"
  - "IN-01 fix: ALTER TABLE ... ADD COLUMN type text no longer false-flagged as alter-type"
  - "findUnguardedFiles() + CLI wiring that fails closed on any non-.sql migration file (CR-02)"
affects: [84-gift-cards-postgres-cutover]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-pass character tokenizer instead of chained regex strip passes for SQL-adjacent parsing, to avoid comment/literal desync bugs"
    - "Recursive body scanning: dollar-quoted content is opaque to the outer scan but independently retokenized to catch SQL hidden inside DO blocks and function bodies"

key-files:
  created:
    - zoho-middleware/__tests__/migration-guard-hardening.test.js
  modified:
    - zoho-middleware/scripts/migration-guard.js
    - zoho-middleware/migrations-manual/README.md

key-decisions:
  - "Body-level tokenizer errors (e.g. a dollar-quoted string literal like $$'$$ whose payload is a lone apostrophe) are not surfaced as unterminated-token violations — only the top-level Up-section scan uses unterminated constructs as a fail-closed signal, since a body's bounds are already known from its matching $tag$ delimiters"
  - "DO blocks, dynamic EXECUTE, MERGE, upsert, and sequence resets are rejected outright with no attempt to parse further — the guard routes all of them to migrations-manual/ rather than trying to reason about their safety"

requirements-completed: [DB-02]

# Metrics
duration: ~20min
completed: 2026-10-02
---

# Phase 83 Plan 10: Migration Guard Hardening Summary

**Rewrote the additive-only migration guard (`zoho-middleware/scripts/migration-guard.js`) from four chained regex passes to a single left-to-right tokenizer with node-pg-migrate-identical Up/Down markers, unanchored DML rules, new DO/EXECUTE/MERGE/upsert/sequence-reset rules, and a fail-closed check for non-`.sql` migration files — closing every CR-01/CR-02/IN-01 row from 83-REVIEW.md.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-10-02
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Replaced the old chained-regex comment/literal stripper with a single character-by-character tokenizer that correctly handles `--` line comments, nested `/* */` block comments, `''`/E`''` string literals (with backslash and `''` escapes), `"..."` quoted identifiers, and `$tag$` dollar-quoted bodies — closing the `'a--b'`, E`''`, quoted-identifier-apostrophe, and dollar-quote parse bypasses from CR-01
- Made the Up/Down marker regexes byte-identical (source + flags) to node-pg-migrate 9's `createMigrationCommentRegex`, and rewrote `extractUpSection` to mirror its `getActions` slicing exactly — including the down-before-up "runs to EOF" edge case and the unanchored mid-line `-- down migration notes` desync bug
- Added recursive scanning of every dollar-quoted body, so a destructive statement hidden inside a `LANGUAGE sql` function body or a `DO $$ ... $$` block is now caught
- Rewrote `RULES`: `alter-type` now matches the optional-`COLUMN`-keyword shorthand (fixing IN-01's false positive on `ADD COLUMN type text`); `delete`/`update` are unanchored (catching `WITH ... DELETE`, `UPDATE ONLY`, `UPDATE ... AS alias`); new `do-block`, `execute` (excluding the trigger `EXECUTE FUNCTION|PROCEDURE` clause), `merge`, `upsert`, and `sequence-reset` rules reject previously-unguarded destructive forms
- Added `findUnguardedFiles()` and wired it into the CLI ahead of `checkMigrationsDir()`, so any non-dotfile, non-`.sql` entry in `migrations/` (a `.js`/`.ts` file node-pg-migrate would otherwise execute via `jiti`) aborts the pre-deploy step (CR-02)
- Updated `migrations-manual/README.md`'s rule list to name every current rule and explain which destructive forms always route to the manual procedure

## Task Commits

1. **Task 1 RED: failing tests for parse bypasses** - `3fb252c8` (test)
2. **Task 1 GREEN: tokenizer + node-pg-migrate-identical markers** - `bc5f5b29` (fix)
3. **Task 2 RED: failing tests for rule gaps and IN-01** - `8d58147d` (test)
4. **Task 2 GREEN: unanchored DML + DO/EXECUTE/MERGE/upsert/sequence-reset rules** - `2014cd73` (fix)
5. **Task 3 RED: failing tests for non-SQL migration files** - `10e1bdf3` (test)
6. **Task 3 GREEN: findUnguardedFiles + CLI fail-closed wiring** - `595b5919` (fix)

**Plan metadata:** (this commit, created after SUMMARY)

## Files Created/Modified
- `zoho-middleware/__tests__/migration-guard-hardening.test.js` - New regression suite: 52 cases covering every CR-01 bypass row, the IN-01 false positive, and CR-02's non-SQL file check
- `zoho-middleware/scripts/migration-guard.js` - Rewritten tokenizer, node-pg-migrate-identical markers, extended RULES, new `findUnguardedFiles` export, CLI wiring
- `zoho-middleware/migrations-manual/README.md` - Rule list updated to name every current rule

## Decisions Made
- Body-level tokenizer parse errors are deliberately swallowed (not reported as `unterminated-token`) during recursive dollar-quote-body scanning, even though the Task 1 action text describes forwarding them. Forwarding them would make a totally safe, common idiom — a dollar-quoted string literal like `$$it's a test$$` used specifically to avoid escaping an apostrophe — fail closed as a false positive. The behavior-driving test (`select $$'$$; drop table gift_cards; select $$'$$;` must return exactly 1 violation) confirmed this reading is correct; only the top-level Up-section scan uses "construct still open at EOF" as a security-relevant fail-closed signal, since that's the one place where an undetected boundary could hide destructive SQL that node-pg-migrate would still execute.

## Deviations from Plan

**1. [Rule 1 - Bug] Did not propagate recursive dollar-quote-body tokenizer errors as `unterminated-token` violations**
- **Found during:** Task 1, while implementing the tokenizer against the `select $$'$$; drop table gift_cards; select $$'$$;` test case
- **Issue:** The plan's Task 1 action text says "Body tokenizer errors are also `unterminated-token`." Implementing that literally makes the dollar-quoted-literal test fail: the body `'` (a lone apostrophe — the entire point of dollar-quoting apostrophes) tokenizes as an "unterminated string" in isolation, producing a second, spurious violation when the test requires exactly one (`drop`).
- **Fix:** `scanBody()` only forwards RULES-matched statement violations from a recursive scan; it silently ignores that scan's own `errors` array. The outer/top-level call (`findDestructiveStatements`) still forwards its own tokenizer errors as `unterminated-token`, since that is the actual fail-closed security boundary (an ambiguous Up-section end could hide code node-pg-migrate would still run).
- **Files modified:** `zoho-middleware/scripts/migration-guard.js` (documented in the file's header comment and in `scanBody`'s docstring)
- **Verification:** All 67 tests in `migration-guard-hardening.test.js` + `migration-guard.test.js` pass, including the `$$'$$` exactly-1-violation case and the function-body-delete at-least-1-violation case
- **Committed in:** `bc5f5b29` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix to match the plan's own behavior-driven test requirements over a literal reading of its prose)
**Impact on plan:** Necessary for correctness — the literal instruction, if followed, would make the guard reject a common, safe SQL idiom. No scope creep; the fix is scoped entirely to the already-planned tokenizer.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Verification gap 1 (REVIEW CR-01, CR-02, IN-01) can be re-verified as VERIFIED: all CR-01 bypass rows and rule-gap rows are rejected, IN-01 is accepted, CR-02's non-SQL-file bypass fails closed, and the pinned `__tests__/migration-guard.test.js` suite is unchanged and still green (`git diff --exit-code 677162fe -- zoho-middleware/__tests__/migration-guard.test.js` exits 0)
- Full middleware suite (130 suites, 1937 tests) and full frontend suite (141 suites, 2048 tests) both pass; `npm run lint` is clean
- `node scripts/migration-guard.js` against the real `migrations/` directory exits 0 — the next staging pre-deploy is unaffected
- Phase 84 (gift-card Postgres cutover) can now add migration `0002` behind a guard that mirrors node-pg-migrate's own parsing and rejects DO blocks, dynamic EXECUTE, MERGE, upserts, sequence resets, and non-SQL migration files, in addition to the original DROP/TRUNCATE/RENAME/ALTER-TYPE/DELETE/UPDATE set

## Self-Check: PASSED

- FOUND: `zoho-middleware/__tests__/migration-guard-hardening.test.js`
- FOUND: `zoho-middleware/scripts/migration-guard.js`
- FOUND: `zoho-middleware/migrations-manual/README.md`
- FOUND: `.planning/phases/83-postgres-infrastructure/83-10-SUMMARY.md`
- FOUND commits: `3fb252c8`, `bc5f5b29`, `8d58147d`, `2014cd73`, `10e1bdf3`, `595b5919`

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*
