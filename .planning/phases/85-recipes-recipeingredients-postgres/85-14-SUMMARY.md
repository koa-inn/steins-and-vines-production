---
phase: 85-recipes-recipeingredients-postgres
plan: 14
status: complete
completed: 2026-10-17
key-files:
  modified:
    - .planning/phases/85-recipes-recipeingredients-postgres/85-DUAL-LOG.md
    - docs/RUNBOOK.md
---

# 85-14 Summary: Dual window and flip to Postgres

Production recipes now run on Postgres (`RECIPES_STORE=postgres`). The flip was set at 2026-10-17 19:17:15Z. The sheet stays as a permanent state-copy mirror.

## Task 1: Dual window
- **Window:** started 2026-10-16 20:46:28Z.
- **Real traffic:** almost none (reads, plus one cold kiosk quote).
- **Scripted runsheet** (RUNBOOK §7, 2026-10-17), with all six ops observed and none raising a discrepancy:
  - create
  - ingredient edit
  - rename in 274 ms
  - public list/detail
  - kiosk sale INV-000246 ($2.34)
  - delete
- **D-05 totals:**
  - compared 6
  - skipped-settle 3 (explained)
  - skipped-dirty 0
  - mismatches 0
  - sheet fetch failures 1 (cold start on 10-16)
- **Mid-window verify:** 13 recipes, 0 mismatches.

## Task 2: Owner decision
**Flip on day 2.** The owner explicitly shortened the 7-day rule (D-07), because no recipe activity was expected for the rest of the day and every op had been covered by the runsheet. The decision is recorded in the 85-DUAL-LOG.md "Flip-decision block".

## Task 3: Flip and post-flip verification
All 7 steps passed:
- **Health:** startup store modes show postgres, the mirror is enabled, and `database_required:true`.
- **Verify:** 13 recipes, 0 mismatches.
- **Real-draft rename:** 354 ms, under the 2 s limit (SC4).
- **Kiosk quote:** unchanged at $97.85.
- **Public list:** served from postgres.
- **Logs:** no mirror errors or dirty markers.

## Deviations
- **Window length:** the 7-day window was cut to 2 days by owner decision. The evidence came from the scripted runsheet rather than from real traffic.
- **Flip timing:** done during opening hours, not after hours. There was no recipe activity at the time and the kiosk was idle.
- **Script source:** the verify ran from the production container's own release scripts (pre-Phase-89, no `beer_category`), which is equivalent to the D-14 pinned-worktree rule.

## Follow-ups
- **Phase 86:** 86-19 (ops data to dual) is now unblocked under D-12. It needs the Phase 86 code on production first, through a release branch, NOT `main`.
- **Terminal pushes:** the first two failed with Helcim 409 before the third succeeded. This is an existing todo, `kiosk-terminal-charge-lag`.
- **Resend:** startup logs "Email transport verification FAILED (Resend): key restricted to only send emails". This is pre-existing and worth a separate check.
- **Recipe sale tax:** tax is charged on the ingredients' retail value, not the locked price. This is existing behaviour; the owner should confirm it is intended.
