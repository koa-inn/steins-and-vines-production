---
phase: 83-postgres-infrastructure
plan: 13
subsystem: database
tags: [libpg-query, postgres, migration-guard, node-pg-migrate, sql-parser, d-04, security]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: node-pg-migrate pipeline, scripts/migration-guard.js (regex/tokenizer guard), migrations/0001_init.sql
provides:
  - "zoho-middleware/scripts/migration-allowlist.js — fail-closed, parser-backed (libpg-query@16.7.3 / real PG16 grammar) allowlist guard over node-pg-migrate's Up section, exporting ready/checkSql/checkMigrationsDir/findUnguardedFiles"
  - "zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js — 118-case ported research corpus (96 R / 22 A), 5 flagged apply:true in dependency order for 83-14's real-Postgres apply test"
  - "zoho-middleware/__tests__/migration-allowlist.test.js — 152 passing tests: full corpus, 15 rule-category assertions by case id, parser-version pin, CLI contract"
  - "libpg-query@16.7.3 pinned exactly in zoho-middleware/package.json dependencies"
affects: [83-14, 84-recipes-and-recipeingredients, any future phase adding migrations/NNNN_*.sql]

# Tech tracking
tech-stack:
  added: ["libpg-query@16.7.3 (production dependency, WASM PG16 grammar)", "@pgsql/types@16.1.2 (transitive)"]
  patterns: ["fail-closed AST allowlist (STMTS/ALTER_CMDS/NODES/FUNCS fixed lookup tables, Object.prototype.hasOwnProperty.call guards against prototype-pollution name collisions)", "whole-body AST walk rather than hand-picked field checks", "mirror node-pg-migrate's own Up-section slicing and trailing-';' append instead of re-deriving it"]

key-files:
  created:
    - zoho-middleware/scripts/migration-allowlist.js
    - zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js
    - zoho-middleware/__tests__/migration-allowlist.test.js
  modified:
    - zoho-middleware/package.json
    - zoho-middleware/package-lock.json

key-decisions:
  - "Old guard (scripts/migration-guard.js) stays as an unedited first pass; this module runs after it in the migrate chain (wiring deferred to 83-14) — owner decision 1"
  - "CREATE FUNCTION/PROCEDURE/TRIGGER, DO and CALL always reject with no hash-allowlist exception — owner decision 2"
  - "Any backslash anywhere in the raw Up section is rejected before parsing — owner decision 3"
  - "INSERT's selectStmt.SelectStmt wrapper must be unwrapped before the AST walk (walk its own fields directly instead of treating 'SelectStmt' as a node-type tag) — found during GREEN, not just a research note; without this fix every VALUES-only INSERT (including 0001_init.sql's own seed row) was falsely rejected as node-not-allowed"

requirements-completed: [DB-02]

# Metrics
duration: 45min
completed: 2026-10-02
---

# Phase 83 Plan 13: Fail-Closed Parser-Backed Migration Allowlist Guard Summary

**New `scripts/migration-allowlist.js` parses every migration's Up section with the real PG16 grammar (libpg-query@16.7.3 WASM) and rejects any statement, ALTER TABLE subcommand, expression node or function not on an explicit allowlist — closing all 4 open 83-REVIEW criticals and 5 research-found bypass classes that the old regex/tokenizer guard missed.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (TDD RED → GREEN)
- **Files created:** 3
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- `libpg-query@16.7.3` installed as an exact-pinned **production** dependency (verified: lands in `dependencies`, not `devDependencies`; `package-lock.json` resolves `node_modules/libpg-query` to exactly `16.7.3`; `@pgsql/types@16.1.2` transitive)
- Ported the 110-case 83-GUARD-RESEARCH.md corpus into `__tests__/fixtures/migration-allowlist-cases.js`, extended to 118 cases (96 reject / 22 accept) — exceeds the plan's >=90 R / >=20 A floor
- 5 cases flagged `apply: true` in the exact dependency order 83-14 needs for its real-Postgres apply test: `migrations/0001_init.sql` → `0002 gift cards` → `later additive` → `explicit public. qualification` → `regex CHECK written without backslash`
- `scripts/migration-allowlist.js` implements the full contract: `ready()`/`checkSql()`/`checkMigrationsDir()`/`findUnguardedFiles()`, byte-identical Up/Down marker regexes and section-slicing to `migration-guard.js`, the node-pg-migrate trailing-`;` mirror, and a CLI with the exact exit-code/stdout/stderr contract from the plan's `<interfaces>` block
- 152/152 tests pass in the new test file; the untouched `migration-guard.test.js` (17) and `migration-guard-hardening.test.js` (50) still pass; full middleware suite is green at 134 suites / 2115 tests (baseline was 133/1963 before this plan)
- `node scripts/migration-allowlist.js` exits 0 against the real `migrations/` dir: `migration-allowlist: 1 file(s) additive-only OK`
- Old guard (`scripts/migration-guard.js`) and both of its test files are byte-identical to the plan's starting commit — verified via `git log --format=%s -- <3 files> | grep -c 83-13` (0) and `git status --porcelain` (no entries for those paths)

## Rule names actually emitted (verified against the full 118-case corpus)

| Rule | Count in corpus | Example |
|---|---|---|
| `statement-not-allowed` | 61 | `CreateFunctionStmt`, `DoStmt`, `CallStmt`, `SelectStmt`, `DropStmt`, `VariableSetStmt`, `AlterObjectSchemaStmt`, ... |
| `alter-not-allowed` | 15 | `AT_AlterColumnType`, `AT_DetachPartition`, `AT_DropNotNull`, non-`OBJECT_TABLE` `AlterTableStmt` |
| `function-not-allowed` | 7 | `wipe()`, schema-qualified `public.now()` outside `pg_catalog` |
| `backslash` | 7 | any `\` in the raw Up section (CR-01b, WR-01-backslash, scs-dependent payloads) |
| `parse-error` | 6 | `select (` |
| `insert-shape` | 4 | `RETURNING`, `INSERT...SELECT`, `WITH` CTE, non-VALUES `selectStmt` |
| `missing-up-marker` | 2 | no `-- Up Migration` marker at all |
| `node-not-allowed` | 2 | non-ASCII identifier, `CREATE SCHEMA` with embedded `CREATE VIEW` |
| `schema-not-public` | 2 | `CREATE TABLE postgres.gift_cards` |
| `enum-rename` | 1 | `ALTER TYPE ... RENAME VALUE` |

`unreadable-file` and `non-sql-file` are exercised only at the directory/CLI level (not via `checkSql` on a single string) — covered by the CLI test suite (`0002_x.js: non-sql-file:` assertion) and by `checkMigrationsDir`'s try/catch around `readFileSync`.

**libpg-query resolved version:** `16.7.3` (package-lock.json `node_modules/libpg-query`), AST `parseSync('select 1').version === 160001` (PG16, as asserted in the test file).

**Corpus case whose expected outcome had to change:** none. Every ported case kept its original `expect` value; the one implementation bug found during GREEN (INSERT's `SelectStmt` wrapper being misclassified as an unknown node) was a guard bug, not a corpus error — fixed in the module, not by changing any test expectation.

## Task Commits

Both tasks committed atomically per the plan's TDD gate (root `npm test`, root `npm run lint`, `cd zoho-middleware && npm test`, `cd zoho-middleware && npm run lint` all run before each commit):

1. **Task 1: Add libpg-query, port the case corpus, write the failing allowlist test file (RED)** - `8c397d61` (test)
2. **Task 2: Implement scripts/migration-allowlist.js (GREEN)** - `127aeb8c` (feat)

No refactor commit was needed — GREEN passed cleanly after the one InsertStmt-walk fix (made before the GREEN commit, not as a separate commit).

## TDD Gate Compliance

- RED gate: `8c397d61` (`test(83-13): ...`) — confirmed failing (module not found, 0 tests ran) before any implementation existed; all 133 pre-existing middleware suites stayed green alongside the one failing new suite.
- GREEN gate: `127aeb8c` (`feat(83-13): ...`) — confirmed all 152 new tests pass, plus the two untouched old-guard suites, plus the full middleware suite.
- No REFACTOR commit — not needed.

Gate sequence present and in order. No warning needed.

## Files Created/Modified

- `zoho-middleware/scripts/migration-allowlist.js` - the fail-closed parser allowlist module + async CLI (432 lines)
- `zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js` - ported + extended case corpus (164 lines, 118 cases)
- `zoho-middleware/__tests__/migration-allowlist.test.js` - corpus-driven + rule-category + CLI tests (311 lines, 152 tests)
- `zoho-middleware/package.json` - `libpg-query: "16.7.3"` added to `dependencies`
- `zoho-middleware/package-lock.json` - lockfile updated for the new dependency tree

## Decisions Made

- Followed all three locked owner decisions from `83-GUARD-RESEARCH.md` exactly (old guard stays untouched as first pass; no function/trigger/procedure/DO/CALL exception mechanism; raw-text backslash ban before parsing).
- Reordered the 5 `apply: true` corpus entries within the fixture array itself (rather than relying on an undocumented sort order) so they appear in the exact real-Postgres apply sequence the plan specifies — the two independent/dependent cases (`explicit public. qualification`, `regex CHECK written without backslash`) are placed immediately after the three cumulative `repo`/`phase84` migrations they build on.
- Kept a single, flat violation-detail string format (`'#N <node/rule detail> — <120-char text slice>'`) rather than separate fields, matching the plan's `statement`/`rule` shape exactly so 83-14's README and CLI stderr format needs no translation layer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] INSERT's `selectStmt.SelectStmt` wrapper falsely rejected as an unknown AST node**
- **Found during:** Task 2 (GREEN) — first test run after writing the initial implementation
- **Issue:** The generic whole-body `walk()` treated the `SelectStmt` wrapper key (present on every `InsertStmt.selectStmt`) as a node-type tag via the capitalised-key check, and since `SelectStmt` is deliberately absent from the `NODES` allowlist (it must never be allowed as a top-level statement, e.g. for `CR-01a`), every VALUES-only INSERT — including the safe corpus cases and `migrations/0001_init.sql`'s own seed row — was falsely flagged `node-not-allowed`.
- **Fix:** For `InsertStmt`, the body passed to `walk()` has its `selectStmt` field pre-unwrapped to `selectStmt.SelectStmt`'s own fields (`valuesLists`, `limitOption`, `op`) before walking, exactly as the research prototype's "Production version must-dos" list specifies ("walk the whole body after the key check, rather than the hand-picked field list... he key allowlist makes the subset safe today, but walking everything is the robust form").
- **Files modified:** `zoho-middleware/scripts/migration-allowlist.js` (within Task 2, before its single commit — not a separate fix commit)
- **Verification:** All 118 corpus cases pass after the fix, including every VALUES-only INSERT accept case and the three Phase 84 realistic migrations.
- **Committed in:** `127aeb8c` (part of the Task 2 GREEN commit — the bug was found and fixed before GREEN was first achieved, so there is no separate RED-for-this-bug commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without the fix the guard would reject every additive migration containing a plain `INSERT ... VALUES`, including the very `0001_init.sql` file the plan requires to produce zero violations. No scope creep; the fix is confined to the AST-walk entry point for `InsertStmt`.

## Issues Encountered

None beyond the deviation above. AST shapes for every statement/node type referenced in the plan's `<action>` step 203-219 (CreateStmt, IndexStmt, AlterTableStmt/AlterTableCmd subtypes, AlterEnumStmt, InsertStmt + onConflictClause, CommentStmt, CreateSeqStmt, CreateEnumStmt, FuncCall qualifier/funcname shape, CONSTR_IDENTITY, FK Constraint, stmt_location/stmt_len presence-on-first-statement) were confirmed empirically against the installed `libpg-query@16.7.3` binary before writing the implementation, rather than assumed from the research doc alone.

## User Setup Required

None — no external service configuration required. `libpg-query` has zero install scripts (confirmed via `npm view libpg-query@16.7.3` and the installed package contents), so no Railway build changes beyond the existing `npm install --production` step are needed. Wiring this module into the actual `npm run migrate` pre-deploy chain is explicitly deferred to 83-14.

## Next Phase Readiness

- `zoho-middleware/scripts/migration-allowlist.js` is ready for 83-14 to wire into `npm run migrate` / Railway pre-deploy, run its real-Postgres apply test against the 5 `apply: true` fixtures (in the order they appear in the array), and document the module in the README.
- No blockers. The old guard (`scripts/migration-guard.js`) remains the first pass in front of this new allowlist, both proven independently green.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*

## Self-Check: PASSED

- FOUND: zoho-middleware/scripts/migration-allowlist.js
- FOUND: zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js
- FOUND: zoho-middleware/__tests__/migration-allowlist.test.js
- FOUND: .planning/phases/83-postgres-infrastructure/83-13-SUMMARY.md
- FOUND commit: 8c397d61 (test(83-13): add failing parser-allowlist migration guard tests)
- FOUND commit: 127aeb8c (feat(83-13): add fail-closed parser allowlist migration guard (D-04))
