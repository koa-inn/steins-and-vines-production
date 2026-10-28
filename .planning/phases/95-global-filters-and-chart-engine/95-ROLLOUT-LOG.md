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

Awaiting owner review (95-09 Task 2). No `--apply` run.
