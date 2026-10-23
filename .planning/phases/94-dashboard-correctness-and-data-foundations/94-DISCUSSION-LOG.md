# Phase 94: Dashboard correctness and data foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-23
**Phase:** 94-dashboard-correctness-and-data-foundations
**Areas discussed:** Approval and timing, Batch type rules, Cycle-time definition, Completed-date backfill, What counts in totals

---

## Approval and timing (asked before discuss-phase started)

| Option | Description | Selected |
|--------|-------------|----------|
| B1 + D1 | Fix avg cycle time; one shared data layer | ✓ |
| S1 | Fast server stats endpoint | ✓ |
| B3 | Explicit batch type + backfill (data write) | ✓ |
| B2 | completed_at backfill (data write) | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Plan now, build after move | Build after the Phase 87 Postgres cutover; B3/S1 Postgres-only | ✓ |
| Plan and build now | B3/S1 must work in both Sheet and Postgres modes | |

## Batch type rules

| Option | Description | Selected |
|--------|-------------|----------|
| Wine, beer, cider, seltzer, other | Keeps the seltzer type BrewPad already uses | ✓ |
| Wine, beer, cider, other | Handoff list; seltzer folds into other | |

| Option | Description | Selected |
|--------|-------------|----------|
| Schedule first | Schedule category → recipe → Zoho → name | |
| Recipe/Zoho first | Recipe style → Zoho cf_type by SKU → name | ✓ |
| You decide | | |

**Follow-up:** Schedule category kept as a fallback before the name guess. Final order: recipe → Zoho → schedule → name → other.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, editable on the batch | Manual type never overwritten by rules | ✓ |
| No, automatic only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Mark Other and flag it | Listed on a needs-a-type list; never blocks create | ✓ |
| Staff must pick at create | | |

## Cycle-time definition

| Option | Description | Selected |
|--------|-------------|----------|
| Median big, mean + count beside | | ✓ |
| Mean big, median beside | Handoff wording | |

| Option | Description | Selected |
|--------|-------------|----------|
| Overall now, per type later | | |
| Per type now | | ✓ |

**Follow-up:** One tile, overall median big, small row per type underneath (types without completed batches hidden).

| Option | Description | Selected |
|--------|-------------|----------|
| Include staff/research batches | Production metric | ✓ |
| Exclude them | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Batch start date | | ✓ |
| Record created date | | |

## Completed-date backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Last task done, else skip | No last_updated guess | ✓ |
| Last task done, else last updated | Handoff rule | |
| Leave all blank | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Mark as estimated (source field) | | ✓ |
| Treat as real | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Review the full dry-run list, then OK | | ✓ |
| Spot-check, then OK | | |

## What counts in totals

| Option | Description | Selected |
|--------|-------------|----------|
| Started batches only | primary/secondary/complete | ✓ |
| Everything except deleted | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Start date | Completed counts use completed_at | ✓ |
| Created date | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Calendar year | Vancouver time | ✓ |
| Last 12 months | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Live now | Corrected numbers on the current dashboard | ✓ |
| Behind ?dash=v2 | | |

**Batch type backfill approval:** review the full dry-run list (every batch, proposed type, deciding rule), then OK. ✓

## Claude's Discretion

Source-marker field names, migration shape, whether S1 extends `get_batch_dashboard_summary` or adds an action, minimal "needs a type" surface, recipe style → type mapping (use Phase 89 `beer_category`).

## Deferred Ideas

All other §7 items to their own phases; full data-health card is G10 (Phase 96). No todos folded (keyword-only matches).
