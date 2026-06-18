# Phase 31: Money-Path Test Coverage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 31-money-path-test-coverage
**Areas discussed:** Route-test mechanism, Coverage config & threshold, HMAC/webhook test level, Test stance

---

## Route-test mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| supertest + export app | Add supertest, refactor server.js to export `app` (guard app.listen). Real HTTP path incl. middleware. | ✓ |
| Direct handler invocation | Export handler fn, call with mock req/res. No server change but skips middleware. | |
| Extend existing capture pattern | Keep mocking express, capture registered .post handler, invoke with fake req/res. | |

**User's choice:** "what do you think is best?" → Claude's discretion → **supertest + export app**
**Notes:** Decisive factor: Phase 32 hardens middleware (reCAPTCHA, referer/API-key guards, webhook signing); the two non-supertest approaches skip middleware and would give a false safety net.

---

## Coverage config & threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Money-path routes + honest global | Add checkout/payments/webhooks(+helcim) only; lower global; per-file thresholds. | |
| All routes/** + honest global | Full routes/** glob, no silent exclusion; global = honest measured number. | ✓ |
| All routes/**, keep threshold as ratchet | routes/**, per-file money-path floors, keep/raise global as ratchet. | partial |

**User's choice:** "I dont really know so whatever you think is best" → Claude's discretion → **all routes/** glob + honest global, plus per-file money-path floors** (combines B with C's per-file protection).
**Notes:** Success criterion 3 literally requires "no route file silently excluded," so full routes/** wins. Per-file thresholds on checkout/payments/webhooks/helcim protect the money path while global stays honestly low.

---

## HMAC / webhook test level

| Option | Description | Selected |
|--------|-------------|----------|
| Both lib + webhook route | Unit-test verifyWebhookSignature() AND route-level tampered-body rejection. | ✓ |
| lib function only | Test verifyWebhookSignature() directly for the 4 cases. | |

**User's choice:** "Same, your best discression" → Claude's discretion → **both levels** (route-level is nearly free once supertest is in place).
**Notes:** —

---

## Test stance (characterization vs aspirational)

| Option | Description | Selected |
|--------|-------------|----------|
| Characterization (green now) | Assert current behavior; suite fully green; Phase 32 edits tests when it changes behavior. | partial |
| Mix: green + red markers | Green characterization for 4 locked paths PLUS test.todo/skip markers for fail-open gaps. | ✓ |

**User's choice:** "I also dont really know the difference, so whatever you think is best" → Claude explained the distinction, then chose **mix** → green characterization for the locked paths + `test.todo`/`skip` markers documenting Phase 32 gaps.
**Notes:** Keeps suite green now while leaving Phase 32 an explicit in-suite checklist.

## Claude's Discretion

All four areas were explicitly delegated to Claude. The user is the visionary; for a test-infrastructure phase these are builder-level technical calls. Rationale recorded per-area above and locked in CONTEXT.md (D-01..D-10).

## Deferred Ideas

- `processCheckout()` decomposition — after this phase (REQUIREMENTS tech-debt note).
- Actual fail-closed hardening — Phase 32.
- CI test-gating of deploys — Phase 33.
