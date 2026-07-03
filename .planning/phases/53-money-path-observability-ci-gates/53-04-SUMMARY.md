---
phase: 53-money-path-observability-ci-gates
plan: 04
subsystem: frontend
tags: [eslint, eqeqeq, no-console, es5, lint-cleanup, build]

# Dependency graph
requires: []
provides:
  - "js/ tree lints 0 problems under existing eqeqeq/no-console rules"
  - "js/ tree parses cleanly under ecmaVersion 5 (no ES6 syntax remains)"
  - "Rebuilt js/main.js, js/main.min.js, js/admin.min.js from cleaned sources"
affects: [53-06 (root eslint.config.js ES5 rule + --max-warnings 0 CI gate)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "eslint-disable-line with a one-line reason for intentional == null / != null loose-equality idioms (preserves undefined-matching behavior that === null would drop)"
    - "eslint-disable-line with a one-line reason for operational console.error/warn sites inside catch blocks (never blanket-disable the file)"
    - "ES5-safe guarded-variable pattern replacing optional chaining: var _el = document.getElementById(id); (_el ? _el.value : '') || fallback"

key-files:
  created: []
  modified:
    - js/admin.js
    - js/batch.js
    - js/brewpad.js
    - js/kiosk.js
    - js/modules/06-featured.js
    - js/modules/07-catalog-kits.js
    - js/modules/08-catalog-ingredients.js
    - js/modules/09-catalog-services.js
    - js/modules/11-cart.js
    - js/modules/12-checkout.js
    - js/modules/12c-checkout-scheduling.js
    - js/modules/13-init.js
    - js/modules/15-hops.js
    - js/modules/16-catalog-subpage.js
    - js/modules/17-search-overlay.js
    - js/main.js
    - js/admin.min.js
    - about.html / admin.html / brewpad.html / contact.html / custom-labels.html / index.html / ingredients.html / kiosk.html / products*.html / reservation.html (cache-busting query-string stamps only)

key-decisions:
  - "All 99 eqeqeq warnings were intentional `== null`/`!= null` loose-equality idioms (confirmed by inspecting every warning site); eslint --fix left them untouched (as the plan's measured baseline predicted). Converted to `=== null`/`!== null` would silently stop matching `undefined`, changing runtime behavior — so each site got a targeted `eslint-disable-line eqeqeq` with a one-line reason instead."
  - "Of the 26 no-console warnings, 6 were pure debug-tracing console.log calls with no error-reporting value (auth-flow step tracing, a dropdown-search tracer firing on every keystroke, an item-count log) — removed outright. The remaining 20 are console.error/warn inside catch blocks or a deploy-verification build-timestamp log — kept with eslint-disable-line + reason, per plan guidance not to blanket-disable the rule."
  - "admin.js:785 optional chaining `document.getElementById('res-status-filter')?.value || 'pending'` converted to an ES5 guarded-variable pattern, preserving the exact 'pending' fallback when the element is absent."

requirements-completed: [OBS-01]

duration: ~12min
completed: 2026-07-03
---

# Phase 53 Plan 04: Frontend eslint/ES5 Lint Cleanup Summary

**Cleared all 125 pre-existing eslint warnings (99 eqeqeq + 26 no-console) in `js/` and converted the sole ES6 construct to ES5, then rebuilt the shipped JS artifacts — unblocking the `--max-warnings 0` + ES5-only lint gate planned for 53-06.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3/3 completed
- **Files modified:** 15 source files (13 `js/*.js` + `js/modules/*.js`), 3 rebuilt artifacts (`js/main.js`, `js/admin.js` restamp, `js/admin.min.js`), 20 HTML files (cache-busting stamp churn only)

## Accomplishments
- `npx eslint js/` now reports **0 problems** (was 125).
- Confirmed via a throwaway `ecmaVersion: 5` eslint config that the entire `js/` tree parses with **0 parse errors** (temp config deleted after the check, never committed).
- `npm run build` regenerated `js/main.js` + `js/admin.min.js` from the cleaned sources; `npm test` stayed green at 947/947 throughout all three tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Clear eqeqeq warnings (99)** - `2549dc4` (fix)
2. **Task 2: Resolve no-console warnings (26) + ES6→ES5 conversion** - `0f7be0f` (fix)
3. **Task 3: Confirm ES5-clean + 0 warnings, rebuild artifacts** - `e5fa053` (chore)

_No plan-metadata commit — SUMMARY.md/STATE.md/ROADMAP.md updates are owned by the orchestrator in worktree mode._

## Files Created/Modified
- `js/admin.js` - 17 eqeqeq disable-lines, 6 debug console.log removed, 4 console.error/warn kept with disable-lines, optional-chaining converted to ES5 guarded-variable
- `js/batch.js`, `js/brewpad.js`, `js/kiosk.js`, `js/modules/06-featured.js`, `js/modules/07-catalog-kits.js`, `js/modules/08-catalog-ingredients.js`, `js/modules/09-catalog-services.js`, `js/modules/11-cart.js`, `js/modules/12-checkout.js`, `js/modules/15-hops.js`, `js/modules/17-search-overlay.js` - eqeqeq disable-lines only (comment-only diffs; minified output unchanged since terser strips comments)
- `js/modules/12c-checkout-scheduling.js` - 2 no-console disable-lines (CRLF-preserving edit — see Issues Encountered)
- `js/modules/13-init.js`, `js/modules/16-catalog-subpage.js` - 1 no-console disable-line each
- `js/main.js` - regenerated via `npm run concat:js` (module comment/logic diffs flowed through)
- `js/admin.min.js` - regenerated via terser (only artifact with a real content diff, since `js/admin.js` had actual logic changes)
- 20 HTML files - cache-busting `?v=` query-string stamp churn from `npm run build` (expected, documented in the plan's measured baseline)

## Decisions Made
- Loose-equality `== null`/`!= null` sites: preserved behavior via `eslint-disable-line eqeqeq` rather than tightening to `===`, since tightening would drop the `undefined` match (see key-decisions above).
- Debug-vs-operational console triage: removed calls with no error-reporting value; kept catch-block error/warn logging and the deploy-verification build-timestamp log, each with a targeted disable-line and reason (no file-wide rule disables anywhere).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Self-caught: CRLF corruption in `js/modules/12c-checkout-scheduling.js` during no-console patch**
- **Found during:** Task 2 (before commit — caught by eslint verification, not shipped)
- **Issue:** This file is the only one in `js/` using CRLF line endings. A `String.split('\n')`/`join('\n')` codemod used to append `eslint-disable-line` comments to the other 3 no-console files silently dropped the trailing `\r`, which JS/ESLint treats as its own line terminator — this pushed the appended comment onto what ESLint parsed as the *next* line, making the disable directive apply to the wrong line (still reported the warning + an "unused directive" warning).
- **Fix:** Reverted the file, then used a CRLF-preserving `perl -i -pe` substitution targeting only the two affected lines (113, 161) so the `\r` stays immediately after the statement and the comment is appended before it.
- **Files modified:** `js/modules/12c-checkout-scheduling.js`
- **Verification:** `npx eslint --no-cache js/` → 0 problems; `grep -c $'\r'` count unchanged (191, confirming CRLF preserved) after the fix.
- **Committed in:** `0f7be0f` (part of Task 2 commit — the bug never reached a commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, self-caught pre-commit)
**Impact on plan:** No scope creep — this was a tooling artifact of my own codemod script, caught and fixed before any commit. No behavior change to shipped code.

## Issues Encountered
CRLF line-ending mismatch in `js/modules/12c-checkout-scheduling.js` — see Deviations above. Caught by the task's own eslint verification step before committing, so no bad commit was ever made.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`js/` is 0-warning and ES5-clean with rebuilt artifacts. 53-06 can now add `ecmaVersion: 5` + `--max-warnings 0` to the root `eslint.config.js` / `package.json` lint script without needing further cleanup here. This plan was independent of the middleware/Sentry wave-1 work and had no dependencies.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*
