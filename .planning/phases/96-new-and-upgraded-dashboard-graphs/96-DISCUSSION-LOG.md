# Phase 96: New and upgraded dashboard graphs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md. This log keeps the alternatives that were considered.

**Date:** 2026-10-28
**Phase:** 96-new-and-upgraded-dashboard-graphs
**Areas discussed:** Approval, Task timeliness (G7), Vessel sharing (G6), Readings (G8), Page layout

---

## Approval

| Option | Description | Selected |
|--------|-------------|----------|
| All ten, G1–G10 | Every graph in the handoff table | ✓ |
| All but task health (G7) | Hold G7 until F8 is settled | |
| Let me pick | Owner lists a subset | |

## Task timeliness (G7)

| Question | Options | Selected |
|----------|---------|----------|
| What usually happened when a task was ticked late? | Done on time, ticked later / Mostly real lateness / A mix | Done on time, ticked later |
| Replacement for "completions by staff" | Drop it / Completions per week / Start recording names | Drop it |

**Context shown:** staging had 233 of 304 tasks (last 120 days) ticked after due, 166 by more than 3 days. About 919
completions were by `hello@`.

## Vessel sharing (G6)

| Question | Options | Selected |
|----------|---------|----------|
| Can two active batches share a vessel? | Never (data error) / Only big vessels / Sometimes after racking | Free text: "Yes this can happen as of now" |
| Follow-up: how to show a shared vessel | Neutral "shared" list / Still flag as conflict / Don't list | Neutral "shared" list |
| Follow-up: capacity counting | One occupied vessel / Count per batch | One occupied vessel |
| Conflict list action | Tap opens the batch / List only | Tap opens the batch |
| Capacity grouping | By vessel type / By ID prefix | By vessel type |

## Readings (G8)

| Question | Options | Selected |
|----------|---------|----------|
| When is a batch "reading due"? | Beer & cider during fermentation / Every active batch / Key steps only | Free text: "No required readings at this point" |
| Interval | 3 days / 7 days / You decide | You decide (moot after the answer above) |
| Expected curve | OG → target FG line / Skip | OG → target FG line |
| Follow-up: what sits beside the curves | Neutral "No readings yet" list / Nothing | Neutral "No readings yet" list |

## Page layout

| Question | Options | Selected |
|----------|---------|----------|
| Arrangement | Grouped sections / Section tabs / One long scroll | Grouped sections (preview: Production → Floor today → Products & sales → Data health) |
| First under the tiles | Production / Floor today / Data health | Production |
| Table view | Chart/Table toggle per widget / Table under each chart | Chart/Table toggle |

## Claude's Discretion

G3 chart form and schedule overlay; G5 horizon and task-kind grouping; G2 and G9 chart forms; the server data shape
(extend `get_dashboard_stats` or a bulk read); section copy and order within a section.

## Deferred Ideas

- Record who ticks a task (staff names).
- Readings cadence and due alerts.
- Rethink A3 vessel conflict alert in Phase 98.
