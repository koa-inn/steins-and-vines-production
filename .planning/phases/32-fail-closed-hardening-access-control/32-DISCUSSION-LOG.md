# Phase 32: Fail-Closed Hardening & Access Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 32-fail-closed-hardening-access-control
**Areas discussed:** Production detection, NODE_ENV safety, PII GET-route auth, Body-shape validation, Misconfig handling

---

## Production detection (cross-cutting)

| Option | Description | Selected |
|--------|-------------|----------|
| Always fail closed | No env gating; secrets required everywhere + DEV_ALLOW_INSECURE escape hatch | |
| Gate on NODE_ENV | Fail closed only when NODE_ENV==='production' | ✓ |
| Explicit FAIL_CLOSED flag | Dedicated SECURITY_FAIL_CLOSED var | |

**User's choice:** Gate on NODE_ENV
**Notes:** Triggered a follow-up because NODE_ENV is not set in any deploy config. User asked whether Railway is shared between prod and staging — confirmed there is ONE shared middleware service (`svmiddleware-production.up.railway.app`), so NODE_ENV=production on it is unambiguous.

---

## NODE_ENV safety (de-risk follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Pin it + assert at boot | Set NODE_ENV=production in Railway + boot check refuses to start if looks-like-prod but NODE_ENV missing | ✓ |
| Default-prod, opt-out dev | Code assumes prod unless explicit dev flag set | |
| Trust Railway default | Rely on Nixpacks; document as checklist item | |

**User's choice:** Pin it + assert at boot
**Notes:** Adds one Railway-dashboard human action (set NODE_ENV=production), tracked like #96/#106. Boot assertion keys off a Railway-injected platform var (independent of NODE_ENV to avoid circularity).

---

## PII GET-route auth (PII-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted guard on the 4 routes | API-key required on /api/contacts, /api/invoices, /api/items/inspect, /api/snapshot only | ✓ |
| Invert default + allowlist | Require key on all GET /api by default, allowlist public routes | |

**User's choice:** Targeted 4 routes (reconfirmed after seeing the 34-route blast radius)
**Notes:** Initially leaned toward inverting; after enumerating that ~12+ public storefront/booking/kiosk GET routes call the middleware with no API key, switched to the targeted approach to satisfy the criterion with near-zero blast radius.

---

## Body-shape validation (PII-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Require key fields, inline | Per-route inline presence/type checks; extra fields pass through | |
| Strict whitelist via shared helper | lib/validate.js; unknown fields stripped, not forwarded | ✓ |
| Require fields inline + strip unknowns | Inline checks + per-route allowlist drop | |

**User's choice:** Strict whitelist via shared helper
**Notes:** Most defensive — Zoho only ever receives vetted fields. Helper must be ES5/vanilla (no new deps).

---

## Misconfig handling (HARDEN-04 + startup safety)

| Option | Description | Selected |
|--------|-------------|----------|
| Both: startup hard-fail + runtime reject | validateEnv refuses boot if prod secrets missing AND runtime gates fail closed | ✓ |
| Runtime reject only | Flip runtime behavior; validateEnv only warns | |
| Startup warn-loud, runtime reject | Runtime fails closed; validateEnv warns but boots | |

**User's choice:** Both — startup hard-fail + runtime reject
**Notes:** A missing secret breaks the deploy loudly instead of silently rejecting every customer. Defense in depth — runtime gates remain.

---

## Claude's Discretion

- Exact `lib/validate.js` API and per-route allowed-field lists.
- Exact error response bodies (status codes fixed by success criteria).
- Which Railway platform var to key the boot assertion on (RAILWAY_ENVIRONMENT vs RAILWAY_PROJECT_ID).
- Test file organization for converting Phase 31 `test.todo`/`skip` markers into real assertions.

## Deferred Ideas

- **Real staging middleware (+ sandbox Zoho/Helcim)** — Phase 33. Raised by user curiosity mid-discussion; modest Railway cost, real work is sandbox credentials + repointing staging frontend; automated promote-to-prod IS DEPLOY-01.
- **reCAPTCHA score-threshold gating** — out of scope (risk of rejecting legit customers); only unset/missing-token/network-error handling is in scope.
