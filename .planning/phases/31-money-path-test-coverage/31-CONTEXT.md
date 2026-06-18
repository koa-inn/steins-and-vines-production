# Phase 31: Money-Path Test Coverage - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Add honest, executable tests for the online checkout and Helcim integration so that Phase 32's behavior-changing hardening lands on a verified safety net.

**In scope:**
- Route-level tests for `POST /api/checkout` covering the four locked paths: successful charge→Zoho-order, void recovery when Zoho fails after charge, void-failure alert emission, dual-cart shared-charge reversal (TEST-01).
- Tests for the Helcim client and HMAC webhook verification: valid signature accepted, tampered body rejected, missing-secret fails closed, base64 key decoding correct (TEST-02).
- Coverage config changes so `routes/**` is reported honestly and stale exclusions are removed (TEST-03).

**Out of scope (carried forward / deferred):**
- Decomposing the 774-line `processCheckout()` into staged helpers — REQUIREMENTS.md explicitly defers this to *after* TEST-01 provides the safety net. This phase tests `processCheckout()` as-is (black box through the route).
- The actual hardening behavior changes (reCAPTCHA/webhook fail-closed, replay-guard 409, PII route auth) — those are Phase 32. Phase 31 only documents those gaps via test markers.
</domain>

<decisions>
## Implementation Decisions

All four gray areas were delegated to Claude's discretion. Decisions below are locked.

### Route-test mechanism (TEST-01)
- **D-01:** Use **supertest against the real exported Express app**, not direct-handler invocation or the existing express-mock capture pattern. Rationale: Phase 32 hardens *middleware* (reCAPTCHA gate, referer/API-key guards, webhook signing). Both alternative approaches skip middleware — exactly where Phase 32's changes live — so they would give a false safety net. supertest exercises the real wired path.
- **D-02:** Refactor `server.js` to make `app` importable: guard `app.listen(...)` behind a `require.main === module` check (or equivalent) and `module.exports = app`. This is the minimal change required; do not otherwise restructure server.js.
- **D-03:** Add `supertest` as a dev dependency in `zoho-middleware/package.json`.
- **D-04:** Reuse the existing mock harness from `__tests__/checkout.test.js` (jest.mock for `lib/zoho-api`, `lib/cache`, `lib/mailer`, `lib/helcim`, `https`/`axios`) so external services stay stubbed while the route + middleware run for real.

### Coverage config & threshold (TEST-03)
- **D-05:** Expand `collectCoverageFrom` to include the full `routes/**/*.js` glob so no route file is silently excluded (satisfies success criterion 3 literally). Keep `lib/**/*.js`.
- **D-06:** Measure the honest post-change global coverage number and set the global `coverageThreshold.lines` just below it (no inflation, no silent exclusion to prop up the number).
- **D-07:** Add stricter per-file thresholds on the money-path files — `routes/checkout.js`, `routes/payments.js`, `routes/webhooks.js`, `lib/helcim.js` — so the money path cannot regress even as the global stays low.
- **D-08:** Remove any stale exclusions (e.g. `!lib/mailer.js`) so the reported number is honest. NOTE: the current `jest.config.js` shows `collectCoverageFrom: ['lib/**/*.js']` with no visible `!lib/mailer.js` exclusion — researcher/planner must confirm where stale exclusions actually live (config may have drifted from the memory note) and remove whatever is found.

### HMAC / webhook test level (TEST-02)
- **D-09:** Test at **both levels**: (a) unit-test `verifyWebhookSignature()` in `lib/helcim.js` directly for the four cases (valid, tampered, missing-secret→fails closed, base64 key decoding); (b) test `routes/webhooks.js` end-to-end via supertest so a tampered body is actually rejected at the route. Route-level is nearly free once supertest is in place.

### Test stance (characterization vs aspirational)
- **D-10:** Use a **mix**: green characterization tests for the four locked checkout paths (suite is fully green at end of Phase 31), PLUS `test.todo`/`describe.skip` markers documenting the known fail-open gaps that Phase 32 will close (unauthenticated checkout, unsigned webhook accepted, duplicate charge when Redis down). This keeps the suite passing now while leaving Phase 32 an explicit, in-suite checklist.

### Claude's Discretion
- Exact test file organization (extend `checkout.test.js` vs new `checkout-route.test.js` / `helcim-webhook.test.js`), fixture shapes, and the precise honest threshold number are left to the planner/executor.
- Whether webhook route tests live in a new file or extend an existing one.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 31: Money-Path Test Coverage" — goal + 4 success criteria (the literal acceptance gates).
- `.planning/REQUIREMENTS.md` — TEST-01, TEST-02, TEST-03 wording; also the deferral note ("Decompose processCheckout() ... do after TEST-01").

### Code under test
- `zoho-middleware/routes/checkout.js` — `POST /api/checkout`, `processCheckout()` (~774 lines), void recovery + void-failure alert logic.
- `zoho-middleware/routes/payments.js` — `handlePaymentInitialize` (`/api/payment/initialize`).
- `zoho-middleware/routes/webhooks.js:33` — webhook route reading `webhook-signature` header.
- `zoho-middleware/lib/helcim.js:309` — `verifyWebhookSignature(webhookId, timestamp, rawBody, signature)`; HMAC-SHA256, base64 key, `crypto.timingSafeEqual`.
- `zoho-middleware/lib/checkout-helpers.js` — already-tested helpers (verifyRecaptcha, buildLineItems, buildContactPayload, findMakersFeeItem, findMaterialsFeeItem).
- `zoho-middleware/server.js:33` (`var app = express()`) and `:434` (`app.listen`) — refactor target for D-02.

### Test infrastructure
- `zoho-middleware/jest.config.js` — coverage config to change (D-05..D-08).
- `zoho-middleware/__tests__/checkout.test.js` — existing mock harness + patterns to reuse (D-04).
- `zoho-middleware/__tests__/calcom-webhook.test.js` — existing HMAC webhook test for reference (`lib/calcom.js` uses the same `createHmac`/`timingSafeEqual` pattern).
- `TESTING.md` (repo root) — testing SOP and campaign tracker; module-export pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `__tests__/checkout.test.js` mock harness (jest.mock of zoho-api, cache, mailer, helcim, https/axios) — extend for route-level tests rather than re-inventing stubs.
- `__tests__/calcom-webhook.test.js` — direct analog for HMAC signature testing (valid/tampered/missing-secret).
- `crypto.timingSafeEqual` + base64 pattern already used in both `lib/helcim.js` and `lib/calcom.js`.

### Established Patterns
- ES5 style (`var`, `function`), Jest node env, tests in `__tests__/**/*.test.js`.
- Current `checkout.test.js` mocks Express entirely — this phase deliberately moves to a real-app/supertest approach for the route (the mock-everything pattern is the gap being fixed).

### Integration Points
- `server.js` must export `app` for supertest; `app.listen` guarded so importing the app in tests does not bind a port.
- External services (Zoho, Helcim API, Redis cache, mailer) stay mocked; middleware (rate-limit, referer guard, body parsing) runs for real under supertest.

</code_context>

<specifics>
## Specific Ideas

- "Honest coverage" is a hard requirement — no silent route exclusions, no threshold inflation. The number reported must reflect reality even if it's low.
- Tests must be green at end of Phase 31 (characterization stance), with Phase 32 gaps left as `test.todo`/`skip` markers rather than red failures.
</specifics>

<deferred>
## Deferred Ideas

- **`processCheckout()` decomposition into staged helpers** — REQUIREMENTS.md tech-debt note; do after this phase's safety net exists. Not Phase 31.
- **Actual fail-closed hardening** (reCAPTCHA gate, unsigned-webhook rejection, replay-guard 409, PII route API-key enforcement) — Phase 32 (HARDEN-01..04, PII-01..02). Phase 31 only marks these as `test.todo`.
- **CI test-gating of deploys** — Phase 33 (DEPLOY-01).

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 31-money-path-test-coverage*
*Context gathered: 2026-06-16*
