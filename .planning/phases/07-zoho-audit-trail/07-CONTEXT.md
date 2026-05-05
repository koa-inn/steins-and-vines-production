# Phase 7: Zoho Audit Trail - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Every batch carries its full provenance from sale to completion, and Zoho reflects batch status so the business has a single source of truth. Staff can see the entire lifecycle — sale, batch creation, fermentation, completion — in BrewPad's batch detail view without switching to Zoho. Zoho invoices show linked batch status via a custom field.

</domain>

<decisions>
## Implementation Decisions

### Zoho Status Sync
- **D-01:** Add a custom field (e.g. "Batch Status") to Zoho invoices. Values: `Pending — SV-B-NNNNNN`, `Active — SV-B-NNNNNN`, `Complete — SV-B-NNNNNN`. Includes batch ID so staff can identify the linked batch at a glance in Zoho.
- **D-02:** Sync on key transitions only — batch created (Pending), schedule assigned (Active), batch marked complete (Complete). Three events max per batch lifecycle.
- **D-03:** Sync path: BrewPad → Middleware (new endpoint, e.g. `POST /api/batch/sync-zoho`) → Zoho Books API (`PUT /invoices/{id}`). Middleware has Zoho OAuth tokens and handles the API call.

### Manual Batch Linking
- **D-04:** Add a "Link to Invoice" button in BrewPad's batch detail view. Staff types a customer name or invoice number, BrewPad searches via middleware (new `GET /api/batch/search-invoices` endpoint), staff picks the match.
- **D-05:** When an invoice is selected, auto-fill `customer_name`, `customer_id`, and `product_name` from the invoice data into the batch record.
- **D-06:** Linking is re-doable — staff can change the linked invoice if they picked the wrong one. The "Link to Invoice" button remains visible and overwrites the previous link.

### Lifecycle Timeline
- **D-07:** Timeline lives in BrewPad's batch detail view as a new section. Vertical timeline with dots/lines connecting events chronologically.
- **D-08:** Four events in the timeline: Sale & Invoice Created, Batch created, Fermentation started, Batch completed. Future events show as hollow dots with "(pending)".
- **D-09:** Timeline data comes from new date columns in the Batches sheet: `created_at`, `fermentation_started_at`, `completed_at`. Apps Script populates these on status transitions. Invoice creation date comes from the linked Zoho invoice.

### Sync Failure Handling
- **D-10:** Failed Zoho syncs go to a Redis retry queue — same pattern as Phase 6 batch creation retries. Retry sweep picks them up on the next cycle.
- **D-11:** BrewPad shows a subtle sync indicator in batch detail near the Zoho Ref row — "syncing" or "sync failed" status. Disappears once sync succeeds.

### Claude's Discretion
- Redis key structure for sync retry queue (can follow Phase 6 patterns)
- Exact CSS styling of the vertical timeline (should match BrewPad's existing visual language)
- Custom field API name in Zoho (e.g. `cf_batch_status`)
- Rate limiting / debounce on the invoice search input
- How to fetch invoice creation date (from the linked invoice data already available, or a separate Zoho API call)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Middleware (sync endpoint)
- `zoho-middleware/routes/pos.js` — Existing Zoho invoice update pattern via `custom_fields` usage on invoices (line ~457, ~621); reuse `zohoPut('/invoices/{id}')` for batch status sync
- `zoho-middleware/lib/constants.js` — Redis key prefixes for retry queue patterns

### Apps Script (batch backend)
- `apps-script/adminApi.gs` — `createBatch()` at line 1649 (already stores `zoho_so_number`, `customer_id`, `source`); `updateBatch()` at line 1794; `getBatchDetail()` at line 1291

### BrewPad (frontend)
- `js/brewpad.js` — Batch detail rendering (line ~1535), existing badge patterns (kiosk/pending badges from Phase 6), Zoho Ref display (D-12 from Phase 6)

### Phase 6 Integration Patterns
- `.planning/phases/06-kiosk-to-brewpad-integration/06-CONTEXT.md` — Redis retry queue decisions (D-04), source column (D-10), kiosk badge (D-11), Zoho Ref display (D-12)
- `zoho-middleware/lib/brewpad-integration.js` — Fire-and-forget Apps Script call + Redis retry pattern to reuse

### Requirements
- `.planning/REQUIREMENTS.md` — ZOHO-01, ZOHO-02, ZOHO-03 define the acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `custom_fields` pattern in `pos.js` — already pushes custom fields to Zoho invoices; extend for batch status field
- New `GET /api/batch/search-invoices` endpoint — searches Zoho invoices for the invoice linking feature
- `brewpad-integration.js` Redis retry queue — same pattern for sync retry
- Batch detail view in `brewpad.js` — already renders Zoho Ref row; extend with timeline and sync indicator
- `shouldShowKioskBadge()` pattern — conditional badge rendering; extend for sync status indicator

### Established Patterns
- IIFE pattern in `brewpad.js` — all new UI follows existing DOM manipulation with `var`
- Apps Script `doPost` action routing — add new actions for batch date updates
- Middleware REST pattern — new endpoints follow existing `router.post/put` conventions
- Fire-and-forget with Redis retry — established in Phase 6 for batch creation

### Integration Points
- BrewPad batch detail view — add timeline section and "Link to Invoice" button
- Apps Script `updateBatch` — extend to write `created_at`, `fermentation_started_at`, `completed_at` columns
- Middleware — new `POST /api/batch/sync-zoho` endpoint for pushing status to Zoho invoice custom field
- Middleware — new `GET /api/batch/search-invoices` endpoint for invoice search/linking
- Batches sheet — add columns: `created_at`, `fermentation_started_at`, `completed_at`

</code_context>

<specifics>
## Specific Ideas

- Vertical timeline with filled dots (●) for completed events and hollow dots (○) for pending events
- Status + Batch ID format in Zoho custom field: "Active — SV-B-000123"
- Invoice search auto-fills customer_name, customer_id, product_name to reduce manual entry

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 7-Zoho Audit Trail*
*Context gathered: 2026-05-04*
