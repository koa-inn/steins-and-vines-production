---
phase: 100-limited-releases-page-and-online-deposits
plan: 14
subsystem: production launch
tags: [launch, production, deposits]
requires: [100-13, 100-15]
provides: [Limited Releases live on steinsandvines.ca with online deposits open]
key-files:
  modified: [23 public pages (nav), index.html (homepage banner), sitemap.xml, limited-releases.html (noindex removed), docs/RUNBOOK.md]
  deleted: [tests/frontend/limited-releases-holdback.test.js]
decisions:
  - "Owner chose free production checks instead of a real $50 production deposit (2026-10-30): 'Free checks, then launch'"
  - "Owner chose to push during opening hours ('Push now')"
metrics:
  completed: 2026-10-30
---

# Phase 100 Plan 14: Production launch — Summary

No "D-02 OPEN RISK" in 100-STAGING-RUN.md (brew day proven live on staging), so no extra sign-off was needed.

## Deploys
| Tag | SHA | Railway | What |
|---|---|---|---|
| prod-20261030-2 | `81293db8` | `a7966905` | Phase 100 code to production with deposits OFF (forced over the quota hotfix `6087783c`; same changes as originals on main) |
| prod-20261030-3 | `fac670b6` | `6aae93bd` | Launch commit (fast-forward) + `PREORDER_DEPOSITS_ENABLED=true` set on production |

## Real $50 production deposit — replaced by free checks (owner decision)
The owner asked whether a real production deposit was needed after the thorough staging run (same commit, same live
Zoho org and Helcim account). Agreed alternative: verify production-only configuration without moving money.
- Env names (no values) for every variable the deposit flow reads: present on production; only the kill switch differed.
- All 10 allowlisted kits resolve with rates 200–230; MAKERS-FEE `109900000000046478` (Makers Fee @45, active) and
  MAT-FEE `109900000000515004` (Materials Fee @5, active).
- Production Helcim token accepted `initializeCheckout` with `invoiceRequest.invoiceNumber` + lineItems (session only, no charge).
- reCAPTCHA site key on the page equals the live checkout key; CORS preflight and POST allow `https://steinsandvines.ca`.
**Residual risk (accepted):** the first real customer deposit is the first end-to-end production proof. Failure modes
are covered by auto-void + staff alert. Check the first deposit in Zoho when it lands.

## Launch commit `fac670b6`
Nav "Limited Releases" after Wine on 23 pages; homepage feature banner after the hero; sitemap entry; noindex removed;
hold-back test deleted; full build restamp; CSP unchanged. Gates: frontend 3301, middleware 3967, lint, e2e static
pages 12/12 (local serve).

## Post-launch smoke (2026-10-30 ~18:21 UTC)
`/health` ok, quota 763/1000; `/api/preorder/initialize` empty basket → 400 "Choose at least one kit" (open);
homepage contains the banner and links; limited-releases.html has no noindex; sitemap lists it.

## Rollback
Stop new deposits: unset `PREORDER_DEPOSITS_ENABLED` on production (in-flight payments still book or void).
Code rollback target: Railway `a7966905` / tag prod-20261030-2 (page unlinked, deposits off).

## Self-Check: PASSED
