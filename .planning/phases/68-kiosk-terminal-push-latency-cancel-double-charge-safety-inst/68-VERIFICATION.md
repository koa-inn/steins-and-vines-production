---
phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety-inst
verified: 2026-08-12T13:13:24Z
status: human_needed
score: 14/14 code must-haves verified
overrides_applied: 0
human_verification:
  - test: "68-03 live-kiosk checkpoint (blocking, autonomous: false) — stage-timing telemetry captured on a real slow sale + cancel-then-tap-anyway does not orphan a charge"
    expected: "Railway logs show kiosk.sale_stage_timing identifying the dominant stage on a live sale; a cancel-then-tap on the physical reader results in either no charge or a voided charge (confirmed via Helcim/eventLog), never an unmatched charge with no invoice"
    why_human: "Requires the real kiosk iPad + physical card reader + a deployed middleware/frontend and (optionally) a refundable test card — none of this is observable from the codebase; 68-03-PLAN.md is an explicit checkpoint:human-verify gate and no 68-03-SUMMARY.md exists yet (not yet run)"
---

# Phase 68: Kiosk Terminal-Push Latency + Cancel Double-Charge Safety Verification Report

**Phase Goal:** (a) instrument the `/api/kiosk/sale` pipeline so the real "card reader isn't picking up" bottleneck is CAPTURED in telemetry (not guessed), and (b) close the cancel/orphan-charge window — a cancel during/after a slow terminal push must never leave a charge with no invoice, via a webhook-anchored mark-and-void through the single void path. Latency REDUCTION itself is explicitly deferred to a follow-up (not a gap).
**Verified:** 2026-08-12T13:13:24Z
**Status:** human_needed
**Re-verification:** No — initial verification

This report verifies the code deliverables of 68-01 and 68-02 (both `autonomous: true`, fully executed and merged) plus the post-review fix commits. 68-03 is a separate `checkpoint:human-verify` live-kiosk gate (`autonomous: false`) that has not yet been run (no `68-03-SUMMARY.md` exists) — per the verification brief this is assessed as a human-verification item, not a code gap.

## Goal Achievement

### Observable Truths — 68-01 (instrumentation)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every `/api/kiosk/sale` request emits stage-timing telemetry (lock, catalog hit/rebuild, assertion, gc-lookup, terminal-push, 202) as `kiosk.sale_stage_timing` with ms deltas | ✓ VERIFIED | `pos.js:346,373,476,488,675,743,762,796,828` — `emitStageTiming()` called at lock_acquired, catalog_read, assertion_done, gc_lookup_done, terminal_push_sent, response_202; emits `eventLog.logEvent('kiosk.sale_stage_timing', {stage, ms_since_start, ...})` |
| 2 | Catalog stage explicitly records cache HIT vs cold-cache rebuild | ✓ VERIFIED | `pos.js:476` `emitStageTiming('catalog_read', stageStart, { cache: 'rebuild' })`; `pos.js:488` `{ cache: 'hit' }` |
| 3 | Client measures wall-time push-shown → 202 via fire-and-forget beacon that never throws into the payment flow | ✓ VERIFIED | `kiosk-core.js:2904` stamps `_kioskPushShownAt`; `:2971-2975` fires `_kcReportTerminalPushLatency` on 202 only (never in the cancelled/saleCompleted-guarded return path, checked at :2914); beacon function (`:174`) uses the same defensive try/fetch(...).catch shape as `_kcReportClientError` |
| 4 | Client beacon uses a NEW sink/function, does NOT overload `_kcReportClientError`/`/api/kiosk/client-error` | ✓ VERIFIED | New function `_kcReportTerminalPushLatency` posts to `/api/kiosk/telemetry` (new route); `kiosk-client-error-beacon.test.js` still passes unmodified (73 frontend suites green) |
| 5 | No PII/PAN in telemetry payloads | ✓ VERIFIED | `/api/kiosk/telemetry` route (`pos.js:981-1006`) uses the same `scrubClientErrorText` helper as `/api/kiosk/client-error` (13-19 digit PAN-shape redaction + control-char stripping); only `stage`, bounded `duration_ms`, `reference_number` are emitted |
| 6 | Instrumentation is observation-only — no control-flow/money-movement change | ✓ VERIFIED | `emitStageTiming` wrapped in try/catch (WR-03 fix, `pos.js:359-377`) so it can never block `res.status(202)`; full middleware suite (1362 tests, incl. `pos-money-defects.test.js` WR-03 lock-release) green after instrumentation |

**Score:** 6/6

### Observable Truths — 68-02 (cancel/orphan-charge safety)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Cancel writes a `KIOSK_CANCELLED_PREFIX` + refNumber flag | ✓ VERIFIED | `pos.js:1671-1696` `/api/pos/cancel` reads `reference_number` from body, `cache.set(C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + ref, {...}, KIOSK_CANCELLED_TTL)`; `constants.js:58` defines the key |
| 8 | Cancelled-flag check + void lives on the Helcim WEBHOOK path (`processCardTransactionResult`), not `/api/kiosk/sale/status` | ✓ VERIFIED | `webhooks.js:242-257` — inside `processCardTransactionResult`, gated on `status === 'APPROVED' && invoiceNumber`, fires on every webhook event independent of client polling |
| 9 | APPROVED webhook for a cancelled ref voids immediately via `moneyPath.voidWithTimeout` (amount from `KIOSK_PENDING_CHARGE` record), skips normal booking | ✓ VERIFIED | `webhooks.js:280-337` `voidCancelledApprovedCharge` reads the pending-charge record for `amount`, calls `moneyPath.voidWithTimeout(helcimLib, transactionId, voidAmount, {...})`, skips `reconcile.reconcilePendingCharge` for that ref |
| 10 | Closes the window on the FIRST webhook event, strictly faster than reconcile.js's 600s backstop, which is UNCHANGED | ✓ VERIFIED | Void fires synchronously in the webhook handler (no polling wait); `git diff` of `zoho-middleware/lib/reconcile.js` since before phase 68 planning (`1b502297`) shows **zero changes** |
| 11 | Cancelling before any push / with no resulting charge produces no void, no orphan | ✓ VERIFIED | `pos-cancel-orphan.test.js` test (d) — cancel with no APPROVED webhook → no void call |
| 12 | Non-cancelled APPROVED webhook path completely unchanged | ✓ VERIFIED | `webhooks.js:246` `if (!cancelledFlag) { return reconcile.reconcilePendingCharge(...) }` — untouched branch; `pos-cancel-orphan.test.js` test (c) asserts `voidWithTimeout` NOT called and reconcile runs |
| 13 | Webhook re-delivery of the same APPROVED event does not double-void | ✓ VERIFIED | `webhooks.js:280-350` `voidCancelledApprovedCharge` guarded by `cache.acquireLock('reconcile:txn:' + transactionId, 60)`; CR-02 fix nests `releaseLock` INSIDE the `acquired` branch only (`webhooks.js:346-349`) so a lock-held re-delivery skips without releasing; `pos-cancel-orphan.test.js` test (g) proves this |
| 14 | Kiosk does not display "Tap, insert, or swipe card" until server returns 202 | ✓ VERIFIED | `kiosk-core.js:2898` sets neutral "Contacting terminal…" before the sale fetch; `:2981` sets the tap prompt only inside the 202-pending success branch |

**Score:** 8/8

**Total code-level score: 14/14 must-haves verified**

### Post-Review Fix Verification (commits `fix(68-review): *`)

The phase evolved beyond the original two plans via a code-review pass (`68-REVIEW.md`, 2 critical + 3 warning findings). Both BLOCKER findings and one warning are confirmed fixed in the current codebase (not just claimed in REVIEW.md):

| Finding | Claimed Outcome | Verified in Code | Evidence |
|---------|-----------------|-------------------|----------|
| CR-01 (orphan on void failure) | Fixed — `voidWithTimeout` returns discriminated `{ok, reason}`; non-ok retains pending record + writes `sv:void-failure` sentinel | ✓ CONFIRMED | `money-path.js:198-258` returns `{ok:true}` / `{ok:false, reason:'declined'|'timeout'|'error'}` on every path (never rejects); `webhooks.js:302-337` checks `voidResult.ok`, only deletes `KIOSK_PENDING_CHARGE`/`KIOSK_CANCELLED` records on `ok:true`, writes `sv:void-failure:<ts>` sentinel (30-day TTL) on non-ok |
| CR-02 (lock released on wrong path) | Fixed — `releaseLock` nested inside the `acquired` branch only | ✓ CONFIRMED | `webhooks.js:282-350` — `!acquired` branch (`:283-291`) returns without releasing; `releaseLock` call (`:346-349`) is nested inside the code path that ran `cache.get(...)` under the acquired branch |
| WR-02 (void-failure path untested) | Fixed — regression tests (e)/(f)/(g) added, folded into `pos-cancel-orphan.test.js` | ✓ CONFIRMED | `pos-cancel-orphan.test.js:251-374` — tests (e) FAILED void retains record + sentinel, (f) TIMED-OUT void same, (g) lock-held re-delivery does not release/void; harness is a full-server `supertest` integration test through the real webhook route (not an isolated function mock), so it exercises actual route wiring |
| WR-03 (`emitStageTiming` not defensively wrapped) | Fixed — wrapped in try/catch | ✓ CONFIRMED | `pos.js:359-377` — try/catch around the full body of `emitStageTiming`, swallows any throw |
| WR-01 (no `hasMatchingZohoOrder` guard before void) | Deferred (explicitly out of locked phase scope — reconcile.js is contractually UNCHANGED) | ✓ CONFIRMED DEFERRED, not silently dropped | `reconcile.js` has zero diff since before phase 68 (verified above); `hasMatchingZohoOrder` exists only in `reconcile.js:92`, not duplicated into `webhooks.js`. Per verification brief, this is an explicitly documented deferral, not a gap. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | Stage-timing events + `/api/kiosk/telemetry` sink | ✓ VERIFIED | Contains `kiosk.sale_stage_timing` (6 call sites), `kiosk.terminal_push_latency`, `/api/kiosk/telemetry` route registered |
| `js/kiosk-core.js` | `_kcReportTerminalPushLatency` beacon + push-start timestamp | ✓ VERIFIED | Function defined `:174`; `_kioskPushShownAt` stamped `:2904`; beacon fired `:2971` on 202 only |
| `zoho-middleware/__tests__/kiosk-telemetry.test.js` | Regression suite ≥40 lines | ✓ VERIFIED | 277 lines, exercises stage-timing emission + telemetry sink validation |
| `zoho-middleware/lib/constants.js` | `KIOSK_CANCELLED_PREFIX` cache-key constant | ✓ VERIFIED | `constants.js:58` `KIOSK_CANCELLED_PREFIX: 'kiosk:cancelled:'` |
| `zoho-middleware/routes/webhooks.js` | APPROVED-branch cancelled-flag check + `voidWithTimeout` void, skip booking | ✓ VERIFIED | `webhooks.js:242-350`, contains `voidWithTimeout` |
| `zoho-middleware/routes/pos.js` (`/api/pos/cancel`) | Reads `reference_number`, writes `KIOSK_CANCELLED_PREFIX` flag | ✓ VERIFIED | `pos.js:1671-1696` |
| `zoho-middleware/__tests__/pos-cancel-orphan.test.js` | Regression suite ≥50 lines covering cancel/void/non-cancelled/no-charge + failure/lock cases | ✓ VERIFIED | 375 lines, full-server supertest harness, 7 test cases (a-g) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `processSaleWithPrices` stages | `eventLog.logEvent` | `Date.now()` deltas at lock/catalog/assertion/gc-lookup/terminal-push/202 boundaries | ✓ WIRED | Confirmed via grep at all 6 call sites; try/catch wrapped (WR-03) |
| `kiosk-core.js _kioskPushToTerminal` | `/api/kiosk/telemetry` | `_kcReportTerminalPushLatency` fire-and-forget on 202 | ✓ WIRED | `kiosk-core.js:2971-2975`, gated after cancelled/saleCompleted checks |
| `/api/kiosk/telemetry` route | `eventLog.logEvent` | no-side-effect sink mirroring `/api/kiosk/client-error` | ✓ WIRED | `pos.js:981-1006`; auth/rate-limit registered (`authTiers.js:66`, `server.js:538-552`) |
| `/api/pos/cancel` | `cache.set(KIOSK_CANCELLED_PREFIX + refNumber)` | `reference_number` from body, fire-and-forget | ✓ WIRED | `pos.js:1671-1696` |
| `processCardTransactionResult` (APPROVED) | `moneyPath.voidWithTimeout` | cancelled-flag hit → void immediately, amount from pending-charge record, skip booking | ✓ WIRED | `webhooks.js:242-337` |
| `kiosk-core.js` cancel handler | `/api/pos/cancel` with `reference_number` | cancel sends the ref so the server can flag it | ✓ WIRED | `kiosk-core.js:2872-2889` |

### Behavioral Spot-Checks (test suites as the runnable proof)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frontend suite green (incl. new 68-01/68-02 tests, pinned client-error beacon test untouched) | `npm test` | 73 suites, 1053 tests passed | ✓ PASS |
| Middleware suite green (incl. new telemetry + cancel-orphan tests, reconcile 45-08 backstop tests, existing webhook tests) | `cd zoho-middleware && npm test` | 89 suites, 1362 tests passed | ✓ PASS |
| Frontend lint clean | `npm run lint` | no output / exit 0 | ✓ PASS |
| Middleware lint clean | `cd zoho-middleware && npm run lint` | no output / exit 0 | ✓ PASS |
| `js/kiosk-core.min.js` matches source (rebuilt via `npm run build`, not hand-edited) | `npm run build && git status js/kiosk-core.min.js` | no diff after build | ✓ PASS |
| `reconcile.js` and its 600s backstop untouched | `git diff 1b502297 HEAD -- zoho-middleware/lib/reconcile.js` | empty diff | ✓ PASS |

### Requirements Coverage

Phase requirement IDs: none declared (owner-ticket defect phase; `68-CONTEXT.md` decisions are the requirement source, not `REQUIREMENTS.md`). No orphaned requirement IDs found for Phase 68 in `.planning/REQUIREMENTS.md`.

### Anti-Patterns Found

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers introduced in phase-68-modified files (`pos.js`, `webhooks.js`, `constants.js`, `money-path.js`, `kiosk-core.js`). One pre-existing `'TBD'` string literal at `kiosk-core.js:3336` (a recipe-timeline day-label UI value, from phase 48, `git blame` confirms 2026-07-04, unrelated to this phase) — not a debt marker, not phase-68 code.

No stub patterns (`return null`/`return {}`/empty handlers/hardcoded-empty-props) found in the reviewed money-path or telemetry code — all new functions have substantive, tested bodies with real cache/moneyPath/eventLog wiring.

### Human Verification Required

### 1. 68-03 live-kiosk checkpoint (blocking gate, not yet run)

**Test:** Deploy middleware (68-01/68-02) before frontend; hard-refresh the kiosk iPad. Ring a normal card sale and read Railway logs for `kiosk.sale_stage_timing` events to identify the dominant latency stage. Then start a sale, cancel from the kiosk mid/after-push, and tap the reader anyway (simulating "reader picks up when I cancel") — confirm via Helcim/Zoho that the charge is either never made or voided, never left as an orphan (charge with no invoice).

**Expected:** Stage timings are captured and readable; a cancel-then-tap-anyway never results in an unmatched charge (voided or no-charge only).

**Why human:** Requires the physical kiosk iPad, the real Helcim card reader, a live/staging middleware deploy, and (optionally) a refundable test card — none of this is observable or simulatable from static code analysis. `68-03-PLAN.md` is explicitly `type: checkpoint:human-verify`, `gate: blocking`, `autonomous: false`, and no `68-03-SUMMARY.md` exists yet, confirming it has not been executed.

### Gaps Summary

No code-level gaps found. All 14 must-haves declared across 68-01-PLAN.md and 68-02-PLAN.md are verified present, substantive, and wired in the current codebase — including the post-review fix commits (`73253046`, `94fc80a5`) that closed the two BLOCKER findings (CR-01 orphan-on-void-failure, CR-02 double-void lock race) identified in `68-REVIEW.md`. Both test suites (1053 + 1362 tests) and both lint configs are green. `js/kiosk-core.min.js` is in sync with source. `reconcile.js` is confirmed byte-for-byte untouched, preserving the 600s backstop as defense-in-depth per the locked design.

The only outstanding item is the 68-03 live-kiosk checkpoint, which is a deliberate human-verify gate by design (not a code deliverable) and has not yet been executed by the owner. Per the phase's own structure this does not block code-level phase completion but does block the phase from being marked fully `passed` until the owner runs it and confirms.

The WR-01 finding (no `hasMatchingZohoOrder` guard before voiding a cancelled-and-approved charge) is a documented, in-scope deferral — the review itself classifies it as defense-in-depth for a currently-unreachable path (client disables cancel once `confirmSale` runs), and fixing it would require either exporting a helper from the contractually-untouched `reconcile.js` or duplicating a second Zoho lookup path, both explicitly out of this phase's locked scope. Confirmed not silently dropped: it is documented in `68-REVIEW.md` outcomes and remains a known follow-up.

---

_Verified: 2026-08-12T13:13:24Z_
_Verifier: Claude (gsd-verifier)_
