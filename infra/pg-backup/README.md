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
| `railway.toml` | Build + cron settings for this service only |

## One-time setup

### 1. Generate the age key pair (on your Mac)

```bash
docker build -t sv-pg-backup -f infra/pg-backup/Dockerfile .
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

1. In `sv-middleware`, switch to the **production** environment → New → GitHub Repo →
   `steins-and-vines-production`. Name the service `pg-backup`.
2. Service Settings → **Config-as-code file path:** `/infra/pg-backup/railway.toml`.
   Railway does not follow the root directory for this file; without this setting the
   service would load the middleware's `/railway.toml` (and its `preDeployCommand`).
3. Check that Settings now shows builder Dockerfile, cron schedule `0 10 * * *` and
   restart policy Never. If not, set them by hand.
4. Variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres-EMVk.DATABASE_URL}}` (reference variable, private network) |
   | `AGE_RECIPIENT` | `age1...` from step 1 |
   | `R2_ACCOUNT_ID` | Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from the R2 token |
   | `R2_BUCKET` | `sv-pg-backups` |
   | `HEARTBEAT_URL` | optional, e.g. a healthchecks.io check (daily, 2h grace) |

5. Do **not** add the service to the staging environment; staging never holds real data.
6. Deploy, then trigger one run now (Deployments → the latest → Run now, or temporarily
   set the cron to a few minutes ahead) and confirm the log ends with
   `[pg-backup] uploaded production/...`.

Before 2026-12-01 (Railway config-as-code end of life), copy the build and cron settings
above into the dashboard or the IaC replacement, same as the middleware's `railway.toml`.

## Restore drill

Run from your Mac against a throwaway local Postgres 18 — never a real database.

```bash
docker network create drill
docker run -d --rm --name drill-db --network drill -e POSTGRES_PASSWORD=pw postgres:18-alpine
# put the AGE-SECRET-KEY line from your password manager into ~/sv-backup-key/id.txt
docker run --rm --network drill -v ~/sv-backup-key:/k:ro --entrypoint restore-drill.sh \
  -e RESTORE_URL=postgresql://postgres:pw@drill-db:5432/postgres \
  -e AGE_IDENTITY_FILE=/k/id.txt \
  -e R2_ACCOUNT_ID=... -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... -e R2_BUCKET=sv-pg-backups \
  sv-pg-backup
docker rm -f drill-db && docker network rm drill && rm -P ~/sv-backup-key/id.txt
```

Pass: the log ends with `[restore-drill] drill complete` and the row counts match
production. Set `BACKUP_OBJECT=production-<timestamp>.pgcustom.age` to restore a specific
day instead of the latest.
