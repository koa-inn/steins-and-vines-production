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
