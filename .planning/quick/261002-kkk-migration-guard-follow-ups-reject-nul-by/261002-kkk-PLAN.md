---
phase: quick-261002-kkk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - zoho-middleware/__tests__/migration-allowlist-nul.test.js
  - zoho-middleware/scripts/migration-allowlist.js
  - zoho-middleware/migrations-manual/README.md
  - zoho-middleware/package.json
  - zoho-middleware/eslint.config.js
  - zoho-middleware/scripts/backfill/backfill.js
  - zoho-middleware/scripts/backfill/normalize.js
  - zoho-middleware/scripts/import-vessels.js
  - zoho-middleware/scripts/replay-collect-webhook.js
  - zoho-middleware/scripts/sync-images.js
  - zoho-middleware/scripts/tag-subcategories.js
autonomous: true
requirements: [83-REVIEW-WR-01, 83-REVIEW-IN-01]

must_haves:
  truths:
    - "A migration whose Up section contains a NUL byte is rejected by migration-allowlist.js with rule 'nul-byte', before libpg-query ever sees it"
    - "The CLI (node scripts/migration-allowlist.js <dir>) exits 1 on a migrations dir containing a NUL-bearing .sql file"
    - "Every existing migration-allowlist / migration-guard test still passes unmodified"
    - "cd zoho-middleware && npm run lint lints scripts/ (including both migration guards) and exits 0"
    - "scripts/migration-guard.js and __tests__/migration-guard*.test.js are byte-identical to HEAD"
  artifacts:
    - path: "zoho-middleware/__tests__/migration-allowlist-nul.test.js"
      provides: "WR-01 regression tests (new file; existing allowlist tests + fixtures untouched)"
    - path: "zoho-middleware/scripts/migration-allowlist.js"
      provides: "NUL pre-parse gate"
      contains: "nul-byte"
    - path: "zoho-middleware/package.json"
      provides: "lint script covering scripts/"
      contains: "eslint routes/ lib/ scripts/ server.js --max-warnings 0"
    - path: "zoho-middleware/eslint.config.js"
      provides: "flat-config files glob that matches scripts/**/*.js"
      contains: "scripts/**/*.js"
  key_links:
    - from: "checkSql()"
      to: "pg.parseSync"
      via: "NUL gate returns early before parse"
      pattern: "indexOf\\('\\\\0'\\)"
---

<objective>
Close two follow-ups from `.planning/phases/83-postgres-infrastructure/83-REVIEW.md`:

1. **WR-01** — `migration-allowlist.js` must reject any NUL byte in a migration's Up section BEFORE parsing. libpg-query (C parser compiled to WASM) treats input as NUL-terminated, so `CREATE TABLE ok (a int);\0DROP TABLE gift_cards;` currently parses as a lone `CreateStmt` and `checkSql()` returns `[]` (accept). This breaks the module's stated "fail-closed" contract.
2. **IN-01** — the middleware `lint` script does not cover `scripts/`, where both deploy-gating migration guards and the backfill tooling live. Extend it and fix the warnings it surfaces with behaviour-preserving edits only.

Purpose: the allowlist is the authoritative deploy gate; its fail-closed guarantee must not depend on incidental backstops (node-postgres refusing NUL, the old regex guard), and the code that gates every prod deploy must be under the pre-commit lint gate.
Output: one new test file, a NUL gate + README row, lint scope extension + 7 warning fixes. Two commits. No push, no deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@.planning/phases/83-postgres-infrastructure/83-REVIEW.md

<hard_constraints>
- `zoho-middleware/scripts/migration-guard.js` and `zoho-middleware/__tests__/migration-guard*.test.js` MUST stay byte-identical (owner decision 1 / CLAUDE.md rule 10). Planner trial-linted `scripts/` with the existing rule set: migration-guard.js produces ZERO warnings, so no edit and no eslint override for it is needed. If the executor's lint run somehow flags it anyway, do NOT edit it — add a narrowly-scoped `ignores: ['scripts/migration-guard.js']` entry in eslint.config.js and flag it to the owner in the SUMMARY.
- Do NOT edit `__tests__/migration-allowlist.test.js`, `__tests__/migration-allowlist-wiring.test.js`, or `__tests__/fixtures/migration-allowlist-cases.js`. The review suggests adding a fixture to the cases file — instead, the NUL case goes in the NEW test file (owner constraint overrides the review's suggested location).
- All middleware commands run from `zoho-middleware/` (it has its own node_modules; ESLint there is v9.39.4, flat config).
- Do not push or deploy.
</hard_constraints>

<interfaces>
From zoho-middleware/scripts/migration-allowlist.js (432 lines):
- `module.exports` includes `ready()` (async, must resolve before `checkSql`), `checkSql(fileText) -> Array<{statement, rule}>`, `checkMigrationsDir(dir) -> Array<{file, statement, rule}>`, `findUnguardedFiles(dir)`.
- `checkSql` flow (~lines 283-320): throw if not initialised -> `extractUpSection(fileText)` (null -> `missing-up-marker`) -> **backslash pre-parse gate** at ~line 297: `if (upSection.indexOf('\\') >= 0) return [{ statement: 'a backslash was found in the Up section — ...', rule: 'backslash' }];` -> append trailing `;` -> `pg.parseSync(textToParse)` in try/catch (`parse-error`) -> walk.
- Module header (~lines 15-32) documents "Owner decisions" 1-3; decision 3 is the backslash ban.
- CLI: `node scripts/migration-allowlist.js [dir]` — exit 1 with one `file: rule: statement` line per violation on stderr.

Existing test setup pattern (__tests__/migration-allowlist.test.js): `'use strict'`, `var` declarations, `var allowlist = require('../scripts/migration-allowlist');`, `beforeAll(function () { return allowlist.ready(); });`, CLI tests use `childProcess` + `os.tmpdir()` temp dirs.

zoho-middleware/migrations-manual/README.md: bullet list of guard behaviours (~line 60 "Any backslash anywhere in the Up section is rejected") and a "Rule names" table (~line 83 `| backslash | ... |`).

zoho-middleware/eslint.config.js: single flat-config block, `files: ['routes/**/*.js', 'lib/**/*.js', 'server.js']`, ecmaVersion 2020, commonjs, node globals, rules `no-unused-vars: warn`, `eqeqeq: warn`, `no-console: off`.
</interfaces>

<lint_trial>
Planner ran the existing rule set against `scripts/` (temp config, nothing written to repo). Exactly 7 warnings, 0 errors:

| File:line | Warning | Behaviour-preserving fix |
|---|---|---|
| scripts/backfill/backfill.js:118 | `'e'` unused in `catch (e)` | optional catch binding `catch {` (ES2019, within ecmaVersion 2020) |
| scripts/import-vessels.js:156 | `'e'` unused in `catch (e)` | `catch {` |
| scripts/sync-images.js:84 | `'e'` unused in `catch (e)` | `catch {` |
| scripts/backfill/normalize.js:192 | `opts.scale != null` | `(opts.scale !== null && opts.scale !== undefined)` — must keep undefined-coverage; a bare `!==` would change behaviour |
| scripts/backfill/normalize.js:221 | `precision != null` | `(precision !== null && precision !== undefined)` |
| scripts/replay-collect-webhook.js:108 | `so.balance != null` | `(so.balance !== null && so.balance !== undefined)` |
| scripts/tag-subcategories.js:44 | `KIT_CATEGORIES` assigned, never used | delete the unused declaration and its comment line (dead code; no reader) |
</lint_trial>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: WR-01 — NUL-byte pre-parse gate in migration-allowlist.js (regression test first)</name>
  <files>zoho-middleware/__tests__/migration-allowlist-nul.test.js, zoho-middleware/scripts/migration-allowlist.js, zoho-middleware/migrations-manual/README.md</files>
  <behavior>
    - checkSql on `-- Up Migration\nCREATE TABLE ok (a int);\0DROP TABLE gift_cards;\n` returns exactly one violation with rule `nul-byte` (today: returns `[]` — this is the RED case).
    - checkSql on the review's payload (`CREATE TABLE ok (a int);` + `\0` + `CREATE OR REPLACE FUNCTION existing_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS 'begin return null; end';`) returns rule `nul-byte`.
    - A NUL as the very first character of the Up section and a NUL as the very last character both reject with `nul-byte`.
    - An Up section containing both a NUL and a backslash rejects with `nul-byte` (NUL gate runs first).
    - A NUL that appears ONLY in the Down section (after `-- Down Migration`) does not trigger `nul-byte` and a clean `CREATE TABLE` Up section is still accepted (`[]`) — the gate is scoped to the Up section exactly like the backslash gate.
    - A NUL-free control (`-- Up Migration\nCREATE TABLE ok (a int);\n`) still returns `[]`.
    - CLI: a temp migrations dir containing one `.sql` file with the NUL payload makes `node scripts/migration-allowlist.js <dir>` exit 1 with `nul-byte` on stderr (write the file with `fs.writeFileSync(path, string)` so the literal `\0` char is preserved; follow the existing tempdir/childProcess pattern from migration-allowlist.test.js).
  </behavior>
  <action>
    RED: create the NEW file `zoho-middleware/__tests__/migration-allowlist-nul.test.js` (do NOT touch the existing allowlist test files or fixtures — owner constraint) covering every behavior bullet above, using the existing style (`'use strict'`, `var`, `beforeAll(function () { return allowlist.ready(); })`, temp dirs cleaned up in afterAll/afterEach). Build NUL strings with the JS escape `'\0'` / `'\u0000'` in string concatenation. Run `cd zoho-middleware && npx jest __tests__/migration-allowlist-nul.test.js` and confirm the nul-byte assertions FAIL (they return `[]` today) — record that in the SUMMARY.

    GREEN: in `checkSql`, immediately after the `missing-up-marker` early return and BEFORE the existing backslash gate, add a NUL gate: if `upSection.indexOf('\0') >= 0`, return a single violation with `rule: 'nul-byte'` and a statement explaining that a NUL byte was found in the Up section and the parser truncates at NUL, so anything after it would go unscanned (wording per the 83-REVIEW WR-01 fix). Precede it with a short comment mirroring the backslash gate's comment style (cite 83-REVIEW WR-01; note libpg-query's C parser is NUL-terminated). Do not alter the backslash gate, extractUpSection, or anything downstream. Also add a one-line mention to the module header's fail-closed / owner-decisions area that NUL is rejected pre-parse (keep it brief; no renumbering of owner decisions — label it as a review follow-up, not an owner decision).

    DOCS: in `zoho-middleware/migrations-manual/README.md`, add a bullet next to the backslash bullet ("Any NUL byte in the Up section is rejected before parsing — the parser stops at NUL, so anything after it would be invisible to the guard") and a `| nul-byte | a NUL (\0) byte was found anywhere in the raw Up section |` row directly under the `backslash` row in the Rule names table.

    Scope note: the review's "ideally validate UTF-8" aside is NOT part of this task (not in the requested scope); mention it as an optional follow-up in the SUMMARY only.

    Then run the full gates (CLAUDE.md "Before Every Commit"): `cd zoho-middleware && npm test` and `npm run lint`; root `npm test` and `npm run lint`. Confirm `git diff --quiet HEAD -- zoho-middleware/scripts/migration-guard.js zoho-middleware/__tests__/migration-guard.test.js zoho-middleware/__tests__/migration-guard-hardening.test.js zoho-middleware/__tests__/migration-allowlist.test.js zoho-middleware/__tests__/migration-allowlist-wiring.test.js zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js`. Commit these three files as ONE commit: `fix(migration-allowlist): reject NUL bytes in Up section before parsing (83-REVIEW WR-01)`.
  </action>
  <verify>
    <automated>cd /Users/koa/dev/steins-and-vines-website/zoho-middleware && npx jest __tests__/migration-allowlist-nul.test.js __tests__/migration-allowlist.test.js __tests__/migration-allowlist-wiring.test.js __tests__/migration-guard.test.js __tests__/migration-guard-hardening.test.js && grep -c "nul-byte" scripts/migration-allowlist.js && git diff --quiet HEAD -- scripts/migration-guard.js __tests__/migration-guard.test.js __tests__/migration-guard-hardening.test.js __tests__/migration-allowlist.test.js __tests__/migration-allowlist-wiring.test.js __tests__/fixtures/migration-allowlist-cases.js && echo PROTECTED_UNCHANGED</automated>
  </verify>
  <done>New NUL test file failed before the gate and passes after; all pre-existing allowlist/guard suites pass unmodified; README documents `nul-byte`; full middleware + root test and lint gates green; one commit created.</done>
</task>

<task type="auto">
  <name>Task 2: IN-01 — extend middleware lint to scripts/ and fix the 7 surfaced warnings</name>
  <files>zoho-middleware/package.json, zoho-middleware/eslint.config.js, zoho-middleware/scripts/backfill/backfill.js, zoho-middleware/scripts/backfill/normalize.js, zoho-middleware/scripts/import-vessels.js, zoho-middleware/scripts/replay-collect-webhook.js, zoho-middleware/scripts/sync-images.js, zoho-middleware/scripts/tag-subcategories.js</files>
  <action>
    1. `zoho-middleware/package.json`: change `"lint"` to `eslint routes/ lib/ scripts/ server.js --max-warnings 0` (whole `scripts/` dir, not just `scripts/migration-*.js` — the backfill tooling is also deploy-adjacent and the trial showed it is cheap to bring clean).
    2. `zoho-middleware/eslint.config.js`: add `'scripts/**/*.js'` to the existing block's `files` array. Required: ESLint 9 flat config silently skips directory-traversed files that match no `files` glob, so changing package.json alone would lint nothing in scripts/. Do not change rules or ecmaVersion.
    3. Fix exactly the 7 warnings in the `<lint_trial>` table using the listed behaviour-preserving edits. Critical: the three `!= null` sites must become explicit `!== null && !== undefined` checks (a plain `!==` would stop matching `undefined` and change behaviour). Unused catch params become optional catch bindings. Delete the unused `KIT_CATEGORIES` declaration (and its now-orphaned comment) in tag-subcategories.js.
    4. If `npm run lint` surfaces anything beyond those 7 (e.g. files added since planning), fix behaviour-preservingly; if a warning lands in `scripts/migration-guard.js`, do NOT edit it — add a narrowly-scoped `ignores` entry for that single file and flag it for the owner in the SUMMARY.
    5. Run `cd zoho-middleware && npm run lint` (must exit 0) and `npm test` (backfill tests under `__tests__/backfill/` exercise normalize.js — must stay green); root `npm test` and `npm run lint`. Re-run the protected-files `git diff --quiet` check from Task 1. Commit as ONE commit: `chore(middleware): lint scripts/ and fix surfaced warnings (83-REVIEW IN-01)`.

    Flag in SUMMARY for owner (do not act): `tag-subcategories.js` declared `KIT_CATEGORIES` with a comment claiming it mirrors the kit filter in routes/catalog.js, but never applied it — the script may tag kit items it was meant to exclude. Removing the dead variable preserves current behaviour; whether the filter should actually be applied is a separate decision.
  </action>
  <verify>
    <automated>cd /Users/koa/dev/steins-and-vines-website/zoho-middleware && grep -q '"lint": "eslint routes/ lib/ scripts/ server.js --max-warnings 0"' package.json && grep -q "scripts/\*\*/\*.js" eslint.config.js && npm run lint && npx eslint scripts/migration-allowlist.js scripts/migration-guard.js --max-warnings 0 && npm test && git diff --quiet HEAD -- scripts/migration-guard.js __tests__/migration-guard.test.js __tests__/migration-guard-hardening.test.js && echo OK</automated>
  </verify>
  <done>`npm run lint` in zoho-middleware lints scripts/ (both guards included) and exits 0; all middleware and root tests pass; migration-guard.js untouched; one commit created.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| migration file author -> Railway pre-deploy guard chain | Any `.sql` in `zoho-middleware/migrations/` is untrusted input to the allowlist before `node-pg-migrate up` runs against prod |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kkk-01 | Tampering | `checkSql` in scripts/migration-allowlist.js | mitigate | NUL pre-parse gate (`indexOf('\0')` on the raw Up section, before `pg.parseSync`) returns `nul-byte`; regression tests cover NUL at start/middle/end, NUL+backslash, CLI exit 1 |
| T-kkk-02 | Tampering | lint gate coverage | mitigate | `scripts/` added to lint target and flat-config `files`; lint must exit 0 with `--max-warnings 0` |
| T-kkk-03 | Tampering | non-UTF-8 byte sequences in migration files | accept | Out of requested scope; review lists as "ideally"; recorded as optional follow-up in SUMMARY |
| T-kkk-04 | Repudiation | owner-protected old guard | mitigate | `git diff --quiet HEAD` check on migration-guard.js and its tests in both tasks' verify |
</threat_model>

<verification>
- `cd zoho-middleware && npm test` green; `npm run lint` exit 0 and includes scripts/.
- Root `npm test` and `npm run lint` green.
- Protected files (migration-guard.js, migration-guard*.test.js, migration-allowlist.test.js, migration-allowlist-wiring.test.js, fixtures/migration-allowlist-cases.js) byte-identical to the starting HEAD.
- Exactly two new commits, no push.
</verification>

<success_criteria>
- A NUL anywhere in the Up section rejects with `nul-byte` before parsing (WR-01 closed).
- Middleware lint covers scripts/ and is clean (IN-01 closed).
- No behavioural change to any script other than the new NUL rejection.
</success_criteria>

<output>
Create `.planning/quick/261002-kkk-migration-guard-follow-ups-reject-nul-by/261002-kkk-SUMMARY.md` when done (include RED evidence, the KIT_CATEGORIES owner flag, and the optional UTF-8 follow-up).
</output>
