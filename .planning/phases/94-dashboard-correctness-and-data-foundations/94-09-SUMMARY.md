---
phase: 94-dashboard-correctness-and-data-foundations
plan: 09
subsystem: rollout (staging)
tags: [staging, backfill, postgres, batches]
key-files:
  created:
    - .planning/phases/94-dashboard-correctness-and-data-foundations/94-ROLLOUT-LOG.md
  modified: []
completed: 2026-10-27
---

# 94-09 Summary: Phase 94 staging rollout

Phase 94 runs on staging. Staging batches were refreshed into Postgres and flipped, both backfills were applied with
the owner's OK, and the dashboard matches the independent recompute exactly.

## What happened

- **Push and deploy:** pushed `141901a7` to staging. The deploy `9d2fea76` came up healthy and migration 0007 applied.
- **Staging was still on sheets.** `BATCHES_STORE` had been unset since the 87-18 rollback, and staging Postgres held stale data from 10-09. The owner chose "Refresh, then flip", so the 87 rehearsal steps were re-run:
  - freeze;
  - empty the six tables;
  - snapshot (tails clean), dry run with 0 rejects, then promote 215 / 1114 / 72 / 442;
  - fresh snapshot and verify (0 mismatches), then parity (0 differences);
  - flip `BATCHES_STORE=postgres`, live 21:40:46Z.
- **Dry runs:** the type dry run found 215 candidates (206 wine zoho, 5 cider zoho, 2 beer recipe, 1 cider schedule, 1 wine schedule) and 0 needing a type, which confirms the 94-06 `cf_type` assumption. The completed-at dry run found 40 to fill and 0 to leave blank.
- **Owner OK:** "yes, apply both on staging". Type apply wrote 215 and skipped 0; completed-at apply wrote 40 and skipped 0.
- **Recompute:** n 175, median 57d, mean 59d, `null_batch_type: 0`, `needs_a_type: 0`.
- **D-13 PASS:** the dashboard tile shows 57 / 59 / 175 with per-type medians that match exactly. The month-chart legend equals the bars (128). The 6-month wine total is 122, the same as the chart. The Needs-a-type chip shows (0).

## Deviations

- **Staging refresh and flip (owner decision):** these steps were added at the precondition stop. The staging batch freeze lasted about 18 minutes, from 21:22 to 21:40Z.
- **Tunnel for the refresh:** the refresh ran through the Railway tunnel, using the `pg` client from the middleware, because `psql` isn't installed. The Phase 94 CLIs ran in-container as planned.
- **Chrome reconnects:** the extension disconnected once and the owner signed in to Cloudflare Access in the MCP tab.

## Not done here

- **No replay or verify on staging:** that is by design, because staging never mirrors.
- **Next plans:** 94-10 (owner iPad check and the production pre-deploy gate) and later.

## Self-Check: PASSED
