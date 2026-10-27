---
phase: 86-vessels-fermschedules-config-postgres
plan: 20
subsystem: release
tags: [production, flip, postgres, security, d-18]
requires: ["86-19"]
provides:
  - Production OPS_DATA_STORE=postgres and STAFF_ACCESS_STORE=postgres
  - D-18 Config staff_emails bypass closed
affects: [86-DUAL-LOG.md, 86-SECURITY.md, docs/RUNBOOK.md, 87-CUTOVER-LOG.md]
key-files:
  modified:
    - .planning/phases/86-vessels-fermschedules-config-postgres/86-DUAL-LOG.md
    - .planning/phases/86-vessels-fermschedules-config-postgres/86-SECURITY.md
    - docs/RUNBOOK.md
decisions:
  - "Owner override of the 7-day D-11 bar: flipped after 8 days in dual with clean logs, plus a short scripted production check"
  - "Staff add/role/remove second-account check skipped on production (owners only; covered on staging and by tests)"
  - "Schedule propagate not re-run on production (staging 2026-10-08 only)"
  - "Flipped in the same Railway change that set BATCHES_FREEZE (runsheet combined variant)"
  - "D-18 probe used the owner's token (the Config cell was the only OAuth limb)"
  - "STAFF_EMAILS trim not needed: it already held one owner account"
metrics:
  completed: 2026-10-27
---

# Phase 86 Plan 20: Production flip to Postgres Summary

Production vessels, ferm schedules, config and the staff sign-in list now run on Postgres, with the
sheet kept as a permanent mirror for vessels and schedules. The old Config `staff_emails` way in is closed.

## What happened (2026-10-27, shop open, owner present)

1. **Window review.** Production had been in dual since 2026-10-19. The current deployment's logs
   (10-22 → 10-27) showed no `ops-mirror` errors and no `[dual-write] staff-access` lines, and there
   were 0 dirty markers.
2. **Short scripted check on production** (owner's choice):
   - Vessels: TST-901 add, edit, In-Use/Empty override, archive refused while In-Use (409), archive.
   - Schedules: "ZZ Test Schedule 2026-10-27" create, edit, delete.
   - S3 `ops-verify`: 233 vessels / 13 schedules, 0 mismatches, staff missing 0.
3. **Flip.** OPS, STAFF and `BATCHES_FREEZE` were set in one change at 18:11:21Z. Deploy `fd9fb39e` went live at 18:13:39Z.
4. **D-18.**
   - Owner-token probe before blanking: `true`.
   - The owner blanked the cell and wrote the retirement note.
   - Probe after a 6-minute wait: `false unauthorized`.
5. **Post-flip verify.** S4 `ops-verify`: 0 mismatches.
6. **Sign-in.** The owner signed in to BrewPad and admin after the flip.

## Deviations

- The flip bar was met by owner override, not by 7 consecutive days. It is recorded in 86-DUAL-LOG "Flip decision".
- Staff add/role/remove was not exercised on production.

## Residue

- TST-901 stays archived in production vessels and in the sheet (no hard delete, D-07).
