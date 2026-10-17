# 86-19 Production Release Plan: Phase 86 code (sheets mode) + everything staged since 2026-10-16

**Prepared:** 2026-10-17, right after the Phase 85 recipes flip (D-12 is now met).
**Status:** PROPOSED. The owner chooses the go and the SHA.
**Scope:** 86-19 Task 1 only, i.e. getting the code onto production. The ops data cutover to dual (86-19 Task 2) is a separate after-hours step afterwards.

## 1. Why this is not a Phase-86-only release

Production (`ff3239cf`, tag `prod-20261016-3`) is a hand-built release branch: `d2c66be9` plus cherry-picks. `main` has moved on since then with the following work:

| Phase | What ships | Live behaviour on production after deploy |
|-------|-----------|--------------------------------------------|
| 86 | Vessel and schedule stores, Staff Access, ops mirror, `acting_user` attribution, migration **0004** | Dormant. `OPS_DATA_STORE` / `STAFF_ACCESS_STORE` stay unset, so sheets mode. The Vessels tab shows "available once vessels move to the database" and Staff Access stays hidden. Attribution goes live, as Apps Script v61+ already expects it. |
| 87 | Batch-store facade, backfill/verify/parity CLIs, migration **0005** (empty batch tables) | Dormant. `BATCHES_STORE` is unset, so sheets mode through the facade. Staging has run this in sheets mode against the shared workbook since 2026-10-09. |
| 89 | `beer_category`, migration **0006** | **Live**, because recipes are already on Postgres. The column starts null on production, so staff redo the D-06 picks. |
| 90 | BrewPad invoice linking, Unlinked chip and review queue, kiosk canning bundle, recipe pickers | **Live.** D-17 staging hardware session passed 2026-10-15. |
| 92 | Kiosk Past Sales (by customer, day ledger) plus review fixes CR-01 (PIN on both Customer View exits), WR-01..07 | **Live.** |
| 93 | Ledger Week/Month views | **Live.** Verified 8/8, staging UAT approved, security 27/27 closed. |

Splitting 86 out of this is not practical:
- 86 and 87 interleave in shared files (`routes/pos.js`, `server.js`, the batch proxy), and `0006` must follow `0004`/`0005`, because node-pg-migrate rejects out-of-order migrations.
- Every item above has run on staging.

**Recommendation:** release the whole staging-verified `main` in one go, with every new store flag left unset.

## 2. Pre-flight (checked 2026-10-17, no changes made)

| Check | Result |
|-------|--------|
| Migrations 0004 / 0005 / 0006 | Up sections are additive only: CREATE TABLE / SEQUENCE / INDEX, plus one `ADD COLUMN beer_category`. The DROPs appear only in the Down sections. |
| Required env vars on production | `APPS_SCRIPT_SERVER_TOKEN`, `APPS_SCRIPT_URL`, `KIOSK_CONTACT_ID` and `STAFF_EMAILS` are all present (names checked only). The only variables on staging but not production are `OPS_DATA_STORE`, `STAFF_ACCESS_STORE` and `SENTRY_ENVIRONMENT`, and all three are intentional. |
| `ZOHO_TAX_STANDARD_ID` (Phase 90 runsheet step 1) | Unset in **both** environments. `kiosk-bundles.js` falls back to the standard-rule catalog item, which works on staging, and the Zoho org is shared. |
| CSP | No `Content-Security-Policy` change in any HTML between production and staging. |
| Phase 91 | No commits on `main`, so nothing ships. |
| Apps Script | v65 live on the shared deployment. That covers the 86 (v61), 87 (v62) and 89 (v63/v65) actions, and production already runs against it. |
| Node | Production is on Node 24.21 (tz fix in place). |
| D-12 | Met. Production `RECIPES_STORE=postgres` since 2026-10-17 19:17Z, post-flip verify 0 mismatches. |
| 86-SECURITY.md | Signed by the owner 2026-10-08. |

**Owner to confirm before go:**
- [x] During the Phase 93 iPad UAT (2026-10-17), leaving Customer View asked for the staff PIN. This is Phase 92 CR-01. **Owner confirmed 2026-10-17.**
- [x] The production Vessels tab row 1 still has `label` to the right of `notes`. This is an 86-19 precondition. **Owner confirmed 2026-10-17.**

## 3. Release steps (after close, kiosk idle)

1. **Staging first (CLAUDE.md):** `git push origin main`. The delta over the current staging state is docs-only commits. Wait for the staging deploy and confirm `/health` is ok.
2. **Pick the SHA:** `RELEASE_SHA=$(git rev-parse origin/main)`. It must equal what staging runs.
3. **Promote:** `git push production $RELEASE_SHA:main --force`. Do **not** push a branch name: `gated-deploy.yml` is main-only. The gated-deploy workflow runs both suites, then deploys to Railway. The Railway pre-deploy guard chain applies `0004`, `0005` and `0006` in order.
4. **Tag:** `git tag prod-<date>-1 $RELEASE_SHA && git push production prod-<date>-1`.
5. **Record:** the SHA and Railway deployment id go into 86-DUAL-LOG.md under "Production prerequisites", and in RUNBOOK Phase 89 §3 step 7.

## 4. Post-deploy smoke (Claude, read-only, same night)

1. `/health`: `database:true`, `database_required:true`.
2. Startup `store modes` shows `{"GIFT_CARDS_STORE":"postgres","RECIPES_STORE":"postgres"}` and **nothing else**. Any OPS, STAFF or BATCHES key there means **roll back**.
3. The deploy log shows `0004_ops_data`, `0005_batches` and `0006_recipes_beer_category` applied.
4. Anonymous `/api/recipes?status=active` returns `source: postgres`, 11 recipes, each with a `beer_category` key (null).
5. `recipes-verify.js` from **main** against a fresh .xlsx returns 0 mismatches. This is now allowed: 0006 is applied, and v63+ added the sheet header.
6. The owner signs in to admin and BrewPad normally (staff allowlist still read from the Sheet). BrewPad batch list, vessel dropdowns and schedule dropdowns load.
7. Kiosk: catalog loads, and a recipe quote for SV-R-000016 at 28 L in-store is still $97.85. Past Sales opens, and the Day / Week / Month views load.
8. `beer.html` and the home page render; no console CSP errors.
9. Logs: no new error or warn lines beyond the known Resend verify message.

## 5. Rollback

- **Code:** in Railway, roll back to the current deployment `990f1764` (Phase 85 flipped, `RECIPES_STORE=postgres`).
- **Data:** the new tables and `recipes.beer_category` stay. They are additive and ignored by the old code, so no down-migration is needed.
- **Repo:** `git push production ff3239cf:main --force` restores the production repo to `prod-20261016-3`.

## 6. After the release (separate steps, not tonight)

- **Phase 89 release step:**
  - Remove the RUNBOOK Phase 85 §5 "D-14 script-source rule" callout and its pointers.
  - Staff redo the D-06 beer-category picks in production BrewPad (11 recipes). The production column starts null, because staging picks never reach production.
- **Phase 90:** staff work the BrewPad Unlinked queue on production (RUNBOOK Phase 90 §5 step 3). Known false positives to reject: SV-B-000222, SV-B-000035/63/64, SV-B-000067. SV-B-000230/231/233 are Internal.
- **86-19 Task 2, ops data to dual:** run after hours on a later evening. One production change per night.
  - Fresh-snapshot dry run with 0 rejects.
  - Promote.
  - Set `OPS_DATA_STORE=dual` and `STAFF_ACCESS_STORE=dual` together.
  - Verify 0 mismatches and staff `missingFromPg 0`.
  - Pre-open vessel edit mirror check.
  - Opening-day smoke.
  - The 86-20 window and flip follow, including the D-18 `staff_emails` probe before blanking.
- **Phase 87:** the production Sunday window stays gated on the Phase 86 flip.

## 7. Agreed schedule (owner, 2026-10-17)

The owner asked to combine this with Phase 87. The 87 code ships dormant in this release, but the batch data cutover stays a separate Sunday window. There are three reasons:
- The batch store refuses `postgres` unless vessels are PG-authoritative.
- D-18 `staff_emails` blanking at the 86 flip closes direct staff-OAuth Apps Script writes.
- One production change per night.

| Target | Step |
|--------|------|
| Sat 10-17 or Sun 10-18, after close | This release (86 + 87 code dormant, 89/90/92/93 live) |
| ~Mon 10-19, after hours | 86-19 Task 2: ops data to dual |
| Tue-Wed | Scripted 86 runsheet (vessel create/edit/archive, schedule edit, staff access add/remove, sign-in probe) and a mid-window verify |
| ~Thu 10-22, after hours | 86-20 flip to postgres, including the D-18 `staff_emails` probe and blanking |
| **Sun 10-25** | 87-19 production batch cutover window (gated on the 86 flip being recorded) |
