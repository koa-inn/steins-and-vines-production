# Phase 85 — Recipes Dual-Window Log

Owner-maintained log for the `RECIPES_STORE=dual` window (D-01/D-02/D-05/D-07). See
`docs/RUNBOOK.md` § "Recipes → Postgres (Phase 85)" for the full procedure this log supports.
No secrets, no names, no recipe values: recipe ids, ingredient ids and classifications only.

## Header

| Field | Value |
|-------|-------|
| Environment | production |
| `RECIPES_STORE=dual` set at | 2026-10-16 20:46:28Z (production) |
| Window day 1 date | 2026-10-16 |
| Current window start (resets to day 1 on any bug-classified discrepancy) | 2026-10-16 (no restarts) |

## Op-coverage table

One row per op. "First seen at" is the first time the op ran (real traffic or the RUNBOOK §7
scripted test-recipe runsheet) during the CURRENT window. "Sentry clean?" is yes only if zero
unexplained discrepancies were raised for that op during the current window.

| Op | First seen at | Real or scripted | Sentry clean? |
|----|----------------|-------------------|----------------|
| create | 2026-10-17 19:05:01Z (SV-R-000017 draft) | scripted | yes |
| edit with ingredient change | 2026-10-17 19:05:52Z (qty 1 to 2, PUT 299 ms) | scripted | yes |
| delete | 2026-10-17 19:13:16Z (DELETE 200, then 404; deleted, not deactivated, after the test batch was removed) | scripted | yes |
| kiosk recipe sale | 2026-10-17 19:09:09Z (INV-000246, Helcim txn 56748989, $2.34) | scripted on the real kiosk | yes |
| public list / detail | 2026-10-17 ~19:06Z (list source postgres incl. test recipe; detail 200; card on beer.html) | scripted (real list reads also seen) | yes |
| rename < 2 s (SC4 stopwatch) | 2026-10-17 19:06:04Z (PUT 274 ms) | scripted | yes |

## Discrepancy table

One row per Sentry `[dual-write] recipes.*` event, `recipes-mirror` error or manually found
`recipes-verify.js` mismatch. Every row must be classified before the flip bar can be met.

| Date/time | Sentry link | Op | Recipe id | Classification (explained/bug) | Root cause | Fix commit | Window restarted? |
|-----------|--------------|----|-----------|----------------------------------|-------------|-------------|--------------------|
| | | | | | | | |

## D-05 compare coverage

One row per window day. Counts come from Railway logs: `[dual-price] compared` and
`[dual-price] skip` lines (split by `reason=settle` / `reason=dirty`), or the latest running
totals.

| Date | compared | skipped settle | skipped dirty | sheet fetch failures | `recipes-dual-price` stale-dirty warnings | notes |
|------|----------|----------------|---------------|----------------------|--------------------------------------------|-------|
| 2026-10-16 | 0 | 0 | 0 | 1 | 0 | One cold-start quote at 20:49Z (SV-R-000016): sheet read timeout 15 s, observe-only, no price impact |
| 2026-10-17 | 6 | 3 | 0 | 0 | 0 | All from the runsheet: 2 quote + 4 sale compares on SV-R-000017, all matched; 3 quote skips within 60 s of an edit (explained, RUNBOOK §12) |

## Explained differences (known up front)

Copy of RUNBOOK §12.

- A missing recipe detail returns 404 in Postgres modes (Sheets returned 200 with an error object).
- Postgres serves current data where Sheets could serve up to 300 s stale.
- Ids are never reused after deleting the highest id.
- SV-R-000001 sorts last after its cell fix.
- Invalid status / NaN numerics now return 422 instead of being stored.
- Invalid ingredients JSON writes nothing (Sheets wrote the row fields first).
- D-05 skips within 60 s of an edit are logged, not compared.
- Delete TOCTOU: a batch created between the `recipe_batch_ref_count` check and the Postgres delete
  is not seen; the batch keeps a dangling `recipe_id` until Phase 87 (log as explained).

## Flip-decision block

Filled in once the flip bar (at least 7 consecutive days, all ops in the Op-coverage table
observed, zero unexplained discrepancies) is met and the owner decides to flip to `postgres`.

| Field | Value |
|-------|-------|
| Owner | |
| Date | |
| Decision | |

## Staging rehearsal

- 2026-10-07: staging push `57a44b84` (`git push origin main`); staging `/health` `database:true`.
- 2026-10-07: Apps Script deployed as version 60 (rollback 59) on deployment `…DI968g`. Pre-paste
  drift hash matched the pre-Phase-85 repo file; post-paste hash matched `apps-script/adminApi.gs`.
  `GET /api/recipes` 200 with 3 active recipes on production and staging afterwards.
- 2026-10-07: owner fixed SV-R-000001 (`created_at` / `created_by` swap) in the live Recipes tab.
- 2026-10-07 19:29Z: dry run on fresh snapshot: 10 recipe rows, 117 ingredient rows read;
  plan 10 recipes / 117 ingredients; sequence seeds recipe 13, ingredient 184; **0 rejects**.
- 2026-10-07 19:34Z: staging promote (owner terminal, tunnel): 0 rejects, **promoted 10 recipes,
  117 ingredients; sequences at 13 / 184**.
- 2026-10-07: `recipes-verify.js` on the same snapshot: **verified 10 recipes, 0 mismatches**.
- 2026-10-07 19:37Z: **staging `RECIPES_STORE=dual` started** (Railway CLI, staging `sv_middleware` only).
  `/health` `database_required:true`; startup log `store modes: {GIFT_CARDS_STORE:dual, RECIPES_STORE:dual}`
  and `Recipe mirror sweep registered: every 5 minutes`.
- 2026-10-07: T-85-63 ordering: GitHub Actions "Deploy Staging (filtered)" for `57a44b84` (contains the
  `stale_recipe` / `expected_updated_at` editor bundles) completed success 19:18Z, before dual at 19:37Z.
- 2026-10-07: API parity, staging (dual, `source: postgres`) vs production (sheets, `source: apps-script`):
  `GET /api/recipes` same 3 ids, 0 differing fields per recipe; `GET /api/recipes/SV-R-000011` 0 differing fields.

### Staging UAT (85-12 Task 3), 2026-10-07, driven in Chrome by Claude with owner sign-ins

| Step | Result | Evidence |
|------|--------|----------|
| 3. Runsheet create / activate / ingredient change / rename | PASS | SV-R-000014 created; activate PUT 200 310 ms; ingredient 4 to 5 kg PUT 200 301 ms (token sent); **rename PUT 200 332 ms** |
| 1. Admin two-tab D-03 | PASS | Tab A save 200; tab B stale save showed "This recipe was changed since you opened it, reload to see the latest" + Reload; Reload showed tab A's value; API stored tab A's value only |
| 2. BrewPad D-03 (desktop Chrome, owner-approved substitute for the iPad) | PASS | BrewPad created SV-R-000015 (POST 201); admin saved a change; BrewPad stale save PUT 409 `stale_recipe` with token, single request (no auto-retry), message offered Reload and no Retry, draft kept in sessionStorage; Reload showed admin's value. Restored draft after re-login also 409s (server treats a missing/old token as stale). Test recipe deleted (DELETE 200 3.7 s, then 404). iPad Safari cookie path remains the separate Phase 76 check |
| 2b. Kiosk quick-edit | NOT RUNNABLE | Admin's kiosk recipe prompt is kiosk-core's (no Edit Recipe button); admin's quick-edit prompt is reachable only via a test hook. Pre-existing (not Phase 85); 85-09 quick-edit token logic covered by unit tests only |
| 4. Public beer page | PASS | Test recipe card shown; ready times "about 3 weeks" / "about 5 weeks" on scheduled recipes; no separate detail page; `GET /api/recipes/:id` identical to production earlier |
| 5. Kiosk quotes vs production | PASS | 8/8 identical totals and ingredient lines (SV-R-000003, SV-R-000002 x 23/46 L x in-store/take-out) |
| 6. Delete test recipe | PASS (deleted, not deactivated) | DELETE 200 4.66 s (token sent); API 404 afterwards |
| Logs | PASS | No ERROR/WARN recipe/mirror/dual lines in staging logs during UAT |

Findings outside Phase 85 scope (pre-existing):
- **Production kiosk recipe quotes 503** ("Ingredient catalog not available") observed ~20:05Z: `zoho:ingredients:all` cache empty and `routes/pos-recipe.js` has no file-cache fallback (unlike `routes/recipes.js`). Cleared when the owner opened production admin. Same gap would fail a kiosk recipe sale.
- Admin Kiosk Sale, Recipes view sticks on "Loading recipes..." although the data loaded (render not re-run).

## Production prerequisites

### 2026-10-14: Phase 89 script-source rule (D-14)

| Check | Value | Date |
|-------|-------|------|
| Script source verified | worktree rev-parse = ____ (must be d2c66be9) | date ____ |

Run backfill, verify and replay only from the pinned d2c66be9 worktree until Phase 89 reaches
production; see the RUNBOOK section 5 callout "Phase 89 script-source rule (D-14)".

### 2026-10-07: D-08 gate NOT met; owner chose deploy-only (option 1)

- Production `GIFT_CARDS_STORE=dual` (Phase 84 window day 2; flip no earlier than ~2026-10-13).
  Per D-08, production `RECIPES_STORE=dual` waits for the gift-card flip.
- Owner decision 2026-10-07: deploy `main` to production tonight after close with `RECIPES_STORE`
  unset (sheets). Deviation from 85-13 Task 1, which also holds the deploy; rationale: a sheets-mode
  deploy opens no second dual window, ships the kiosk catalog-503 fix (`a509e397`) and the D-03 editor
  bundles. 85-13 Task 2 (backfill + dual) stays gated on the Phase 84 flip.
- Deploy contents vs production `ef3be1e3`: middleware changes are recipe-only (`lib/recipe-*`,
  `routes/recipes.js`, `routes/pos-recipe.js`, `server.js` mirror-sweep registration, additive
  `0003_recipes.sql`, backfill/verify/replay CLIs); no gift-card code changed. Frontend: `admin.js`,
  `brewpad.js` (+ min); public pages differ only in `?v=` stamps; `BEER_PAGE_LIVE = false`.
- Backups: production `pg-backup` ran 2026-10-07 10:02Z, dump ok, uploaded.

### Tonight's runsheet (deploy-only, sheets)

1. After close, kiosk idle. **PINNED (2026-10-08, Phase 86 code is on `main`):** `git push production d2c66be9:main --force` (gated-deploy workflow). NEVER `main` until Phase 86 is meant to ship; d2c66be9 is the last pre-86 commit and contains all 85 work incl. a509e397.
2. Production `/health`: `database:true`; startup log `store modes` shows `RECIPES_STORE` absent/sheets
   and `GIFT_CARDS_STORE: dual` unchanged; pre-deploy guard chain passed with `0003_recipes` applied.
3. `GET /api/recipes` 200 with `source: apps-script`; kiosk `recipe-quote` 200 for SV-R-000002 at 23 L.
4. Public `beer.html` still hidden; spot-check one gift-card lookup still works (Phase 84 dual untouched).
5. Rollback: redeploy `ef3be1e3` (Railway rollback to the previous deployment); the empty recipe tables
   are harmless.

## Production cutover

## Post-flip verification

---
*Phase: 85-recipes-recipeingredients-postgres*
*Template created: 2026-10-07 (Plan 85-11)*

## Production cutover (2026-10-16, owner approved during opening hours, kiosk idle)

- **Prerequisites:**
  - D-08 met: production gift cards flipped to postgres at 2026-10-16 18:22:14Z (84-DUAL-LOG).
  - Phase 85 code was on production since prod-20261016-1, with 0003_recipes applied. Backups are live (Phase 83).
- **Dry run:** fresh snapshot (20:45Z) gave 13 recipe rows and 145 ingredient rows, 0 rejects (so SV-R-000001's cells are fine). Seeds: recipe 16, ingredient 495.
- **Promote:** done at 20:46:19Z, run inside the production container (DATABASE_URL never left Railway; the tunnel fails from zoho-middleware/). Promoted 13 recipes and 145 ingredients; sequences at 16 / 495.
- **RECIPES_STORE=dual:** set at 20:46:28Z. Startup showed `store modes: {"GIFT_CARDS_STORE":"postgres","RECIPES_STORE":"dual"}` and `[sheet-mirror] mirror ENABLED (environment=production)`; the recipe mirror sweep is registered. /health is ok and database_required.
- **Post-promote verify:** fresh snapshot (20:52Z) gave "Verified 13 recipes: 0 mismatches".
- **Pre-open mirror write:** owner notes edit on draft SV-R-000014 (QA-23 cider, 5 ingredients) at 20:54:08Z, PUT 200.
  - Postgres and the sheet had identical notes (same md5), identical updated_at (stored as a string), and 5 ingredients each.
  - No mirror-dirty markers.
- **Post-mirror verify:** fresh snapshot (20:55Z) gave "Verified 13 recipes: 0 mismatches".
  - Cell-type check: created_at and updated_at are string cells for SV-R-000014, SV-R-000001 and SV-R-000016, so there was no Date-serial mangling.
  - RecipeIngredients has 5 rows for SV-R-000014.
- **Kiosk quote under dual:** SV-R-000016 in-store gives $95.00 + $2.85 tax = $97.85, unchanged from before the cutover, with no `[dual-write] recipes` discrepancy.
  - One `[sheet-mirror] recipes.price failed: timeout of 15000ms` warning on the first, cold quote. This is the observe-only D-05 compare, not a price change; watch whether it recurs.
- **Window day 1:** 2026-10-16. The 85-14 ≥7-day dual window runs to 2026-10-23 at the earliest, then the flip decision.
- **Snapshots:** all deleted from the container and from Downloads.

## Scripted runsheet and mid-window verify (2026-10-17, day 2)

Driven by Claude in production admin, with the owner signing in and selling on the kiosk. Owner approved running it on production.

- **Steps 1-5:**
  - SV-R-000017 "ZZ TEST RECIPE 2026-10-17" was created as a draft with 1 ingredient (1L Swing-top Bottle Amber).
  - It was activated with locked $1, its quantity edited from 1 to 2, and renamed (PUT 274 ms).
  - Its fees were set to $0.01 to keep the sale small; that was a further edit.
  - It appeared in the public list (`source: postgres`), the detail endpoint returned 200, and it showed on beer.html.
- **Step 6:** kiosk sale at 23 L in-store for $2.34 ($1.02 plus $1.32 tax; tax is charged on the $11 ingredient retail).
  - The first two terminal pushes failed with Helcim 409 ("Terminal error, please try again") and the third succeeded. This is the pre-existing `kiosk-terminal-charge-lag` issue, not Phase 85.
  - The sale produced invoice INV-000246 and auto-created batch SV-B-000238.
- **Step 7:** `[dual-price]` compared 6 times with no mismatch. There were no `[dual-write] recipes`, `recipes-mirror` or `recipes-dual-price` lines.
- **Step 8:**
  - Test batch SV-B-000238 was deleted first, through the admin proxy `delete_batch`, to remove the batch reference.
  - SV-R-000017 was then deleted: DELETE 200, then GET 404, and it is gone from the public list.
- **Step 9 cleanup:**
  - The owner refunded Helcim txn 56748989.
  - Zoho payment #241 (reference 56748989) was deleted.
  - INV-000246 is awaiting void or delete in Zoho Books. The Phase 84 precedent deleted its test invoices INV-000242 to 245.
- **Step 10:** `recipes-verify.js` ran inside the production container against a fresh .xlsx (downloaded about 19:15Z, sha256 prefix 320b7b1e) and printed **"Verified 13 recipes: 0 mismatches"** (exit 0). The snapshot copy was deleted from the container.
  - Script source: the production container's own release scripts. These are pre-Phase-89, with no `beer_category`, which is equivalent to the D-14 pinned d2c66be9 rule.
- **Discrepancies in window so far:** none. The only non-info lines are the explained cold-start sheet read on 10-16 and the settle skips.
- **Flip bar status at day 2:**
  - All six ops have been observed.
  - There are zero unexplained discrepancies.
  - The mid-window verify returned 0 mismatches.
  - It is not yet 7 consecutive days. Shortening the window is an owner decision.
