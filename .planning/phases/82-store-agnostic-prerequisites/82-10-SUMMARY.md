---
phase: 82-store-agnostic-prerequisites
plan: 10
subsystem: deploy
tags: [production, cutover, gated-deploy, railway]
requires: [82-09]
provides: [phase-82-in-production]
affects: [83, 84, 85, 86, 87, 88]
key-files:
  created: [.planning/phases/82-store-agnostic-prerequisites/82-10-SUMMARY.md]
  modified: [zoho-middleware/package.json, zoho-middleware/package-lock.json]
status: complete
---

# Phase 82 Plan 10: Production Cutover Summary

**Phase 82 is live in production (2026-09-30).** Production browsers no longer call Apps Script /
Google Sheets directly for admin or public-batch data — DB-01 delivered.

## Deploy record

| Item | Value |
|------|-------|
| Gated Production Deploy run | [`36753725754`](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/36753725754) — success, 2026-09-30 17:45 UTC, reason "Phase 82 store-agnostic prerequisites" |
| Deployed SHA | `d581eb89` (production repo head `d83fe233` = same tree + CNAME commit) |
| Railway rollback target | **`1d502419-0741-4709-8f72-4686627512db`** (the deployment live before the cutover; owner-read from the Railway dashboard) |
| New Railway deployment id | Not captured — see "Deploy-ID capture race" below. Read from Railway → sv-middleware → svmiddleware-production → Deployments if needed |
| Apps Script | v58 (rollback v57), deployed 2026-09-24 — backward-compatible with the pre-82 site, so it can stay if the site is rolled back |
| Rollback path | Railway dashboard → roll back to `1d502419…`; site: `git push production <previous-sha>:main --force` (previous production site SHA `871da8d5`) |

### Two failed attempts first (no production change)

1. Run 1 (`36751685542`, `b8f8339f`) failed at **"Audit middleware dependencies"**
   (`npm audit --audit-level=high --omit=dev`): high advisories published after the staging walk for
   **axios** (7 GHSAs, <=1.19.0) and **nodemailer** (<=10.0.8). Tests/lint passed; `deploy` skipped.
2. Fixed on main and staged first: `52445def` removed **nodemailer** (unused — mail goes via Resend
   HTTPS, `lib/mailer.js`; nothing required it); `d581eb89` updated **axios 1.18.1 → 1.20.0**
   (in-range). Middleware 1705/1705, lint clean, audits 0. Pushed to staging; staging middleware
   redeployed and verified (Zoho `/api/products` 200; Apps Script round-trip via
   `/api/batch/public` returned a genuine `invalid_token`, not a 502).
3. Run 1 attempt 2 failed identically — GitHub **Re-run replays the original SHA** (`b8f8339f`), not
   main's head. A fresh "Run workflow" dispatch picked up `d581eb89` and succeeded.

## Post-cutover smoke (production, Claude-driven via Chrome, owner signed in)

| Check | Result | Evidence |
|-------|--------|----------|
| /health | ✓ | `status ok, authenticated true, redis true`, uptime 19 s (fresh restart — Zoho refresh token survived the restart; cf. the 2026-09-23 incident) |
| New code served | ✓ | `/js/admin.min.js?v=muemm0v4` contains `/api/admin/proxy`, no `sheets.googleapis.com/v4`; `MIDDLEWARE_URL` = production Railway |
| Admin dashboard loads, no direct Google data calls | ✓ | Batch tracker, summary chips, reservations rendered; no console errors. Resource timing: **0** calls to script.google.com / sheets.googleapis.com; data only via `svmiddleware-production…/api/admin/proxy`, `/api/orders/recent`, `/api/recipes`, `/api/kiosk/products`, `/api/kiosk/discounts` (+ expected GIS `userinfo` at sign-in) |
| One harmless write on a test record | **skipped (owner decision)** | The staging test batch had already been cleaned up. The write path is identical code already exercised on staging against the same (shared) Apps Script v58 |
| Public batch page for a real batch, read-only | ✓ | SV-B-000201 via the new route: `/api/batch/public/SV-B-000201` 200 `ok:true` (4 tasks); `batch.html` rendered tasks, readings form, location history. Nothing ticked |
| 429s | none observed | |

Incidental: while picking a batch, SV-B-000224 (pending, real customer) detail was opened by a
mis-click during a list re-render — view only, no change.

## Notes for later phases

- **7 → 3 deletion correction (D-02 / D-21).** D-02 corrected success criterion 2's "7" to 4, and
  D-21 then superseded that list: `get_config`, `update_schedule`, `update_kits` were deleted;
  `get_homepage` gained a caller and was kept. Net: 3 deletions, not 7.
- **Ingredients / Schedule / Homepage have no destination in Phases 83–88** (D-21) — milestone gap
  (see the v4.9 milestone note: Schedule/Homepage move to repo content).
- **`check_auth` kept** in `apps-script/adminApi.gs` (handler at the read dispatch) — no browser
  caller remains (only a comment in `js/brewpad.js`). Delete in a later phase once no old admin.js
  can be cached anywhere.
- **admin.html / batch.html have no CSP `<meta>`** (pre-existing; CLAUDE.md rule 12 covers public
  pages).
- **Admin writes are attributed to `'middleware'`** (shown as `kiosk-middleware`) — owner chose
  follow-up: `.planning/todos/pending/admin-write-attribution-kiosk-middleware.md` (candidate: pass
  the session email as `acting_user`).
- **Batch-token path does not check task → batch ownership** (Phase 87).
- **Spreadsheets OAuth scope still requested at admin login** (`js/sheets-config.js`) though the
  browser no longer calls Sheets — remove when convenient.
- **No 429s** observed on staging or production.
- **Deploy-ID capture race (new, workflow):** `gated-deploy.yml` step "Capture Railway deploy ID"
  runs `railway deployment list --limit 1` immediately after the force-push, before Railway creates
  the new deployment, so the RUNBOOK row for this deploy (`032fc577`) records the *previous*
  deployment `1d502419…`. The /health gate has the same timing hazard (can pass against the old
  instance). Fix: poll until the latest deployment's commit SHA matches the pushed SHA (and gate
  health on it).
- **Batch IDs are reused after deleting the newest batch** (`generateNextId` = max + 1): deleted
  test batch SV-B-000221 was re-issued to a real customer. Harmless (tokens differ) but worth
  knowing for audit/history joins.
- **Pre-existing Apps Script bugs fixed during the walk** (v58, `0d460a6e`, `ff1436b7`): public batch
  cache token binding; template propagate duplicates/mislabelling/cache eviction. Known limit: regular
  steps still match by step_number (delete/reorder of a middle step shifts task identity).
