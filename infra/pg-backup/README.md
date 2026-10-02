# pg-backup — nightly production Postgres backups

A Railway cron service in the `sv-middleware` project, **production environment only**.
Every night at 10:00 UTC (03:00 Pacific in summer, 02:00 in winter) it:

1. runs `pg_dump --format=custom` against production Postgres (`Postgres-EMVk`) over
   Railway's private network,
2. checks that `pg_restore --list` can read the dump,
3. encrypts it with [age](https://age-encryption.org) to a public key (the private key
   never touches Railway or R2),
4. uploads it to Cloudflare R2 as `production/production-<UTC timestamp>.pgcustom.age`,
5. confirms the uploaded size matches, then pings `HEARTBEAT_URL` if set.

Any failure exits non-zero, so the run shows as failed in Railway, and pings
`$HEARTBEAT_URL/fail`. R2 keeps 30 days of dumps via a bucket lifecycle rule.

Owner decisions (2026-10-02): Railway cron runner, Cloudflare R2, age encryption,
production only, daily, 30-day retention. This closes the D-16 Phase 84 prerequisite
once the restore drill below has passed against a real backup.

Files:

| File | Purpose |
|---|---|
| `Dockerfile` | `postgres:18-alpine` (pg_dump must be ≥ the server's major version; prod is 18.x) + `age`, `rclone`, `curl` |
| `backup.sh` | The nightly job (container entrypoint) |
| `restore-drill.sh` | Fetch → decrypt → restore into a scratch DB → print row counts |

## One-time setup

### 1. Generate the age key pair (on your Mac)

```bash
docker build -t sv-pg-backup infra/pg-backup
mkdir -p ~/sv-backup-key && docker run --rm --entrypoint age-keygen \
  -v ~/sv-backup-key:/k sv-pg-backup -o /k/id.txt
```

- The command prints `Public key: age1...` — that is `AGE_RECIPIENT`.
- Store the whole of `~/sv-backup-key/id.txt` (the `AGE-SECRET-KEY-...` line) in your
  password manager, then delete the file. **Without it no backup can be restored.**

### 2. Cloudflare R2

1. R2 → Create bucket, e.g. `sv-pg-backups` (location: automatic, North America).
2. Bucket → Settings → Object lifecycle rules → add rule: delete objects with prefix
   `production/` after **30 days**.
3. R2 → Manage API tokens → Create token: permission **Object Read & Write**, scoped to
   **only** this bucket. Note the Access Key ID, Secret Access Key, and your Account ID.
4. Optional hardening: Bucket → Settings → Bucket lock rule for `production/` with a
   retention of 7+ days, so a leaked token cannot delete recent backups.

### 3. Railway service (production environment)

Live since 2026-10-02 as `pg-backup` in `sv-middleware`, **production environment only**
(service id `cc758a22-eec3-4e49-bbab-b1d5e04e22bc`). It is deployed from this folder with
the Railway CLI, not from GitHub, so backups do not depend on a production git push:

```bash
railway up infra/pg-backup --path-as-root --service pg-backup --environment production --ci
```

Re-run that after changing anything in this folder. Settings live in the **dashboard**,
not a `railway.toml`: Railway stopped letting new services opt in to config-as-code on
2026-08-28, so a config file here would be silently ignored.

| Setting | Value |
|---|---|
| Builder | Dockerfile (auto-detected) |
| Cron Schedule | `0 10 * * *` (10:00 UTC) |
| Restart Policy | Never (implied by the cron schedule) |

Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres-EMVk.DATABASE_URL}}` (reference variable, private network) |
| `AGE_RECIPIENT` | `age1sz33kf69xvfwudkr7jnxgvh4atcu2edmg4cxj9ygkmerkt8hl3rs8fcvf3` |
| `R2_ACCOUNT_ID` | `5a4eea499a354cbb6e550cc9e8b2da8d` |
| `R2_BUCKET` | `sv-pg-backups` |
| `BACKUP_PREFIX` | `production` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 token `sv-pg-backup-railway-2` (Object Read & Write, this bucket only); values in the owner's password manager |
| `HEARTBEAT_URL` | optional, not set |

R2 bucket `sv-pg-backups`: lifecycle rule deletes `production/` after 30 days; bucket
lock keeps `production/` objects undeletable for their first 7 days.

To check a run: Railway → `pg-backup` → Cron Runs, or
`railway logs -s pg-backup -e production -d`. A good run ends with
`[pg-backup] uploaded production/...`.

## Restore drill

Run from your Mac against a throwaway local Postgres 18 — never a real database.

```bash
docker network create drill
docker build -t sv-pg-backup infra/pg-backup
docker run -d --rm --name drill-db --network drill -e POSTGRES_PASSWORD=pw postgres:18-alpine
# put the AGE-SECRET-KEY line from your password manager into ~/sv-backup-key/id.txt
# railway run injects the service's R2 variables; -e NAME passes them through
# without the values ever being typed or printed.
railway run -s pg-backup -e production -- docker run --rm --network drill \
  -v ~/sv-backup-key:/k:ro --entrypoint restore-drill.sh \
  -e RESTORE_URL=postgresql://postgres:pw@drill-db:5432/postgres -e AGE_IDENTITY_FILE=/k/id.txt \
  -e R2_ACCOUNT_ID -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_BUCKET -e BACKUP_PREFIX \
  sv-pg-backup
docker rm -f drill-db && docker network rm drill && rm -P ~/sv-backup-key/id.txt
```

Pass: the log ends with `[restore-drill] drill complete` and the row counts match
production. Set `BACKUP_OBJECT=production-<timestamp>.pgcustom.age` to restore a specific
day instead of the latest.

Drill history:

| Date | Backup | Result |
|---|---|---|
| 2026-10-02 | `production-20261002T223253Z.pgcustom.age` (first real backup) | pass — `app_meta` 1, `pgmigrations` 1, matches production |
