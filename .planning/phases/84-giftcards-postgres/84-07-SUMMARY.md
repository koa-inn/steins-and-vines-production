---
phase: 84-giftcards-postgres
plan: 07
subsystem: middleware
tags: [postgres, gift-cards, facade-consumer, kiosk, tdd, auth-tiers, money-path]

# Dependency graph
requires:
  - phase: 84-giftcards-postgres
    plan: 05
    provides: "lib/gift-card-store.js — the facade this plan's routes/gift-cards.js now
      consumes exclusively for next-number/lookup/void/adjust (getMode, lookup,
      nextCertNumber, voidCard, adjust, actorFromRequest)"
  - phase: 84-giftcards-postgres
    plan: 03
    provides: "the kiosk client (js/kiosk-core.js) built against this plan's exact
      /api/kiosk/gift-card/adjust HTTP contract (request body shape, 200/400/403/404/
      409/503 response shapes) — this plan implements the server side of that contract"
provides:
  - "routes/gift-cards.js next-number/lookup/void now dispatch through
    lib/gift-card-store.js instead of a local axios-based callAppsScript helper,
    honouring GIFT_CARDS_STORE (sheets/dual/postgres) at every call site"
  - "POST /api/kiosk/gift-card/adjust — full server-side validation + facade dispatch
    for the ledgered balance-adjust control"
  - "lib/authTiers.js KIOSK_ROUTES gains an explicit '/api/kiosk/gift-card/adjust' entry"
affects: [84-08 (routes/pos.js kiosk confirm chain — same facade, different call sites)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route-level facade dispatch: every gift-card route reads giftCardStore.getMode()
      once per request and branches only on sheets vs non-sheets, never on 'dual' vs
      'postgres' individually — the facade itself owns the dual/postgres distinction
      (sheet-compare, mirror). Routes only need the binary sheets/not-sheets split for
      cache-bypass (D-14) and 502-vs-503 (D-09) decisions."
    - "Facade business-error mapping table (ADJUST_ERROR_STATUS) separates the generic
      500 default from explicitly-handled codes — tx_ref_conflict is deliberately listed
      so a reused idempotency key never looks like a server crash to the kiosk."

key-files:
  created:
    - zoho-middleware/__tests__/gift-cards-store-mode.test.js
    - zoho-middleware/__tests__/gift-cards-adjust.test.js
  modified:
    - zoho-middleware/routes/gift-cards.js
    - zoho-middleware/lib/authTiers.js

key-decisions:
  - "ASSUMPTION (owner not yet confirmed, per plan's own orchestrator note): D-05's
    'device ID' requirement on the adjust ledger row is satisfied by the client's
    self-reported device_label field, because kiosk auth is one shared
    KIOSK_DEVICE_TOKEN with no per-device identity (RESEARCH Open Question 1) — there
    is no server-issued device ID to validate against instead. Recorded in a code
    comment (routes/gift-cards.js, grep 'ASSUMPTION') per the plan's instruction."
  - "void/lookup/next-number's rejection-status split (502 in sheets mode, 503 in
    dual/postgres) is based on giftCardStore.getMode() read ONCE at the top of each
    handler, not re-read in the .catch() — avoids a theoretical TOCTOU where the env
    var flips mid-request-lifecycle producing an inconsistent status/body pairing."
  - "adjust's business-error table (ADJUST_ERROR_STATUS) treats 'not_found' specially
    (rewrites the facade's raw error to the human string 'Certificate not found' to
    match the lookup/void convention already in this file) while every other mapped
    code passes the facade's error string through verbatim in the response body."

requirements-completed: [DB-03]  # this plan is the routes-wiring leg; DB-03 overall
  # spans the full phase (lib/gift-card-pg.js 84-01, facade 84-05, kiosk UI 84-03,
  # reconcile 84-06, pos.js confirm chain 84-08 are the other legs)

# Metrics
duration: ~55min
completed: 2026-10-03
---

# Phase 84 Plan 07: Gift-Card Kiosk Routes — Facade Wiring + Balance-Adjust Endpoint Summary

**`routes/gift-cards.js`'s next-number/lookup/void now dispatch exclusively through `lib/gift-card-store.js` (zero direct axios calls), the lookup response carries `data.store_mode`, and a new fully-validated `POST /api/kiosk/gift-card/adjust` implements the kiosk's ledgered balance-adjust control end-to-end — 26 new TDD tests plus the pre-existing `gift-cards.test.js` pass with zero assertion changes, confirming sheets-mode behavior is byte-for-byte unchanged.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-10-03
- **Tasks:** 2 completed
- **Files modified:** 2 source files, 2 new test files

## Accomplishments

- `routes/gift-cards.js` requires `../lib/gift-card-store` and removes the local
  `callAppsScript`/`axios` dependency entirely (`grep -c "axios"` → 0) — all three
  pre-existing endpoints (`next-number`, `lookup`, `void`) now call the facade's
  `nextCertNumber()`/`lookup()`/`voidCard()` instead.
- **next-number** bypasses the 30s read-through cache entirely in dual/postgres mode
  (D-14) — a sequence value is never served twice from a stale cache entry; sheets
  mode's cache behavior is unchanged byte-for-byte.
- **lookup** response now carries `data.store_mode` (D-07) via
  `Object.assign({}, result.data, {store_mode: mode})`, and opts into the facade's
  dual-mode sheet-compare leg (`{compare: true}`) — the 84-05 Claude's-Discretion choice
  that the staff lookup route is the one read allowed to fire the comparison. A
  dual/postgres DB failure on lookup returns 503 with zero sheet fallback (D-09, proven
  by a test asserting `axios.post` is never called on a facade rejection); sheets mode
  keeps its existing 502.
- **void** now attributes every void via `giftCardStore.actorFromRequest(req,
  'kiosk-void')` and maps a dual/postgres rejection to 503 (sheets mode keeps 502).
- **New `POST /api/kiosk/gift-card/adjust`** implements the full server-side contract
  84-03's kiosk client was built against: D-07 mode gate first (403
  `adjust_unavailable` with zero facade calls in sheets mode), then seven ordered
  field validations (cert format, delta finite/non-zero/≤99999999.99/≤2dp with numeric-
  string coercion, reason pick-list + required note for `other`, actor_name 1-60 chars
  containing a letter with control characters stripped, device_label pattern,
  adjust_key pattern) — every validation rule from the plan's `<action>` block has a
  passing test, and a bad-field request never reaches the facade.
- Business-error mapping (`ADJUST_ERROR_STATUS`): `not_found`→404 (rewritten to
  `'Certificate not found'` to match the file's existing convention),
  `invalid_status`/`negative_balance`→409 (carrying `status`/`balance` respectively),
  `invalid_amount`→400, `adjust_unavailable`→403, `tx_ref_conflict`→409 with its own
  explicit entry so a reused idempotency key never falls into the generic-500 default
  (the kiosk needs to mint a fresh key, not retry blindly). An infrastructure rejection
  (a true Promise rejection from the facade) maps to 503.
- D-08 (no Zoho Books write): the adjust handler makes zero `zoho-api`/axios calls of
  any kind — `grep -c "adjust_gift_card"` on the facade is 0 (84-05) and this route
  never imports `zoho-api`.
- `eventLog.logEvent('kiosk.gift_card_adjusted', {certNumber, delta, reason,
  actorName, deviceLabel})` fires on success only — proven by both a positive test and
  a negative test (`{ok:false}` business rejection never logs).
- `'/api/kiosk/gift-card/adjust'` added to `lib/authTiers.js`'s `KIOSK_ROUTES` as an
  explicit entry (no prefix match, per the file's own anti-pattern warning), directly
  under the void entry, with a comment mirroring D-54-GC's accepted-risk rationale.
  Confirmed the route relies on the existing global `server.js` `app.use('/api', ...)`
  tier guard exactly as void does — neither route calls `requireTiers` inline; the
  global guard already resolves `req.authTier` and restricts device tokens to
  `KIOSK_ROUTES` membership for every non-GET `/api` request.

## Task Commits

1. **Task 1 (next-number/lookup/void → facade):** `b2e38f39` feat(84-07): route
   next-number/lookup/void through gift-card-store facade
2. **Task 2 RED:** `4db01e6e` test(84-07): add failing tests for POST
   /api/kiosk/gift-card/adjust (RED) — 26 tests, all failing with
   `TypeError: handlers./api/kiosk/gift-card/adjust is not a function` / the
   `KIOSK_ROUTES` membership assertion failing (confirmed RED).
3. **Task 2 GREEN:** `8e87b5ee` feat(84-07): implement POST
   /api/kiosk/gift-card/adjust (GREEN) — all 26 tests passing.

## Files Created/Modified

- `zoho-middleware/routes/gift-cards.js` — next-number/lookup/void rewired onto the
  facade; new `POST /api/kiosk/gift-card/adjust` handler + `ADJUST_ERROR_STATUS` /
  `mapAdjustError` / `ADJUST_VALID_REASONS` / `ADJUST_MAX_AMOUNT` helpers; `axios`
  require and the local `callAppsScript` helper removed entirely
- `zoho-middleware/lib/authTiers.js` — `'/api/kiosk/gift-card/adjust'` added to
  `KIOSK_ROUTES`
- `zoho-middleware/__tests__/gift-cards-store-mode.test.js` (new) — 5 tests: sheets-mode
  `store_mode` field (real facade + mocked axios, mirrors `gift-cards.test.js`'s
  harness), postgres lookup success/rejection, dual next-number cache-bypass (two
  distinct suggestions, `cache.get`/`cache.set` never called), void actor attribution
  (all four mocking `../lib/gift-card-store` entirely per the plan's instruction)
- `zoho-middleware/__tests__/gift-cards-adjust.test.js` (new) — 26 tests covering every
  `<behavior>` line: sheets-mode gate, all seven field validations (several
  table-driven via `test.each` for the five invalid-delta cases), the full
  `facade.adjust` call-argument shape, numeric-string delta coercion, success response
  shape, `eventLog.logEvent` on success/non-success, all six facade business-error
  mappings, infra-rejection → 503, and `KIOSK_ROUTES` membership

## Decisions Made

See `key-decisions` in frontmatter. Most notably the device_label/D-05 ASSUMPTION
(owner confirmation still pending — see Issues Encountered) and the `not_found`
message-rewrite choice to match this file's existing lookup/void convention.

## Deviations from Plan

None — no bugs, missing functionality, or blocking issues were found beyond what the
plan already specified. The plan's `<action>` blocks (exact validation regexes/bounds,
exact facade call shapes, exact error-to-status mapping table) were detailed enough
that no interpretation gaps arose. One plan-authorized ASSUMPTION was recorded exactly
as instructed (see Decisions).

**Total deviations:** 0 auto-fixed, 0 architectural, 1 plan-authorized assumption
(recorded, not a deviation from the plan's own instruction).

## Issues Encountered

None blocking. The device_label/D-05 ASSUMPTION (self-reported label stands in for a
per-device ID) is owner-unconfirmed per the plan's own note — flagging here again so
it surfaces in the phase-level review, not a defect in this plan's execution.

## User Setup Required

None — no external service configuration required. This plan is code-only; no deploy
of any kind occurred (per environment constraints). The new endpoint cannot be
exercised against a live Postgres/kiosk until `GIFT_CARDS_STORE` is flipped to
`dual`/`postgres` in a real environment and the kiosk (84-03, already built against
this exact contract) is pointed at it.

## Next Phase Readiness

- `routes/gift-cards.js` is now fully facade-backed; `84-08` (routes/pos.js's kiosk
  confirm chain) can follow the identical pattern (`giftCardStore.getMode()` once per
  call site, branch only on sheets vs not-sheets) for its own issue/redeem/reload call
  sites.
- The adjust endpoint's response shapes (`data.current_balance`, `data.idempotent`,
  the exact `error` string values for every status code) were authored directly
  against 84-03's documented client expectations; both were written from the same
  interface contract but have not been cross-verified against a running server/kiosk
  pair yet — that integration check is a natural candidate for the phase-level UAT.
- No blockers for sibling/downstream plans in Phase 84. Full middleware suite
  (142 suites, 2241 tests) and root suite (144 suites, 2076 tests) both green on the
  merged tree through this plan; both linters clean.

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/gift-cards.js (modified — axios require removed,
  giftCardStore require added, adjust route added)
- FOUND: zoho-middleware/lib/authTiers.js (modified — KIOSK_ROUTES entry added)
- FOUND: zoho-middleware/__tests__/gift-cards-store-mode.test.js (created, 5 passing)
- FOUND: zoho-middleware/__tests__/gift-cards-adjust.test.js (created, 26 passing)
- FOUND commit b2e38f39 (Task 1)
- FOUND commit 4db01e6e (Task 2 RED)
- FOUND commit 8e87b5ee (Task 2 GREEN)
- `npx jest __tests__/gift-cards.test.js __tests__/gift-cards-store-mode.test.js
  __tests__/gift-cards-adjust.test.js __tests__/auth-tiers-guard.test.js`: 78/78 passed
- `git diff --stat HEAD -- __tests__/gift-cards.test.js`: empty (zero assertion changes)
- `cd zoho-middleware && npm test`: 142/142 suites, 2241/2241 tests passed
- `cd zoho-middleware && npm run lint`: clean (0 warnings)
- Root `npm test`: 144/144 suites, 2076/2076 tests passed
- Root `npm run lint`: clean (0 warnings)
- `grep -c "axios" zoho-middleware/routes/gift-cards.js` → 0
- `grep -c "store_mode" zoho-middleware/routes/gift-cards.js` → 2
- `grep -c "'/api/kiosk/gift-card/adjust'" zoho-middleware/lib/authTiers.js` → 1
- `grep -c "refund-to-card" zoho-middleware/routes/gift-cards.js` → 1
- `grep -c "ASSUMPTION" zoho-middleware/routes/gift-cards.js` → 1

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
