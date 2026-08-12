---
phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety
plan: 02
subsystem: payments
tags: [kiosk, helcim, webhooks, money-path, cancel-safety, tdd]

# Dependency graph
requires:
  - phase: 68-01
    provides: per-stage kiosk sale-pipeline instrumentation (unrelated to this plan's fix — 68-02 does not depend on the telemetry itself, only sequenced after it in the wave)
provides:
  - KIOSK_CANCELLED_PREFIX cache-key convention (constants.js) — a fire-and-forget, short-TTL "this ref was cancelled" flag keyed by reference_number
  - /api/pos/cancel writes that flag before responding
  - webhooks.js processCardTransactionResult's APPROVED branch checks the flag FIRST and, if set, voids the charge immediately via moneyPath.voidWithTimeout instead of booking — sourcing the amount from the existing KIOSK_PENDING_CHARGE record
  - client: cancel POST now carries reference_number; the "Tap, insert, or swipe card" prompt is gated on the sale-push 202 response
affects: [68-03-live-verify, any future kiosk terminal/webhook change]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook-anchored safety check: because the kiosk client stops polling /api/kiosk/sale/status the instant cancel is clicked (kiosk-core.js), any post-cancel safety net that depends on client-side resolution is unreachable in the real scenario. The Helcim webhook (processCardTransactionResult) is the only channel that resolves an approved terminal result independent of the client, so cancel-safety checks belong there."
    - "Mark-and-void: cancel does not attempt to stop the device (no txnId exists yet) — it records a flag; the flag is consumed later, when a real transactionId resolves, by the single void path (moneyPath.voidWithTimeout)."
    - "Double-void guard via the existing reconcile.js 'reconcile:txn:' + transactionId lock convention — reused rather than inventing a second locking scheme, so a Helcim webhook re-delivery of the same APPROVED event no-ops instead of double-voiding."
    - "Amount-from-cache read as an already-parsed object (ctx.amount), matching reconcile.js's convention for the same KIOSK_PENDING_CHARGE_PREFIX record — NOT JSON.parse (that convention belongs to the terminal-result cache key, a different record)."

key-files:
  created:
    - zoho-middleware/__tests__/pos-cancel-orphan.test.js
    - tests/frontend/kiosk-cancel-safety.test.js
  modified:
    - zoho-middleware/lib/constants.js
    - zoho-middleware/routes/pos.js
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/lib/helcim.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js

key-decisions:
  - "Void path is the Helcim WEBHOOK (processCardTransactionResult), not /api/kiosk/sale/status — the client poll loop stops the instant cancel is clicked, so sale/status is never reached in the real cancel-then-tap-later scenario. This was a plan-review correction baked into 68-02-PLAN.md before execution; confirmed correct during implementation (no code path calls /api/kiosk/sale/status after a client-side cancel)."
  - "Double-void guard: acquired the SAME cache.acquireLock('reconcile:txn:' + transactionId, 60) reconcile.js already uses, rather than clearing the cancelled flag pre-void or inventing a new lock key. This keeps exactly one serialization mechanism per transactionId across both the fast-void path and the reconcile backstop, so they can never race each other for the same txn."
  - "A missing/unreadable KIOSK_PENDING_CHARGE record still proceeds to void with amount=0 (amount is only used for the void's failure-alert payload, never to gate whether the void fires) — fail toward voiding, not toward silently skipping it."
  - "helcimLib.cancelTerminal() stays bookkeeping-only (ok:false, device_cancel_required:true) — Helcim has no documented in-flight device-cancel distinct from reverse/void, and no txnId exists yet at cancel time to void against. Its log message was reworded so it no longer reads as though the device was stopped; the real safety net is the cancelled-flag + webhook void, not this call."
  - "10-minute TTL (KIOSK_CANCELLED_TTL) on the cancelled flag — comfortably longer than the client's own POLL_TIMEOUT_MS (45s) plus webhook-delivery margin, short enough not to accidentally void a much-later unrelated re-use of the same reference_number (kiosk refs are timestamp-derived, effectively unique)."

patterns-established:
  - "voidCancelledApprovedCharge(transactionId, invoiceNumber) helper in webhooks.js — the reusable insertion point for any future 'resolve a terminal result against a cancelled-sale flag' need, without duplicating the lock-acquire/amount-read/void/cleanup/lock-release sequence."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-08-12
---

# Phase 68 Plan 02: Cancel/Orphan-Charge Safety Summary

**Closes the cancel-then-charge orphan window by voiding on the Helcim webhook's first APPROVED event (not the unreachable client poll), keyed by a new KIOSK_CANCELLED_PREFIX flag and routed exclusively through moneyPath.voidWithTimeout.**

## Performance

- **Duration:** 8 min (05:44 → 05:52 PDT)
- **Started:** 2026-08-12T12:44:00Z
- **Completed:** 2026-08-12T12:52:16Z
- **Tasks:** 4 (RED test, GREEN server, RED test, GREEN client)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- **Root defect closed:** `/api/pos/cancel` → `helcimLib.cancelTerminal()` was a no-op with no server-side memory of the cancel. A slow `terminalPurchase` landing after cancel left the reader live with nobody polling (`kiosk-core.js` stops its poll loop the instant cancel is clicked) — if the customer then tapped, the card was charged with no invoice created, invisible until the `reconcile.js` 600s backstop swept it up. That window is now closed on the **first** Helcim webhook event, not after a 10-minute wait.
- **New `KIOSK_CANCELLED_PREFIX` cache-key convention** (`zoho-middleware/lib/constants.js`) — `/api/pos/cancel` now reads `reference_number` from the request body and writes `cache.set(KIOSK_CANCELLED_PREFIX + ref, {cancelled_at}, 600s)` fire-and-forget before responding.
- **`processCardTransactionResult`'s APPROVED branch** (`webhooks.js`) now checks that flag FIRST. If set: sources the void amount from the existing `KIOSK_PENDING_CHARGE_PREFIX` record (read as `ctx.amount`, the object convention `reconcile.js` already uses — never `JSON.parse`, that's a different cache key's convention), voids via `moneyPath.voidWithTimeout(helcimLib, transactionId, amount, {reqId: invoiceNumber})` — the single void path, no new direct `helcimLib.voidTransaction` call added — emits `kiosk.cancel_after_push_voided`, clears both the pending-charge record and the cancelled flag, and **skips** `reconcile.reconcilePendingCharge` (the normal booking/backstop path) entirely for that ref. If not flagged: **completely unchanged**, still calls `reconcile.reconcilePendingCharge`.
- **Double-void guard:** the fast-void path acquires the same `cache.acquireLock('reconcile:txn:' + transactionId, 60)` lock `reconcile.js` already uses for its own serialization. A Helcim webhook re-delivery of the same APPROVED event finds the lock held and no-ops — no spurious void-failure staff alert, no double void attempt.
- **`reconcile.js` and its 600s `MIN_ORPHAN_AGE_SECONDS` backstop are completely untouched** — they remain as defense-in-depth for the case where the fast-void path itself fails (e.g. the flag write never landed due to a Redis blip during cancel).
- **`helcimLib.cancelTerminal()`** stays bookkeeping-only — researched during implementation (per CONTEXT.md's deferred question): Helcim has no documented in-flight device-cancel endpoint distinct from `payment/reverse` (void), and no `transactionId` exists yet at cancel time to void against. Its log message was reworded so it no longer implies the device was actually stopped; `ok: false` already correctly signalled "did not stop the device," but the message text was misleading.
- **Client (`js/kiosk-core.js`):** the terminal-cancel handler now POSTs `{ reference_number: refNumber }` (JSON body) to `/api/pos/cancel` — previously the POST carried no body at all, so the server had no ref to key the flag on. The "Tap, insert, or swipe card..." prompt no longer appears the instant the payment screen shows (the exact "reader isn't picking up" perception bug from the ticket) — a neutral "Contacting terminal…" shows first, and the real tap prompt is set only after the sale-push 202 pending response confirms the push actually reached Helcim.

## Task Commits

1. **RED — cancel/orphan regression tests (webhook-anchored)** - `0ca28ffa` (test)
2. **GREEN — constants + /api/pos/cancel flag + webhook fast-void** - `9a0915a7` (feat)
3. **RED — client cancel-ref + prompt-gating test** - `e6966b13` (test)
4. **GREEN — client cancel ref + prompt gating + rebuild min** - `da771ae2` (feat)

_TDD gate sequence verified in git log: test → feat → test → feat._

## Files Created/Modified

- `zoho-middleware/__tests__/pos-cancel-orphan.test.js` - Full-server supertest suite (mirrors `webhook-wr07.test.js`'s harness): (a) `/api/pos/cancel` writes the flag; (b) an APPROVED webhook for a cancelled ref voids via `moneyPath.voidWithTimeout` (amount from the pending-charge record) and skips `reconcile.reconcilePendingCharge`; (c) the same APPROVED event for a non-cancelled ref is unchanged; (d) a cancel with no resulting charge never calls `voidWithTimeout`
- `zoho-middleware/lib/constants.js` - `KIOSK_CANCELLED_PREFIX: 'kiosk:cancelled:'` added to `CACHE_KEYS`
- `zoho-middleware/routes/pos.js` - `/api/pos/cancel` reads `reference_number`, writes the cancelled flag (10min TTL, `KIOSK_CANCELLED_TTL`) fire-and-forget before responding
- `zoho-middleware/routes/webhooks.js` - `require('../lib/money-path')` added; `processCardTransactionResult`'s APPROVED branch gated on the cancelled flag; new `voidCancelledApprovedCharge()` helper (lock-acquire → amount lookup → `voidWithTimeout` → eventLog → cleanup → lock-release)
- `zoho-middleware/lib/helcim.js` - `cancelTerminal()` log message reworded to not imply the device was stopped; return shape unchanged (`{ok:false, device_cancel_required:true}`)
- `js/kiosk-core.js` - cancel handler sends `reference_number` in the POST body; tap-card prompt moved from immediately-on-screen-show to after the confirmed 202 pending response; neutral "Contacting terminal…" shown in between
- `js/kiosk-core.min.js` - Rebuilt via `npm run build` (terser); no hand edits; unrelated stamp churn (admin.js, all public HTML pages) reverted via `git checkout --`
- `tests/frontend/kiosk-cancel-safety.test.js` - jsdom suite (mirrors `kiosk-push-latency.test.js`'s harness, extended with injected `kiosk-terminal-msg`/`kiosk-cancel-payment` DOM nodes so message text and the cancel POST body are directly assertable): (a) cancel POST body carries the same `reference_number` used for the sale; (b) tap-card prompt text is absent pre-202, present post-202

## Decisions Made

- **Webhook, not sale/status:** the plan's frontmatter/context already carried the corrected design (client stops polling on cancel, so `/api/kiosk/sale/status` is unreachable for the real scenario) — implementation confirmed this by inspection: no code path invokes `/api/kiosk/sale/status` in response to a cancel, and the webhook already ran `reconcile.reconcilePendingCharge` unconditionally on every APPROVED event, making it the natural, already-proven-reachable insertion point.
- **Reused `reconcile:txn:` lock** rather than clearing the cancelled flag pre-void (the plan offered both as acceptable) — reusing the existing lock means exactly one serialization primitive per `transactionId` governs both the fast-void path and the reconcile backstop, so the two paths can never race for the same transaction even under concurrent webhook retries.
- **Amount-read-as-object convention** confirmed against `reconcile.js:233,257` (`cache.get(pendingKey).then(function(ctx){ ctx.amount })`) rather than the `JSON.parse` convention used for the *different* `helcim:terminal:result:` cache key (webhooks.js:161-167) — these are two distinct records with two distinct storage conventions in the same file; using the wrong one would have thrown on `JSON.parse` of an already-object value.
- **10-minute TTL** for `KIOSK_CANCELLED_TTL`, matching the same order of magnitude as `reconcile.js`'s own lock TTL (60s) and `MIN_ORPHAN_AGE_SECONDS` (600s) family of constants already in this codebase, comfortably covering the 45s client poll timeout plus webhook delivery latency.

## Deviations from Plan

None - plan executed exactly as written, including both explicitly offered discretion points (webhook-vs-status already resolved by the plan's own correction note; lock-vs-flag-clear guard resolved by choosing the lock, one of the two plan-sanctioned options).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Uses the existing Redis-backed cache and the existing `KIOSK_DEVICE_TOKEN` route allowlist (`/api/pos/cancel` was already in `KIOSK_ROUTES`).

## Money-Path Verification

- Void fires ONLY through `moneyPath.voidWithTimeout` — `grep -n "voidWithTimeout" zoho-middleware/routes/webhooks.js` confirms the only new void call site; no direct `helcimLib.voidTransaction` added anywhere in this plan's diff.
- `zoho-middleware/lib/reconcile.js` is byte-for-byte untouched (not in `git diff` for this plan) — the 600s `MIN_ORPHAN_AGE_SECONDS` backstop remains fully intact as defense-in-depth.
- The non-cancelled APPROVED webhook path is unchanged — regression test (c) proves `reconcile.reconcilePendingCharge` still fires and `voidWithTimeout` is never called for a ref with no cancelled flag.
- Full middleware suite green both after server-side (Task 2) and after client-side (Task 4) changes: 89/89 suites, 1359/1359 tests, `npm run lint` clean (zoho-middleware).
- Full frontend suite green after client changes: 73/73 suites, 1053/1053 tests, `npm run lint` clean (root).

## Deferred Research Answered

CONTEXT.md flagged "whether Helcim supports a genuine remote device-cancel API" as a deferred research question. Answer, confirmed during this plan's implementation: no — Helcim's documented API surface offers `payment/reverse` (void, requires an existing `transactionId`) but no distinct in-flight terminal-cancel endpoint. Cancel safety is therefore bookkeeping-based by design (mark-and-void via the webhook), not a device-level stop — this is now stated explicitly in `helcimLib.cancelTerminal()`'s own log message and code comment rather than left implicit.

## Next Phase Readiness

- The cancel/orphan-charge money-bug found while diagnosing the latency ticket is closed: any charge that lands for a cancelled kiosk sale is voided on the first Helcim webhook event, strictly faster than the pre-existing 600s reconcile backstop, through the single sanctioned void path.
- Client-perceived "reader isn't picking up" is also addressed for the cancel-adjacent symptom (tap prompt now truthful about push status) — the deeper pipeline-reorder latency work itself remains explicitly deferred to a future telemetry-driven phase per 68-01's `kiosk.sale_stage_timing`/`kiosk.terminal_push_latency` events.
- Ready for 68-03 (live verify) — this plan's server and client changes are both deployed-shape-complete (min rebuilt, both suites green) with no outstanding TODOs.

---
*Phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety*
*Completed: 2026-08-12*

## Self-Check: PASSED

All files_modified files verified present on disk; all 4 task commit hashes (0ca28ffa, 9a0915a7, e6966b13, da771ae2) verified present in git log.
