---
phase: 32
slug: fail-closed-hardening-access-control
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-17
---

# Phase 32 — Validation Strategy

> Per-phase validation contract. Retroactively reconstructed and audited after execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (node env) |
| **Config file** | `zoho-middleware/jest.config.js` |
| **Quick run command** | `cd zoho-middleware && npm test -- <file>` |
| **Full suite command** | `cd zoho-middleware && npm test` |
| **Estimated runtime** | ~4 seconds (38 suites, 775 tests) |

---

## Sampling Rate

- **After every task commit:** Run the scoped suite for the changed module
- **After every plan wave:** Run the full middleware suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 32-01 | 01 | 1 | HARDEN-01 | T-32-01/02 | Prod: unset/timeout reCAPTCHA → 4xx before charge | unit+route | `npm test -- checkout-route` | ✅ | ✅ green |
| 32-01 | 01 | 1 | HARDEN-03 | T-32-03/3b | Redis-down: transactionId → 409; idempotency-key → 409 (prod), fail-open (dev) | route+integration | `npm test -- checkout-route harden03-idem-redis-down` | ✅ | ✅ green |
| 32-02 | 02 | 1 | HARDEN-02 | T-32-05/06 | Prod: webhook with unset secret → verifier false → route 403, not processed | unit+route | `npm test -- helcim-webhook calcom-webhook` | ✅ | ✅ green |
| 32-03 | 03 | 1 | HARDEN-04 | T-32-09/10/11 | Boot: exit(1) on missing prod secret; RAILWAY_ENVIRONMENT asserts NODE_ENV=production; GP_* removed | unit | `npm test -- validateEnv` | ✅ | ✅ green |
| 32-04 | 04 | 1 | PII-01 | T-32-12/13 | 4 PII GET routes require x-api-key → 403 without it, Referer-independent; public GETs unaffected | route | `npm test -- pii-access` | ✅ | ✅ green |
| 32-04 | 04 | 1 | PII-02 | T-32-14/15 | POST/PUT items + POST taxes/apply reject missing/malformed body before Zoho | unit+route | `npm test -- validate pii-access` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing Jest infrastructure (from Phase 31) covers all phase requirements. No Wave 0 setup required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Railway service armed: `NODE_ENV=production` + 4 prod secrets set so the validateEnv boot gate boots green-and-armed | HARDEN-04 (T-32-09/10) | Railway dashboard config — no CLI/API automates the variable set; the boot gate is code-correct but runtime-unarmed until configured | See `32-HUMAN-UAT.md`: set NODE_ENV=production on svmiddleware-production, confirm RAILWAY_ENVIRONMENT present, confirm RECAPTCHA_SECRET_KEY / HELCIM_WEBHOOK_SECRET / CALCOM_WEBHOOK_SECRET / REDIS_ENCRYPTION_KEY all set before next deploy |

*All in-code behaviors have automated verification. The single manual item is a deploy-time ops configuration, not a code behavior.*

---

## Validation Audit 2026-06-17

| Metric | Count |
|--------|-------|
| Requirements audited | 6 |
| COVERED (pre-existing) | 5 |
| Gaps found | 1 (HARDEN-03 idempotency-key prod-409 path) |
| Gaps filled | 1 (`harden03-idem-redis-down.test.js`, +2 tests) |
| Escalated | 0 |

---

## Validation Sign-Off

- [x] All tasks have automated verify coverage
- [x] Sampling continuity: every requirement maps to a green suite
- [x] Wave 0 covers all MISSING references (none needed)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-17 (gsd-nyquist-auditor, all 6 requirements COVERED green)
