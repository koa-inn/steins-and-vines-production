# Phase 86 — Ops Data Dual-Window Log

Owner-maintained log for the `OPS_DATA_STORE=dual` and `STAFF_ACCESS_STORE=dual` window
(D-09/D-10/D-11/D-12/D-18/D-19). See `docs/RUNBOOK.md` § "Ops data → Postgres (Phase 86)" for the
procedure this log supports. No secrets, no names, no emails, no vessel notes: ids, field names and
classifications only.

## Header

| Field | Value |
|-------|-------|
| Environment | production |
| `OPS_DATA_STORE=dual` set at | 2026-10-20T00:00:45Z (Mon 2026-10-19 17:00 PDT, shop closed); deployment `b523aaf0`, rollback `ea61a171` |
| `STAFF_ACCESS_STORE=dual` set at | 2026-10-20T00:00:45Z (same single change as OPS) |
| Window day 1 date | 2026-10-20 (Tue, first open day in dual) |
| Current window start (resets to day 1 on any bug-classified discrepancy) | 2026-10-20 |

## Production prerequisites (D-12)

| Check | Evidence | Date |
|-------|----------|------|
| Production `RECIPES_STORE=postgres` recorded in 85-DUAL-LOG.md "Flip decision" | Flipped 2026-10-17 19:17:15Z (85-DUAL-LOG.md) | 2026-10-17 |
| Phase 85 post-flip verification complete | 85-DUAL-LOG.md "Post-flip verification (2026-10-17, production)"; re-run from shipped main 2026-10-19 on S1: `Verified 13 recipes: 0 mismatches`, exit 0 (runsheet step 1, A1 GO) | 2026-10-19 |
| Data-hygiene decisions (FS-0011 "ZZ Test Template", "[gfs-probe]" on FS-0001): delete/clean or accept | Owner: import both as-is (accept) | 2026-10-08 |
| Vessels `label` header present (`ops-verify.js` prints "Vessels label header: present") | label header added to Vessels L1; staging verify printed "present" | 2026-10-08 |

## Phase 86 Apps Script versions

| Field | Value |
|-------|-------|
| New version | 61 |
| Rollback version | 60 |
| Deployed on | 2026-10-08 (owner; editor-drift check skipped, owner judged no editor edits since v60) |
| Probes (get_vessels, get_ferm_schedules, update_batch via proxy shows staff email in VesselHistory) | |

## Staging rehearsal

| Date | Step | Result |
|------|------|--------|
| 2026-10-08 | staging candidate SHA | `b5aad084` pushed to origin/main; staging middleware restarted healthy (database:true) |
| 2026-10-08 | backfill dry run (0 rejects) | 232 vessels, 11 schedules, 2 config keys, 2 staff (1 owner); 0 rejects. Two earlier runs were blocked: Config tab had no header row (key/value header added), and owner/staff env input was missing |
| 2026-10-08 | promote + `ops-verify.js` 0 mismatches | Promoted 232/11/2/2, sequences 11/232. Verify on a fresh snapshot: label header present, 0 mismatches, staff missing-from-PG 0, PG-only 1 (owner passed via --owners) |
| 2026-10-08 | dual on, pre-open mirror write verified | OPS_DATA_STORE=dual + STAFF_ACCESS_STORE=dual set together on staging; /health ok, database_required:true; /api/vessels and /api/staff-access/me 401 anonymous. Mirror write N/A on staging (staging never mirrors) |

### Staging UAT (86-18 Task 3, 2026-10-08, owner-approved; run in Chrome by Claude as hello@ owner/break-glass)

| Step | Result |
|------|--------|
| 1 Vessels tab | PASS: TST-001 added via next-id prefill; edit; stale save showed the D-16 message + Reload; status override In-Use; archive refused while In-Use; Empty then archive hides it (status Disabled/Retired, BrewPad picker filters it); unarchive OK; no Delete button |
| 2 Batch flow | PASS: test batch SV-B-000236 in TST-001 flipped it to In-Use; deleting the batch set it back to Empty. Staging never writes the Vessels sheet |
| 3 Schedules | PASS: FS-0012 got the next sequence id; stale edit showed the message; a batch created with the PG-only schedule; propagate updated 1, failed []; delete blocked "0 recipe(s) and 1 batch(es)"; deleted after the batch was removed; archive (FS-0013) hides it from admin and BrewPad lists |
| 3 bug found | **FIXED `e6da5880`:** in dual, the get_batch_init overlay returned `data.schedules` as a bare array, so the admin Schedule Templates list rendered empty. Fixed to `{schedules:[...]}`, re-verified on staging (11 cards) |
| 4 Staff Access | PASS (owner side): tab visible; list 2 staff + 1 break-glass-only; self-remove -> 409 cannot_remove_self. Second-account add/role/remove-403 **skipped by owner, covered by tests** (staff-access-routes, auth-tiers-revocation) |
| 5 Attribution | PASS: batch created_by and VesselHistory transferred_by = staff email, not kiosk-middleware |
| 6 Recipes | PASS: public /api/recipes still shows ferment_days 21 for FS-0010 recipes |

Leftover staging test data: TST-001 (Empty, label "UAT test carboy") and FS-0013 (archived). SV-B-000236 and FS-0012 were deleted.

## Production cutover

| Date | Step | Result |
|------|------|--------|
| 2026-10-19 | backfill dry run (0 rejects) | In-container on S1 (sha `772790ed`): 232 vessels, 13 schedules, 2 config keys, 2 staff (2 owners); seeds 13/232; 0 non-imported keys; 0 Config staff_emails entries outside the Railway list; **0 rejects**. Pre-check: all 10 ops/batch tables were 0; C1 headers OK (Vessels `label` after `notes`, Config `key \| value`) |
| 2026-10-19 | promote + `ops-verify.js` 0 mismatches | Promoted 232/13/2/2, sequences 13/232. `ops-verify` on S1: label header present, **0 mismatches**, staff missing-from-PG 0, PG-only 1 (an owner passed via --owners that is not in env STAFF_EMAILS) |
| 2026-10-20 00:00:45Z | both flags set to dual together; `/health` `database_required` true | One `railway variable set` (both keys) → deploy `b523aaf0` SUCCESS. store modes: GIFT_CARDS postgres, RECIPES postgres, OPS dual, STAFF dual, BATCHES sheets. `/health` ok, authenticated, redis, database, database_required true |
| 2026-10-20 00:03:06Z | startup log "Ops mirror sweep registered" | `[sheet-mirror] mirror ENABLED (environment=production)` + `[ops-mirror] Ops mirror sweep registered: every 5 minutes` |
| 2026-10-20 00:03:41Z | pre-open mirror write + fresh-snapshot verify | Owner session (Claude in Chrome): MT-001 (Empty) notes edit, `PUT /api/vessels/MT-001` 200 in 23 ms; dirty markers 0. S2 (sha `8346e38a`, downloaded after the write): MT-001 notes on the sheet match; `ops-verify` **0 mismatches** (232/13), missing-from-PG 0, PG-only 1 (as above); row layout check: MT-001 and FS-0001 cell counts ≤ header, types match neighbours BK-001/FS-0002, no shift. **A2 GO.** S1/S2 deleted from the container |
| | every regular staff member signed in once | |

**Scope note (owner decision, 2026-10-19):** Only runsheet steps 1-2 were run on Mon 10-19 (the
Sunday 10-18 session did not happen). The owner chose dual-only for the evening, so staff use dual
for real Tue 10-20 to Sat 10-24. This restores most of the D-11 real-use window that the runsheet
had replaced with the scripted step 3. The flip (86-20) and the 87-19 batch window move to the next
closed day. The scripted step 3 still runs before the flip for any action real use has not covered.

Open for the window: every regular staff member signs in once. The production staff list is the
2 owner accounts only, so the owner must confirm whether any other staff account needs adding
before the STAFF_EMAILS trim.

## Op coverage

One row per D-11 action. "First seen at" is the first time the action ran (real traffic or the
RUNBOOK §7 scripted runsheet) during the CURRENT window. "Sentry clean?" is yes only if zero
unexplained discrepancies were raised for that action during the current window.

| Action | First seen at | Real or scripted | Sentry clean? |
|--------|----------------|-------------------|----------------|
| vessel add | production 2026-10-27 ~17:56Z (TST-901) | scripted | yes |
| vessel edit | production 2026-10-20 00:03:41Z (MT-001 notes); real edits through 2026-10-23; TST-901 location 2026-10-27 | real + scripted | yes |
| vessel archive | production 2026-10-27 17:57:46Z (TST-901; archive while In-Use refused 409 first) | scripted | yes |
| vessel status override | production 2026-10-27 (TST-901 In-Use, then Empty) | scripted | yes |
| batch-flow vessel status delta | production, real BrewPad batch flows during the window (~174 admin-proxy calls 10-22..10-27); post-flip SV-B-000246 on LFB-009/LFB-008 2026-10-27 | real + scripted | yes |
| schedule create | production 2026-10-27 ("ZZ Test Schedule 2026-10-27") | scripted | yes |
| schedule edit | production 2026-10-27 (added a day-7 step) | scripted | yes |
| schedule delete-or-archive | production 2026-10-27 (test schedule deleted; PG back to 13) | scripted | yes |
| schedule propagate | staging 2026-10-08 only (owner chose the short check; no active batch used the test schedule) | staging | yes |
| staff add | staging 2026-10-08 + tests (owner skipped the second-account check: production has owners only) | staging/tests | yes |
| staff remove | tests only (staff-access-routes, auth-tiers-revocation); owner skip, see above | tests | yes |
| staff role change | tests only; owner skip, see above | tests | yes |

## Discrepancy table

One row per Sentry `[dual-write]` event, `ops-mirror` error or manually found `ops-verify.js`
mismatch. Every row must be classified before the flip bar can be met.

| Date | Entity | Id | Field | Classification (explained/bug) | Fix commit |
|------|--------|----|-------|----------------------------------|------------|
| | | | | | |

## Staff decisions

Shadow-compare outcomes for the un-mirrored staff list (D-10). Counts only, never emails.

| Date | Shadow disagreements (count) | Explanation |
|------|-------------------------------|-------------|
| | | |

## Window days

| Day | Date | Sentry `ops-mirror` clean? | `ops:mirror-dirty` markers | `ops-verify.js` result | Notes |
|-----|------|-----------------------------|-----------------------------|--------------------------|-------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |

## Explained differences (known up front)

Copy of RUNBOOK §11.

- Vessel status drift when a Postgres status apply failed (Sentry names the vessel; replay fixes it).
- jsonb key order in schedule steps (verify compares parsed).
- Vessel location is trimmed on import.
- New vessels do not get Zoho inventory items (Pitfall 11).

## Flip decision

Filled in once the flip bar (at least 7 consecutive days, every Op-coverage action observed, zero
unexplained discrepancies) is met and the owner decides to flip to `postgres`.

| Field | Value |
|-------|-------|
| Owner | hello@ (owner), in session |
| Date | 2026-10-27 (Tue, shop open; owner accepted BrewPad downtime) |
| Decision | **Flip.** Owner override of the 7-day bar (D-11): 8 calendar days in dual (10-19 → 10-27), 0 `ops-mirror` errors and 0 `[dual-write] staff-access` lines in the current deployment's logs (10-22 → 10-27), 0 dirty markers, plus a short scripted check on production (vessel add/edit/status/archive-refused/archive, schedule create/edit/delete) and S3 `ops-verify` 233 vessels / 13 schedules, 0 mismatches. Staff add/role/remove on production skipped by the owner (owners only; covered on staging and by tests). Flipped together with the 87 freeze (combined variant). |

## Post-flip verification

| Check | Result | Date |
|-------|--------|------|
| Both flags `postgres`; `ops-verify.js` 0 mismatches | PASS. One `railway variable set` (OPS, STAFF, plus `BATCHES_FREEZE`) at 18:11:21Z → deploy `fd9fb39e` SUCCESS, store modes OPS/STAFF postgres at 18:13:39Z, mirror ENABLED, ops sweep registered, `/health` database_required true. S4 (downloaded 11:15 PDT, after the flip) `ops-verify`: label header present, 233 vessels / 13 schedules, **0 mismatches** | 2026-10-27 |
| D-18: Config `staff_emails` value cell blanked with retirement note | PASS (owner blanked column B and wrote the retirement note in column C) | 2026-10-27 |
| Direct Apps Script call with a non-owner staff token returns unauthorized (after 5 minutes) | PASS with the owner's token (runsheet adjustment 9: the cell was the only OAuth limb). Positive control before blanking: `true -`. After a 6-minute wait (18:20:58Z): `false unauthorized`. Token read from the clipboard, never printed; clipboard cleared after | 2026-10-27 |
| `ops-verify.js` staff leg: missing from Postgres 0 | PASS (S3 and S4: missing 0, Postgres-only 1 = an owner passed via `--owners`) | 2026-10-27 |
| Railway `STAFF_EMAILS` trimmed to owner break-glass only (date) | Not needed: production `STAFF_EMAILS` already holds 1 owner account. Owner confirmed no non-owner staff sign in with their own account | 2026-10-27 |
| Regular staff member and an owner can still sign in | Owner signed in to BrewPad after the flip (`POST /auth/google` 200, 18:43Z) and to admin. No regular staff accounts exist | 2026-10-27 |

## Production prerequisites and release (86-19 Task 1), 2026-10-17

| Check | Value |
|-------|-------|
| D-12 | Met. Production `RECIPES_STORE=postgres` since 2026-10-17 19:17:15Z; post-flip verify 13/0 (85-DUAL-LOG.md). |
| Security sign-off | 86-SECURITY.md, owner, 2026-10-08 |
| Vessels `label` header | Owner confirmed present 2026-10-17 |
| Phase 92 CR-01 PIN on Customer View exit | Owner confirmed during the 93 UAT, 2026-10-17 |
| Release | Gated Production Deploy, run 2 (run 1 failed at test-frontend: a UTC-only Jest timezone bug, fixed in d12b4b9b). Staging SHA `d12b4b9b` became production `47fcd354` (+CNAME), tag `prod-20261017-1`. Railway deployment `b3fd002a` SUCCESS, 2026-10-17 12:45 PDT. Rollback target: `990f1764`. |
| Migrations | `0004_ops_data`, `0005_batches` and `0006_recipes_beer_category` applied by the pre-deploy guard chain ("Migrations complete!") |
| Store modes at startup | `{"GIFT_CARDS_STORE":"postgres","RECIPES_STORE":"postgres","OPS_DATA_STORE":"sheets","STAFF_ACCESS_STORE":"sheets","BATCHES_STORE":"sheets"}`. The new code prints the unset flags explicitly as `sheets`, i.e. off. |
| `/health` | ok, `database:true`, `database_required:true` |
| Smoke | `/api/recipes?status=active` returns `source: postgres`, 11 recipes, all carrying `beer_category`. Kiosk quote SV-R-000016 at 28 L in-store is still $97.85. Admin-proxy `get_vessels` returns 232 and `get_ferm_schedules` 12 (from the Sheet). Production kiosk.html serves the new bundle with the Week/Month chips and Past Sales. beer.html has 11 cards with "Ready in" and no console or CSP errors. Logs show only the known Resend verify message. |
| Apps Script | v65 active on the shared deployment (covers v61 for 86, v62 for 87, v63/v65 for 89) |
| Staff sign-in (allowlist read from the Sheet) | **PASS**, 2026-10-17 ~12:55 PDT. The owner signed in to production admin and BrewPad. Admin shows its tabs, including the new Vessels tab. The BrewPad dashboard loaded (KPIs, Needs Attention, batches). The BrewPad proxy returned `get_vessels` 232 and `get_ferm_schedules` 12. The admin proxy returned `get_batch_init` 200 (41 active batches, 12 schedules, summary). No console errors. |
| Pending | Reload the kiosk iPad. Run `recipes-verify.js` from main with the next snapshot (Phase 89 step). |
