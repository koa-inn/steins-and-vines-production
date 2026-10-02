---
phase: quick-261002-kkk
reviewed: 2026-10-02T00:00:00Z
depth: quick
files_reviewed: 11
files_reviewed_list:
  - zoho-middleware/scripts/migration-allowlist.js
  - zoho-middleware/__tests__/migration-allowlist-nul.test.js
  - zoho-middleware/eslint.config.js
  - zoho-middleware/package.json
  - zoho-middleware/migrations-manual/README.md
  - zoho-middleware/scripts/backfill/backfill.js
  - zoho-middleware/scripts/backfill/normalize.js
  - zoho-middleware/scripts/import-vessels.js
  - zoho-middleware/scripts/replay-collect-webhook.js
  - zoho-middleware/scripts/sync-images.js
  - zoho-middleware/scripts/tag-subcategories.js
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Quick 261002-kkk: Code Review Report

**Reviewed:** 2026-10-02
**Depth:** quick (with targeted reads for the two focus questions)
**Files Reviewed:** 11
**Status:** clean

## Narrative Findings (AI reviewer)

## Summary

Diff reviewed: `git diff 481498ce..7fdc6858 -- zoho-middleware/`. `npm run lint` (now covering `scripts/`) passes with `--max-warnings 0`. All three `__tests__/migration-allowlist*` suites pass (166 tests).

### Focus 1: does the NUL gate cover the exact text libpg-query parses?

Yes. In `checkSql()` (`scripts/migration-allowlist.js:293-338`):

- `upSection = extractUpSection(fileText)` is a plain `slice` of the raw text. No trimming, decoding, or other normalisation happens.
- The NUL gate (`upSection.indexOf('\0') >= 0`, line 303) runs on that string. It runs before the backslash gate and before parsing.
- The only change between the gate and `pg.parseSync(textToParse)` is that `textToParse = upSection` may get a `';'` appended. That cannot add a NUL. Every NUL that could reach the parser is therefore checked by the gate.
- `fs.readFileSync(..., 'utf8')` (line 384) cannot turn non-NUL bytes into U+0000. Invalid UTF-8 becomes U+FFFD, and lone surrogates are encoded as U+FFFD when the string is passed to WASM. So no NUL can be created after the check.
- NUL bytes before the Up marker or inside the Down section are outside `upSection`. node-pg-migrate's `up` never runs them, so ignoring them is correct, and the Down-only test covers this.
- The early return means a file with a NUL reports only `nul-byte` and hides any other violations. This is intentional fail-closed behaviour and has a test.

Defence-in-depth note (no action needed): node-pg sends the query as a NUL-terminated CString. Postgres then rejects a Query message that has bytes after the first NUL ("invalid message format"), so before this gate the tail would most likely have errored rather than run. The gate is still correct, because it puts the rejection at guard time instead of relying on wire-protocol behaviour.

### Focus 2: are the 7 lint fixes behaviour-preserving?

- **`!= null` rewrites** (`normalize.js:192`, `normalize.js:221`, `replay-collect-webhook.js:108`): `x != null` and `x !== null && x !== undefined` behave the same for every value except `document.all`, which does not exist in Node. The operator precedence in the ternaries is correct (the parenthesised condition is evaluated first). These are equivalent.
- **`catch (e)` → `catch {}`** (`backfill.js:118`, `import-vessels.js:156`, `sync-images.js:84`): none of these handlers referenced `e`. Optional catch binding is ES2019. ESLint is set to `ecmaVersion: 2020` and the runtime is Node 20. Behaviour is unchanged.
- **Deleted `KIT_CATEGORIES`** (`tag-subcategories.js`): the variable had no references before this change. The script filters kits through `cf_type === 'ingredient'` (lines 233-235), which never used this list. Removing it is behaviour-preserving, and it was not a forgotten, half-wired filter.
- **ESLint scope / `lint` script**: `scripts/**/*.js` was added to both the config `files` glob and the `lint` command. The two match, and `calcom-smoke.sh` is not affected.

No blocker, warning, or info findings.

---

_Reviewed: 2026-10-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
