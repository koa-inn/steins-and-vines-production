---
phase: 90-brewpad-batch-invoice-linking
plan: 11
subsystem: release
tags: [staging, uat, d-17, runbook]
requires: [90-10]
provides: [Phase 90 staging release record, D-17 hardware session record, production promotion runsheet]
key-files:
  modified: [docs/RUNBOOK.md]
metrics:
  completed: 2026-10-15
---

# Phase 90 Plan 11: Staging release, Apps Script deploy, UAT and D-17 Summary

- Tasks 1-3 (staging push, Apps Script v64 deploy, staging UAT) are recorded in docs/RUNBOOK.md Phase 90 §2 and the deploy table (809aafac).
- Task 4 (D-17 staging hardware session) **passed on 2026-10-15** and is recorded in RUNBOOK Phase 90 §3:
  - Recipe auto-confirm: INV-000239.
  - Canning bundle: INV-000240 ($40.00 + 12% = $44.80, can line qty 52 at $0).
  - The owner **skipped** recipe manual confirm. Its one attempt failed closed with a 409 and no charge.

## Deviations from Plan
- The recipe manual-confirm leg was skipped by the owner. The kit-sale manual-confirm path was exercised by the bundle sale.
- The session found and fixed recipe money-path bugs outside Phase 90 scope:
  - f4272eed and ae191772.
  - c10e8111 and 0cfbd181 (invoice total ≠ charge; debug session `.planning/debug/resolved/kiosk-recipe-adjustment-round.md`).
  - f6e6eff8 and 34a85698 (kiosk receipt screen cut off on the iPad).
- The can count was 52, not the suggested small count. The test invoice was deleted, so stock is restored.

## Open after this plan
- Production promotion follows RUNBOOK Phase 90 §5. The kiosk recipe money-path hotfix (cherry-pick f4272eed, ae191772, c10e8111 and 0cfbd181 onto production/main) needs the owner's go.

## Self-Check: PASSED
