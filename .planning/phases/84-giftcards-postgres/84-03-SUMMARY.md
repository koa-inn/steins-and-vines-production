---
phase: 84-giftcards-postgres
plan: 03
subsystem: ui
tags: [kiosk, jsdom, es5, gift-cards, idempotency]

# Dependency graph
requires:
  - phase: 54-gift-card-management-on-the-kiosk-surface
    provides: "kgcm-* kiosk Gift Card Management panel (lookup + void) this plan extends with a third adjust view"
provides:
  - "#kgcm-adjust-view kiosk UI: signed-delta amount, direction toggle, reason pick-list (correction/goodwill/refund-to-card/other), required note for other, actor name/initials"
  - "kioskShowGiftCardMgmt() adjust state machine: store_mode/status visibility gate (D-07, UX-only), per-view-opening idempotent adjust_key (D-06), self-reported persisted device label (D-05), client validation, POST /api/kiosk/gift-card/adjust via _kcMergeAuth"
  - "jsdom regression suite (tests/frontend/kiosk-gift-card-adjust.test.js, 13 tests) covering visibility gate, payload contract, validation, idempotency-key reuse/rotation, response-to-message mapping, device-label persistence"
affects: [84-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adjust view mirrors the existing #kgcm-void-view view-switch/fetch pattern in kioskShowGiftCardMgmt() exactly (lookup -> hide lookup/show sub-view -> fetch via _kcMergeAuth -> map status codes to inline error text)"
    - "Client-side gate is UX only — server (84-07) is the authoritative enforcement point for store_mode and all field validation (D-07, ASVS V4)"

key-files:
  created:
    - tests/frontend/kiosk-gift-card-adjust.test.js
  modified:
    - kiosk.html
    - js/kiosk-core.js
    - js/kiosk-core.min.js (build artifact, regenerated via `npm run build`)

key-decisions:
  - "Direction toggle (Add credit / Remove credit) used instead of a signed numeric input, since iPad Safari's decimal keypad has no minus key (per plan action spec)"
  - "adjust_key minted once per adjust-view opening and reused across retries (network-failure path keeps the same key); a fresh key is minted only when the view is reopened after a 200 success, per D-06 idempotency"
  - "Device label persistence follows the same try/catch-wrapped localStorage pattern as sv-kiosk-view-mode, falling back to 'kiosk-unknown' if storage is unavailable"

requirements-completed: [DB-03]

# Metrics
duration: ~45min
completed: 2026-10-03
---

# Phase 84 Plan 03: Kiosk Gift-Card Balance-Adjust Summary

**Kiosk Gift Card Management panel gains a third ledgered balance-adjust view: signed-delta amount with a direction toggle, closed reason pick-list, idempotent adjust_key reused on retry, gated client-side on store_mode dual/postgres + active status.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-10-03 (worktree branch reset to main HEAD `1ccf5782` at start)
- **Completed:** 2026-10-03
- **Tasks:** 2 completed
- **Files modified:** 2 source + 1 test file created, plus 25 build-stamp artifacts from `npm run build`

## Accomplishments
- Added `#kgcm-adjust-view` markup to `kiosk.html` (direction toggle, amount, reason select, conditional note, actor name, live preview, confirm/cancel) plus an `Adjust Balance` button and sheets-mode note next to the existing void control
- Implemented the adjust state machine inside `kioskShowGiftCardMgmt()` in `js/kiosk-core.js`: visibility gate on `store_mode`/`status`, idempotency-key minting/reuse, self-reported device label, client validation, the signed-delta POST, and full response-code-to-message mapping (200/403/404/409/400/503/network)
- Wrote a new 13-test jsdom suite (`tests/frontend/kiosk-gift-card-adjust.test.js`) exercising every behavior in the plan's `must_haves.truths`, reusing the existing `kiosk-gift-card-mgmt.test.js` harness pattern
- Regenerated `js/kiosk-core.min.js` and re-stamped cache-busting versions via `npm run build`

## Task Commits

Each task was committed atomically:

1. **Task 1: #kgcm-adjust-view markup + adjust logic in kioskShowGiftCardMgmt** - `9c387d8d` (feat)
2. **Task 2: jsdom test suite + build artifacts** - `35cb8235` (test)

_No separate plan-metadata commit — STATE.md/ROADMAP.md updates are owned by the orchestrator per this plan's execution instructions._

## Files Created/Modified
- `kiosk.html` - new `#kgcm-adjust-view` (amount/direction/reason/note/actor/preview/error/confirm/cancel), `#kgcm-adjust-btn` + `#kgcm-adjust-sheets-note` next to the void button
- `js/kiosk-core.js` - `kioskShowGiftCardMgmt()` extended with the adjust element lookups, reset-on-open, lookup-response gate (`_mgmtStoreMode`/`_mgmtStatus`/`_mgmtBalance`), `_kcDeviceLabel()`, `mintAdjustKey()`, direction/preview/validation helpers, and the adjust button/confirm/cancel handlers
- `js/kiosk-core.min.js` - rebuilt via `terser` (build artifact)
- `tests/frontend/kiosk-gift-card-adjust.test.js` (new) - 13 tests: visibility gate (4), payload contract (1), client validation (4), idempotency key reuse/rotation (1), success toast (1), error-code mapping (1), device-label persistence (1)
- `about.html`, `admin.html`, `beer.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `js/admin.js`, `js/admin.min.js`, `privacy.html`, `products.html`, `products/{additives,equipment,ferment-in-store,grains,hops,ingredients-supplies,packaging,yeast}.html`, `refunds.html`, `reservation.html`, `terms.html`, `warranty.html`, `wine.html` - unrelated build-stamp churn from running the full `npm run build` pipeline (cache-version query strings + `js/admin.js`'s `BUILD_TIMESTAMP`); no functional changes. Committed together per the project's existing build-commit convention (e.g. `f2bca7ee`) and the plan's own instruction to include unrelated re-stamped pages in the build commit.

## Decisions Made
- None beyond what the plan specified — direction-toggle UI, adjust_key minting/reuse timing, and device-label fallback all followed the plan's `<action>` block verbatim.

## Deviations from Plan

None - plan executed exactly as written. The server-side `/api/kiosk/gift-card/adjust` endpoint and its contract (84-07) did not exist yet at execution time, as expected — this plan builds the client against the documented interface contract only; it was never called against a live endpoint.

## Issues Encountered
- **Host disk-space exhaustion (ENOSPC) during `zoho-middleware && npm ci`:** the shared filesystem had <150Mi free, causing both the npm ci retry-output capture and an initial attempt to fail. Resolved by removing the resulting incomplete partial `zoho-middleware/node_modules` (freed ~370Mi) and retrying `npm ci --loglevel=error --no-audit --no-fund` to avoid writing a large log to the already-tight disk. This is a host/environment constraint unrelated to this plan's code; flagging here in case sibling parallel worktree agents (84-01/84-02/84-06) hit the same contention.

## User Setup Required

None - no external service configuration required. This plan is frontend-only and depends on 84-07 (server-side `/api/kiosk/gift-card/adjust`) to become functional end-to-end; it cannot be exercised against a live backend until that plan lands.

## Next Phase Readiness
- Client is fully built against the documented `/api/kiosk/gift-card/adjust` contract and ready to integrate once 84-07 ships the server-side route
- 84-07 should re-verify its response shapes (`data.data.current_balance`, `data.data.idempotent`, the exact `error` string values for 403/409) against what this client expects, since both were authored from the same interface contract but not cross-verified against a running server
- No blockers for other 84-wave plans; this plan touched only `kiosk.html`/`js/kiosk-core.js`/`js/kiosk-core.min.js`/the new test file plus incidental build-stamp churn

## Self-Check: PASSED

- FOUND: kiosk.html (modified, contains `#kgcm-adjust-view`)
- FOUND: js/kiosk-core.js (modified, contains adjust logic)
- FOUND: js/kiosk-core.min.js (modified, rebuilt)
- FOUND: tests/frontend/kiosk-gift-card-adjust.test.js (created, 13 passing tests)
- FOUND commit 9c387d8d (Task 1)
- FOUND commit 35cb8235 (Task 2)

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
