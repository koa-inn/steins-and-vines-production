# Phase 6: Kiosk-to-Brewpad Integration - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

When a kit is sold on the kiosk (with Maker's Fee), a batch is automatically created in BrewPad with customer name, product, and Zoho SO reference pre-filled. Staff never manually duplicates sale data into BrewPad.

</domain>

<decisions>
## Implementation Decisions

### Trigger Mechanism
- **D-01:** Middleware calls Apps Script directly after successful sale confirm (`POST /api/kiosk/sale/confirm`). Uses existing `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN`.
- **D-02:** Only kit sales that include a Maker's Fee line item trigger batch creation. This is the signal that distinguishes ferment-in-store kits from take-home purchases.
- **D-03:** One batch is created per kit line item. If a customer buys 2 different kits, they get 2 separate batches.
- **D-04:** If Apps Script call fails, store the pending batch creation in Redis and retry later. Sale still succeeds — batch creation is eventually consistent.

### Pending Batch State
- **D-05:** Modify existing `createBatch` in Apps Script to make `schedule_id` and `start_date` optional. When omitted, batch is created with status "pending".
- **D-06:** Pending batches appear in the main batch list (not a separate queue) with a visible "Pending" badge.
- **D-07:** No auto-suggest for fermentation schedule. Staff always explicitly picks the schedule when setting up a pending batch.

### Customer Data Source
- **D-08:** Pull customer info from the Zoho sales order (canonical source). Middleware has `customer_name` and `customer_id` from the invoice creation step.
- **D-09:** Store name + customer_id only in the batch. No email — reduces PII in Sheets.

### From-Kiosk Indicator
- **D-10:** Add a "source" column to the Batches sheet with values "kiosk" or "manual".
- **D-11:** BrewPad renders a "Kiosk" badge next to the batch in the list, visible only while the batch is in "pending" status. Once staff assigns a schedule and the batch goes active, the badge disappears.
- **D-12:** Zoho sales order number is shown only in the batch detail view (not in the list row). Satisfies INTG-03.

### Claude's Discretion
- Retry mechanism details (Redis key structure, retry interval, max attempts)
- How to detect Maker's Fee in the sale line items (by SKU, by name pattern, or by item type)
- Exact placement and styling of the "Kiosk" badge in the batch list UI

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Middleware (trigger point)
- `zoho-middleware/routes/pos.js` — Contains `POST /api/kiosk/sale/confirm` where batch creation will be triggered (line ~393)
- `zoho-middleware/lib/constants.js` — Redis key prefixes for retry queue

### Apps Script (batch backend)
- `apps-script/adminApi.gs` — `createBatch()` function at line 1642, `doPost()` at line 178. This is where schedule_id/start_date need to become optional.

### BrewPad (frontend display)
- `js/brewpad.js` — Batch list rendering, badge display, detail view for SO number

### Requirements
- `.planning/REQUIREMENTS.md` — INTG-01, INTG-02, INTG-03 define the acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN` env vars already configured on Railway for server-to-Apps-Script calls
- `createBatch()` in adminApi.gs handles batch ID generation, task creation from schedule, vessel assignment — needs minimal modification
- Redis cache module (`zoho-middleware/lib/cache.js`) can be used for retry queue storage
- Batch list rendering in brewpad.js already has status badges (active/complete) — "Pending" + "Kiosk" badges extend this pattern

### Established Patterns
- Middleware uses fire-then-confirm pattern for terminal payments (push → poll → confirm) — similar eventual consistency applies here
- Apps Script `doPost` routes by `action` field in payload — add handling for server-originated `create_batch` calls
- IIFE pattern in brewpad.js — new UI elements follow existing DOM manipulation patterns with `var`

### Integration Points
- After invoice creation in `POST /api/kiosk/sale/confirm` (~line 486) — insert batch creation call
- Apps Script `doPost` case switch — handle `create_batch` with server token auth (not staff OAuth)
- Batches sheet — new "source" column appended (position matters for existing reads)
- BrewPad batch list render function — add badge for source=kiosk when status=pending

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 6-Kiosk-to-Brewpad Integration*
*Context gathered: 2026-05-03*
