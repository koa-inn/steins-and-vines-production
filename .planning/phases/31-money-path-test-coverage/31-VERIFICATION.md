---
phase: 31-money-path-test-coverage
verified: 2026-06-17T21:00:00Z
status: human_needed
score: 5/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm the `payment_token` pre-charge void path (chargeAndProceed lines 843-943) is an acceptable gap for this phase"
    expected: "Developer acknowledges lines 843-943 are uncovered (zero test coverage for the live HelcimPay iframe payment flow's pre-validation void calls) and accepts this as a Phase 32 follow-on OR requests a test be added before proceeding"
    why_human: "WR-01 in the code review: every test uses `transaction_id` not `payment_token`. The SC-1 wording ('successful charge→Zoho-order path, void recovery when Zoho fails after charge') is ambiguous about whether the pre-charge validation void block (lines 843-943) must be exercised. The void recovery after Zoho failure IS covered via transaction_id. The pre-charge validation void logic (catalog unavailable, unknown item_id, missing Maker's Fee) is not covered. The reviewer considers this a WARNING not a blocker; the verifier surfaces it for human decision."
---

# Phase 31: Money-Path Test Coverage Verification Report

**Phase Goal:** The online checkout and Helcim integration are covered by honest, executable tests — so behavior-changing hardening in Phase 32 lands on a safety net, not on faith
**Verified:** 2026-06-17T21:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npm test` executes route-level tests for POST /api/checkout covering: success→Zoho-order, void recovery, void-failure alert, dual-cart reversal | VERIFIED | `cd zoho-middleware && npm test` exits 0; 35 suites, 689 passed, 4 todo; checkout-route.test.js: 9 passing + 2 todo; PATH-1 (201+salesorder_number), PATH-2 (voidTransaction called), PATH-3 (sendVoidFailureAlert called), PATH-4 (voidTransaction NOT called, payment_voided:false) confirmed in code and executed |
| 2 | Helcim HMAC webhook tests cover: valid sig accepted, tampered rejected, missing-secret behavior documented, base64 key decoding correct | VERIFIED | helcim-webhook.test.js exists, 261 lines, 6 passing + 2 todo; unit block asserts valid→true, tampered→false, missing-secret→true (honest), base64 decoding proven; route block asserts 200 {received:true} and 401 {error:'Invalid signature'} via supertest |
| 3 | `npm run test:coverage` reports coverage rows for routes/** files including checkout, payments, webhooks | VERIFIED | Full coverage run exits 0; routes/checkout.js (52.86% lines), routes/payments.js (37.20%), routes/webhooks.js (62.96%), lib/helcim.js (26.53%) all present in coverage table |
| 4 | Stale exclusions in jest.config.js are removed — coverage number is honest | VERIFIED | jest.config.js collectCoverageFrom: ['lib/**/*.js', 'routes/**/*.js'] — no !-prefix exclusions; D-08 explicitly verified and documented in a code comment |
| 5 | The suite uses supertest against the real exported app (not express mock, not direct handler) | VERIFIED | checkout-route.test.js line 82: `var app = require('../server')` + line 81: `var request = require('supertest')`. helcim-webhook.test.js line 212: `var app = require('../server')`. Neither file contains `jest.mock('express')` |
| 6 | The `payment_token` (chargeAndProceed) pre-charge validation block is covered by at least one test | UNCERTAIN | coverage table shows lines 843-943 as uncovered (explicitly in uncovered range for checkout.js). All four PATH tests use `transaction_id`, bypassing `chargeAndProceed()` validation logic. This is the HelcimPay iframe path used in production. See WR-01 in 31-REVIEW.md. The plan's D-10 characterization stance documents Phase 32 gaps via test.todo but did not call out this specific gap. |

**Score:** 5/6 truths verified (truth #6 is UNCERTAIN — human decision required)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/server.js` | Importable Express app + guarded listen | VERIFIED | `grep -c "require.main === module"` → 2 (1 guard + 1 comment); `grep -c "module.exports = app"` → 1; `node -e "require('./server')"` exits 0, returns function, no port binding |
| `zoho-middleware/package.json` | supertest dev dependency | VERIFIED | devDependencies.supertest = "^7.0.0"; installed version 7.2.2 confirmed |
| `zoho-middleware/jest.config.js` | Honest coverage glob + per-file thresholds | VERIFIED | collectCoverageFrom has both `lib/**/*.js` and `routes/**/*.js`; coverageThreshold: global {lines:62}, checkout {lines:52}, payments {lines:36}, webhooks {lines:62}, helcim {lines:25}, validate {lines:98}, logger {lines:98} |
| `zoho-middleware/__tests__/checkout-route.test.js` | supertest route tests for POST /api/checkout | VERIFIED | Exists, 328 lines (>120 min_lines); contains `require('supertest')` and `require('../server')`; no express mock |
| `zoho-middleware/__tests__/helcim-webhook.test.js` | Unit + route webhook tests | VERIFIED | Exists, 261 lines (>100 min_lines); contains `verifyWebhookSignature` (unit block) and supertest route block |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `checkout-route.test.js` | `server.js` | `require('../server')` | WIRED | Line 82: `var app = require('../server');` |
| `checkout-route.test.js` void-recovery test | `lib/helcim` voidTransaction | assert called with transaction_id | WIRED | Line 190: `expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-001')` |
| `checkout-route.test.js` alert test | `lib/mailer` sendVoidFailureAlert | assert called when void fails | WIRED | Lines 229-231: `expect(mailer.sendVoidFailureAlert).toHaveBeenCalled(); var alertArg = mailer.sendVoidFailureAlert.mock.calls[0][0]; expect(alertArg.txnId).toBe('txn-002')` |
| `helcim-webhook.test.js` unit block | `lib/helcim.js` verifyWebhookSignature | direct require + call | WIRED | describe block at line 32 calls `helcim.verifyWebhookSignature(...)` directly on re-required module |
| `helcim-webhook.test.js` route block | `routes/webhooks.js` POST /api/webhooks/terminal | supertest | WIRED | Line 225: `.post('/api/webhooks/terminal')` with mock returning true → 200; line 240: mock returning false → 401 |
| `jest.config.js` | routes coverage | collectCoverageFrom glob | WIRED | `routes/**/*.js` present in array; confirmed by actual coverage run showing route file rows |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces test files and configuration, not components that render dynamic data.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite executes and passes | `cd zoho-middleware && npm test --forceExit` | 35 suites, 689 passed, 4 todo, exit 0 | PASS |
| Coverage run exits 0 with thresholds met | `cd zoho-middleware && npm run test:coverage --forceExit` | exit 0; global 63.01% > floor 62; all per-file thresholds met | PASS |
| New test files pass in isolation | `npm test -- --testPathPattern="checkout-route|helcim-webhook"` | 2 suites, 15 passed, 4 todo (coverage thresholds fail in single-file mode — expected Jest behavior) | PASS (full suite) |
| server.js exports app without binding port | `node -e "require('./server')"` | exits 0, returns Express function, no listen | PASS |
| supertest resolves from node_modules | `node -e "require('supertest')"` | version 7.2.2 | PASS |

### Probe Execution

No probe scripts declared in PLAN files. Step 7c skipped — no `scripts/*/tests/probe-*.sh` found for Phase 31.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TEST-01 | 31-02-PLAN.md | Route-level tests for POST /api/checkout: charge→order, void recovery, void-failure alert, dual-cart reversal | SATISFIED | checkout-route.test.js: 4 describe blocks (PATH-1 through PATH-4); all assertions match implementation; suite green |
| TEST-02 | 31-03-PLAN.md | Helcim client + HMAC webhook verification tests: valid sig, tampered, missing-secret, base64 key | SATISFIED | helcim-webhook.test.js: Block A (4 unit cases) + Block B (2 route cases); valid→true/200, tampered→false/401, missing-secret→true (honest), base64 proven |
| TEST-03 | 31-01-PLAN.md + 31-04-PLAN.md | routes/** in coverage collection, stale exclusions removed, honest global threshold | SATISFIED | collectCoverageFrom includes routes/**/*.js; no !-prefix exclusions; global floor 62 <= measured 63.01; per-file floors on 4 money-path files |

No orphaned requirements — REQUIREMENTS.md maps TEST-01, TEST-02, TEST-03 to Phase 31 and no additional Phase 31 IDs appear in the file.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `__tests__/checkout-route.test.js` | 88, 122-124 | `process.env.RECAPTCHA_SECRET_KEY = ''` in file scope + beforeEach reset | Warning | Relies on empty-secret fail-open behavior and beforeEach reset to neutralize leakage from checkout.test.js. Fixed by 3087d66 post-merge; deterministic across runs. WR-03 in review. |
| `__tests__/checkout-route.test.js` | 228, 289, 317 | `setTimeout(resolve, 100)` for async side-effect assertions | Warning | Fixed-delay timing for fire-and-forget callbacks (sendVoidFailureAlert, voidTransaction). Functional but fragile under CI load. WR-04 in review. |
| `__tests__/checkout-route.test.js` | 157-165 | PATH-1 "voidTransaction NOT called" assertion | Warning | WR-02: fixture has no transaction_id, making voidTransaction structurally unreachable — assertion passes even if success logic breaks. Low impact (other tests cover void paths) but assertion is non-informative. |

No TBD/FIXME/XXX markers found in any Phase 31 modified files. No debt gate blockers.

### Human Verification Required

#### 1. payment_token Pre-Charge Validation Coverage (WR-01)

**Test:** Review `routes/checkout.js` lines 843-943 (`chargeAndProceed()` block) and the live frontend checkout flow in CLAUDE.md ("Checkout flow: Form submit → ... → open HelcimPay.js iframe → payment result via postMessage → submit order with `payment_token`"). Decide whether the absence of a test exercising this path is acceptable for Phase 31.

**Expected:** Developer accepts one of:
- (A) The gap is acceptable for Phase 31 because SC-1 requires "void recovery when Zoho fails after charge" which IS covered via `transaction_id`, and the pre-charge validation block (catalog empty, unknown item_id, missing Maker's Fee → void pre-charge) can be a Phase 32 addition alongside the hardening work; OR
- (B) A test is needed before proceeding: `test('voids payment_token when catalog unavailable', ...)` per the reviewer's example in WR-01

**Why human:** The ROADMAP SC-1 wording is satisfied by the existing tests (successful charge→Zoho-order and void recovery after Zoho failure are both covered). However the review flags that the live production path (HelcimPay iframe → `payment_token` → `chargeAndProceed` with pre-charge validation) has 0% coverage on lines 843-943 — the void-on-pre-validation-failure calls at lines 863, 884, 902, 910, 933. This is a judgment call about whether SC-1 intended to include this block. The phase context (D-10: characterization stance, green suite at end of Phase 31) suggests the executor made a reasonable scoping decision, but the reviewer flags it as the "largest money-path branch never exercised."

### Gaps Summary

No BLOCKER gaps found. One UNCERTAIN item requires human judgment:

**UNCERTAIN: `payment_token` path coverage (lines 843-943)** — The entire `chargeAndProceed()` pre-charge validation block is uncovered. All four checkout route tests use `transaction_id` which bypasses this block. This is the production path the frontend actually takes (HelcimPay iframe sends `payment_token`). The phase's D-10 characterization stance and the SC-1 wording do not explicitly require this block to be covered, but the code review (WR-01) identifies it as the most security-critical uncovered code. Decision needed: accept as deferred to Phase 32, or add before proceeding.

**Review warnings (non-blocking):**
- WR-02: PATH-1 "void NOT called" assertion is a tautology (void is structurally unreachable in that fixture)
- WR-03: env var leak mitigated by beforeEach but latent flakiness risk under worker reorder
- WR-04: setTimeout(100) for async assertions — not a synchronization guarantee
- WR-05: coverage thresholds at ~1pt headroom may cause brittle CI failures on unrelated refactors
- IN-01: jest.config.js comment says 63.04% but live run shows 63.01% (0.03pt doc drift)

---

_Verified: 2026-06-17T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
