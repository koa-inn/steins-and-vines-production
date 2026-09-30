# Backfill pipeline — owner procedure

Runs on the **owner's Mac**, never inside the deployed Railway app. Moves one sheet's data
through `snapshot -> normalise -> rejects report -> scratch schema -> checks -> (optional)
promote` against a chosen Postgres database (staging or production, both on Railway).

Phase 83 proves this pipeline end-to-end against an empty/scratch schema only — nothing is
promoted to a real table this phase (no real tables exist yet for the rehearsal sheets used
here). Phase 84+ reuses this CLI unchanged with each store's own spec.

## Before you start

- **Never paste a connection string, a rejects file's contents, or a snapshot file into
  chat, an issue, or any tracked file.** The target database comes ONLY from the
  `BACKFILL_DATABASE_URL` environment variable — the CLI refuses to start if a connection
  string shows up on the command line instead (`--target=postgres://...` and similar are a
  hard error).
- **Neither Railway Postgres service currently exposes a public TCP proxy
  (`DATABASE_PUBLIC_URL`)** (confirmed 2026-09-30, `docs/RUNBOOK.md` "Public proxy (D-10)").
  To run this from your Mac you need ONE of:
  - Temporarily enable a TCP proxy on the target Postgres service in the Railway dashboard
    (Settings → Networking → TCP Proxy), copy the generated `DATABASE_PUBLIC_URL`, run the
    backfill, then **disable the proxy again** when you're done; or
  - Run the command from inside Railway instead of your laptop (`railway run npm run
    backfill -- ...`, or an SSH session into the service) — no public proxy needed, the
    private `DATABASE_URL` resolves directly.
- The CLI is connection-agnostic — it reads whichever URL you put in
  `BACKFILL_DATABASE_URL` (`lib/db.js`'s `createPool` applies TLS automatically only when
  the host matches Railway's public proxy pattern `*.proxy.rlwy.net`; a private/`railway
  run` connection needs no TLS config).

## Procedure

1. **Download the workbook snapshot.** Open the "STEINS AND VINES" Google Sheet → File →
   Download → Microsoft Excel (`.xlsx`). Save it somewhere OUTSIDE this repo, e.g.
   `~/sv-backfill/snapshot.xlsx` — the CLI refuses to read a file from inside the tracked
   repo (except the git-ignored `zoho-middleware/backfill-output/`, D-13).

2. **Install the full dependency tree** (the backfill CLI needs `exceljs`, a
   devDependency — `npm install --production` on Railway intentionally excludes it):

   ```bash
   cd zoho-middleware && npm install
   ```

3. **Set the target database** — copy the connection string from the Railway dashboard
   (see "Before you start" above for how to reach it), then set it without it ever
   appearing in your shell history:

   ```bash
   read -s BACKFILL_DATABASE_URL && export BACKFILL_DATABASE_URL
   ```

   (Paste the connection string at the prompt; nothing is echoed.)

4. **Check the database is reachable and see what's already there:**

   ```bash
   npm run backfill -- --status
   ```

   Prints the current database name, the applied migrations, and any existing
   `scratch_*` schemas.

5. **Rehearse one sheet at a time.** Each Phase 83 rehearsal sheet reads into its own
   scratch schema and never touches a real table (no real tables exist yet for these
   sheets):

   ```bash
   npm run backfill -- --file=~/sv-backfill/snapshot.xlsx --sheet=VesselHistory
   npm run backfill -- --file=~/sv-backfill/snapshot.xlsx --sheet=PlatoReadings
   npm run backfill -- --file=~/sv-backfill/snapshot.xlsx --sheet=FermSchedules
   ```

   Each run prints its six steps (`[1/6]` .. `[6/6]`), then a one-line summary of counts
   (read/accepted/rejected) and the rejects file's path. Without `--promote`, step 6 is
   skipped and nothing beyond the scratch schema is touched.

   Unless `--yes` is passed, the CLI prints `Target: <redacted connection string>
   database=<name>` and asks you to type the database name back before it writes
   anything — confirms you're pointed at the database you think you are before any load.

6. **Review the rejects, if any.** The summary line names the rejects file's path (always
   under `~/sv-backfill/` by default, or wherever `--out-dir` points — never inside the
   repo). Open it locally; it is JSON with one entry per rejected row and the reason.
   **Do not paste its contents anywhere** — it may contain customer names/notes.

7. **Promotion (Phase 84+ only).** This phase never promotes — none of the three
   rehearsal sheets (VesselHistory, PlatoReadings, FermSchedules) has a real table yet.
   When a later phase does add one, promotion requires `--promote`, and is blocked
   (exit code 2) while any rejects exist unless you also pass `--accept-rejects`:

   ```bash
   npm run backfill -- --file=~/sv-backfill/snapshot.xlsx --sheet=<Sheet> --promote
   npm run backfill -- --file=~/sv-backfill/snapshot.xlsx --sheet=<Sheet> --promote --accept-rejects
   ```

   Promotion also refuses to run if the last checks step failed, or if the target table
   is missing or already has rows in it.

8. **Clean up.** When you're done for the session:

   ```bash
   unset BACKFILL_DATABASE_URL
   rm ~/sv-backfill/snapshot.xlsx
   ```

   And if you enabled a temporary TCP proxy in step "Before you start", disable it again
   in the Railway dashboard.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (or a step was intentionally skipped — no `--promote`, or `--dry-run`) |
| 1 | Error — bad arguments, snapshot not found, database unreachable, etc. |
| 2 | Promotion blocked — rejects exist and `--accept-rejects` was not passed |
| 3 | Promotion blocked — the post-load checks failed |

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--file=<path>` | — | Path to the downloaded `.xlsx` snapshot |
| `--sheet=<name>` | — | Sheet name (see `npm run backfill -- --status` or an invalid value's error for the current list) |
| `--schema=<name>` | `scratch_backfill` | Scratch schema to load into (must match `scratch_[a-z0-9_]+`) |
| `--timezone=<iana>` | `America/Vancouver` | Timezone used to interpret bare `Date`/date-only cells |
| `--out-dir=<path>` | `~/sv-backfill` | Where the rejects report is written (never inside the repo, except the git-ignored `zoho-middleware/backfill-output/`) |
| `--promote` | off | Attempt to promote scratch rows into the real table (gated, see above) |
| `--accept-rejects` | off | Allow promotion despite existing rejects |
| `--status` | off | Print database/migrations/scratch-schema status and exit — no file needed |
| `--dry-run` | off | Read, normalise and write the rejects report only — never touches the database |
| `--yes` | off | Skip the interactive "type the database name" confirmation before any write |

Never pass a database connection string as an argument — the CLI refuses to start if any
argv value looks like `postgres://` or `postgresql://`.
