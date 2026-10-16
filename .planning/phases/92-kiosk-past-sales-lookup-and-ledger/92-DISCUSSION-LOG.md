# Phase 92: Kiosk past-sales lookup and ledger - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 92-kiosk-past-sales-lookup-and-ledger
**Areas discussed:** Ledger scope & range, Customer lookup flow, Access & privacy, What each row shows

---

## Ledger scope & range

| Option | Description | Selected |
|--------|-------------|----------|
| All in-store kiosk sales | KIOSK- invoices + recipe sales + SOs paid at the kiosk | ✓ |
| KIOSK- reference only | Simplest filter; misses SO payments | |
| Every Zoho invoice | Includes online/manual, tagged by source | |

| Option | Description | Selected |
|--------|-------------|----------|
| Today + day picker | One day at a time, ‹ › arrows + date input | ✓ |
| Last 7 days + from/to range | Flexible, heavier fetches | |
| Preset chips | Today / Yesterday / Week / Month | |

| Option | Description | Selected |
|--------|-------------|----------|
| Count + gross total | "14 sales · $1,240.55" | ✓ |
| Totals split by tender | Card / gift card / other subtotals | |
| No totals | List only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Show voids greyed, excluded from totals | Void badge | ✓ |
| Hide voided | | |
| You decide | | |

## Customer lookup flow

| Option | Description | Selected |
|--------|-------------|----------|
| One "Past Sales" header button, two tabs | By customer / Ledger | ✓ |
| Header button + cart shortcut | Plus a link on the cart's customer chip | |
| Two separate header buttons | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Last 12 months + "Load older" | | ✓ |
| All time | | |
| Last N invoices | | |

| Option | Description | Selected |
|--------|-------------|----------|
| All their invoices, tagged by source | In-store + online | ✓ |
| In-store only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Invoices only (no open SOs) | | ✓ |
| Include open SOs with badge | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude walk-in contact + explain | Point to Ledger | ✓ |
| Allow like any contact | | |

## Access & privacy

| Option | Description | Selected |
|--------|-------------|----------|
| Device token + session, like Sales Orders | Purpose-built kiosk routes; D-46-02 unchanged | ✓ |
| Staff session only | Breaks standalone iPad | |
| Device token + PIN re-prompt | Client-side only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Hide button + clear view on exit | Clear on Customer View / new sale | ✓ |
| Just hide the button | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Slim allowlist, no contact details | | ✓ |
| Pass Zoho through | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No reprint/resend this phase | | ✓ |
| Include resend-receipt | | |

## What each row shows

| Option | Description | Selected |
|--------|-------------|----------|
| Card / Cash / Gift card from Zoho payments (ledger only) | One payments query per day | ✓ |
| Tender in both views | | |
| Status only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Expand inline, fetched on tap | | ✓ |
| Separate detail screen | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Short cache + refresh button | ~60 s today, longer for past | ✓ |
| Always live | | |

## Claude's Discretion

- Cache TTLs and keys, "Load older" paging mechanics and caps, visual design, empty and error states, whether the admin-embedded kiosk gets the button.

## Deferred Ideas

- Reprint or resend a past receipt
- Reorder / add a past order to the cart
- Tender-split end-of-day cash-up
