# Phase 75 — Discussion Log

**Date:** 2026-08-26
**Mode:** discuss (default)

Human-reference only — not consumed by downstream agents (see CONTEXT.md for the canonical decisions).

## Areas selected for discussion
Owner selected all four offered gray areas.

## Decisions

| # | Area | Options presented | Chosen |
|---|------|-------------------|--------|
| D-01 | Retroactive vs going-forward | Auto-backfill on next reconcile / Backfill via manual trigger / Going-forward only | **Auto-backfill on next reconcile** (INV-000171 self-corrects; safe via idempotency) |
| D-02 | Already-activated units | Reconcile (qty − existing) / Always create N | **Reconcile: pending = qty − existing** (converge total to invoice qty, no dupes) |
| D-03 | Display of N units | Per-unit "Unit X of N" / N identical rows / one row + qty badge | **Per-unit "Unit X of N"** label |
| D-04 | Fee-slot cap | Match sale path (min kit, slots) / kit qty only | **Match sale path — cap by paid slots** (consistency w/ createBatchesFromSale) |

## Left to Claude's discretion
- Per-unit identity/idempotency key scheme (research/planner).
- Which layer implements the fix (apps-script vs middleware reconciliation vs both) — research target.

## Scope creep / deferred
None — discussion stayed within phase scope.
