---
phase: 32
slug: fail-closed-hardening-access-control
status: secure
threats_open: 0
threats_closed: 17
asvs_level: 1
created: 2026-06-17
---

# Phase 32 — Security

> Per-phase security verification. The full threat-by-threat audit (with file:line
> evidence) lives in the project's living security doc at the repo root:
> **`SECURITY.md` → "Phase 32 Security Audit — Fail-Closed Hardening & Access Control"**.
> This file is the GSD per-phase index; the root doc is the source of truth.

## Result

**SECURED — 17/17 threats CLOSED, `threats_open: 0`** (verified by `gsd-security-auditor`, ASVS L1, 2026-06-17).

All `mitigate` dispositions are code-backed; `accept`/`n/a` dispositions are documented in the
root doc's "Accepted Risks — Phase 32" table.

## Threat Register Summary

| Threat ID | Category | Disposition | Status |
|-----------|----------|-------------|--------|
| T-32-01 | Spoofing (reCAPTCHA fail-closed) | mitigate | CLOSED |
| T-32-02 | Elevation/Repudiation (bot checkout, defense-in-depth) | mitigate | CLOSED |
| T-32-03 | Tampering (transactionId replay 409) | mitigate | CLOSED |
| T-32-04 | DoS (Redis-flap false positive) | accept | CLOSED |
| T-32-3b | Tampering (idempotency-key 409) | mitigate | CLOSED |
| T-32-05 | Spoofing (Helcim webhook fail-closed 403) | mitigate | CLOSED |
| T-32-06 | Spoofing (Cal.com webhook fail-closed 403) | mitigate | CLOSED |
| T-32-07 | Tampering (webhook replay w/ valid HMAC) | accept | CLOSED |
| T-32-08 | DoS (runtime reject on unset secret) | accept | CLOSED |
| T-32-09 | Tampering/EoP (NODE_ENV unset boot assertion) | mitigate | CLOSED |
| T-32-10 | Info disclosure (missing prod secret boot gate) | mitigate | CLOSED |
| T-32-11 | Repudiation (dead GP_* removed) | mitigate | CLOSED |
| T-32-12 | Info disclosure (PII GET-route API-key guard) | mitigate | CLOSED |
| T-32-13 | DoS (over-broad guard) | mitigate | CLOSED |
| T-32-14 | Tampering (item body field-smuggling) | mitigate | CLOSED |
| T-32-15 | Tampering (taxes/apply malformed body) | mitigate | CLOSED |
| T-32-16 | Tampering (validate.js export clobber) | accept | CLOSED |
| T-32-SC | Tampering (supply chain) | n/a | CLOSED |

## Notes

- **CR-02 strengthening:** the code-review timing-oracle fix (commit `791d287`, constant-time
  `apiKeyMatches`) was verified present and strengthens T-32-12 beyond the plan's original mitigation.
- **Human-action gate (T-32-09 / T-32-10):** the boot assertions in `lib/validateEnv.js` are
  code-correct but **runtime-unarmed** until the Railway middleware service is configured with
  `NODE_ENV=production` and all four prod secrets (Plan 32-03 Task 3, tracked in `32-HUMAN-UAT.md`).
  This is an operational gap, not an implementation gap.
