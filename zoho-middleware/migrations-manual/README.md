# Destructive (manual) migrations — D-04

`migrations/` is **additive only**. Every file in that directory runs automatically on every
deploy (staging and production), guarded by `scripts/migration-guard.js`: any `DROP`, `TRUNCATE`,
`RENAME`, `ALTER … TYPE` / `SET DATA TYPE`, `DELETE`, or `UPDATE` statement in a file's
`-- Up Migration` section fails `npm test` **and** aborts the Railway pre-deploy step (the guard
runs as the first half of `npm run migrate` — see `package.json` and the root `railway.toml`'s
`preDeployCommand`). A destructive change pushed to `migrations/`, even on a break-glass push that
skipped CI, is rejected before `node-pg-migrate` ever touches the database.

Anything that drops, renames, or rewrites existing data belongs **here** instead — a separate,
manually triggered procedure, never run automatically by a deploy.

## Procedure

1. **Take a backup first, and record it.** Railway backups/PITR are not available on this
   workspace's current (Hobby) plan (see `docs/RUNBOOK.md` § Railway Postgres — Backups). Until
   that changes, take a manual `pg_dump` of the target environment's database before running
   anything here, and note where the dump is stored (outside the repo — it may contain customer
   PII, per D-13).

2. **Run against STAGING first.** Confirm the result (row counts, spot-check affected rows) before
   touching production. Staging and production are separate Railway Postgres databases (Plan
   83-01) — a staging-only mistake never reaches production data.

3. **Run by hand, with the owner present.** Either:
   - `railway connect` (or `psql` directly, via the environment's `DATABASE_URL`) and run the SQL
     by hand, or
   - `node-pg-migrate up -m migrations-manual --migrations-table pgmigrations_manual` — note the
     **explicit `-m` directory** (never the default `migrations/`) **and** a **separate tracking
     table** (`pgmigrations_manual`, never the deploy's `pgmigrations`). Recording a manual file in
     the deploy's own tracking table would make the next real deploy's order check fail on a
     migration it has never seen in `migrations/` and cannot resolve.

   Never invoke anything in this directory from `railway.toml`'s `preDeployCommand` or any other
   automated deploy path — it is not wired into `npm run migrate` and must stay that way.

4. **Record it.** Add an entry to `docs/RUNBOOK.md` Deploy History: what ran, when, against which
   environment, who was present, and the backup reference from step 1.

## Why not just edit a file in `migrations/`?

`node-pg-migrate` migrations are meant to be applied exactly once and never edited afterward.
Editing an already-applied file doesn't get re-run — the next environment to deploy would simply
apply it as normal, silently diverging from whatever was hand-run here. Destructive work needs a
human in the loop for every environment it touches, not a deploy pipeline that runs once, applies
cleanly, and moves on.
