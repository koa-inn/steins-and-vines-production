---
phase: 84-giftcards-postgres
plan: 10
subsystem: database
tags: [postgres, gift-cards, staging, cutover, uat, money-path]

requires:
  - phase: 84-giftcards-postgres
    plan: 09
    provides: "verify/replay scripts, RUNBOOK Phase 84 runsheet, 84-DUAL-LOG.md template"
provides:
  - "Staging running GIFT_CARDS_STORE=dual on the full Phase 84 build, backfilled and verified (0 mismatches)"
  - "Apps Script v59 live on the shared deployment (rollback v58)"
  - "84-DUAL-LOG.md 'Staging rehearsal' record incl. the per-step iPad UAT table"
affects: [84-11-production-cutover, 84-12-dual-window-flip]

key-files:
  modified:
    - .planning/phases/84-giftcards-postgres/84-DUAL-LOG.md
    - docs/RUNBOOK.md

completed: 2026-10-06
status: complete-with-gaps
---

# 84-10 Summary — staging rehearsal

**Outcome: owner-approved with gaps (2026-10-06).** Tasks 1–2 fully done; Task 3 (iPad UAT)
partially run on 10-03 and the owner chose to skip the rest.

## Tasks

| Task | Result |
|------|--------|
| 1. Full automated gate | Done (merged tree green; see 84-DUAL-LOG step 1) |
| 2. Staging push, Apps Script v59, backfill, dual, verify | Done 2026-10-03 — `4e8432df` deployed; v58→v59; 1 card promoted; 0 mismatches |
| 3. iPad Safari UAT | **Approved with gaps** — PASS: 2, 8. Owner-attested (client-side, no trace possible): 3, 5, 6. Not runnable on staging: 1. **Not run: 4, 7 (redeem half), 9 (lookup + switch back).** |

## Deviations

- **Staging left in `sheets` for 3 days.** The step-9 toggle (10-03 16:02 PDT) was never reverted.
  No gift-card traffic hit staging in that window (logs checked). Restored to `dual` 2026-10-06.
- **Unscripted +$5.00 goodwill adjust** on GC-000002 during the UAT; harmless (card since voided).
- **Out-of-plan change shipped to staging during closeout:** `11b5c27b` — gift-cert fields accept
  just the digits ("42" → GC-000042) with the number keyboard, prompted by awkward iPad typing in
  this UAT. Tests 26 new / frontend 2102 / middleware 2275 green.

## Risk accepted by the owner

The live issue-and-redeem-in-one-sale check (Pitfall 1) has not run on real hardware. Mitigations:
84-08 regression tests; the 84-12 flip bar requires a real `redeem` to be observed in production
dual before the switch to `postgres`.

## Open items carried to 84-11

1. D-05 sale-path attribution — `issue` rows carry no actor/device (owner sign-off needed).
2. Voided GC-000002 keeps `current_balance 6.25` — confirm intended.
3. A production push ships all of `main`, including other staging-only phases — agree scope first.
4. Rotate the staging Postgres password (printed in the 10-03 session).
5. Void test invoice INV-000228 in Zoho (staging and production share org `110002406307`).
