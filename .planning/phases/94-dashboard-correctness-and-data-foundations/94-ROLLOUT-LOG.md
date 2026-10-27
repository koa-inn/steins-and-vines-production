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

**Owner OK (94-09 Task 2):** on 2026-10-27 the owner reviewed both lists and replied "yes, apply both on staging".

### Staging applies (94-09 Task 3), in-container

| Run | Time (UTC) | Result |
|-----|-----------|--------|
| `batch-type-backfill.js --apply --expect=215` | 21:43:36 | candidates 215, **written 215, skipped 0**; same type x rule table as the dry run |
| `completed-at-backfill.js --apply --expect=40` | 21:43:49 | candidates 40, **written 40, skipped 0**; stay blank 0, before start_date 0 |
| `batch-cycle-recompute.js` | 21:43:51 | see below |

staging: no replay/verify (staging never mirrors). The apply CLIs printed the same note.

Recompute (Calendar-YTD 2026, Vancouver days, completed batches):

```
n: 175  excluded: 0  median: 57d  mean: 59d
  beer: n=1 median=38d mean=38d
  cider: n=5 median=71d mean=73d
  wine: n=169 median=57d mean=59d
null_batch_type: 0
needs_a_type: 0
```

### D-13 acceptance (staging BrewPad, owner signed in, read by Claude in Chrome, ~21:5xZ)

| Number | Dashboard | Recompute | Result |
|--------|-----------|-----------|--------|
| Cycle tile median | 57d | 57d | match |
| Cycle tile mean | 59d | 59d | match |
| Cycle tile N | 175 | n 175 | match |
| Per-type medians | Wine 57d · Beer 38d · Cider 71d | wine 57 · beer 38 · cider 71 | match |
| Completed this year | 175 | n 175 (Calendar-YTD completed) | match |
| Started this year | 214 | n/a | recorded |
| Month chart (May–Oct, started) | legend Wine 122 / Beer 2 / Cider 4 / Other 0; bars 30+33+17+15+14+19 = 128 | n/a | legend = bars (128) |
| Wine breakdown, 6 Months | Total 122 (Red 73, White 36, Rosé 10, Fruit 3) | n/a | = chart wine 122 |
| Needs-a-type chip | `Needs a type (0)` | needs_a_type 0 | match |

**D-13 check: PASS** (median and mean within ±1 — exact, type totals agree for the same window, chip = needs_a_type).

## Staging UAT

The owner checked staging BrewPad on the iPad (dashboard tiles, month chart, Needs-a-type chip, Type select).
Result, 2026-10-27, verbatim: **"gotcha, cool then approved"**.

## Production pre-deploy

Read-only (production container via `railway ssh`, read-only transaction; Railway variable listing). Nothing
changed on production.

- **Migrations applied on production (`pgmigrations`):** 0001_init, 0002_gift_cards, 0003_recipes, 0004_ops_data,
  0005_batches, `0006_recipes_beer_category` (2026-10-17T19:46:55Z).
  - **0006 present: yes.**
  - **0007 present: no.** 0007 applies next, in order, on the release boot.
- **Store flags:** `BATCHES_STORE=postgres`, `OPS_DATA_STORE=postgres`, no `BATCHES_FREEZE`.
- **Rollback target:** Railway deployment `90dfb9c1-3ecf-4535-b9fa-2ad45745bc91` (SUCCESS, 2026-10-27 18:34Z, the
  87 flip deploy). Production git: `production/main` = `0944f4c6`, the CNAME commit on top of `prod-20261022-1`
  (`2b397c89`), which is an ancestor of the candidate.
- **Candidate SHA:** `141901a7` (staging-verified in 94-09).
- **Commits `production/main..141901a7` (no merges):** 39 in total.
  - **35 Phase 94 commits:** 94-01..94-08 and 94-13 code, tests and docs, plus phase tracking.
  - **4 others, all docs or bookkeeping with no runtime effect:**
    - `8dbfa2ac` docs(todo) newsletter landing page;
    - `8186f54e` docs(86,87) record the production flip;
    - `f0184315` docs(state) 94 context;
    - `129e439d` the bot's deploy-runbook line.
- **Non-Phase-94 files in the diff:**
  - `CNAME` is the production-only CNAME commit. `enforce-cname.yml` re-applies it after the push.
  - `zoho-middleware/routes/pos.js` adds only the `get_dashboard_stats: true` allowlist entries (94-05).
- **Ship shape:** the release boot applies migration 0007. Its three columns are Postgres-only and additive,
  and the migration allowlist and guard pass. After the release, `get_dashboard_stats` serves the dashboard.
  New batches get `batch_type` on create, but existing production rows stay NULL until the 94-11 B3 backfill,
  which needs its own owner OK. Until then the production "Needs a type" chip will show the untyped batches.

**Owner release approval:** 141901a7 at 2026-10-27T22:10:26Z (verbatim: "release 141901a7 now").

## Production release (94-11 Task 1)

- **Push:** `git push production 141901a7:main --force` at 22:10:37Z (`0944f4c6...141901a7`). Tagged `prod-20261027-1`.
- **Railway:** deployment `896f6942-dff8-4ccc-af7b-42ae658281ce` SUCCESS (built 22:10:44Z, live ~22:14Z). The rollback target is still `90dfb9c1`.
- **Health:** `/health` 200, `database_required: true`. Store modes are all `postgres`.
- **Migration:** the boot log shows migration-guard and allowlist OK, then `### MIGRATION 0007_batch_type (UP) ###`.
  A read-only read-back of `pgmigrations` gives `0007_batch_type <- 0006_recipes_beer_category`.
  `batches`: 215 rows, 0 typed (expected before B3).
- **Frontend:** the GitHub Pages "Deploy Production (filtered)" run succeeded. Production BrewPad loads at the staff
  sign-in screen; the dashboard render check waits on the owner's Google sign-in.
- **Production repo `Tests` workflow: FAILED, on the `npm audit --audit-level=high --omit=dev` step only.**
  The failure is a new high advisory, body-parser GHSA-27r3-jxmh-p828 (DoS via trailing bytes after a compressed body),
  and `npm audit fix` is available. Every other step passed: unit tests, Postgres tests, lint, the frontend suite
  and artifact drift. This is not caused by Phase 94. It needs a separate dependency-patch change.

## Production B3

Dry run in the production container at 22:18:11Z. Full list: `~/sv-backfill/94-prod-type-dryrun.txt` (outside the repo).

| Type | Rule | Count |
|------|------|-------|
| wine | zoho | 206 |
| cider | zoho | 5 |
| beer | name | 2 |
| cider | schedule | 1 |
| wine | schedule | 1 |
| **needs a type** | | **0** |
| **candidates** | | **215** |

Diff against the staging list: 213 rows are identical. SV-B-000167 and SV-B-000229 are `beer` on both, but decided by
`name` on production and `recipe` on staging. Cause (read-only check): on production their linked recipe rows have
`beer_category` NULL, while staging has it set. These are Phase 89 values that never reached the production recipes
table. The type is unaffected. Source `name` stays eligible for later re-derivation once a category exists.
Follow-up: production recipe `beer_category` backfill (Phase 89 gap; probably also affects beer.html card tints on
production).

Awaiting the owner's review of the full list and OK for `--apply --expect=215`.

### Production B3 apply (94-11 Task 3)

- **Owner OK:** 2026-10-27, verbatim "signed in, yes apply with expect=215".
- **Dashboard before the apply (production, owner signed in):** it renders on the new data layer. Tile median 61d,
  mean 61d, "Based on 135 batches, 40 excluded (no completion date)". Started 214, completed 135. Before B3 and B2
  the client-side classifier was used. No errors shown.
- **Apply:** `batch-type-backfill.js --apply --expect=215` (in-container) at 22:19:49Z: candidates 215,
  **written 215, skipped 0**. Same type x rule table as the dry run.
- **Replay dry run:** `batches-replay-to-sheet.js --since=2026-10-27T22:19:54.013Z` built 215 state and 0 delete requests.
- **Replay `--apply`:**
  - **Run 1 (22:20:08Z):** stopped at SV-B-000005, "timeout of 30000ms exceeded".
  - **Run 2 (22:21:59Z):** stopped at SV-B-000038, same timeout. By then it had sent SV-B-000001..000037 successfully;
    the replay stops at its first error.
  - Apps Script `mirror_batch_state` takes about 15–30 s per batch right now, so a full re-run would take more than an hour.
    All 215 rows share one `last_updated`, so `--since` cannot resume from a point.
  - **Resume:** a one-off driver, `/tmp/replay-driver.js` in the container, calls the same `runBatchesReplay`, so the
    payloads and order are unchanged. Its injected HTTP client returns ok for ids below SV-B-000038 (already sent) and
    allows 120 s per call with 3 tries. Started ~22:35Z with `nohup`.
  - **Driver result (finished ~23:15Z):** `Replayed 215/215 request(s)`, exitCode 0. It skipped 35 already-sent ids
    below SV-B-000038 (the gaps are deleted batches), sent the other 180 with 0 retries, and took 2456 s (~14 s/batch).
  - **Next:** `batches-verify` against a fresh owner snapshot.
- **Verify after the B3 replay:** owner snapshot S6 (sha `a5fef135`) uploaded to the container, sha256 prefix
  `4f142c85ca7ee39c` checked on both ends. Ran `batches-verify` at 23:28:14Z: headers match; counts 215 / 1114 / 72 / 442
  equal; 0 orphans; **0 mismatches**; exit 0. The uploaded file was then deleted from the container.
- **Production B3: COMPLETE.**

## Production B2

Dry run in the production container (~23:29Z). Full list: `~/sv-backfill/94-prod-completed-dryrun.txt` (outside the repo).

- candidates **40**, will fill **40**, stay blank **0**, before start_date **0**.
- **Identical to the staging-approved list** (`diff` empty: same ids, proposed dates and `backfill-task` source).

Awaiting the owner's OK for `--apply --expect=40`.
