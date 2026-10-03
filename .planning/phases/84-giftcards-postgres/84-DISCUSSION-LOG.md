# Phase 84: GiftCards → Postgres - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-03
**Phase:** 84-giftcards-postgres
**Areas discussed:** Dual window & flip, Balance-adjust control, Database-down behaviour, Backfill & ledger history

Note: invoked as `/gsd-discuss-phase 83`; Phase 83 was already complete, so the owner chose to discuss Phase 84 instead.

**Todos folded:** admin-write-attribution-kiosk-middleware.md (gift-card ledger actor only), giftcard-ledger-empty-tab-crash.md

---

## Dual window & flip

| Option | Description | Selected |
|--------|-------------|----------|
| Re-run real ops | Fire-and-forget calls to existing Apps Script actions; independent check, lossless rollback | ✓ |
| Copy resulting state | Upsert sheet row from Postgres; can't diverge, nothing meaningful to compare | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Week + real activity | ≥7 days AND ≥1 of each op, scripted $1 test card fills gaps | ✓ |
| Calendar week only | 7 days, zero unexplained discrepancies, any volume | |
| Scripted test only | No minimum duration | |

| Option | Description | Selected |
|--------|-------------|----------|
| Investigate, reset clock | Sales continue; explained vs bug; bug fix restarts 7 days | ✓ |
| Auto-rollback to sheets | Conflicts with Phase 83 D-05 | |
| Log only, judge at flip | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Copy state (post-flip) | Row upsert + ledger append; rollback = ledger replay | ✓ |
| Keep re-running ops | Phase 51 logic stays in hot path forever | |
| You decide | | |

## Balance-adjust control

| Option | Description | Selected |
|--------|-------------|----------|
| Kiosk + typed name | Self-reported name + reason + device id | ✓ |
| Admin page only | Verified Google-session email | |
| Both | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Delta, ≥$0, active only | Signed delta, floor $0, required reason, no cap | ✓ |
| Same, plus a cap | | |
| Set new balance | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres-backed only | Hidden in sheets mode, no new Apps Script action | ✓ |
| All modes | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No Zoho write | Ledger + mirror is the record | ✓ |
| Post a Zoho entry | | |

## Database-down behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Same as today: refuse | 503 before charge, no sheet fallback | ✓ |
| Fall back to the sheet mirror | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fail only in postgres mode | Smoke check fails when a store is dual/postgres; status stays ok | ✓ |
| Keep D-02 as-is | | |
| status=degraded | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Redis pending + Sentry | Durable pending record keyed by tx_ref, replay when DB returns | ✓ |
| Sentry + staff flag only | | |

## Backfill & ledger history

| Option | Description | Selected |
|--------|-------------|----------|
| Opening entry + Phase 51 rows | Ledger-sum invariant; historical rows reserve tx_refs | ✓ |
| Opening entry only | | |
| Balances only, no ledger rows | | |

| Option | Description | Selected |
|--------|-------------|----------|
| All real; drop TEST-* | Voided/$0 kept; needs_manual_review rows rejected | ✓ |
| Active only | | |
| Everything incl. test | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sequence-suggested, override kept | | ✓ |
| Sequence only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| After-hours + verify | Closed-store cutover, read-only verify to the cent | ✓ |
| Any time + reconcile | | |

## Claude's Discretion

- How an adjust reaches the sheet leg during dual (reload/redeem mapping, pending research)
- Schema/index detail, store facade module split, D-11 replay mechanism, adjust form layout, dual lookup comparison

## Deferred Ideas

- Zoho journal entries for adjustments
- Admin-page (verified identity) adjust control
- Full admin-proxy/Apps Script staff attribution (remains in todo)
