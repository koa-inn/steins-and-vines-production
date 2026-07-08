---
phase: 54
slug: gift-card-management-on-the-kiosk-surface
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-08
---

# Phase 54 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Gift-card management (lookup + void) on the staff-only kiosk surface; backend
> widens the kiosk device-token scope to include the money-destroying void
> (D-54-GC, supersedes D-46-02/T-46-07).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| kiosk iPad → prod middleware | bare `x-device-token` crosses here; now authorized for `POST /api/kiosk/gift-card/void` | cert number, void reason (staff-entered) |
| other clients → middleware | device token must remain REJECTED on PII / BrewPad / admin routes (scope widening is void-only) | — |
| kiosk browser fetch → middleware | new `kgcm-` panel fetches must carry the injected device-token, not a hard-coded cookie flag | device-token header |
| untrusted lookup/void response → DOM | cert #, status, balance echoed into `innerHTML` | Apps Script gift-card record |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-54-01 | Elevation of Privilege | `KIOSK_ROUTES` + `POST /api/kiosk/gift-card/void`, panel entry | accept | Owner-accepted (D-54-GC). Void is status-only (no cash / no Zoho money movement); non-empty `reason` enforced server-side (400 if empty, `routes/gift-cards.js`); every void logged via `eventLog.logEvent('kiosk.gift_card_voided', …)`; destructive action gated by two-step lookup→Void→reason→Confirm ("cannot be undone"). Manager-PIN + gated placement consciously declined (D-54-01 placement waived, see 54-VERIFICATION.md override). | closed (accepted) |
| T-54-02 | Elevation of Privilege | scope-widening blast radius (`authTiers.js`) | mitigate | ONLY the explicit literal `/api/kiosk/gift-card/void` added to `KIOSK_ROUTES` — NOT an `/api/kiosk/*` prefix (T-46-07). `isKioskRoute()` stays exact-membership (body byte-unchanged). Device→403 negatives preserved + asserted for PII GET `/api/contacts`, BrewPad GET `/api/batch/search-invoices`, admin GET `/api/orders/recent`. Verified live by gsd-verifier against real code. | closed |
| T-54-03 | Spoofing / Tampering | `kgcm-` panel fetch calls (`kiosk-core.js`) | mitigate | Both lookup GET and void POST route through `_kcMergeAuth()` → `buildAuthOptions()` → `x-device-token` on the kiosk surface. Hard-coded `credentials:'include'` (admin-only bug pattern) confirmed absent from the new code and asserted by `tests/frontend/kiosk-gift-card-mgmt.test.js`. | closed |
| T-54-04 | Information Disclosure / XSS | result-card + label rendering (`kiosk-core.js`) | mitigate | Verified: the only `innerHTML` write escapes both dynamic strings — `escapeHTML(_mgmtCert)`, `escapeHTML(statusStr)` — and renders numeric balances via `kioskFmt()`; all other dynamic values (error messages, button/confirm labels) use `textContent`. Matches the file's existing escapeHTML convention. | closed |
| T-54-SC | Tampering (supply chain) | npm/pip installs | accept | No new packages installed this phase — only `npm run build` on existing tooling. Supply-chain surface unchanged. | closed (accepted) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-54-01 | T-54-01 | Widening the kiosk device token to void gift certs is a conscious blast-radius increase (D-54-GC, supersedes D-46-02/T-46-07). Residual risk: a leaked/stolen iPad token could void a cert. Bounded by: status-only (no cash movement), server-enforced non-empty reason, event logging, and a multi-step confirm. Owner runs everything from the kiosk (staff-only). | Owner (koainn) | 2026-07-08 |
| R-54-02 | T-54-01 | Entry button placed on the always-visible kiosk shell bar rather than a gated settings area (D-54-01 placement clause waived). Panel-open is a harmless lookup; destructive void stays multi-step gated. | Owner (koainn) | 2026-07-08 |
| R-54-03 | T-54-SC | No new dependencies — nothing to review. | Owner (koainn) | 2026-07-08 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-08 | 5 | 5 | 0 | Claude (orchestrated secure-phase; register plan-authored, mitigations verified against code + passing suites) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-08
