# Requirements: v4.2 Payment Path Hardening & Deploy Safety

**Milestone goal:** Make the money path trustworthy — test the online checkout, close the fail-open security gaps, and stop unsafe/untested code from reaching production.

**Source:** `PROJECT_ASSESSMENT.md` (Priority Action Items + Week 1 / Weeks 2–4 roadmap).

---

## v4.2 Requirements

### Deploy Safety

- [x] **DEPLOY-01**: Production deploys are gated on the test suite — failing tests block the deploy (frontend + middleware).
- [x] **DEPLOY-02**: Every production deploy is tagged (`prod-YYYYMMDD-N` or similar) and a written rollback runbook pairs the git SHA with the Railway deploy.
- [x] **DEPLOY-03**: The nightly Zoho snapshot reaches the live production site (resolve the `[skip ci]` + force-push interaction that leaves the static fallback stale).

### Monitoring

- [x] **MONITOR-01**: An external uptime monitor polls the middleware `/health` endpoint and alerts on downtime, `authenticated:false`, or `redis:false`.
- [x] **MONITOR-02**: Required production secrets (`HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, `SENTRY_DSN`) are verified present in Railway, and their absence fails closed (not silently) in production.

### Test the Money

- [x] **TEST-01**: Route-level tests cover `POST /api/checkout` — charge→order→void recovery, void-failure alert, and dual-cart shared-charge reversal.
- [x] **TEST-02**: The Helcim client and terminal/webhook HMAC verification are covered by tests (valid signature, tampered body, missing-secret behavior, base64 key).
- [x] **TEST-03**: Coverage collection includes `routes/**` (honest number reported) and stale exclusions (e.g. `!lib/mailer.js`) are removed.

### Fail-Closed Hardening

- [x] **HARDEN-01**: reCAPTCHA verification fails **closed** for unauthenticated callers on `POST /api/checkout` in production (unset key or network error → reject, not proceed).
- [x] **HARDEN-02**: Helcim and Cal.com webhooks reject events when their signing secret is unset in production (no fail-open acceptance of unsigned events).
- [x] **HARDEN-03**: The replay/idempotency guard returns 409 (fails closed) when Redis is unavailable, preventing duplicate Zoho orders for a single charge.
- [x] **HARDEN-04**: `validateEnv.js` validates the live Helcim/Cal.com/`REDIS_ENCRYPTION_KEY` variables and no longer checks dead Global Payments vars.

### Access Control

- [x] **PII-01**: PII-exposing GET routes (`/api/contacts`, `/api/invoices`, `/api/items/inspect`, `/api/snapshot`) require the API key (no Referer-skip bypass).
- [x] **PII-02**: Mutating item/tax routes (`/api/items` POST/PUT, `/api/taxes/apply`, `upload-catalog`) validate request body shape instead of forwarding raw `req.body` to Zoho.

---

## Future Requirements (deferred to a later milestone)

- Decompose `processCheckout()` (774 lines) into testable staged helpers — do after TEST-01 provides the safety net.
- De-fork the kiosk POS (`admin.js` ↔ `kiosk.js`, 34 duplicated functions) into a shared `kiosk-core.js`.
- `window.SV` namespace + break the `11-cart.js` ↔ `12-checkout.js` circular dependency.
- Static product rendering + `Product` JSON-LD at build time (catalog currently invisible to crawlers).
- Facility/about image pipeline (webp + srcset); Sentry defer/lazy-load.
- Cart-identity SKU migration (fixes search-overlay duplicate cart lines).
- Accessible dialogs (cart drawer, min-qty overlay) + tabs/FAQ ARIA.
- Docs refresh: README, CLAUDE.md, openapi.yaml regeneration, `.env.example`, CHANGELOG.

## Out of Scope (this milestone)

- **Redis AOF persistence (#96)** — RDB snapshots already persist to the mounted `/data` volume (verified 2026-06-16); AOF would only shrink the loss window from ~60s to ~1s, negligible for a rarely-changing refresh token. The double-charge risk is addressed by HARDEN-03 (replay guard fail-closed), not AOF.
- Breakpoint consolidation / spacing-type design tokens — opportunistic CSS work, not payment-path risk.
- Apps Script monolith split — separate from the money-path/deploy focus.

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| DEPLOY-01 | Phase 33 | Complete |
| DEPLOY-02 | Phase 33 | Complete |
| DEPLOY-03 | Phase 33 | Complete |
| MONITOR-01 | Phase 33 | Complete |
| MONITOR-02 | Phase 33 | Complete |
| TEST-01 | Phase 31 | Complete |
| TEST-02 | Phase 31 | Complete |
| TEST-03 | Phase 31 | Complete |
| HARDEN-01 | Phase 32 | Complete |
| HARDEN-02 | Phase 32 | Complete |
| HARDEN-03 | Phase 32 | Complete |
| HARDEN-04 | Phase 32 | Complete |
| PII-01 | Phase 32 | Complete |
| PII-02 | Phase 32 | Complete |
