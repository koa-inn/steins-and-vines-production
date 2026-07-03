---
phase: 52-fail-closed-sweep
plan: 04
subsystem: api
tags: [express, ssrf, path-traversal, input-validation, url, security]

# Dependency graph
requires: []
provides:
  - "isValidId (^\\d+$) guard on items.js GET /api/inventory/items/:id and GET /api/items/:item_id/image, closing the %2F Zoho-path pivot (M20)"
  - "validateCsvUrl mandatory-allowlist + https-only + private-range guard on taxes.js POST /api/items/migrate csv_url, closing SSRF (M6)"
  - "CSV_MIGRATE_ALLOWED_HOSTS documented in .env.example (migrate endpoint 400s until configured)"
affects: [52-05, RESIL-01-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local isValidId(^\\d+$) route-param guard (2nd copy, mirrors purchaseorders.js — not extracted to a shared lib per CLAUDE rule 2)"
    - "Mandatory (fail-closed-by-default) env-driven host allowlist for an outbound server-side fetch: unset env => 400, no fetch, not opt-in"
    - "Route-handler unit tests via jest.mock('express') + pulling handlers off the mocked Router() (mirrors gift-cards.test.js), avoiding full supertest/server.js boot"

key-files:
  created:
    - zoho-middleware/__tests__/items-id-validation.test.js
    - zoho-middleware/__tests__/taxes-ssrf.test.js
  modified:
    - zoho-middleware/routes/items.js
    - zoho-middleware/routes/taxes.js
    - zoho-middleware/.env.example

key-decisions:
  - "PUT /api/inventory/items/:id intentionally left unguarded by isValidId — plan scoped M20 to the two GET handlers only, and the existing (do-not-edit) pii-access.test.js PUT suite uses a non-numeric fixture ID (ITEM-123) and asserts success; adding the guard there breaks a protected existing test under CLAUDE.md rule 10."
  - "csv_url SSRF guard is a MANDATORY allowlist (CSV_MIGRATE_ALLOWED_HOSTS unset => 400, no fetch) rather than optional/opt-in — matches the phase's fail-closed theme and ROADMAP SC-3; operational consequence is the migrate endpoint won't fetch until an operator sets the env var in Railway (documented in .env.example)."
  - "Private/link-local host block implemented as literal-hostname regex patterns (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 incl. the 169.254.169.254 metadata IP, localhost, ::1) — DNS-rebinding is explicitly accepted residual risk per the plan's threat register (T-52-M6b), not attempted here."

patterns-established:
  - "Route-level jest unit tests via jest.mock('express') + Router() handler extraction (no supertest/full app boot) for testing individual route files in isolation — used for both items.js and taxes.js"

requirements-completed: [RESIL-01]

# Metrics
duration: 25min
completed: 2026-07-03
---

# Phase 52 Plan 04: Item :id validation (M20) + csv_url SSRF allowlist (M6) Summary

**Closed a %2F path-pivot on the Zoho item routes and an unrestricted-fetch SSRF on the CSV migrate endpoint, both via TDD RED→GREEN with fail-closed defaults.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03T05:11:00Z (approx)
- **Completed:** 2026-07-03T05:36:00Z
- **Tasks:** 2 completed
- **Files modified:** 5 (2 new test files, 2 modified route files, 1 modified env doc)

## Accomplishments
- `GET /api/inventory/items/:id` and `GET /api/items/:item_id/image` now 400 on a non-numeric (including `%2F`-decoded) id before any Zoho path concatenation, closing the M20 path pivot.
- `POST /api/items/migrate` now fails closed by default: with `CSV_MIGRATE_ALLOWED_HOSTS` unset it 400s and never calls `axios.get`; when set, it additionally rejects non-https, off-allowlist, and loopback/private/link-local (incl. cloud metadata `169.254.169.254`) hosts, and malformed URLs — all before the fetch. Closes M6 SSRF.
- 14 new regression tests (6 items.js + 8 taxes.js), both suites RED→GREEN verified against the live pre-fix code.
- Full middleware suite: 64 suites / 1201 tests green; `npm run lint` clean (0 errors).

## Task Commits

Each task's TDD cycle was committed atomically:

1. **Task 1: M20 — validate numeric :id on both item routes**
   - `a387a7c` test(52-04): failing test — %2F pivots item :id
   - `256bdd4` fix(52-04): validate numeric :id on item routes (M20)
2. **Task 2: M6 — restrict csv_url to https + a MANDATORY host allowlist (fail closed)**
   - `90c0c80` test(52-04): failing test — csv_url SSRF, default-open allowlist
   - `63dbf96` fix(52-04): mandatory host allowlist (fail closed) + https-only on csv_url (M6)

_TDD tasks: test → fix per task, no refactor commit needed (both fixes were minimal and clean on first pass)._

## Files Created/Modified
- `zoho-middleware/__tests__/items-id-validation.test.js` - New RED→GREEN regression suite for the M20 `:id` guard (6 tests)
- `zoho-middleware/__tests__/taxes-ssrf.test.js` - New RED→GREEN regression suite for the M6 csv_url allowlist (8 tests)
- `zoho-middleware/routes/items.js` - Local `isValidId` helper + 400 guard on both GET handlers before Zoho path concatenation
- `zoho-middleware/routes/taxes.js` - `validateCsvUrl` (mandatory allowlist + `new URL` parse + https-only + private-host block) wired in before the `/api/items/migrate` fetch
- `zoho-middleware/.env.example` - Documents `CSV_MIGRATE_ALLOWED_HOSTS` and the fail-closed-until-set operational consequence

## Decisions Made
- Kept `isValidId` as a local (non-shared) function in items.js, identical to the purchaseorders.js idiom — this is now the 2nd copy of the same 3-line helper. A `lib/validate.js` home would prevent drift if a 3rd copy is ever needed; flagged as a follow-up, not expanded into this plan (CLAUDE rule 2 favors the simplest change).
- Did NOT add the `isValidId` guard to `PUT /api/inventory/items/:id` (see key-decisions above) — plan-scoped to the two GET handlers, and doing so would have broken the existing, do-not-edit `pii-access.test.js` PUT suite (uses a non-numeric fixture ID and expects success).
- Chose literal-hostname regex blocking (not a DNS resolve-then-check) for the private/link-local guard — matches the plan's accepted residual (T-52-M6b, DNS rebinding out of scope for this audit item).

## Deviations from Plan

### Auto-fixed Issues, then reverted

**1. [Rule 2 attempted, then reverted — Scope correction] isValidId on PUT /api/inventory/items/:id**
- **Found during:** Task 1 (M20 guard)
- **Issue:** The PUT handler on the same route concatenates `req.params.id` into the Zoho path identically to the two GET handlers guarded by the plan — same vulnerability class, same file, same threat-register component (T-52-M20 covers "items.js :id / :item_id path params" without limiting to GET).
- **Action taken:** Added the same `isValidId` guard to PUT as a Rule 2 (missing critical functionality) auto-fix.
- **Why reverted:** Running the full middleware suite showed this broke the pre-existing `pii-access.test.js` PUT test (`calls inventoryPut with whitelisted fields only on valid partial body`), which uses a non-numeric fixture ID (`ITEM-123`) and asserts a 200/201 response. CLAUDE.md rule 10 forbids editing existing tests, and the plan's explicit scope (`<interfaces>` "M20 targets") was the two GET handlers only. Reverted the PUT change to stay in scope and keep the full suite green.
- **Files touched (net: unchanged):** `zoho-middleware/routes/items.js`
- **Verification:** Full suite (63/1193 at that point) green after revert.
- **Committed in:** not committed (reverted before the `256bdd4` commit was made)

---

**Total deviations:** 1 attempted-then-reverted (scope correction, no net code change). No committed deviations from plan scope.
**Impact on plan:** None — plan executed as scoped after the scope correction. `PUT /api/inventory/items/:id`'s identical exposure is now a known, documented gap (not silently missed) for a future follow-up plan if that fixture/test is ever revisited.

## Issues Encountered
- The worktree's `zoho-middleware/node_modules` was absent (git worktrees don't carry gitignored deps). Symlinked it from the main checkout (`ln -s .../zoho-middleware/node_modules node_modules`) to run tests/lint; never staged/committed (git's `node_modules/` gitignore pattern doesn't match symlinks, so this was done manually with care to stage only plan files).
- Handler-extraction test pattern (`jest.mock('express')` + pulling handlers off the mocked `Router()`) required per-method keying (`'GET ' + path`, `'PUT ' + path`) in items.js since GET and PUT are both registered on the identical path string `/api/inventory/items/:id` — a naive path-only key collided and caused the wrong handler to run in early test iterations. Fixed before the RED commit.

## User Setup Required

None for this plan's own scope. Operational note (documented in `.env.example`): `POST /api/items/migrate` will return 400 for every request until an operator sets `CSV_MIGRATE_ALLOWED_HOSTS` in the Railway environment — this is the intended fail-closed default, not a bug. No action required unless/until that endpoint needs to be used.

## Next Phase Readiness
- M20 and M6 are closed; no known blockers for 52-05 (catalog.js M7 + recipes/gift-cards M8), which is file-disjoint from this plan.
- Full middleware suite green (64/1201) and lint clean at merge time — safe to merge without further gating.

---
*Phase: 52-fail-closed-sweep*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 5 task/summary commit hashes (`a387a7c`, `256bdd4`, `90c0c80`, `63dbf96`, `0a84f89`) confirmed in `git log`.
