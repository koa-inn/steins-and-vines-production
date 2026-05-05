# Phase 7: Zoho Audit Trail - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 07-zoho-audit-trail
**Areas discussed:** Zoho status sync, Manual batch linking, Lifecycle timeline, Sync failure handling

---

## Zoho Status Sync

### Q1: How should batch status appear on the Zoho sales order?

| Option | Description | Selected |
|--------|-------------|----------|
| Custom field | Add a custom field like 'Batch Status' to the SO in Zoho. Structured, queryable, visible on the SO detail page. Already uses custom_fields for consignment. | ✓ |
| SO notes/comments | Append a note to the SO. Human-readable but not filterable or structured. | |
| You decide | Let Claude pick the best approach. | |

**User's choice:** Custom field

### Q2: When should batch status sync to Zoho?

| Option | Description | Selected |
|--------|-------------|----------|
| Key transitions only | Sync on: batch created (Pending), schedule assigned (Active), batch marked complete (Complete). 3 events max. | ✓ |
| Every status change | Sync on every status update including secondary fermentation, bottling, etc. | |
| Manual push button | Staff clicks a 'Sync to Zoho' button. No automatic sync. | |

**User's choice:** Key transitions only

### Q3: Where should the Zoho API call originate?

| Option | Description | Selected |
|--------|-------------|----------|
| BrewPad → Middleware → Zoho | BrewPad calls a new middleware endpoint when status transitions. Middleware has Zoho OAuth tokens. | ✓ |
| Apps Script → Middleware → Zoho | Apps Script detects the status change and calls middleware. | |
| You decide | Let Claude pick. | |

**User's choice:** BrewPad → Middleware → Zoho

### Q4: Should the custom field also store the batch ID?

| Option | Description | Selected |
|--------|-------------|----------|
| Status + Batch ID | Value like 'Active — SV-B-000123'. Staff can see which batch at a glance. | ✓ |
| Status only | Just 'Pending', 'Active', or 'Complete'. | |
| You decide | Let Claude pick. | |

**User's choice:** Status + Batch ID

---

## Manual Batch Linking

### Q1: How should staff link a manually-created batch to a Zoho sales order?

| Option | Description | Selected |
|--------|-------------|----------|
| SO search in BrewPad | 'Link to Sales Order' button in batch detail. Staff types name/number, searches via middleware, picks match. | ✓ |
| Paste SO number manually | Simple text input. No validation or search. | |
| Optional — skip linking | Manual batches don't need Zoho linking. | |

**User's choice:** SO search in BrewPad

### Q2: Should the SO search also pull in customer name and product?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, auto-fill | Auto-populate customer_name, customer_id, and product_name from SO. | ✓ |
| SO number only | Just store the reference. | |
| You decide | Let Claude pick. | |

**User's choice:** Yes, auto-fill

### Q3: Can a batch be unlinked from an SO after linking?

| Option | Description | Selected |
|--------|-------------|----------|
| Allow re-link | Staff can change the linked SO. Button remains visible and overwrites. | ✓ |
| Permanent once set | Once linked, SO reference is locked. | |
| You decide | Let Claude pick. | |

**User's choice:** Allow re-link

---

## Lifecycle Timeline

### Q1: Where should the lifecycle timeline live?

| Option | Description | Selected |
|--------|-------------|----------|
| BrewPad batch detail | Add timeline section to existing batch detail view. | ✓ |
| Separate timeline tab | New sub-tab dedicated to lifecycle. | |
| Both BrewPad + Zoho note | Timeline in BrewPad AND summary note on Zoho SO. | |

**User's choice:** BrewPad batch detail

### Q2: What events should appear in the timeline?

| Option | Description | Selected |
|--------|-------------|----------|
| Sale + SO created | Date the Zoho SO was created, with SO number | ✓ |
| Batch created | When created in BrewPad (auto or manual), with who created it | ✓ |
| Fermentation started | When schedule was assigned (pending → active) | ✓ |
| Batch completed | When marked complete, closing the lifecycle | ✓ |

**User's choice:** All four events

### Q3: How should the timeline be displayed visually?

| Option | Description | Selected |
|--------|-------------|----------|
| Vertical timeline | Stacked vertically with dots/lines. Filled dots for completed, hollow for pending. | ✓ |
| Simple table rows | Event/Date/Detail format. Functional, less visual. | |
| You decide | Let Claude pick. | |

**User's choice:** Vertical timeline

### Q4: Where does the timeline data come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Add date columns to Batches sheet | Add created_at, fermentation_started_at, completed_at columns. Apps Script populates on transitions. | ✓ |
| Separate event log sheet | New BatchEvents sheet tab with timestamped events. | |
| You decide | Let Claude pick. | |

**User's choice:** Add date columns to Batches sheet

---

## Sync Failure Handling

### Q1: How should failed Zoho syncs be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Redis retry queue | Same pattern as Phase 6 batch creation. Store failed sync in Redis, retry on sweep. | ✓ |
| Fire and forget | Try once, log failure, move on. Staff can manually re-trigger. | |
| You decide | Let Claude pick. | |

**User's choice:** Redis retry queue

### Q2: Should BrewPad show a visual indicator when Zoho sync is pending/failed?

| Option | Description | Selected |
|--------|-------------|----------|
| Subtle indicator | Small icon/dot near Zoho Ref row. Shows 'syncing' or 'sync failed'. Disappears on success. | ✓ |
| No indicator | Sync happens silently. | |
| You decide | Let Claude pick. | |

**User's choice:** Subtle indicator

---

## Claude's Discretion

- Redis key structure for sync retry queue
- Exact CSS styling of vertical timeline
- Custom field API name in Zoho
- Rate limiting / debounce on SO search input
- How to fetch SO creation date

## Deferred Ideas

None — discussion stayed within phase scope.
