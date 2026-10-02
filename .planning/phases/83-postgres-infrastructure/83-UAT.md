---
status: complete
phase: 83-postgres-infrastructure
source: [83-01-SUMMARY.md, 83-02-SUMMARY.md, 83-03-SUMMARY.md, 83-04-SUMMARY.md, 83-05-SUMMARY.md, 83-06-SUMMARY.md, 83-07-SUMMARY.md, 83-08-SUMMARY.md, 83-09-SUMMARY.md, 83-10-SUMMARY.md, 83-11-SUMMARY.md, 83-12-SUMMARY.md, 83-13-SUMMARY.md, 83-14-SUMMARY.md]
started: 2026-10-02T22:39:55Z
updated: 2026-10-02T22:41:50Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test (staging middleware)
expected: Open https://svmiddleware-staging.up.railway.app/health (the host the staging site actually calls; staging-api.steinsandvines.ca does not resolve). The page loads (JSON) and shows the database as connected (a "database" field that is true/ok), alongside the usual Zoho and Redis status.
result: pass — piloted in Chrome by Claude 2026-10-02: {"status":"ok","authenticated":true,"redis":true,"database":true}; fresh container (uptime ~30 min since the 22:10 UTC redeploy of d68fd4df).

### 2. Staging site works normally (stores still on Sheets)
expected: On the staging site, do one normal thing that touches the middleware — e.g. look up a gift card balance or open the product catalogue. It behaves exactly as before Phase 83: nothing has moved to Postgres yet (all stores still read from Sheets), so there should be no visible change and no errors.
result: pass — staging site is behind Cloudflare Access (Claude cannot sign in), so verified at the API it calls: staging /api/products HTTP 200 (250 items), /api/ingredients HTTP 200 (208 items); startup log shows store modes {"GIFT_CARDS_STORE":"sheets","RECIPES_STORE":"sheets"}. Owner may still eyeball the staging pages.

### 3. Production middleware healthy
expected: Open https://svmiddleware-production.up.railway.app/health (the host the live site calls). It loads and shows the database as connected — production has had Postgres with the empty schema since the 2026-10-02 Phase 83 deploy, and nothing about the live site changed.
result: pass — piloted in Chrome: production /health {"status":"ok","authenticated":true,"redis":true,"database":true}.

### 4. Backup visible in Cloudflare R2
expected: In Cloudflare → R2 → sv-pg-backups → Objects, open the production/ folder. There is a file named production-20261002T223253Z.pgcustom.age (about 4 KB). Downloading or opening it shows unreadable (encrypted) content, not SQL.
result: pass — piloted in Chrome: R2 sv-pg-backups/production/ lists production-20261002T223253Z.pgcustom.age, 4.05 KB, application/octet-stream, public access Disabled. Not downloaded; encryption proven by the restore drill, which required the age identity to decrypt it.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
