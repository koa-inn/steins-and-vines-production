---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 10
subsystem: rollout
tags: [staging, uat, release-approval]
requires: [96-02, 96-09]
provides: [staging deploy, staging UAT (desktop Chrome), production pre-deploy record, owner release approval]
key-files:
  created:
    - .planning/phases/96-new-and-upgraded-dashboard-graphs/96-ROLLOUT-LOG.md
    - .planning/todos/pending/recipe-og-target-fg-capture.md
    - tests/frontend/brewpad-dashboard-v2-type-labels.test.js
  modified:
    - js/brewpad.js
    - css/brewpad.css
decisions:
  - "Owner approved fixing the duplicate DASH_TYPE_LABELS before staging (ac8124b7)"
  - "Owner asked for all seven Chrome-pass UAT fixes (8dcccc79)"
  - "Owner waived the iPad UAT: BrewPad is mostly used from a desktop browser; desktop Chrome pass accepted"
  - "Owner approved production release of 3f761072; rollback target Railway a3cce010"
  - "OG/target FG capture tracked as a follow-up todo (candidate Phase 97)"
metrics:
  completed: 2026-10-29
---

# Phase 96 Plan 10: Staging, UAT and release approval Summary

Phase 96 deployed to staging (`ac8124b7`, then `8dcccc79` with UAT fixes). The live payload check passed: all four new arrays are present, every column is on the approved list, and there are no emails, raw snapshots or `customer_*` keys in them. A desktop Chrome pass with the owner signed in, plus a 390px phone-width check, verified all ten widgets, cross-widget totals and both drill paths. Seven display issues found there were fixed, each with a test written first, and re-verified on staging. The owner waived the iPad pass and approved release of `3f761072`.

**G8 note:** the expected curve, attenuation and ABV stay dormant until OG/target FG are recorded on recipes. The owner chose to track that as a follow-up (`recipe-og-target-fg-capture.md`).

## Deviations from Plan

- **Extra pre-deploy fix:** `ac8124b7` merged the duplicate `DASH_TYPE_LABELS` map. The owner approved it, and it ships with a regression test.
- **iPad UAT waived:** the owner replaced it with the desktop Chrome pass.
- **Combined commit:** the seven UAT fixes went in as one commit (`8dcccc79`) instead of one per fix.
- **Payload check method:** read-only, inside the container against the staging database, not through the browser network panel.

## Self-Check: PASSED
