# Phase 93: Kiosk ledger week and month views - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-17
**Phase:** 93-kiosk-ledger-week-and-month-views
**Areas discussed:** Range switcher & drill-in, Summary row contents, Slow / partial months, Freshness & accuracy

---

## Range switcher & drill-in

| Option | Description | Selected |
|--------|-------------|----------|
| Chips above the date bar | Day · Week · Month chips, same style as the tabs; Day is the default | ✓ |
| Dropdown in the date bar | Smaller, but needs an extra tap and is less obvious | |

| Option | Description | Selected |
|--------|-------------|----------|
| Current week/month | Today's period in Vancouver time | ✓ |
| Period containing the viewed day | Follows the day being viewed | |

| Option | Description | Selected |
|--------|-------------|----------|
| "‹ Back to week/month" link | Returns to the range with scroll restored | ✓ |
| Switch fully to Day mode | Flip the chip to Day; re-tap Week to go back | |

| Option | Description | Selected |
|--------|-------------|----------|
| Date input jumps to the containing range | One native input; the label shows the range | ✓ |
| Hide it, ‹ › only | Simpler, but slow to go far back | |

**User's choice:** All recommended options.

---

## Summary row contents

| Option | Description | Selected |
|--------|-------------|----------|
| Show greyed zero-sale rows | Gaps stay visible | ✓ |
| Hide zero-sale days | Shorter list | |

| Option | Description | Selected |
|--------|-------------|----------|
| Leave future days out | The list ends at today; today is labelled "Today" | ✓ |
| Empty placeholders | Fixed-length list | |

| Option | Description | Selected |
|--------|-------------|----------|
| Newest first | Matches the day ledger | ✓ |
| Calendar order | Reads like a calendar | |

| Option | Description | Selected |
|--------|-------------|----------|
| Flat list of days | Simplest, matches the owner's decision | ✓ |
| Week sub-headers with subtotals | More UI; partial weeks at month edges | |

**User's choice:** All recommended options.

---

## Slow / partial months

| Option | Description | Selected |
|--------|-------------|----------|
| Single load with a progress message | The whole month appears at once | ✓ |
| Progressive, week by week | Feels faster, more complex, the total keeps changing | |

| Option | Description | Selected |
|--------|-------------|----------|
| Show partial data with a warning | "at least" footer; drill-in stays exact | ✓ |
| Refuse with an error | Never incomplete, but shows nothing | |

| Option | Description | Selected |
|--------|-------------|----------|
| Same floor as the day ledger (2020+) | Consistent | ✓ |
| Last 12 months only | Caps the Zoho cost | |

**User's choice:** All recommended options.

---

## Freshness & accuracy

| Option | Description | Selected |
|--------|-------------|----------|
| Exact match with the day ledger | Same rules; payments lookup when all-digit references exist | ✓ |
| Approximate for summaries | Skip payments; recipe sales may be miscounted | |

| Option | Description | Selected |
|--------|-------------|----------|
| ~5 min for the current period, plus ↻ | Month rebuilds are expensive | ✓ |
| 60 s, same as today | Fresher, but costly | |

| Option | Description | Selected |
|--------|-------------|----------|
| Past ranges within an hour | Same as past days | ✓ |
| Within a day | Fewer calls | |

**User's choice:** All recommended options.
**Notes:** Claude flagged that today's row in the current range can lag the Today day ledger by up to about 5 minutes (different caches). Recorded as an accepted side effect; the owner did not object.

---

## Claude's Discretion

- Zoho call strategy (one ranged query vs composing day caches), page caps, route shape, cache keys and per-day cache warming, visual design, and empty/error states.

## Deferred Ideas

- Weekly subtotals in Month view; tender split / cash-up report; progressive loading.
