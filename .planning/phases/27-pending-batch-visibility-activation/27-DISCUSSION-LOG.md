# Phase 27: Pending Batch Visibility & Activation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-07
**Phase:** 27-Pending Batch Visibility & Activation
**Areas discussed:** Default-view visibility, Where Activate lives, One-click safety, Guided flow shape

---

## Default-view visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Show in default + Pending filter | Default 'Active' view includes pending alongside Primary/Secondary; plus dedicated 'Pending' filter; distinct badge | ✓ |
| Pending filter only | Keep default = Active; pending reachable only via new 'Pending' filter | |
| Default + count badge/attention | Show in default AND surface a count via pipeline stage / attention-list nudge | |

**User's choice:** Show in default + Pending filter
**Notes:** Most discoverable — staff can't miss a batch that needs activating.

### Follow-up: pending sort order

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned to top | Pending always sort above active rows regardless of sort column | ✓ |
| Sort naturally (bottom) | No special-casing; with no start date they fall to the bottom of date-sorted list | |
| You decide | Let planner choose cleanest with existing sort logic | |

**User's choice:** Pinned to top
**Notes:** Reinforces "no longer hidden" intent.

---

## Where Activate lives

| Option | Description | Selected |
|--------|-------------|----------|
| Inline row + detail modal | Inline action buttons on pending rows AND same actions in detail modal | ✓ |
| Detail modal only | Open row → use Activate / Schedule & activate in modal | |
| Inline row only | Buttons only on list row; none in modal | |

**User's choice:** Inline row + detail modal
**Notes:** Fewest clicks — genuinely one-click from the list; also consistent with where status changes live today.

---

## One-click safety

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm dialog | showConfirm() warning 'no schedule will be attached', then flip to Primary | ✓ |
| Instant flip + toast | Immediately flip, start=today, toast; no dialog | |
| Confirm + offer schedule | Confirm that also nudges into the guided flow | |

**User's choice:** Confirm dialog
**Notes:** Guards against accidental clicks and warns about the empty schedule (pending batches have no tasks yet).

---

## Guided flow shape

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated modal, reuse pickers | Focused modal showing only schedule + start date + vessel pickers (reuse New Batch components) | ✓ |
| Reuse full New Batch modal | Open New Batch modal in 'activate' mode pre-populated | |
| Inline expansion in detail | Expand pickers inline within the detail modal | |

**User's choice:** Dedicated modal, reuse pickers
**Notes:** Focused UI without irrelevant New Batch fields.

### Follow-up: required fields

| Option | Description | Selected |
|--------|-------------|----------|
| Schedule + start date only | Schedule + date required; vessel/location optional (assignable later) | ✓ |
| Schedule + date + vessel | All three required for stronger data hygiene | |
| You decide | Mirror existing New Batch validation | |

**User's choice:** Schedule + start date only
**Notes:** Lowest friction; matches how location can already be edited post-creation.

---

## Claude's Discretion

- Exact badge color for the new "Pending" status.
- Whether pending visibility is widened backend-side (broaden `active` filter) or frontend-side (default filter value).
- Precise button styling/placement within the row action cell.

## Deferred Ideas

None — discussion stayed within phase scope. A pending-count attention/pipeline nudge was offered but not selected; existing attention-list machinery remains available for later.
