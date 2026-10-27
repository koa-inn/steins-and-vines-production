# Phase 94 rollout log

Owner/Claude-maintained record of the Phase 94 staging and production rollout (plans 94-09 to 94-12).
Ids, counts and rules only: no customer names, emails, tokens or notes.

## Preconditions

- **D-01 (Phase 87 production cutover):** `87-CUTOVER-LOG.md` records
  "Flip at (`BATCHES_STORE=postgres`) | T1 2026-10-27T18:34:09Z (set + `BATCHES_FREEZE` deleted + `railway redeploy`);
  deploy `90dfb9c1` live 18:40:18Z". Satisfied.
- **Staging store mode:** at the start of 94-09, staging had `BATCHES_STORE` **unset (sheets)**. It had been
  rolled back to sheets at the end of the 87-18 rehearsal on 2026-10-09, and staging Postgres held that day's
  stale copy (204 / 1064 / 70 / 427, plus 1 tombstone). `OPS_DATA_STORE=dual`, so the boot rule for postgres is met.
  Per the plan, Claude stopped and asked. **Owner chose "Refresh, then flip"** (2026-10-27).
- **Code gate before push (Node 24):** frontend 2861/2861, middleware 3663/3663, `test:db` 414/414, both lints clean.
  `recipes-write-auth-guard.test.js` fails about 1 in 5 full-suite runs and passes on its own. It predates Phase 94,
  which didn't touch it.

## Staging

- **Staging SHA:** `141901a7` (`git push origin main` 2026-10-27, 44 commits, `8dbfa2ac..141901a7`).
- **Deploy:** Railway `9d2fea76` SUCCESS. `/health 200` (`database_required: true`).
- **0007 applied:** the startup log shows `### MIGRATION 0007_batch_type (UP) ###` and the `pgmigrations` insert.
  Read back over the tunnel: max(`pgmigrations.name`) = `0007_batch_type`.

### Staging Postgres refresh (87 rehearsal steps, owner-approved)

| Step | Time (UTC) | Result |
|------|-----------|--------|
| Freeze `BATCHES_FREEZE="4:00 PM"` + redeploy | 21:16:53 set; deploy `77717ad9` live ~21:22 | store modes `BATCHES_STORE: sheets`, freeze set |
| Empty the six staging batch tables (one transaction; hand SQL, staging only) | 21:22:34 | 204/1064/70/427/1/0 -> 0 in all six |
| Snapshot S1 (owner download, sha `df1baa6e`) | ~21:24 | tails clean: 0 blank-id rows with data in all four tabs |
| Dry run | 21:25:02 | 215 / 1114 / 72 / 442, **0 rejects**, seeds 247 / 1133 / 74 / 446 |
| Promote (db `railway`, staging) | 21:25:13 | promoted 215 / 1114 / 72 / 442; sequences 247 / 1133 / 74 / 446 |
| Snapshot S2 (owner download) + `batches-verify` | 21:37:19 | headers match, counts equal, 0 orphans, **0 mismatches** |
| `batches-parity` (snapshot to `~/sv-backfill/staging-94-parity.json`, outside the repo) | 21:37:33 | **0 differences (5 reads)** |
| Flip: `BATCHES_STORE=postgres`, `BATCHES_FREEZE` deleted, `railway redeploy` | 21:38:01; deploy `d74e1c2f` live 21:40:46 | store modes `BATCHES_STORE: postgres`; `/health` ok |

Staging batch writes were frozen ~21:22 -> 21:40. Production was unaffected (separate service and database).
Staging no longer writes batches to the shared workbook, because staging never mirrors.

### batch-type dry run (B3), in-container, 21:41:50Z

Full list (215 rows): `~/sv-backfill/94-staging-type-dryrun.txt` (outside the repo).

| Type | Rule | Count |
|------|------|-------|
| wine | zoho | 206 |
| cider | zoho | 5 |
| beer | recipe | 2 |
| cider | schedule | 1 |
| wine | schedule | 1 |
| **needs a type** | | **0** |
| **candidates** | | **215** |

Non-`wine zoho` rows: SV-B-000028, -000030 (cider zoho 60270), -000136 (cider zoho 60263), -000153 (cider zoho 60254),
-000164 (cider zoho 60257), -000167 and -000229 (beer recipe), -000175 (wine schedule, SKU G009289), -000234 (cider schedule).
The Zoho list rows do carry `cf_type` (the 94-06 assumption held: 0 needs-a-type).

### completed-at dry run (B2), in-container, 21:42:00Z

Full list: `~/sv-backfill/94-staging-completed-dryrun.txt` (outside the repo).

- candidates **40**, will fill **40**, stay blank **0**, before start_date **0**. All are stamped `backfill-task`.
- Range SV-B-000002 .. SV-B-000057; proposed dates 2026-02-26 .. 2026-05-02.

**No `--apply` has been run.** Awaiting the owner's review of both full lists (94-09 Task 2).
