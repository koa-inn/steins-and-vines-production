---
phase: 83-postgres-infrastructure
verified: 2026-10-02T00:00:00Z
status: gaps_found
score: 32/33 must-haves verified (all 4 ROADMAP success criteria VERIFIED; 2 of 3 prior plan-level gaps closed; 1 remains open under new findings)
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 30/33
  gaps_closed:
    - "Every row is normalised in the documented order … rejecting (never coercing) anything unconvertible, with a reason per column (83-06, D-12)"
    - "Promotion is … blocked when checks fail (83-07, D-12) — checks must be able to fail on a sheet that loaded nothing or lost a column"
  gaps_remaining:
    - "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section, both in `npm test` and inside the pre-deploy command itself (83-03, D-04)"
  regressions: []
gaps:
  - truth: "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section, both in `npm test` and inside the pre-deploy command itself (83-03, D-04)"
    status: partial
    reason: "83-10 closed every bypass listed in the original VERIFICATION.md (old CR-01, CR-02, IN-01) — the verifier reran all of them and they are now correctly rejected (drop, alter-type, update, do-block, etc.), and findUnguardedFiles() now fails closed on any non-.sql migration file. But the 83-REVIEW.md re-review, run against the NEW tokenizer, found and verified on real postgres:16-alpine FOUR independent new bypasses that the verifier reproduced directly against the shipped code: (1) `$` is a valid Postgres identifier-continuation character the tokenizer does not treat as such, so `select 1 as a$$t$;` or `select a$e'\\';drop table gift_cards;--'` opens a fake dollar-quote/E-string and hides a top-level DROP; (2) a function/procedure body written as an ordinary single- or E-quoted string (`CREATE FUNCTION wipe() ... AS 'DELETE FROM gift_cards'; SELECT wipe();`) is never scanned, only $tag$ bodies are; (3) the 83-10 deviation that silently swallows tokenizer errors inside a dollar-quoted body means any statement after a tokenizer/Postgres disagreement inside that body (e.g. a stray `$$$` inside a function body) is never rule-matched; (4) `ALTER TABLE t ALTER COLUMN U&\"balance\" TYPE integer` slips past alter-type because the regex only accepts `\"q\"` or a bare identifier, not a Unicode-escaped one. The verifier independently reran all four against the current `zoho-middleware/scripts/migration-guard.js` with plain `findDestructiveStatements()` (no Postgres needed to show the guard itself returns `[]`) and confirmed `[]` for all four — i.e. the guard does not flag any of them, so node-pg-migrate would execute the DROP/DELETE/TRUNCATE in each case. This is the only automated D-04 barrier on the production pre-deploy step, and Phase 84 is the first phase to add migration 0002 next to real gift-card money data, so this gap is not closed."
    artifacts:
      - path: "zoho-middleware/scripts/migration-guard.js"
        issue: "isIdentChar excludes '$' and non-ASCII letters so a `$`-continued identifier opens a fake dollar-quote/E-string (CR-01 new); only $tag$ bodies are pushed into bodies[] for recursive scanning, so single-/E-quoted function/procedure bodies are never checked (CR-02 new); scanBody() silently drops tokenizer errors inside a body instead of falling back to a raw-text scan (CR-03 new, the 83-10 documented deviation); ALTER_TYPE_CLAUSE_RE does not match a U&\"...\" unicode-escaped column token (CR-04 new)"
      - path: "zoho-middleware/__tests__/migration-guard-hardening.test.js"
        issue: "No regression cases for any of the 4 new bypasses (they postdate this file's creation)"
    missing:
      - "Tokenize identifiers as whole units before checking for E'/U&'/$tag$ starts, using Postgres's own ident_cont character class (letters, digits, underscore, $, and \\u0080-\\uFFFF)"
      - "Scan every CREATE FUNCTION/PROCEDURE string-literal body (not just dollar-quoted ones) for destructive statements, or fail closed by rejecting any CREATE FUNCTION/PROCEDURE whose body is not dollar-quoted and rejecting CALL outright"
      - "Replace scanBody's error-swallowing with a conservative raw-text rule match when a body fails to tokenize, instead of dropping the remainder of the body"
      - "Match ALTER COLUMN against any single non-space token (after stripping the ALTER TABLE prefix), not just \"q\" or a bare identifier, so U&\"...\" and non-ASCII column names are caught"
      - "Regression tests for all 4 new payloads, added to migration-guard-hardening.test.js"
    reviewer_note: "This is intentionally reported as still open, not deferred or overridden — the 83-REVIEW.md re-review explicitly asks the verifier to decide honestly whether the guard-as-D-04-barrier claim holds, and the verifier independently reproduced all 4 bypasses against the current code without any override request on file."
---

# Phase 83: Postgres Infrastructure Verification Report

**Phase Goal:** Both environments have their own Postgres, the middleware can query it transactionally under test, and the migration, backfill and store-flag machinery every later phase reuses exists and is proven on an empty schema.
**Verified:** 2026-10-02
**Status:** gaps_found
**Re-verification:** Yes — after gap closure (plans 83-10, 83-11, 83-12)

## Bottom line

Two of the three gaps from the initial verification are genuinely closed, verified independently in this pass (not taken from SUMMARY.md claims):

- **Gap 2 (backfill normaliser coercion, CR-03): CLOSED.** The verifier's exact prior reproduction — `normalizeRow(VesselHistory, {vessel_id:true, notes:{cellError:'#REF!'}})` — now returns `ok:false` with two typed reasons (`expected text, got boolean`, `cell error: #REF!`) instead of `ok:true` with `"[object Object]"`/`"true"`. `cellToPrimitive({})`, `cellToPrimitive({formula:'A1'})` and `cellToPrimitive({sharedFormula:'A2',result:'x'})` now give `{cellError:'unsupported cell value'}`, `{cellError:'formula has no cached result'}` and `'x'` respectively — no silent `null`.
- **Gap 3 (backfill zero-accept / header-drift, CR-04): CLOSED.** `backfill.js` now contains a `sheetResult.headers` comparison (`checkHeaders`) that aborts before normalising, and `load.js` contains a `read_vs_accepted` check and an "is empty — nothing to promote" refusal in `promote()`, both grep-confirmed present and exercised by new Docker-free and real-Postgres regression tests.
- **Gap 1 (migration guard, D-04): STILL OPEN**, under a new set of findings. 83-10 did close every bypass row from the original gap-1 report (the verifier reran them: `alter-type`, `update`, `do-block`, `[]` for `ADD COLUMN type text`, and non-`.sql` files now fail closed). But the independent re-review (`83-REVIEW.md`, committed `2c90029e`) found four new, different, equally-destructive bypasses and verified them on real Postgres. The verifier reran all four directly against `zoho-middleware/scripts/migration-guard.js` in this repository and confirmed the guard itself returns `[]` for each — meaning it does not flag SQL that node-pg-migrate will actually execute. The guard is measurably better than before (every known attack from the first review is closed, plus the full test suite including 67 migration-guard cases is green), but it is not "proven" in the sense the phase goal and the D-04 must-have claim. This is a cat-and-mouse parser-differential problem (SQL tokenization vs. the real Postgres lexer), and a new, different set of bypasses surviving a second adversarial review is strong evidence the class of bug (not just the specific instances) is not yet closed.

All four ROADMAP success criteria (SC1–SC4, the DB-02 contract) continue to hold — they do not depend on the guard being bypass-proof, only on it being wired into the pre-deploy step, which it is.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Railway Postgres in staging + production, distinct DATABASE_URLs, validateEnv refuses boot without one, /health reports database | VERIFIED (regression check only — no re-run needed, no file in this diff) | Unchanged since initial verification; `zoho-middleware/lib/validateEnv.js` and `server.js` untouched by 83-10/11/12. |
| SC2 | lib/db.js single pool/query/withTransaction; node-pg-migrate applies 0001_init.sql on deploy | VERIFIED | Unchanged; `node scripts/migration-guard.js` on the real `migrations/` dir still exits 0 and prints `migration-guard: 1 file(s) additive-only OK` (reran by verifier). |
| SC3 | Jest harness: real Postgres per test process, per-test rollback, CI runs it, round-trip green | VERIFIED | Reran by verifier: `CI=true npx jest --config jest.db.config.js` passes (32/32 with the new `backfill-gates.test.js` suite added by 83-12; orchestrator reported the same count post-merge). |
| SC4 | Store flag; mirror hard-off staging; backfill end-to-end with rejects report, zero rows to real tables | VERIFIED | Unchanged store-flag/mirror code. Backfill pipeline strengthened by 83-11/83-12 without breaking the end-to-end test (`backfill.test.js` still green, unmodified per `git diff --exit-code 677162fe`). |
| G1 (83-03, D-04) | Guard rejects destructive statements in Up, both in `npm test` and pre-deploy | **FAILED (still)** | Original bypass rows all now rejected (verifier reran). New independent re-review found and the verifier reproduced 4 new bypasses, all returning `[]` from `findDestructiveStatements`: dollar-sign/E-string identifier-continuation desync, single-/E-quoted function-body scanning gap, swallowed-tokenizer-error-in-body (an explicit 83-10 deviation), and `U&"..."` unicode-identifier evasion of `alter-type`. See gap. |
| G2 (83-06, D-12) | Normaliser rejects (never coerces) unconvertible cells | **VERIFIED (closed)** | Verifier's exact reproduction now returns `ok:false` with 2 typed reasons. `cellToPrimitive` no longer returns `null` for unknown shapes. |
| G3 (83-07, D-12) | Checks/promote can fail on a sheet that loaded nothing or lost a column | **VERIFIED (closed)** | `checkHeaders` wired before normalise (grep-confirmed); `read_vs_accepted` check and empty-scratch `promote()` refusal both grep-confirmed present; new Docker-free and real-Postgres regression suites added and green. |

**Score:** 32/33 truths verified (the 33rd — the guard being a reliable D-04 barrier — remains the one open item; everything else from the original 33-item list is unchanged from the initial VERIFICATION.md and continues to hold).

### Deferred Items

None. No later phase in the 82–88 milestone owns migration-guard hardening; it must be closed before Phase 84 writes migration `0002` next to gift-card money data, consistent with the prior verification's reasoning.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `zoho-middleware/scripts/migration-guard.js` | PARTIAL | Rewritten as a single-pass tokenizer (465 lines, up from ~150). Closes every originally-reported bypass. 4 new bypasses found by independent re-review and confirmed here. |
| `zoho-middleware/__tests__/migration-guard-hardening.test.js` | VERIFIED (for what it covers) | 52+ cases pinning every original CR-01/CR-02/IN-01 row; all pass. Does not yet cover the 4 new bypasses (they postdate it). |
| `zoho-middleware/scripts/backfill/normalize.js` | VERIFIED | `normalizeText` rejects cell-error, Date, boolean, object, non-finite-number; only strings and finite numbers accepted. Confirmed by direct `node -e` reproduction. |
| `zoho-middleware/scripts/backfill/read-xlsx.js` | VERIFIED | `cellToPrimitive` never returns `null` for an unrecognised shape; `sharedFormula` handled; confirmed by direct reproduction. |
| `zoho-middleware/scripts/backfill/backfill.js` | VERIFIED | `checkHeaders`/`sheetResult.headers` comparison present and wired before `[2/6] Normalise`; `read: counts.read` passed into `runChecks`. |
| `zoho-middleware/scripts/backfill/load.js` | VERIFIED | `read_vs_accepted` check (2 occurrences) and empty-scratch `promote()` refusal (exact message grep-confirmed) present. |
| `zoho-middleware/__tests__/backfill/normalize-no-coercion.test.js`, `read-xlsx-cell-shapes.test.js` | VERIFIED | New files exist, pass. |
| `zoho-middleware/__tests__/backfill/backfill-gates.test.js`, `__tests__/db/backfill-gates.test.js` | VERIFIED | New files exist, pass (confirmed by rerunning `npx jest __tests__/backfill/`). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `migrate` script | guard, then node-pg-migrate | `node scripts/migration-guard.js && node-pg-migrate up` | WIRED, but the guard behind it still has known bypasses (see gap) |
| `backfill.js runBackfill` | `checkHeaders` | comparison immediately after `readSheet`, before `[2/6] Normalise` | WIRED (grep: `backfill.js:252`) |
| `backfill.js runLoadChecksPromote` | `load.runChecks` | `read: counts.read` | WIRED (grep-confirmed) |
| `load.js promote()` | empty-scratch guard | `count(*)` before `to_regclass` check, outside BEGIN | WIRED (grep-confirmed) |
| `normalize.js normalizeRow` (text case) | `normalizeText` | switch dispatch | WIRED, now fail-closed |
| `read-xlsx.js readSheet` | `cellToPrimitive` → `{cellError}` → normalize.js rejects | `values[header] = primitive` | WIRED |

### Data-Flow Trace (Level 4)

Not applicable in the usual UI-rendering sense — this phase's artifacts are CLI scripts and a guard, not components rendering fetched data. The equivalent check (does the guard's output actually gate the pre-deploy command, does the backfill's checks output actually gate promote) is covered under Key Link Verification above.

### Behavioral Spot-Checks (run by the verifier, this pass)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full middleware suite | `cd zoho-middleware && npm test` | 133 suites / 1963 tests passed | PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean, no output | PASS |
| Guard on real migrations/ dir | `node scripts/migration-guard.js` | `migration-guard: 1 file(s) additive-only OK`, exit 0 | PASS |
| Targeted guard + backfill tests | `npx jest __tests__/migration-guard-hardening.test.js __tests__/migration-guard.test.js __tests__/backfill/` | 12 suites / 176 tests passed | PASS |
| CR-03 reproduction (should now fail closed) | `normalizeRow(VesselHistory, {vessel_id:true, notes:{cellError:'#REF!'}})` | `ok:false`, 2 typed reasons | PASS (gap 2 closed) |
| cellToPrimitive unknown shapes | `c({}), c({formula:'A1'}), c({sharedFormula:'A2',result:'x'})` | `{cellError:'unsupported cell value'}`, `{cellError:'formula has no cached result'}`, `'x'` | PASS (gap 2 closed) |
| Header-drift / read_vs_accepted / empty-scratch wiring | `grep -n "sheetResult.headers\|read_vs_accepted\|is empty — nothing to promote"` | all three present | PASS (gap 3 closed) |
| New CR-01 bypass: `$`-continued identifier (dollar-quote/E-string desync) | `findDestructiveStatements('-- Up Migration\nselect 1 as a$$t$;\nselect 1 as b$$$;\ndrop table gift_cards;\n-- $t$\n-- Down Migration\nselect 1;\n')` | `[]` | **FAIL (gap 1 still open)** |
| New CR-02 bypass: quoted function body | `findDestructiveStatements("-- Up Migration\nCREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS 'DELETE FROM gift_cards';\nSELECT wipe();\n...")` | `[]` | **FAIL** |
| New CR-03 bypass: swallowed tokenizer error in body | `findDestructiveStatements('-- Up Migration\nCREATE FUNCTION wipe() ... AS $f$ select 1 as b$$$; delete from gift_cards; $f$;\nSELECT wipe();\n...')` | `[]` | **FAIL** |
| New CR-04 bypass: `U&"balance"` unicode identifier | `findDestructiveStatements('-- Up Migration\nALTER TABLE gift_cards ALTER COLUMN U&"balance" TYPE integer;\n...')` | `[]` | **FAIL** |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files declared or present for this phase. Skipped (unchanged from initial verification).

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| DB-02 | 83-01 … 83-12 | SATISFIED as written for SC1–SC4; hardening gap 1 still open | Every ROADMAP SC clause holds. REQUIREMENTS.md:129 is still `[ ]` — correctly unticked, since the migration-guard hardening promised by 83-10's own `requirements: [DB-02]` tag and the goal's "proven" language is not yet fully delivered. |

No orphaned requirements. REQUIREMENTS.md maps only DB-02 to Phase 83, and all three gap-closure plans (83-10, 83-11, 83-12) correctly declare `requirements: [DB-02]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (83-10/11/12 files scanned) | — | TBD/FIXME/XXX | — | None found |
| `migration-guard.js` scanBody | ~333-347 | Silently drops tokenizer errors inside a recursively-scanned body instead of failing closed | now classified as the CR-03 (new) BLOCKER above | Documented in 83-10-SUMMARY.md as an intentional deviation from the plan's literal text, but the re-review shows the deviation itself is the vulnerability |
| `scripts/backfill/load.js` | 378-382, 474-481 | `Promise.all` over one client (pg deprecation path) | WARNING (carried forward, not re-scoped to this gap set) | pg deprecation warning; unchanged from initial verification (WR-01) |
| `scripts/backfill/backfill.js` | 407-411 | Client not released on error path before `promptTypeDatabaseName`/`loadScratch`/`runChecks` failure | WARNING (carried forward) | `pool.end()` can hang on a CLI error path (WR-02); not re-fixed by 83-10/11/12, correctly out of scope for those plans |
| `scripts/backfill/backfill.js` | 91-96 | Raw connection string (with password) in an error message | WARNING (carried forward, WR-03) | Unchanged |

### Human Verification Required

None outstanding for this re-verification pass. The gap that remains (migration guard bypasses) is a code-level, programmatically-reproducible finding, not something requiring human judgment — the verifier reproduced all four bypasses directly.

### Gaps Summary

Two of the three original gaps are closed and verified independently in this pass:
- Gap 2 (backfill normaliser silent coercion) — CLOSED.
- Gap 3 (backfill checks/promote vacuous pass on zero-accepted or header-drifted sheets) — CLOSED.

One gap remains open, restated with new specifics:
- Gap 1 (migration guard as the automated D-04 barrier) — STILL OPEN. 83-10 closed every originally-reported bypass (old CR-01, CR-02, IN-01), rewriting the guard from chained-regex stripping to a character-level tokenizer and adding 52+ regression tests, all green. An independent re-review then found four new, different, verified-on-real-Postgres bypasses in that same tokenizer: a `$`-identifier-continuation desync that opens a fake dollar-quote/E-string, a quoted (non-dollar) function/procedure body that is never scanned, a documented 83-10 deviation that silently drops tokenizer errors inside a body instead of failing closed, and a `U&"..."` unicode-escaped column identifier that evades the `alter-type` rule. The verifier reran all four directly against the shipped `migration-guard.js` and confirmed the guard returns `[]` (no violation) for each — i.e., it would let node-pg-migrate execute a `DROP TABLE`, a function-hidden `DELETE`, or a silent money-column type truncation on the next deploy.

This is a genuine "same bug class survives a second round" pattern: a hand-written SQL tokenizer trying to match Postgres's real lexer is inherently an adversarial parser-differential problem, and finding a second independent set of bypasses after the first set was fully closed is evidence that further rounds would likely find more, not that this round happened to be unlucky. Since Phase 84 is the first phase to run migration `0002` next to real gift-card money data, and no later milestone phase (84–88) owns migration-guard hardening, this gap blocks "proven" in the phase goal's wording and should go through one more gap-closure plan (or an explicit owner override, see below) before Phase 84 begins.

**If the owner prefers to accept Phase 83 as done and track the new CR-01..CR-04 bypasses as a pre-Phase-84 hardening plan instead of re-opening this phase, add to this file's frontmatter:**

```yaml
overrides:
  - must_have: "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section, both in `npm test` and inside the pre-deploy command itself (83-03, D-04)"
    reason: "Only app_meta exists in either database; all four new CR-01..CR-04 bypasses (dollar-sign identifiers, quoted function bodies, swallowed-parse-error deviation, U&\"...\" unicode identifiers) scheduled as a Phase 84 Wave 0 hardening plan before migration 0002 is written"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
```

---

_Verified: 2026-10-02_
_Verifier: Claude (gsd-verifier)_
