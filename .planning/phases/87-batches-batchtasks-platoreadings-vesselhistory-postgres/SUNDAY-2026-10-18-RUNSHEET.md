# Sunday 2026-10-18: production data-migration runsheet (shop closed, daytime)

**Status:** DRAFT, prepared 2026-10-17 from read-only checks. Not committed.
**Scope:** (1) recipes-verify from main, then remove the D-14 callout. (2) 86-19 Task 2: ops data to dual. (3) Scripted Phase 86 runsheet, which replaces the 7-day window. (4) 86-20 flip, including D-18. (5) 87-19 batch cutover window.
**Rule:** each step ends in an explicit owner **GO / NO-GO**. A NO-GO stops the day at the last good state, and every step's rollback is listed with it.
**Data policy:** logs, terminal output and the evidence logs carry ids, counts and field names only. No emails, names, notes or token values.

## State at start (checked read-only 2026-10-17 19:56Z)

| Item | Value |
|------|-------|
| Production deployment | `b3fd002a` SUCCESS (release `prod-20261017-1`, SHA `47fcd354`). Container started 19:47Z. Rollback target: `990f1764`. |
| Startup store modes | `GIFT_CARDS_STORE` postgres, `RECIPES_STORE` postgres, `OPS_DATA_STORE` sheets, `STAFF_ACCESS_STORE` sheets, `BATCHES_STORE` sheets |
| `/health` | ok, authenticated, redis, `database:true`, `database_required:true` |
| Production env var **names** | `APPS_SCRIPT_SERVER_TOKEN APPS_SCRIPT_URL DATABASE_URL GIFT_CARDS_STORE NODE_ENV RAILWAY_ENVIRONMENT_NAME RECIPES_STORE REDIS_ENCRYPTION_KEY REDIS_URL SENTRY_DSN STAFF_EMAILS ZOHO_BOOKINGS_STAFF_ID` (filtered list). Absent, as expected: `OPS_DATA_STORE`, `STAFF_ACCESS_STORE`, `BATCHES_STORE`, `BATCHES_FREEZE`, `BATCHES_TIMEZONE` (defaults to America/Vancouver), `SENTRY_ENVIRONMENT`. |
| Apps Script | v65 on the shared deployment (`…DI968g`). It covers the 86 actions (v61), the 87 actions (v62) and the 89 actions (v63/v65). |
| Migrations | 0004, 0005 and 0006 applied, so the ops and batch tables exist and should be empty |

## Conventions (in-container execution)

Every script runs **inside the production container**. `DATABASE_URL`, `STAFF_EMAILS`, `APPS_SCRIPT_URL` and `APPS_SCRIPT_SERVER_TOKEN` already exist there, so no secret is typed or passed on argv. Use single quotes so that `$VARS` expand in the container, not on the Mac.

```bash
# alias used below
RS() { railway ssh -s sv_middleware -e production -- sh -c "$1"; }
M='cd /app/zoho-middleware && export BACKFILL_DATABASE_URL="$DATABASE_URL"'

# upload snapshot N (owner downloads File > Download > .xlsx to ~/Downloads/<SN>.xlsx)
railway ssh -s sv_middleware -e production -- sh -c 'cat > /tmp/sN.xlsx && sha256sum /tmp/sN.xlsx | cut -c1-8' < ~/Downloads/<SN>.xlsx
# delete it afterwards (container) and on the Mac
RS 'rm -f /tmp/sN.xlsx; ls /tmp/*.xlsx 2>/dev/null | wc -l'      # expect 0
rm ~/Downloads/<SN>.xlsx
```

- **Interactive prompts.** `--promote` asks you to "Type the database name (<name>)". Run it without a stdin redirect, because `railway ssh` is interactive, and type the name it shows. Fallback: `printf '%s\n' '<DBNAME>' | railway ssh … -- sh -c '…--promote'`.
- **Variable changes.** Prefer the Railway UI: stage all edits, then press **Deploy** once. With the CLI, `railway variable delete` and `--skip-deploys` do **not** redeploy (87-18 gotcha), so always finish with `railway redeploy -s sv_middleware -e production -y`. Confirm the new `store modes` line every time:
  `railway logs -s sv_middleware -e production | grep -E 'store modes|sheet-mirror|Ops mirror sweep|batches-drift' | tail -5`
- **Dirty-marker count** (counts only):
  `RS 'cd /app/zoho-middleware && node -e "const {createClient}=require(\"redis\");(async()=>{const c=createClient({url:process.env.REDIS_URL});await c.connect();let n=0;for await(const k of c.scanIterator({MATCH:\"ops:mirror-dirty:*\"}))n+=Array.isArray(k)?k.length:1;console.log(\"ops:mirror-dirty markers\",n);await c.quit()})()"'`
- **No code pushes all day** (production or staging). `watchPatterns=["**"]` rebuilds on any push, and a FAILED build blocks variable-only redeploys, which would make it impossible to lift a freeze or roll back a flag from the CLI. Doc edits stay local until the day ends.

## Owner touch-points (count: 21)

| # | Step | What |
|---|------|------|
| W1-W5 | 1-2, 2, 3, 4, 5 | **Workbook downloads: 5 minimum.** S1 is shared by recipes-verify and the ops dry run/promote. S2 is the dual verify after the mirror write. S3 is the end-of-runsheet verify. S4 is the post-flip verify and also the 87 backfill snapshot (combined freeze, step 5a). S5 is the 87 verify. The non-combined path needs 6. |
| A1-A5 | each step | Five GO/NO-GO calls |
| C1 | 2 | Re-confirm the Vessels `label` header and the Config `key\|value` header row are still in row 1 |
| C2 | 5 | Eyeball the tails of the 4 batch tabs; confirm BT-000567..570 are still gone |
| S1 | 2-5 | Google sign-ins to production admin and BrewPad (owner) |
| S2 | 3 | Second Google account for the staff add/role/remove-403 test (test Gmail, never a real person) |
| E1 | 4 | Hand-edit the Config sheet: blank `staff_emails` VALUE cell and type the retirement note |
| E2 | 4 | Get a Google access token for the D-18 probe (OAuth Playground) and paste it with `read -s` |
| R1 | 4/5 | Railway UI variable batches (or approve Claude's CLI) |
| AS1 | 5 | Apps Script editor: run `setupBatchMirrorNotices()` and confirm v65 is the active version |
| SM1 | 5 | Live smoke writes in BrewPad and admin, plus copy the session token for post-flip parity |
| SE1 | 2-5 | Sentry check, if Claude has no access: components `ops-mirror`, `batches-drift`, any new issue |
| Z1 | 5 | Run Scan invoices in the admin panel |

---

## Step 1: Recipes verify from main, then remove the D-14 callout (~10 min)

The production container's scripts **are** main now (`47fcd354`, carrying 0006 and the `beer_category` spec), so in-container satisfies "run from main". No worktree is needed.

1. Owner downloads **S1**. Upload it to `/tmp/s1.xlsx` and record the sha256 prefix.
2. `RS "$M"' && node scripts/backfill/recipes-verify.js --file=/tmp/s1.xlsx'`
   **Expect:** `Verified 13 recipes: 0 mismatches`, exit 0. The 13 recipes are 11 active plus the drafts. The sheet must already have the `beer_category` header, which a v65 mirror write creates. If you see a `missing_header`/`beer_category` header reject, run `setupRecipeBeerCategoryColumn` once in the editor (owner) and re-download.
   **Known benign difference:** if staff already made production D-06 picks, the mirror writes them to the sheet, so you should still get 0.
3. **GO/NO-GO A1:** GO only on 0 mismatches.
   **NO-GO:** any mismatch → stop step 1 and classify (expect `beer_category` only). Recipes stay postgres; nothing changes. Replay if needed: `RS "$M"' && node scripts/backfill/recipes-replay-to-sheet.js'` (dry), then `--apply`.
4. **Doc edit (Claude, local, commit later):**
   - Remove the RUNBOOK Phase 85 §5 "Phase 89 script-source rule (D-14)" callout and its §6/§8/§9/§10/§13 pointers.
   - Phase 89 §3 step 7: record "D-14 removed 2026-10-18, first main verify 13/0".
   - 85-DUAL-LOG "Production prerequisites": record "D-14 retired".
   - **Rollback:** none needed (read-only).
5. **Keep S1** in the container for step 2. Don't delete it yet.

## Step 2: 86-19 Task 2, ops data to dual (~25 min)

Preconditions:
- C1: Vessels row 1 has `label` right of `notes`, and the Config row 1 is `key | value`.
- The staging hygiene decisions apply: FS-0011 and the `[gfs-probe]` text are imported as-is.
- The admin and BrewPad bundles with the Vessels and Staff Access UI are live (prod-20261017-1, confirmed).

1. Tables empty (read-only):
   `RS "$M"' && node -e "const{Client}=require(\"pg\");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();for(const t of [\"vessels\",\"ferm_schedules\",\"config\",\"staff_access\",\"batches\",\"batch_tasks\",\"plato_readings\",\"vessel_history\",\"batch_tombstones\",\"batch_create_dedup\"]){const r=await c.query(\"select count(*)::int n from \"+t);console.log(t,r.rows[0].n)}await c.end()})()"'`
   **Expect** 0 for every table. If a table name errors, use the 0004/0005 names.
2. Dry run on S1:
   `RS "$M"' && BACKFILL_STAFF_EMAILS="$STAFF_EMAILS" node scripts/backfill/ops-backfill.js --file=/tmp/s1.xlsx --owners=<owner1>[,<owner2>] --out-dir=/tmp/ops-out --dry-run'`
   - **Expect:** **0 rejects**. The counts should be about 232 vessels / 12 schedules (production read showed 12 on 10-17; staging was 11 plus the deleted test) / 2 config keys / staff N (owners flagged).
   - Note the "Config staff_emails entries not in the Railway list (not imported)" count. It must be 0 or explained.
3. Promote: the same command with `--promote` instead of `--dry-run`, run interactively. Type the DB name.
   **Expect:** promoted counts equal the dry run, with sequences seeded (schedule, vessel).
4. **Set `OPS_DATA_STORE=dual` and `STAFF_ACCESS_STORE=dual` in ONE change** (D-09/D-19), then redeploy.
   **Expect:**
   - `store modes … "OPS_DATA_STORE":"dual","STAFF_ACCESS_STORE":"dual"` (others unchanged).
   - `[sheet-mirror] mirror ENABLED (environment=production)` and `[ops-mirror] Ops mirror sweep registered: every 5 minutes`.
   - `/health` `database_required:true`.
5. **Pre-open mirror write:** the owner, in production admin → Vessels, makes a harmless notes edit on one **Empty** vessel (Claude records its id). Wait 60 s.
   - Logs show an ops-mirror success line and no `component ops-mirror` error.
   - The dirty-marker count is 0.
6. Owner downloads **S2** (after the mirror write). Upload it, then run:
   `RS "$M"' && BACKFILL_STAFF_EMAILS="$STAFF_EMAILS" node scripts/backfill/ops-verify.js --file=/tmp/s2.xlsx'`
   - **Expect:** `Vessels label header: present`, `0 mismatches` (exit 0), `Staff: missing from Postgres 0`. Postgres-only should equal the owners passed via `--owners` that aren't in env.
   - Then run a cell-type check that prints types only, for the edited vessel row and FS-0001:
     `RS 'cd /app/zoho-middleware && node -e "const E=require(\"exceljs\");(async()=>{const w=new E.Workbook();await w.xlsx.readFile(\"/tmp/s2.xlsx\");for(const [t,id] of [[\"Vessels\",\"<VESSEL_ID>\"],[\"FermSchedules\",\"FS-0001\"]]){const s=w.getWorksheet(t);const hn=s.getRow(1).cellCount;s.eachRow((r,i)=>{if(r.getCell(1).text===id)console.log(t,i,hn,r.cellCount,r.values.slice(1).map(v=>v==null?\"null\":v instanceof Date?\"date\":typeof v).join(\",\"))})}})()"'`
     **Expect:** cellCount is at most the header count, there is no column shift, and the types match an untouched neighbour row.
   - **Merge note:** the written plan has a verify before the mirror write AND one after it, which is one more download. S2 covers both: the backfill correctness and the mirror landing. If S2 fails, treat it as a backfill failure and roll back either way.
7. **GO/NO-GO A2.** GO requires all of: 0 rejects, 0 mismatches, missingFromPg 0, the mirror line seen, 0 markers, and the row layout intact.
   - **Rollback (NO-GO):** set BOTH flags to `sheets` (or delete them), then redeploy. `STAFF_EMAILS` is untouched, so sign-in is unaffected. If the sheet lags (mirror only wrote the one notes edit), run `ops-replay-to-sheet.js --only=vessels --id=<id>` dry, then `--apply`. The PG rows are inert. To retry, empty the 4 ops tables (logged SQL, RUNBOOK P87 §16 shape).
8. Record "Production cutover" in 86-DUAL-LOG.md, then delete S1 and S2.

## Step 3: Scripted Phase 86 runsheet, replacing the 7-day window (~45 min)

The owner explicitly shortened D-11. Record this as an **owner decision** in 86-DUAL-LOG "Flip decision", mirroring 85-DUAL-LOG. Run in production admin; the owner signs in and Claude drives Chrome if wanted. After each action, check the logs for `ops-mirror` errors and `[dual-write] staff-access`, and tick the Op-coverage row with its timestamp.

| # | D-11 action | How | Expected |
|---|-------------|-----|----------|
| 1 | vessel add | admin → Vessels → Add, id **TST-901** (next-id prefill or typed), label "ZZ TEST <date>", type/capacity, location | 201. Within 60 s the sheet Vessels tab shows TST-901 with the label in the `label` column. |
| 2 | vessel edit | change the label/location | saves; sheet updated |
| 3 | stale-save (D-16) | open TST-901 in two tabs, save A, then save B | B shows "changed since you opened it" + Reload |
| 4 | vessel status override | set In-Use, then Empty | saves; sheet status matches |
| 5 | batch-flow status delta | BrewPad: create a test batch (no customer, no invoice, "No invoice (internal batch)") on TST-901 → TST-901 becomes In-Use. **Delete the batch** → Empty. | Status flips both ways in PG and on the sheet. The batch itself is still a sheet row (BATCHES_STORE=sheets) and is deleted before step 5. |
| 6 | vessel archive | archive TST-901 (must be Empty; archiving while In-Use is refused) | Hidden from the BrewPad picker. **Stays forever** (no hard delete, D-07), so the archived test vessel is the accepted residue. |
| 7 | schedule create | admin → Scheduling: "ZZ Test Schedule 2026-10-18", 2 steps | new `FS-00NN` from the sequence; sheet row appears |
| 8 | schedule edit | change a step day | saves; sheet updated; stale-save message on a second tab |
| 9 | schedule propagate | propagate the test schedule (referenced by no batch) | `updated 0, failed []` |
| 10 | schedule delete | delete the unreferenced test schedule | Removed from PG and the sheet. **Do NOT archive it first**: an archived schedule can't be deleted from admin (86-18 finding), so archiving it would leave permanent residue. D-11 says "delete-or-archive", and delete covers it. |
| 11 | staff add | Staff Access → add a **test Gmail** (S2) as `staff` | row listed; audit row |
| 12 | staff sign-in probe | the test account signs in to production BrewPad in a private window | Allowed (via table; not in STAFF_EMAILS). No `[dual-write] staff-access` line: a shadow line is expected only for env-allowed-but-no-row. |
| 13 | staff role change | staff → owner → staff | saves; the test account sees/loses Staff Access on its next request |
| 14 | staff remove | remove the test account **while it is signed in**; it then reloads BrewPad | Next request **403**, and the session is destroyed |
| 15 | owner safeguards | owner tries to remove self | 409 `cannot_remove_self` |

Then:
- Dirty-marker count is 0.
- `railway logs … | grep -cE 'component.*ops-mirror.*error|\[dual-write\] staff-access'` is 0, or every line is explained.
- SE1: Sentry has no new `ops-mirror` issue.
- Owner downloads **S3** and runs `ops-verify` as in step 2.6. **Expect:** 0 mismatches and missingFromPg 0. TST-901 appears in both PG and the sheet as archived; the test schedule is in neither.

**GO/NO-GO A3:** GO when every Op-coverage row has a timestamp and there are 0 unexplained discrepancies.
- **Bug found → NO-GO.** Roll both flags back to sheets per step 2.7 (replay vessels/schedules first if verify shows lag), and open a gap-closure plan.
- **Cleanup:**
  - TST-901 stays archived (accepted).
  - The test batch, test schedule and test staff row are deleted; the staff audit rows stay by design.
  - The test Gmail is never in STAFF_EMAILS.
  - Delete S3.

## Step 4: 86-20 flip to postgres, including D-18 (~35 min)

1. AS1: in the Apps Script console, confirm the active version is **v65**. Do not roll Apps Script back below v65 at any point today.
2. **Set `OPS_DATA_STORE=postgres` and `STAFF_ACCESS_STORE=postgres` in ONE change**, then redeploy. **Expect:** `store modes` shows both `postgres`, the mirror is ENABLED, the ops sweep is registered, and `/health` reports `database_required:true`.
   **Combined variant (saves one download and one redeploy):** stage `BATCHES_FREEZE="<HH:MM>"` in the same change and do step 5a's staff notice first. S4 then serves both the post-flip ops-verify and the 87 backfill. Use it only if the owner is ready to go straight into step 5. If the 86 flip fails, removing the freeze is part of that rollback.
3. Owner downloads **S4**. Run `ops-verify` as in step 2.6. **Expect:** 0 mismatches and `Staff: missing from Postgres 0`.
4. **D-18 probe-then-blank** (86-SECURITY §7 / RUNBOOK P86 §8, made concrete):
   - a. **Token (E2).** The owner gets a Google OAuth access token with the `userinfo.email` scope, e.g. via OAuth 2.0 Playground. Claude prepares the following; the token is never echoed or written to a file:
     ```bash
     read -s GTOK && export GTOK
     ADMIN_API='https://script.google.com/macros/s/AKfycbw_t1zzpa3AQxvzPqo2wAg-cBU3IdevmyEz8P-dL205VrO2jx4s3DP30WxYoVUSDI968g/exec'
     probe() { curl -sL "$ADMIN_API?action=get_vessels&token=$GTOK" | jq -r '[.ok, (.error // "-")] | @tsv'; }
     ```
     `doGet` routes non-server-token calls through the same `checkAuthorization` as `doPost` (adminApi.gs L118 / L496), so a read probe tests the identical limb without writing anything.
   - b. **Positive control (before blanking):** `probe` → `true  -`. This proves the probe can see the limb. If it returns `unauthorized`, the token or account is wrong, so fix that before going on.
   - c. **Blank (E1):** in the Config sheet, clear the `staff_emails` **VALUE** cell (column B only). Leave column A and the `key|value` header row alone. In the adjacent cell (C), type: `Retired 2026-10-18: staff sign-in is managed in admin → Staff Access (Phase 86). Do not re-add.`
   - d. **Wait 6 minutes.** The Apps Script `staff_emails` cache lasts 300 s. The tokeninfo cache is also 300 s, but it caches the email, not the decision.
   - e. **Negative probe:** `probe` → `false  unauthorized`. Then `unset GTOK`; the token expires within 1 h anyway.
   - f. **Middleware unaffected:** in production admin the Vessels tab loads, and a BrewPad list loads. Both use `server_token`, not the cell.

   Why an owner token is acceptable: the cell is the **only** OAuth limb in `checkAuthorization`, and no browser code calls Apps Script directly any more (admin and BrewPad use the middleware proxies). So the owner's token exercises the same path the written design assigns to a "non-owner staff token". No regular staff member has to be present on Sunday.
5. **STAFF_EMAILS trim: DEFER to Monday** (ADJUST, D-01 timing is Claude's discretion). It requires a regular staff member to sign in successfully via the table right after the trim, and nobody is in on Sunday. Monday procedure:
   - Re-run `ops-verify` (missingFromPg 0).
   - Trim `STAFF_EMAILS` to the owner break-glass accounts.
   - Redeploy.
   - The regular staff member signs in (table) and the owner signs in and sees Staff Access.
   - Record in 86-DUAL-LOG "Post-flip verification" and 86-SECURITY (close D-18 on the probe result today; record the trim Monday).
6. Smoke: a vessel notes edit appears on the sheet within 60 s, a schedule edit saves, the BrewPad dropdowns load, and there are 0 dirty markers.
7. **GO/NO-GO A4.**
   - **Rollback OPS:**
     - Set `OPS_DATA_STORE=dual` (preferred: keeps PG authority with the mirror) or `sheets`.
     - For `sheets`, run `ops-verify` first and replay with `ops-replay-to-sheet.js`, dry then `--apply`.
   - **Rollback STAFF:** `STAFF_EMAILS` still holds everyone (untrimmed), so `STAFF_ACCESS_STORE=sheets` is safe today.
   - **D-18:** restoring the cell value re-opens the bypass. Do it only if direct OAuth Apps Script access is needed, which nothing uses.
   - **After step 5 completes**, OPS can no longer go to `sheets` while `BATCHES_STORE=postgres` (boot guard). Roll 87 back first.

## Step 5: 87-19 production batch cutover window (~90 min budget, 120 max)

Preconditions:
- Step 4 is GO.
- C2 tails are eyeballed and BT-000567..570 are confirmed gone.
- The step 3 test batch is deleted.
- Staff are told **no BrewPad batch, task or reading edits** from now on. BrewPad shows only a generic "Save failed".
- The owner agrees the freeze text (e.g. `3:30 PM`).
- Online orders can still arrive on a Sunday, which is why the invoice list matters.

Timings below are from the 87-18 staging rehearsal (run 2).

| Step | Action | Expected | Rehearsal |
|------|--------|----------|-----------|
| 5a Freeze | Set `BATCHES_FREEZE="<HH:MM>"` and redeploy (or it already rode step 4's combined change). Record the time T0 in ISO-Z. | `store modes` unchanged. An admin task tick shows "Batches are read-only for maintenance until <HH:MM>", BrewPad tick shows "Save failed", reads load, and `batch.html` opens for an existing printed token. | 5 min (redeploy 3.5-5) |
| 5b Invoice list | Start the list: every Zoho invoice dated ≥ T0. Cross-check with `railway logs … \| grep -E 'create_batch refused: maintenance\|batch_retry_queued'`. | numbers only in the log | - |
| 5c Snapshot | Owner downloads **S4** (or **S5** on the non-combined path) after T0. Upload it to `/tmp/b1.xlsx`. | - | 1-2 |
| 5d Dry run | `RS "$M"' && node scripts/backfill/batches-backfill.js --file=/tmp/b1.xlsx --out-dir=/tmp/b-out --dry-run'` | **0 rejects**, exit 0. Counts about 205+ / 1070+ / 70+ / 430+ (staging was 204/1064/70/427 on 10-09). Sequence seeds are greater than every max id. | seconds |
| 5e Promote | The same with `--promote`, run interactively, type the DB name | 10 invariants passed; exit 0 | seconds |
| 5f Verify | Owner downloads the **next snapshot** after the promote. Upload it to `/tmp/b2.xlsx`, then run `RS "$M"' && node scripts/backfill/batches-verify.js --file=/tmp/b2.xlsx'` | headers match, counts equal, 0 orphans, **0 mismatches**, exit 0 | 1-2 |
| 5g Parity | **Wait until ≥ 300 s after T0** (Apps Script cache). Run `RS "$M"' && node scripts/backfill/batches-parity.js --snapshot-out=/tmp/pre-cutover-2026-10-18.json'`, then **copy it off the container before the flip** (the redeploy wipes `/tmp`): `RS 'cat /tmp/pre-cutover-2026-10-18.json' > ~/sv-backfill/pre-cutover-2026-10-18.json` (outside the repo; holds customer names). | `parity: 0 differences (5 reads)`, exit 0 | 5 |
| 5h GO/NO-GO A5 | The owner reviews: rejects 0, counts equal, verify 0, parity 0 | NO-GO before the flip: unset `BATCHES_FREEZE` and leave `BATCHES_STORE` unset. PG rows are inert. To retry, empty the 6 tables (§16 SQL, logged). | 1 |
| 5i Flip | ONE change: `BATCHES_STORE=postgres` + **delete** `BATCHES_FREEZE`, then `railway redeploy … -y` (CLI delete does not deploy). Record T1. | `store modes … "BATCHES_STORE":"postgres"`, `/health` database_required true, mirror ENABLED, drift timer registered, and a write is no longer refused | 2 (+ redeploy) |
| 5j D-12 notices | AS1: run `setupBatchMirrorNotices()` in the Apps Script editor | row-1 notes + warning protections on 4 tabs | not rehearsed (shared workbook) |
| 5k Post-flip parity (run BEFORE the smoke writes) | On the **Mac**: start `read -s BATCH_PARITY_SESSION && export BATCH_PARITY_SESSION`, THEN in the admin console run `copy(localStorage.getItem('sv_session_token'))` and paste. Then `export BATCH_PARITY_BASE_URL=https://svmiddleware-production.up.railway.app` and, from `zoho-middleware/`, `node scripts/backfill/batches-parity.js --against-snapshot="$HOME/sv-backfill/pre-cutover-2026-10-18.json" --via=proxy` | 0 differences, exit 0 | ~5 |
| 5l Smoke (owner) | BrewPad: create a test batch on an Empty vessel (check the mirrored sheet row appears ≤ 60 s), mark a task, add a reading, transfer the vessel. Admin: regenerate the token on the test batch (old token → `invalid_token`, new one loads). Open `batch.html` with an **existing** printed token. Then delete the test batch (the mirror removes its rows). | all writes 200; `[batch-proxy] create_batch ms=<n>` logged; no `ops-mirror` error; 0 dirty markers | ~15 (staging UAT) |
| 5m Scan invoices | Z1: admin → Scan invoices, run once (idempotent). Tick each invoice on the 5b list as created or already-existing. | every window invoice has its batch(es) | not rehearsed (shared Zoho) |
| 5n Close | Tell staff the window is closed. Record T2. Delete `/tmp/*.xlsx` in the container and the S4/S5 downloads. **Keep** `~/sv-backfill/pre-cutover-*.json` until day-7 retirement. | - | - |

**Rollback inside the window** (any failed smoke write or parity diff after the flip):
1. Set `BATCHES_FREEZE` again.
2. Set `BATCHES_STORE` to `sheets` (or delete it) and redeploy.
3. If only smoke writes happened: delete the smoke batch, or replay with `RS "$M"' && node scripts/backfill/batches-replay-to-sheet.js --since=<T1>'` (dry), then `--apply`.
4. Run `removeBatchMirrorNotices()` (AS).
5. Run `batches-verify` on a fresh snapshot.
6. Unfreeze.

**Rollback days 1-7:** RUNBOOK P87 §13. Replay `--since=<T1> --apply` first, then verify, then remove the notices, then `BATCHES_STORE=sheets`. On any re-flip, re-seed the sequences.

**After the window:**
- 87-20 begins: daily `[batches-drift]` line plus the Sentry `batches-drift` record, days 1-7 (Mon 10-19 to Sun 10-25). The first run may show false `start_date`/`due_date` mismatches, which are explained.
- 87-19 Task 3 next business day: a real kiosk or online sale creates its batch, and record the median of the `create_batch ms`.

---

## Gaps / adjustments vs the written plans

| # | Tag | Where | What changed / risk | Action |
|---|-----|-------|---------------------|--------|
| 1 | ADJUST | 86-19 Task 1, RUNBOOK P86 §12, 87-19 Task 1, RUNBOOK P87 §0 ("pinned production SHA", "deploy Phase 87 code") | Done. All of main shipped as `47fcd354` (`prod-20261017-1`), with 0004/0005/0006 applied. | Mark 86-19 Task 1 and 87-19 Task 1's deploy half done. Record `47fcd354` as the window SHA in 87-CUTOVER-LOG "Production prerequisites". No deploy tomorrow. |
| 2 | ADJUST | RUNBOOK P85 §5 callout + §6/§8/§9/§10/§13, 85-DUAL-LOG "Production prerequisites 2026-10-14", RUNBOOK P86 §12 line 1202, RUNBOOK L64-65 deploy history, 86-18 SUMMARY decisions, P87 design §15 "Release train (Q10)" | `d2c66be9` / `release/85-13-node24` pin rules are obsolete. The ops and batch scripts have **no** pin rule: they run from the shipped release (in-container). | Remove after step 1. Leave the historical deploy-history rows as history. |
| 3 | ADJUST | 86-20 Task 1, RUNBOOK P86 §6, D-11 | The 7-day window is replaced by the scripted step 3 (owner decision). The flip bar's "≥7 consecutive days" acceptance criterion will not be met. | Record the owner override in 86-DUAL-LOG "Flip decision" (same form as 85). |
| 4 | ADJUST | 86-19 Task 2 "after hours", 86-19 Task 3 "opening-day smoke", 86-20 "after hours", RUNBOOK P87 §2 "Sunday evening after close" (D-02) | It is a daytime Sunday with the shop closed. The opening-day smoke becomes Monday's check, folded into 87-19 Task 3 (regular-staff sign-in, a real batch flow, logs). | Record as owner decision. Monday: every regular staff member signs in once. |
| 5 | ADJUST | 86-19/86-20 "Apps Script v61 still the active version", RUNBOOK P86 §9 "roll back to 60", P87 §13.7 "v61" | Active is v65. Rolling back below v65 drops the 87 mirror and the 89 `beer_category`. | The rollback target for Apps Script today is "stay on v65". |
| 6 | ADJUST | RUNBOOK P86 §4, P87 §4/§5/§16, README step 3 (`railway connect` tunnel, `read -s BACKFILL_DATABASE_URL`, `~/sv-backfill/…`) | The tunnel fails from zoho-middleware/. Use in-container with `BACKFILL_DATABASE_URL="$DATABASE_URL"` and `BACKFILL_STAFF_EMAILS="$STAFF_EMAILS"` (no secret typed). Snapshots go to `/tmp`. | Update the RUNBOOK text after the day. |
| 7 | **BLOCKER** (procedural) | P87 §6/§10 parity `--snapshot-out` → `--against-snapshot` | Run in-container, the pre-cutover snapshot sits in `/tmp` and is **wiped by the flip redeploy**. | Step 5g copies it to `~/sv-backfill/` before the flip. 5k runs on the Mac (it needs the proxy only, not the DB). |
| 8 | ADJUST | RUNBOOK P86 §7 schedule "archive it, then delete it" | Archived schedules can't be deleted from admin (86-18), so archiving leaves permanent prod residue. | Delete only (D-11 "delete-or-archive"). |
| 9 | ADJUST | 86-20 Task 3 step 4, 86-SECURITY §7 ("non-owner staff token", "write call") | Nobody is in on Sunday. The Config cell is the only OAuth limb, and no browser code calls Apps Script directly. | Use the owner's token for a positive control, then a negative read probe (step 4.4). "Probe-then-blank" = control before blanking, unauthorized after. |
| 10 | ADJUST | 86-20 Task 3 step 5 (STAFF_EMAILS trim) | It needs a regular staff sign-in right after the trim. | Defer the trim to Monday. D-18 closes today; the trim closes Monday. |
| 11 | ADJUST | RUNBOOK P86 §5 step 5 / 86-19 Task 3 "every regular staff member signs in once" | Not possible on a closed Sunday. | Monday, before the trim. Record the count, no names. |
| 12 | ADJUST | Snapshot count | The plans need about 7-8 downloads (85 verify, ops dry run, 2 ops verifies, mid-window verify, post-flip verify, 87 backfill, 87 verify). | 5 with S1 shared and S4 combined, 6 without the combined freeze. |
| 13 | ADJUST | RUNBOOK P87 §8 "In ONE Railway variable change" | The CLI can't set and delete in one call, and delete/`--skip-deploys` don't redeploy. | Use the Railway UI batch or CLI then `railway redeploy -y`. Always confirm the `store modes` line. |
| 14 | RISK | Boot guard `lib/batch-flag.js` | After step 5, `OPS_DATA_STORE=sheets` would **refuse to boot** while `BATCHES_STORE=postgres`. Any 86 rollback during the 87 week must roll 87 back first, or use `dual`, not `sheets`. | Noted in step 4's rollback. |
| 15 | RISK | Step 3 test batch (sheets) vs the 87 snapshot | The test batch must be deleted before 5c, or it's imported and becomes real data. | Checked in the step 5 preconditions. |
| 16 | RISK | No-push rule | `watchPatterns=["**"]` + a failed build blocks variable redeploys, which would make a freeze impossible to lift (87-18). | No pushes of any kind during the day. Commit docs after 5n. |
| 17 | RISK | BrewPad freeze UX | BrewPad shows a generic "Save failed", not the maintenance text. | Tell staff in advance (Sunday: only the owner is active). |
| 18 | RISK | Online orders during the freeze | Kiosk and online sales still invoice. The batch create is refused and the retry queue gives up after ~15 min. | The 5b invoice list plus 5m Scan invoices. Scan invoices has never run against prod Postgres (skipped on staging, shared Zoho). Watch for a `cf_batch_status` write per invoice. |
| 19 | RISK | Parity time rules | It refuses within 15 min of local midnight (no issue in daytime). It needs ≥ 300 s after the last write (cache). | 5g waits. |
| 20 | INFO | Gate evidence not yet recorded | 86-DUAL-LOG "Production cutover", "Op coverage", "Flip decision" and "Post-flip verification" are empty, and 87-CUTOVER-LOG "Production prerequisites" has 5 empty rows. P87 §0 wants the Phase 86 flip recorded before the date is set. | Fill these as each step completes. The 87 gate is met only after step 4 is recorded. |
| 21 | INFO | 87-CUTOVER-LOG Q3 caveat (Node 20 tzdata) | Resolved. Prod is on Node 24.21 since 10-16. | Update the row. The Postgres server timezone check is still open (memory); batches store dates as text/ISO, so it's low risk. |
| 22 | INFO | Railway PG 18.6 vs CI postgres:16 | Pre-existing mismatch. Today's promotes are plain INSERT/setval. | None for tomorrow. |
| 23 | INFO | `gh` unauthenticated | No workflow is needed tomorrow (no deploy). | - |
| 24 | INFO | Sentry | `SENTRY_ENVIRONMENT` is unset on prod (intentional), so prod events are untagged by environment. Claude may lack Sentry access. | SE1 owner check after steps 2-5. |
| 25 | INFO | Pending from release | Reload the kiosk iPad. Phase 89 D-06 picks redone in prod BrewPad (11 recipes). Phase 90 Unlinked queue triage. | Not blocking. Do the iPad reload before Monday open. |
| 26 | INFO | Accepted residue | TST-901 (archived) stays in prod vessels and the sheet. The test staff audit rows stay. | Recorded. |
| 27 | INFO | Memory/docs drift | MEMORY "Phase 86 ops-data status: 85-13 deploy MUST use d2c66be9:main" is stale. The `node-tzdata-bc-permanent-time` todo is still in `.planning/todos/pending/` though resolved. | Tidy after the day. |
| 28 | INFO | Working tree | `links.html` is modified and uncommitted (unrelated). | Don't sweep it into tomorrow's doc commits. |
