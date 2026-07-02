---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
verified: 2026-07-02T00:00:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "CRITICAL auth-model exposure closed (D-01..D-05: rotate leaked API_SECRET_KEY, remove MW_API_KEY from public js/sheets-config.js, server-side staff identity)"
    reason: "Split to Phase 46 (owner-approved 2026-06-29, recorded in ROADMAP.md Phase 45 'Planned scope' + STATE.md Blockers). Interim containment shipped in Wave 1 (45-01 PII guards + 45-02 prod deploy); residual key-validity-until-cutover risk documented (D-04) and accepted. Decision coverage 10/15 is BY DESIGN."
    accepted_by: "owner (koa)"
    accepted_at: "2026-06-29T00:00:00Z"
gaps: []
---

# Phase 45: Security and Money-Path Hardening Verification Report

**Phase Goal:** Close the verified CRITICAL and HIGH findings from the 2026-06-29 multi-agent audit (`AUDIT-2026-06-29.md`) — the public-key/auth-model exposure and the kiosk money-path weaknesses — plus safe quick-win containments, without weakening the v4.2/v4.4-hardened online checkout path (existing money-path tests must stay green).
**Verified:** 2026-07-02
**Status:** passed (with 1 owner-approved scope override: D-01..D-05 → Phase 46)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Kiosk PII GETs require API key (D-09) | ✓ VERIFIED | `zoho-middleware/routes/pos.js:1566-1570` (`/api/kiosk/salesorders`) and `:2919-2925` (`/api/kiosk/salesorder/:id`) both start with `apiKeyGuard.matches(req.headers['x-api-key'])` → 401. Inline-guard rationale documented in code (path-param routes can't use static `PII_GET_ROUTES`). Regression tests: `__tests__/kiosk-salesorders.test.js`. |
| 2 | KIOSK_PIN misconfig cannot lock out staff via timingSafeEqual RangeError (D-15) | ✓ VERIFIED | `routes/pos.js:677-684` — length compared BEFORE `crypto.timingSafeEqual`; missing/length-mismatch pin returns via the guarded path (mirrors `lib/apiKey.js:34`). |
| 3 | Redis dump never re-committed (D-15) | ✓ VERIFIED | `.gitignore:54-55` (`*.rdb` + `zoho-middleware/dump.rdb`); `git ls-files` confirms no `dump.rdb` tracked. |
| 4 | Redis outage does NOT disable security-critical rate limits or double-charge locks (D-06/07/08) | ✓ VERIFIED | `server.js:299-360` `makeRedisStore` counts in an in-process `memStore` Map when `!cache.isConnected()`; `pinLimiter`/`paymentLimiter`/`apiLimiter` (`:391-431`) carry NO `skip: redisUnavailableSkip` (only low-stakes contact/waitlist/requests limiters retain skip). `lib/cache.js:113-142` — `acquireLock` falls through to `acquireInProcessLock` (NX-semantics Map) on disconnect AND on mid-op Redis error; `releaseLock` clears the in-process entry (FIX1 WR-03). False "MemoryStore" comments removed. Residual: see WR-01/WR-09 note below. |
| 5 | CI fails on artifact drift, stamp-normalized (D-10) | ✓ VERIFIED | `scripts/check-artifact-drift.sh` (5031 B, executable, sed ISO-8601 stamp normalization at :104-107; scoped to main.js/main.min.js/kiosk.min.js/css, excludes stamped admin.min.js). Wired as parallel `artifact-drift` job in `.github/workflows/tests.yml:41-49`. |
| 6 | checkout.js safety primitives extracted to a shared lib consumed by BOTH paths (D-11) | ✓ VERIFIED | `zoho-middleware/lib/money-path.js` (241 lines; exports `acquireIdempotencyLock`, `rejectWithVoid`, `voidWithTimeout`, `markTxnUsed`, TTL const). Consumed by `routes/checkout.js:10,46,149,796` AND `routes/pos.js:15,251,718,965,1272`. checkout.js behavior preserved — all pre-existing checkout money-path tests pass unchanged (suite green, see truth 11). |
| 7 | Kiosk sale/confirm can no longer double-charge or silently swallow recording failures (D-12) | ✓ VERIFIED | `routes/pos.js:239-246` — `idempotency_key` required in production (400 fail-closed); `:251`/`:718` atomic `moneyPath.acquireIdempotencyLock` (replay/contention discriminated); `:554-557` deterministic Helcim terminal key = sha256(client key).slice(25); `:1254-1282` confirm propagates payment-recording failure → `voidWithTimeout` + `needs_manual_review` + `sv:void-failure` persist (no false 201). FIX1 CR-01 fallback seed (`idempotency_key || transaction_id || reference_number`) present. F2 (45-09): manual-confirm now server-verified via `pollTerminalResult(reference_number)` before booking (`:989-1231`) — approved→real txn id, declined→400, unverifiable→409 fail-closed. Live-verified on prod 2026-07-02 (all 3 paths, 45-09-UAT-FINDINGS.md). |
| 8 | Gift-card split-tender cannot underpay; redeem failure flags manual review; timeouts leave a reconcilable trail (D-12 + D-13 interface) | ✓ VERIFIED | `routes/pos.js:536-537` (sale) + `:982-983` (confirm) clamp `gcApplied` to real balance (F1 fix: reads `current_balance`, live-verified — UAT step 6 clamped $20→$8 on prod); redeem failure → `giftCardActivationFailed` → `needs_manual_review` (`:1201-1203`); pending-charge record `KIOSK_PENDING_CHARGE_PREFIX + refNumber` written after every terminal push (`:569`, `:1962`), deleted on confirm success (`:1218`); `lib/constants.js:51` defines the prefix (7-day TTL). |
| 9 | Orphan charges (approved after poll timeout, nothing booked) are auto-voided or flagged (D-13) | ✓ VERIFIED | `lib/reconcile.js` (442 lines): `reconcilePendingCharge` + `sweepPendingCharges`, matched on reference_number; FIX2 hardening present — `MIN_ORPHAN_AGE_SECONDS = 600` (`:67`), per-txn Redis lock `reconcile:txn:` (`:201`), `isAlreadyVoidedError` recovery (`:144,:265`). Wired: webhook fire-and-forget `routes/webhooks.js:240`; 5-minute sweep registered `server.js:578-582`; webhook API-unavailable now caches `UNCONFIRMED` not APPROVED (WR-07 fix, `webhooks.js:120-137`). Tests: `__tests__/reconcile.test.js`, `reconcile-wr02-wr07.test.js`, `webhook-wr07.test.js`. |
| 10 | Hardening is live on prod and survived a live-card UAT (D-15/16/17 checkpoints) | ✓ VERIFIED | 45-02: Wave-1 containments deployed pinned to `322c963` (image digest recorded), honoring the deploy-ordering blocker. 45-09: money-path waves deployed (`41f6462` → … → `211ad6e`/f057094 lineage; Railway `b8aebdca`); **all 8 UAT steps PASS** with concrete live evidence (INV-000127–133, txn ids 50808404/50913349/50914850, GC-000001 lifecycle, over-balance clamp, 15ms idempotent-replay on double-POST). `f057094` is on `main`; `origin/main` and `production/main` both at `9c48d83` (includes it). Findings F1/F2/F3/F7 fixed test-first + live-verified; F4/F6 filed as issues #108/#109 (see note). |
| 11 | Online checkout path NOT weakened — existing money-path tests stay green | ✓ VERIFIED | Run during this verification (2026-07-02): middleware **1122/1122 pass** (55 suites), frontend **931/931 pass** (50 suites), lint **0 errors** (138 pre-existing warnings). Matches the claimed post-UAT baseline. |
| — | CRITICAL auth-model exposure (D-01..D-05) | PASSED (override) | Split to Phase 46, owner-approved 2026-06-29 (ROADMAP.md:857,866; STATE.md Blockers:109). Interim containment shipped (truths 1, 10). Absence is EXPECTED, not a gap. |

**Score:** 11/11 truths verified (+1 owner-approved override)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `zoho-middleware/lib/money-path.js` | Shared safety primitives | ✓ VERIFIED | 241 lines, 5 exports, imported by checkout.js + pos.js (wired, not orphaned) |
| `zoho-middleware/lib/reconcile.js` | Reconciliation backstop | ✓ VERIFIED | 442 lines, wired into webhooks.js + server.js 5-min sweep |
| `zoho-middleware/routes/pos.js` | PII guards, PIN guard, idempotency, GC clamp, pending-charge, F2 verify-before-book | ✓ VERIFIED | All mitigations located at cited lines |
| `zoho-middleware/routes/checkout.js` | Refactored onto money-path lib, no behavior change | ✓ VERIFIED | Consumes lib at :10,46,149,796; 82 pre-existing checkout tests pass unchanged |
| `zoho-middleware/server.js` | Fail-closed limiters + sweep registration | ✓ VERIFIED | memStore fallback; no skip on pin/payment/api; sweep at :578 |
| `zoho-middleware/lib/cache.js` | In-process NX lock fallback | ✓ VERIFIED | :113-142 incl. releaseLock in-process clear (WR-03) |
| `scripts/check-artifact-drift.sh` + `.github/workflows/tests.yml` | Drift gate | ✓ VERIFIED | Script executable + parallel CI job |
| `.gitignore` | rdb ignore | ✓ VERIFIED | :54-55 |
| Test files (kiosk-salesorders, redis-failclosed, money-path, pos-money, pos-giftcard, reconcile, pos-money-defects, reconcile-wr02-wr07, webhook-wr07, admin-gift-card-mgmt) | Regression coverage | ✓ VERIFIED | All present; full suites green |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| routes/checkout.js | lib/money-path.js | require + acquireIdempotencyLock/rejectWithVoid/voidWithTimeout call sites | ✓ WIRED |
| routes/pos.js | lib/money-path.js | require + sale (:251) / confirm (:718) locks, void paths (:965, :1272) | ✓ WIRED |
| routes/pos.js sale+confirm | Apps Script gift-card lookup | balance clamp on `current_balance` (F1 fix, live-verified) | ✓ WIRED |
| routes/pos.js | KIOSK_PENDING_CHARGE_PREFIX cache records | write on terminal push, delete on confirm success | ✓ WIRED |
| routes/webhooks.js | lib/reconcile.js | `reconcile.reconcilePendingCharge(transactionId)` at :240 | ✓ WIRED |
| server.js | lib/reconcile.js | `sweepPendingCharges` every 5 min at :578 | ✓ WIRED |
| .github/workflows/tests.yml | scripts/check-artifact-drift.sh | `artifact-drift` job step | ✓ WIRED |
| pos.js confirm (manual) | helcim.pollTerminalResult | F2 verify-before-book (:999) | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Middleware suite (incl. all phase-45 regression tests) | `cd zoho-middleware && npm test` | 1122/1122 pass, 55 suites | ✓ PASS |
| Frontend suite | `npm test` | 931/931 pass, 50 suites | ✓ PASS |
| Lint | `npm run lint` | 0 errors (138 pre-existing warnings) | ✓ PASS |
| Live-card UAT (human checkpoint 45-09) | prod kiosk → Railway → Helcim terminal → Zoho | All 8 steps pass, evidenced (45-09-UAT-FINDINGS.md) | ✓ PASS (human, complete) |

### Requirements Coverage

| Requirement (AUDIT-2026-06-29) | Status | Evidence |
| ------------------------------ | ------ | -------- |
| CRITICAL auth-model exposure (D-01..D-05) | PASSED (override) | Phase 46 split, owner-approved; interim containment shipped |
| HIGH unguarded PII GETs (D-09) | ✓ SATISFIED | Truth 1 |
| HIGH fail-open under Redis outage (D-06/07/08) | ✓ SATISFIED | Truth 4 |
| HIGH kiosk money-path un-hardened re-impl (D-11/12) | ✓ SATISFIED | Truths 6, 7, 8 |
| HIGH terminal-timeout orphan charges (D-13) | ✓ SATISFIED | Truths 8, 9 |
| HIGH CI artifact drift (D-10) | ✓ SATISFIED | Truth 5 |
| Quick-win containments (D-15) + prod deploy (D-15/17) | ✓ SATISFIED | Truths 2, 3, 10 |
| Live UAT signoff (D-16) | ✓ SATISFIED | Truth 10 |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| (phase-modified files) | No TBD/FIXME/XXX debt markers | — | Clean (only a false-positive `INV-XXXXX` doc string in pos.js:2258) |

### Advisory Notes (non-blocking)

1. **Unresolved code-review warnings without a recorded disposition.** 45-REVIEW.md raised 2 blockers + 9 warnings + 2 info. Blockers CR-01/CR-02 and warnings WR-02/WR-03/WR-07 were fixed (FIX1/FIX2, verified in code). **WR-01, WR-04, WR-05, WR-06, WR-08, WR-09, IN-01, IN-02 remain unfixed** and have no explicit deferral record. Most map plausibly to the roadmap's out-of-scope deferrals (WR-08 `npm ci` = "dependency hygiene, phases 46+"; WR-04 legacy `/api/pos/sale` = Phase 42 de-fork territory), and WR-01/WR-09 are narrow residuals inside the now-closed fail-open finding (mid-op-error window while `connected` is stale-true, `server.js:335,353`; loopback/proxy assumption). None re-opens a phase success criterion, but recording their disposition (defer to 46+/42 or accept) would close the audit trail.
2. **GitHub issues #108/#109 (F4/F6 UX findings) could not be confirmed** — `gh` auth returned 401 in this environment. UAT findings doc records them as filed; non-blocking (UX follow-ups, not phase criteria).
3. **Residual risk, documented and owner-accepted:** the leaked `API_SECRET_KEY` remains valid until the Phase 46 cutover (D-04).

### Gaps Summary

No gaps. All in-scope CRITICAL/HIGH remediations exist in code at the claimed locations, are wired end-to-end, are covered by regression tests (suites re-run green during this verification), are deployed to production, and survived a live-card UAT with concrete transaction evidence. The single absent item (auth re-architecture D-01..D-05) is an owner-approved split to Phase 46, treated as PASSED (override) per the recorded decision.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
