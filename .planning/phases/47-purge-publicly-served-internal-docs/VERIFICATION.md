---
phase: 47-purge-publicly-served-internal-docs
status: passed
verified: 2026-07-24
verifier: live HTTP checks against production (browser-UA curl)
requirements: [SEC-01]
---

# Verification: Phase 47 — Purge Publicly-Served Internal Docs

**Status: PASSED** — SEC-01 closed on both sites.

## Context

47-01-SUMMARY.md (2026-07-03) closed SEC-01 on staging with live verification, leaving one
open item: prod audit-doc removal "rides the next production deploy." Multiple prod deploys
have since shipped (`prod-20260716-1`, `prod-20260721-1`). This verification confirms the
strip is live on production.

## Evidence (2026-07-24, https://steinsandvines.ca)

| Path | Expected | Actual |
|---|---|---|
| `/.planning/STATE.md` | 404 | **404** ✅ |
| `/.planning/ROADMAP.md` | 404 | **404** ✅ |
| `/AUDIT-2026-06-29.md` | 404 | **404** ✅ |
| `/PROJECT_ASSESSMENT.md` | 404 | **404** ✅ |
| `/.well-known/security.txt` | 200 (must keep serving) | **200** ✅ |
| `/` (homepage renders) | 200 | **200** ✅ |

Staging: verified live 2026-07-03 (see 47-01-SUMMARY.md); staging is now additionally behind
Cloudflare Access, so nothing on it is publicly reachable regardless.

Note: Cloudflare returns 403 to bot-like user agents on all paths (curl default UA) — checks
must use a browser UA or the results are meaningless.

## Success criteria → outcome

1. Internal `.planning/` tree not publicly served (staging + prod) — **met**
2. Audit docs (`AUDIT-*.md`, `PROJECT_ASSESSMENT.md`) not publicly served — **met**
3. `.well-known/security.txt` still serves; raw (no-Jekyll) serving preserved; site renders — **met**
