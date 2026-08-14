---
phase: 71-kiosk-so-collect-reconciliation
plan: 01
subsystem: payments
tags: [zoho-books, helcim, webhooks, money-path, invoice-reconciliation]

# Dependency graph
requires:
  - phase: 45/49/68 (money-path doctrine)
    provides: moneyPath (lib/money-path.js), reconcile.js sv:void-failure sentinel convention, fail-closed patterns reused here
provides:
  - moneyPath.ensureOpenInvoiceForSalesOrder(soId) — dedup pre-check + convert-or-reuse + finalize SO invoice
  - reconcile.recordCollectReconcileFailure(ctx, transactionId, err) — collect-flow fail-closed sentinel + staff alert
  - COLLECT_RECONCILE_FAILURE_PREFIX constant
  - webhooks.js collect APPROVED path rewritten to apply payments via invoices:[...] (never salesorders_to_apply)
affects: [71-02, 71-03 (live-verify of the SO invoices[] field-path assumption against real Zoho), checkout.js:693 sibling deposit bug (flagged, not fixed here)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SO->invoice finalize-before-apply: ensureOpenInvoiceForSalesOrder dedup-checks GET /salesorders/{id}.invoices[], reuses/converts, then POST /invoices/{id}/submit before any payment is booked against it"
    - "Fail-closed collect reconcile: hoist the parsed collect-pending ctx to an outer-scope var so a single terminal .catch() can report failures with full context (recordCollectReconcileFailure + captureExceptionSafe) without deleting the pending key"

key-files:
  created:
    - zoho-middleware/__tests__/collect-webhook-reconcile.test.js
  modified:
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/lib/money-path.js
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/lib/constants.js
    - zoho-middleware/__tests__/helcim-terminal-success.test.js

key-decisions:
  - "Full convert-or-reuse-and-finalize logic lives inside money-path.js's ensureOpenInvoiceForSalesOrder (not spread across webhooks.js) so processSale-style callers can reuse it later; webhooks.js only needed zohoPost (not zohoGet) after this encapsulation, so the plan's literal 'add zohoGet to webhooks.js' instruction was skipped as unnecessary/unused (would fail lint) — see Deviations."
  - "Reused mailer.sendVoidFailureAlert for the collect reconcile-failure staff alert per plan instruction ('do not invent a new mailer method'); its hardcoded subject line reads 'Helcim void failed' even though this alert covers invoice-finalize/apply failures, not void failures — a known, accepted cosmetic mismatch."
  - "An existing regression test (helcim-terminal-success.test.js, 'collect-pending APPROVED') pinned the pre-fix salesorders_to_apply shape — updated in place to the invoices[] shape (Rule 1 exception to CLAUDE.md rule 10: the old test WAS the pinned bug this exact plan required removing)."

requirements-completed: ["71-D1-finalize-invoice", "71-D2-apply-to-invoice", "71-D3-fail-closed"]

# Metrics
duration: 12min
completed: 2026-08-14
---

# Phase 71 Plan 01: Kiosk SO-Collect Money-Path Fix Summary

**Kiosk "collect payment on SO" now finalizes the SO's invoice (convert-or-reuse + submit) and applies the Helcim payment to it via `invoices:[{invoice_id, amount_applied}]`, replacing the `salesorders_to_apply` construct that left charges as unapplied advances against a draft invoice; a post-charge finalize/apply failure now writes a fail-closed reconcile record + staff alert instead of a bare `log.warn`.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-14T22:27:00Z (approx.)
- **Completed:** 2026-08-14T22:39:01Z
- **Tasks:** 3/3
- **Files modified:** 5 (1 new test file, 4 modified — one of which is a pre-existing test file, see Deviations)

## Accomplishments
- `money-path.ensureOpenInvoiceForSalesOrder(soId)`: dedup pre-check against `GET /salesorders/{id}` reuses any existing linked invoice (never duplicates), converts via `/invoices/fromsalesorder?salesorder_id=` only when none exists, then finalizes via `/invoices/{id}/submit` — rejects (never silently returns a draft invoice_id) on a genuine submit failure.
- `reconcile.recordCollectReconcileFailure(ctx, transactionId, err)`: fail-closed sentinel (`collect:reconcile-failure:` + timestamp, 30-day TTL) + `collect.reconcile_failed` event + staff alert, mirroring the existing `sv:void-failure` convention.
- `webhooks.js` collect APPROVED path rewritten: finalize invoice → apply payment via `invoices:[...]` → delete pending key only on success (double-apply guard) → on failure, report + retain pending key for recovery (no silent draft/unapplied advance).
- New test file with 4 cases (happy path, existing-draft reuse, post-charge fail-closed, `salesorders_to_apply` regression guard) exercising the REAL `money-path.js`/`reconcile.js` implementations against mocked Zoho API + cache + mailer — not just mocked call-shape assertions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for the collect-webhook reconcile (RED)** - `79d1d100` (test)
2. **Task 2: Add the shared finalize helper + fail-closed reconcile writer + constant** - `7f24592c` (feat)
3. **Task 3: Rewrite the collect APPROVED path in webhooks.js (GREEN)** - `0f879a54` (feat, also updates a pre-existing test — see Deviations)

_TDD gate sequence confirmed in git log: test(71-01) RED commit precedes both feat(71-01) GREEN commits._

## Files Created/Modified
- `zoho-middleware/__tests__/collect-webhook-reconcile.test.js` - New: 4-case harness (happy path, draft-reuse, fail-closed, regression) combining collect.test.js's router-mock extraction with helcim-webhook.test.js's flushPromises-after-200 pattern; runs the REAL money-path.js/reconcile.js against mocked zoho-api/cache/mailer.
- `zoho-middleware/lib/money-path.js` - Added and exported `ensureOpenInvoiceForSalesOrder(soId)` + a top-level `zoho-api` require.
- `zoho-middleware/lib/reconcile.js` - Added and exported `recordCollectReconcileFailure(ctx, transactionId, err)` + a top-level `eventLog` require + the `COLLECT_RECONCILE_FAILURE_PREFIX` constant reference.
- `zoho-middleware/lib/constants.js` - Added `COLLECT_RECONCILE_FAILURE_PREFIX: 'collect:reconcile-failure:'`.
- `zoho-middleware/routes/webhooks.js` - Rewrote the collect APPROVED branch (finalize → apply → delete-on-success) and the fail-closed catch (hoisted `collectCtx` so the single terminal `.catch()` can report with full context).
- `zoho-middleware/__tests__/helcim-terminal-success.test.js` - Updated the pre-existing "collect-pending APPROVED" test (see Deviations).

## Decisions Made
- Encapsulated the entire convert-or-reuse-and-finalize sequence (dedup pre-check + create-if-missing + submit) inside `money-path.js`, matching the plan's `<must_haves.artifacts>` contract for that file, rather than splitting the dedup `zohoGet` pre-check into `webhooks.js`.
- Reused `mailer.sendVoidFailureAlert` rather than adding a new mailer method (explicit plan instruction); the collect-flow-specific failure text is carried in the alert's `error` field, since the function's subject line is fixed.
- Treated an "already sent" / "cannot be submitted" `/invoices/{id}/submit` error as success (invoice already in the desired open/sent state) rather than a failure — matches the plan's intent that a reused draft invoice may already have been finalized by another path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/test-pinned-the-bug] Updated a pre-existing regression test that pinned the pre-fix `salesorders_to_apply` shape**
- **Found during:** Task 3 (`npm test` full-suite run)
- **Issue:** `__tests__/helcim-terminal-success.test.js`'s "collect-pending APPROVED: calls zohoPost customerpayments + clears pending key" test asserted the OLD buggy payload (`salesorders_to_apply`) — i.e. it was a regression test for the exact bug this plan fixes. After the Task 3 rewrite, this test failed (0 calls to `/customerpayments`, because the test's `zohoGet`/`zohoPost` mocks weren't configured for the new convert→submit→apply chain, so `ensureOpenInvoiceForSalesOrder` rejected and the fail-closed catch fired instead — no crash, but not the intended assertion).
- **Fix:** Configured `zohoGet`/`zohoPost` mocks in that one test to route the SO-lookup/convert/submit/apply chain, and updated the assertion from `salesorders_to_apply` to `invoices: [{invoice_id, amount_applied}]` + added a `cache.del(pendingKey)` assertion. No other test in the file was touched.
- **Files modified:** `zoho-middleware/__tests__/helcim-terminal-success.test.js`
- **Verification:** `npx jest helcim-terminal-success` → 10/10 pass; full `npm test` → 92/92 suites, 1391/1391 tests pass.
- **Committed in:** `0f879a54` (part of Task 3 commit — CLAUDE.md rule 4 "one logical change per commit" was interpreted here as "the Task 3 code change and its required test-suite fixup are one logical unit," since the code change is what the test needed corrected)

**2. [Rule 1 - Bug avoidance / lint] Did not add an unused `zohoGet` import to webhooks.js**
- **Found during:** Task 3 read_first review
- **Issue:** The plan's Task 3 action literally instructs "Add `var zohoGet = zohoApi.zohoGet;` near line 8" for the dedup pre-check. But Task 2's `<must_haves.artifacts>` contract places the entire dedup pre-check inside `money-path.ensureOpenInvoiceForSalesOrder` (not `webhooks.js`), and `webhooks.js` never calls `zohoGet` directly in the final implementation. Adding an unused `var` would fail `npm run lint` (`no-unused-vars`, `--max-warnings 0`), which is a hard commit gate under CLAUDE.md rule 2.
- **Fix:** Did not add the unused import. `webhooks.js` only needed its existing `zohoPost` import.
- **Files modified:** None (omission, not an edit)
- **Verification:** `cd zoho-middleware && npm run lint` passes clean.
- **Committed in:** `0f879a54`

---

**Total deviations:** 2 (1 test-fixup required by the fix itself, 1 omission to avoid a lint failure). Neither expands scope beyond the plan's stated objective — both were necessary for `npm test` + `npm run lint` to pass per CLAUDE.md rules 1/2/7 and the plan's own verification block.

## Issues Encountered
None beyond the deviations above. `node_modules` was missing in this worktree at the start of execution (flagged by the orchestrator); ran `cd zoho-middleware && npm ci` before any test invocation, per the pre-flight note in this plan's prompt.

## Flagged, Not Fixed (per plan's explicit scope boundary)

**DECLINED-path idempotency-key mismatch (webhooks.js, unchanged):** The DECLINED branch reads `ctx.idempotencyKey` (camelCase), but `collect.js:105` stores the pending context field as `idempotency_key` (snake_case). This means `C.CACHE_KEYS.COLLECT_IDEM_PREFIX + ctx.idempotencyKey` evaluates to `'collect:idem:undefined'` on a DECLINED webhook — the real per-SO idempotency key (`collect:idem:{soId}`) is never cleaned up on decline, so a declined collect payment leaves the idempotency lock in place until its 5-minute TTL expires (staff cannot immediately retry a declined SO collection; must wait out the TTL). This is a pre-existing, separate bug from the one this plan fixes. Per the plan's explicit instruction ("Note for executor... do NOT fix here"), it was left unchanged and is surfaced here for a future plan.

**checkout.js:693 sibling deposit bug (not touched):** Also out of scope per `71-CONTEXT.md` — the online deposit-on-SO path uses the same `salesorders_to_apply` construct in its `else` branch. Left untouched; a future phase/plan should apply the same fix pattern established here.

## Dedup Pre-Check Field Path — For 71-03 Live-Verify

**Exact field path read:** `GET /salesorders/{id}` response → `response.salesorder.invoices[].invoice_id` (first entry whose `.status` is not `'void'`, case-insensitive). Implemented in `money-path.js`'s `ensureOpenInvoiceForSalesOrder`.

**Secondary/defensive fallback (unverified, kept only as a belt-and-suspenders signal):** a flat `response.salesorder.invoice_id`, checked only if the `invoices[]` array yields no match.

**Why this matters:** No in-repo precedent exists for this shape prior to this change (confirmed by 71-PATTERNS.md's pattern-mapping pass — "No Analog Found: does an invoice already exist for this SO"). It is currently mock-tested only (`collect-webhook-reconcile.test.js` supplies `{ salesorder: { invoices: [...] } }` fixtures). **71-03's live-verify step must confirm this exact shape against a real Zoho `GET /salesorders/{id}` response** (e.g. for SO-000076, which already has a hand-repaired linked invoice INV-000169) before this dedup pre-check is trusted in production — if the real Zoho response nests this differently, the pre-check will silently miss the existing invoice and always create a new one (duplicate-invoice risk, the exact failure mode this pre-check exists to prevent).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The core money-path fix (finalize → apply → fail-closed) is implemented, tested (unit-level against mocked Zoho API), and does not touch `js/`, `kiosk.html`, or `pos.js:2465` per the plan's constraints.
- **Blocker for full confidence:** the dedup pre-check's field-path assumption (`salesorder.invoices[].invoice_id`) is unverified against live Zoho data — 71-03 (or an equivalent live-verify plan) must confirm it before this ships to production traffic, per the note above.
- `checkout.js:693` (sibling deposit bug) and the DECLINED-path idempotency-key mismatch remain open, flagged for a follow-up plan.

---
*Phase: 71-kiosk-so-collect-reconciliation*
*Completed: 2026-08-14*

## Self-Check: PASSED
All 7 file paths and 3 commit hashes referenced above verified present via `[ -f ... ]` and `git log --oneline --all | grep`.
