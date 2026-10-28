# Phase 95 Rollout Log

Owner/Claude-maintained record of the Phase 95 staging and production rollout (plans 95-09 to 95-11).
Ids, counts and reason codes only — no customer names, emails or tokens.

## Code gate

Node v24.21.0 (prod runtime), 2026-10-28, main at `b4e5ecaf`:

| Suite | Result |
|-------|--------|
| Frontend `npm test` | 223 suites / 3000 tests passed |
| Frontend `npm run lint` | clean |
| Middleware `npm test` | 256 suites / 3690 passed (2 skipped) |
| Middleware `npm run test:db` | 51 suites / 443 passed |
| Middleware `npm run lint` | clean |

`npm run build` from a clean tree reproduces the committed `js/brewpad.min.js` (only the `brewpad.html` cache stamp differs).

## Staging

- **Staging SHA:** `020f6a9c` (`git push origin main` 2026-10-28, `aef21a36..020f6a9c`).
- **Deploy:** Railway `00713d4a` SUCCESS. `/health 200` (`database_required: true`, `authenticated: true`).
- **0008 applied:** in-container read-only read-back of `pgmigrations`: `0008_staff_batch <- 0007_batch_type <- 0006_recipes_beer_category`.
  Before backfill: 215 batches, 0 with `staff_batch`.

### Staging staff dry run

In-container (`railway ssh`, `/app/zoho-middleware`), `staff-batch-backfill.js --dry-run`, exit 0, no writes.
Full list: `~/sv-backfill/95-staging-staff-dryrun.txt` (outside the repo).

| Reason | Count |
|--------|-------|
| name:Inn | 11 |
| name:McLachlan | 18 |
| source:internal | 3 |
| source:research | 1 |
| **Candidates (distinct batches)** | **30** |


### Owner review (95-09 Task 2)

The owner reviewed the full 30-row list (names shown in chat only) on 2026-10-28 and said: "katie and anthony are paying
customers so is wayne". So only Koa Inn and Paul McLachlan are staff/family. The 10 rejected batches are
SV-B-000025, 000027, 000034, 000082, 000084, 000085, 000094, 000166, 000235, 000238. 000238 matched only on source
`internal` even though it belongs to a paying customer, so its `source` may be wrong (not changed here).

The CLI could only apply the full listed set, so `--exclude=<ids>` was added (`c881e492`, tests + docs, Node 24 gate
FE 3000 / MW 3697 / DB 443 green) and staging was redeployed (Railway `c543f53a` SUCCESS, `/health 200`). Exclude list kept in
`~/sv-backfill/95-staff-exclude.txt`. The re-run dry run with `--exclude` listed exactly the 20 approved rows (name:Inn 11,
name:McLachlan 9; source:internal 2 and source:research 1 overlap with Inn).

Owner OK (staging staff): --expect=20 with --exclude of the 10 customer batches, 2026-10-28 ~19:35Z.

## Staging staff apply

| Step | Result |
|------|--------|
| `--apply --exclude=<10> --expect=20` | candidates 20, written 20, skipped 0, exit 0 |
| Re-run `--dry-run --exclude=<10>` | re-run candidates 0 |
| Read-only read-back | `count(*) where staff_batch` = 20; excluded ids flagged = 0 |

staging: no replay/verify (staging never mirrors).

## Staging UAT

### Desktop pass (Claude in Chrome, owner signed in, 2026-10-28 ~19:45Z)

- Staging serves the Phase 95 `brewpad.min.js` (contains `bp_dash_v2`, `staff_batch`, the Chart.js loader); `js/vendor/chart.umd.min.js` is 200.
- Before sign-in / before v2 opens: no Chart.js request. After v2 opens: one request, `js/vendor/chart.umd.min.js?v=4.5.1`.
- Console: no app errors. Only the Google sign-in popup-blocked message (GSI, pre-existing, not Phase 95).
- Defaults YTD · Month · Batches · All: tiles 39 fermenting / 214 started / 175 completed / median 57d; Period YTD shows "No earlier data to compare".
- Wine · 90d · Week: hash becomes `#dash=v2&type=wine&period=90d&group=week`; tiles show deltas (`▼ 30 (-39%) vs prev 90d`, cycle `▲ 7d (+12%)`); Reset filters appears.
- Wine breakdown note "Staff batches hidden". Sticky filter bar pins flush under the header.
- Drill: Week of Sep 14 bar (10) -> Batches tab, banner "From dashboard: Wine started in Week of Sep 14 · 10 batches", "10 batches shown".
- Not exercised on desktop: staff checkbox write, custom date picker, phone width (left to the iPad pass).

### Checklist pass (Claude in Chrome on the owner's Mac, owner signed in, 2026-10-28 ~20:00Z)

The owner asked Claude to run the iPad checklist in the open Chrome tab. Steps 1-11 all passed: opt-in persists across
reload (with filters); sticky bar; Wine/90d/Week deltas; Litres ("L", estimated subtitle); bar drill 10 = 10; tile drills
37/46/59/59 equal tile numbers; staff toggle changes the wine note only; custom Jun 1 – Aug 31 with "vs prior 92 days";
cider gold vs beer amber distinct; SV-B-000232 showed Staff batch ticked (backfill), untick + re-tick both toasted
"Staff flag updated", left ticked; Back to classic restores v1 and "Try new dashboard".

Finding (owner decision): a drill survived leaving Batches and re-entering via the bottom Batches tab. Owner: "Yes,
clear it" - the bottom Batches tab clears the drill (fix on main with a regression test, then staging re-check).
Minor, left as is: backfilled staff flags show the hint "Set by hand".

Owner: **approved** (2026-10-28).

## Production pre-deploy

Read-only, 2026-10-28 (production container via `railway ssh`, read-only transaction; Railway deployment list). No production change.

- **Migrations on production (`pgmigrations`):** 0001_init .. 0007_batch_type. `0007_batch_type` present: **yes**. `0008_staff_batch` present: **no**; `batches.staff_batch` column absent.
- **BATCHES_STORE:** `postgres`. `/health` 200 (`authenticated: true`, `database_required: true`).
- **Rollback target:** Railway deployment `d8ffd7bd-3149-4ea1-ad18-c9fd5421cfb6` (SUCCESS, 2026-10-28 02:52Z, `prod-20261028-1`).
- **production/main:** `3f64da2d`. Commits on main not yet on production: 54. Outside Phase 95 these are docs only:
  `fd92427e`, `aef21a36`, `1bf21d41`, `44a0e542`, `354b3d98` (STATE / Phase 94 docs).
- **Candidate SHA:** pending - the code-review warning fixes (95-REVIEW-FIX) land first and must be staging-verified.
