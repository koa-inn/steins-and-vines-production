# Phase 7: Zoho Audit Trail - Research

**Researched:** 2026-05-04
**Domain:** Zoho Books SO custom fields, Apps Script batch lifecycle, BrewPad detail view extension, Redis retry queue
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Zoho Status Sync**
- D-01: Custom field on Zoho SOs stores batch status. Values: `Pending — SV-B-NNNNNN`, `Active — SV-B-NNNNNN`, `Complete — SV-B-NNNNNN`.
- D-02: Sync on three key transitions only: batch created (Pending), schedule assigned (Active), batch marked complete (Complete).
- D-03: Sync path: BrewPad → Middleware `POST /api/batch/sync-zoho` → Zoho Books API (PUT /salesorders/{id}).

**Manual Batch Linking**
- D-04: "Link to Sales Order" button in batch detail view; reuses existing `/api/kiosk/salesorders` endpoint for SO search.
- D-05: SO selection auto-fills `customer_name`, `customer_id`, `product_name` from SO data into the batch record.
- D-06: Link is re-doable — button remains visible, overwrites previous link.

**Lifecycle Timeline**
- D-07: Vertical timeline in BrewPad batch detail view.
- D-08: Four events: Sale + SO created, Batch created, Fermentation started, Batch completed. Future events = hollow dots with "(pending)".
- D-09: Three new date columns in Batches sheet: `created_at`, `fermentation_started_at`, `completed_at`. Apps Script populates on transitions. SO date from the linked SO.

**Sync Failure Handling**
- D-10: Failed Zoho syncs go to a Redis retry queue (same pattern as Phase 6 batch creation retries).
- D-11: Sync indicator in batch detail near Zoho Ref row — "syncing" or "sync failed" state. Disappears on success.

### Claude's Discretion
- Redis key structure for sync retry queue (follow Phase 6 patterns)
- CSS styling of the vertical timeline (match BrewPad's existing visual language)
- Custom field API name in Zoho (e.g. `cf_batch_status`)
- Rate limiting / debounce on the SO search input
- How to fetch SO creation date (from linked SO data or separate Zoho API call)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ZOHO-01 | Batch stores its originating Zoho SO number and customer ID | Already stored: `zoho_so_number` column (col 22) and `customer_id` column (col 5) exist in Batches sheet. Manual linking adds SO data to records that were created without it. |
| ZOHO-02 | Zoho SO shows linked batch status (active/complete) via custom field | New `POST /api/batch/sync-zoho` middleware endpoint calls `zohoPut('/salesorders/{id}', {custom_fields: [...]})` — mirrors existing pattern from pos.js. |
| ZOHO-03 | Staff can view the full audit trail: sale → batch → fermentation → completion | Vertical timeline in batch detail view, assembled from new Batches sheet date columns and SO date from Zoho API call. |
</phase_requirements>

---

## Summary

Phase 7 adds three interconnected capabilities to the existing batch tracking system: (1) a middleware endpoint that pushes batch status into a Zoho SO custom field, (2) a "Link to Sales Order" UI in BrewPad that lets staff manually connect a batch to its originating SO, and (3) a lifecycle timeline in the batch detail view that shows the complete journey from sale to completion.

All three capabilities build on patterns already established in Phase 6. The Zoho SO update follows the same `zohoPut('/salesorders/{id}', payload)` path used by `/api/kiosk/salesorder-update` (pos.js line 1268). The retry queue mirrors `brewpad-integration.js` exactly — same Redis TTL, same `RETRY_PREFIX + timestamp + key` naming, same 3-attempt cap. The BrewPad UI extension follows the existing `renderBatchDetail` DOM construction pattern (var-based IIFE, `escapeHTML` throughout).

The key structural discovery is that `created_at` already exists as a column in the Batches sheet (column 17, written as `now` on `createBatch`). The missing columns are `fermentation_started_at` and `completed_at` on the Batches sheet itself — the BatchTasks sheet already has a `completed_at` column for tasks (line 1094, 1312) but the Batches sheet does not. Apps Script's `handlePackagingCompletion` already sets `status = 'complete'` but does not write a batch-level `completed_at`.

**Primary recommendation:** Build wave-by-wave — sync endpoint first (enables ZOHO-02), then manual linking (ZOHO-01 for manual batches), then timeline (ZOHO-03). Each wave is independently testable.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Zoho SO custom field write | API / Middleware | — | Only middleware has Zoho OAuth tokens |
| Sync retry queue | API / Middleware | — | Redis is middleware-side; fire-and-forget from BrewPad |
| SO search for linking | API / Middleware | — | Reuses existing `/api/kiosk/salesorders` cache; no new endpoint needed |
| Batch record update (link SO) | Apps Script / Backend | — | Batches sheet mutations go through Apps Script doPost |
| Lifecycle timeline rendering | Browser / BrewPad frontend | — | Read-only; data already returned by `get_batch` action |
| Sync status indicator | Browser / BrewPad frontend | — | UI state only; no backend involved |
| Date columns (fermentation_started_at, completed_at) | Apps Script / Backend | — | Must be written at transition points in Apps Script |

---

## Standard Stack

### Core (all verified in codebase)

| Component | Version | Purpose | How Used |
|-----------|---------|---------|----------|
| `zohoPut` in `zoho-api.js` | existing | PUT to Zoho Books API | Write custom field to SO |
| `cache.set/get` in `lib/cache.js` | existing | Redis retry queue | Same pattern as `brewpad-integration.js` |
| `axios.post` to Apps Script | existing | Update batch record | Same as `callAppsScriptCreateBatch` |
| Express router in `routes/pos.js` | existing | New endpoint location | `router.post('/api/batch/sync-zoho')` |
| Apps Script `updateBatch` action | existing | Write date columns | Extend `allowedFields` array |

[VERIFIED: direct codebase read]

### No New Libraries Required

All capabilities use existing dependencies. No npm installs needed for this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
BrewPad (brewpad.js)
  │
  ├─[status transition]──► POST /api/batch/sync-zoho ──► zohoPut('/salesorders/{so_id}', {
  │                          │  (middleware)                  custom_fields: [{api_name: process.env.ZOHO_CF_BATCH_STATUS,
  │                          │                                                 value: 'Active — SV-B-000123'}]
  │                          │                               })
  │                          │
  │                          └─[on failure]──► Redis key: brewpad:zoho-sync:{timestamp}-{batch_id}
  │                                           └─[retry sweep, 5 min]──► retry zohoPut, max 3 attempts
  │
  ├─[Link SO button]────── GET /api/kiosk/salesorders?search={term} ──► cached Zoho SO list
  │                         │
  │                         └─[staff picks SO]──► Apps Script action: update_batch
  │                              updates: {zoho_so_number, customer_id, customer_name, product_name}
  │
  └─[detail view render]── Apps Script action: get_batch
                             │
                             ├─ batch.created_at (existing col 17)
                             ├─ batch.fermentation_started_at (new col)
                             ├─ batch.completed_at (new col)
                             └─ batch.zoho_so_number ──► GET /api/kiosk/salesorder/{id}
                                                          → so.date (sale date for timeline)
```

### Recommended File Changes
```
zoho-middleware/
├── routes/pos.js              # Add POST /api/batch/sync-zoho, GET /api/batch/search-so (if needed)
├── lib/brewpad-integration.js # Add syncBatchToZoho() and queueSyncRetry() functions
├── lib/constants.js           # Add BATCH_SYNC_RETRY_PREFIX key
└── lib/validateEnv.js         # Add ZOHO_CF_BATCH_STATUS to OPTIONAL list

apps-script/
└── adminApi.gs                # Extend updateBatch allowedFields; add fermentation_started_at/completed_at
                               # writes in status transition logic; add link_so action

js/
└── brewpad.js                 # renderBatchDetail: add timeline section, Link SO button,
                               # sync indicator; new callSyncZoho(), callLinkSo() functions
```

### Pattern 1: Zoho SO Custom Field Write (existing pattern from pos.js)

```javascript
// Source: zoho-middleware/routes/pos.js line 477-480 (VERIFIED: direct read)
// How consignment custom fields are written to Zoho invoices — same pattern for SO:
invoicePayload.custom_fields.push({
  api_name: process.env.ZOHO_CF_CONSIGNMENT_SALE,
  value: true
});

// For batch status sync, adapted to zohoPut on a salesorder:
var soPayload = {
  custom_fields: [{
    api_name: process.env.ZOHO_CF_BATCH_STATUS,
    value: 'Active — ' + batchId
  }]
};
zohoPut('/salesorders/' + soId, soPayload);
```

[VERIFIED: direct codebase read]

### Pattern 2: Redis Retry Queue (existing from brewpad-integration.js)

```javascript
// Source: zoho-middleware/lib/brewpad-integration.js lines 96-111 (VERIFIED: direct read)
// Key pattern: RETRY_PREFIX + Date.now() + '-' + identifier
// TTL: 86400 (24 hours), MAX_RETRIES: 3

// For Zoho sync retries, mirror exactly:
var SYNC_RETRY_PREFIX = C.CACHE_KEYS.BATCH_SYNC_RETRY_PREFIX;  // new constant
var key = SYNC_RETRY_PREFIX + Date.now() + '-' + batchId;
var retryData = {
  payload: { so_id, batch_id, status_value },
  attempts: 0,
  reason: reason,
  queued_at: new Date().toISOString()
};
cache.set(key, retryData, 86400);
```

[VERIFIED: direct codebase read]

### Pattern 3: Apps Script `updateBatch` Field Extension

```javascript
// Source: apps-script/adminApi.gs line 1879 (VERIFIED: direct read)
// Current allowedFields:
var allowedFields = ['status', 'vessel_id', 'shelf_id', 'bin_id', 'notes'];

// Extend to support linking and date columns:
var allowedFields = ['status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
                     'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
                     'fermentation_started_at', 'completed_at'];
```

[VERIFIED: direct codebase read]

### Pattern 4: BrewPad Batch Detail DOM (existing from brewpad.js)

```javascript
// Source: js/brewpad.js lines 1565-1567 (VERIFIED: direct read)
// Existing conditional Zoho Ref row — timeline slots in after this:
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>'
        + escapeHTML(b.zoho_so_number) + '</span></div>';
}
// New timeline section follows the info grid:
html += '<div class="bp-detail-section">';
html += '<div class="bp-detail-section-title">Lifecycle</div>';
html += buildLifecycleTimeline(b, soDate);
html += '</div>';
```

[VERIFIED: direct codebase read]

### Pattern 5: SO Search (existing endpoint reuse)

```javascript
// Source: zoho-middleware/routes/pos.js lines 809-884 (VERIFIED: direct read)
// GET /api/kiosk/salesorders supports ?search= query param — case-insensitive customer_name filter
// Response includes: salesorder_id, salesorder_number, customer_name, customer_id, date, line_items

// BrewPad "Link to Sales Order" search:
fetch(MW_BASE + '/api/kiosk/salesorders?search=' + encodeURIComponent(term), { headers: { 'x-api-key': MW_API_KEY } })
// Returns { salesorders: [...] }
// First line_item.name used to auto-fill product_name
```

[VERIFIED: direct codebase read]

### Anti-Patterns to Avoid

- **Writing `completed_at` on the batch from the task completion handler only**: `handlePackagingCompletion` (adminApi.gs line 2241) fires when all tasks are done and packaging task is checked. Phase 7 must add a `completed_at` write inside `handlePackagingCompletion`. Do NOT add a separate code path that tries to detect completion elsewhere.
- **Fetching SO date on every detail view load**: SO date is only needed for the timeline and only when a batch has a `zoho_so_number`. Fetch it lazily (after the detail renders) or cache the result in a BrewPad-local variable keyed by SO id.
- **Blocking BrewPad on Zoho sync**: All sync calls must be fire-and-forget. BrewPad should not `await` the sync response before updating its own UI state.
- **Using `appendRow` to add new batch columns**: New columns (`fermentation_started_at`, `completed_at`) must be added to the sheet header row manually in Google Sheets. `sheetToObjects` dynamically reads headers — `appendRow` in `createBatch` must also be extended to include the new columns (even as empty strings) so column alignment is preserved.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zoho SO update | Custom HTTP call in new file | `zohoPut` from `zoho-api.js` | Already handles auth, retry on 429, org_id param |
| Redis retry queue | Custom Redis logic | Mirror `brewpad-integration.js` exactly | Retry sweep, TTL, max-attempts pattern already proven in production |
| SO search | New Zoho API call | `GET /api/kiosk/salesorders?search=` | Already fetches all statuses, caches, supports `search` param |
| Debounce on SO search input | Custom timer logic | Native `setTimeout`/`clearTimeout` pattern | Consistent with ES5 IIFE style already in brewpad.js |
| Sync retry sweep | New `setInterval` | Add to existing 5-min interval in `server.js` line 457 | One sweep handles both batch creation and Zoho sync retries |

---

## Runtime State Inventory

> Not a rename/migration phase — this section is not applicable.

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `ZOHO_CF_BATCH_STATUS` env var | Sync endpoint | Not set (new) | Must be added to Railway + local .env. Value is the Zoho custom field API name (e.g. `cf_batch_status`) — staff must create the field in Zoho Books first |
| Redis | Sync retry queue | Yes (Railway production) | Already in use for Phase 6 batch retry |
| Apps Script deployment | Batch record updates | Yes (APPS_SCRIPT_URL configured) | Any new actions require redeployment with "New version" |
| Zoho Books `salesorders` PUT endpoint | Sync | Yes (zohoPut already works) | Proven by `/api/kiosk/salesorder-update` |
| `/api/kiosk/salesorders` GET | SO search/link | Yes (live in production) | Cache TTL is configurable |

**Pre-condition: Zoho custom field creation**
Before the sync endpoint can work, a staff member must:
1. Open Zoho Books → Settings → Custom Fields → Sales Orders
2. Create a field named "Batch Status" (text type, ~64 chars)
3. Note the API name (auto-generated by Zoho, typically `cf_batch_status`)
4. Set `ZOHO_CF_BATCH_STATUS=cf_batch_status` in Railway environment

This is a one-time human action. The planner should include it as a Wave 0 prerequisite note.

---

## Common Pitfalls

### Pitfall 1: `appendRow` Column Alignment After Adding Sheet Columns

**What goes wrong:** Adding `fermentation_started_at` and `completed_at` columns to the Batches sheet header without updating `createBatch`'s `appendRow` call causes misaligned data. `sheetToObjects` reads columns by header name, so existing rows are fine, but new rows created by `appendRow` will have data in the wrong columns.

**Why it happens:** `appendRow` in `createBatch` passes a fixed-length array. When new columns are added to the sheet header, the array must be extended with placeholder empty strings for the new columns.

**How to avoid:** Update `createBatch`'s `appendRow` call (adminApi.gs line 1694) to append two empty strings at the end for the new columns. Also update the manual batch creation `appendRow` call found around line 2218.

**Warning signs:** After adding sheet columns, batch list shows data in wrong info-row fields.

---

### Pitfall 2: Sync Fires Before `zoho_so_number` Is Set

**What goes wrong:** BrewPad triggers the Zoho sync on status change, but if the batch was created manually without an SO link, `zoho_so_number` is empty. The sync endpoint has no SO id to PUT to.

**Why it happens:** Manual batches legitimately have no SO. The sync must be conditional on `zoho_so_number` being non-empty.

**How to avoid:** In the sync endpoint body validation, require `so_id` and return `200 { ok: true, skipped: true }` if it's blank. In BrewPad, skip calling the sync endpoint when `batch.zoho_so_number` is empty (after checking the current batch state).

**Warning signs:** 400 errors on sync calls for manual batches.

---

### Pitfall 3: Apps Script Requires Redeployment for Every New Action

**What goes wrong:** New actions added to `doPost` switch statement are not live until a new deployment is published ("New version") in the Apps Script editor. Developers sometimes test against the live URL and are confused why the new action returns "unknown action."

**Why it happens:** Apps Script web apps are versioned. The deployed URL serves the last published version.

**How to avoid:** The plan must include a step: "Redeploy Apps Script as new version before testing." This must happen before any BrewPad code calling the new action is pushed.

**Warning signs:** `{ ok: false, error: 'unknown_action' }` response from Apps Script.

---

### Pitfall 4: `fermentation_started_at` Has No Clear Single Trigger

**What goes wrong:** D-09 says Apps Script populates `fermentation_started_at` on "schedule assigned." In the current code, when a pending batch gets a schedule, the client calls `update_batch_schedule` (line 248 in doPost switch) which transitions status from `pending` to `primary`. There is no separate "fermentation started" event — it coincides with schedule assignment. If the batch was created non-pending (already had a start_date), `fermentation_started_at` should be set at creation.

**Why it happens:** The batch lifecycle has two creation paths: kiosk-created (always pending → activated later) and manually-created (may have start_date from the start).

**How to avoid:** Write `fermentation_started_at = now` inside `update_batch_schedule` when transitioning from pending to primary. For non-pending batches created via `createBatch`, write `fermentation_started_at = start_date` at creation time.

**Warning signs:** Timeline shows "Fermentation started" as "(pending)" for manually-created active batches.

---

### Pitfall 5: Custom Field API Name Must Match Exactly

**What goes wrong:** Zoho returns an error if `api_name` in the custom_fields array doesn't match the field's exact API name. Zoho auto-generates the API name (e.g. `cf_batch_status`) and it cannot contain spaces.

**Why it happens:** `ZOHO_CF_BATCH_STATUS` env var is set to the wrong value, or the field was renamed in Zoho after the env var was set.

**How to avoid:** After creating the custom field in Zoho, verify the API name in Settings → Custom Fields, not the display name. Test with a manual PUT before wiring up the automated sync.

**Warning signs:** Zoho API returns `{ code: 1002, message: "Invalid custom field" }` or similar.

---

## Code Examples

### Sync endpoint skeleton

```javascript
// Source: mirrors zoho-middleware/routes/pos.js pattern (VERIFIED: direct read)
// Add to zoho-middleware/routes/pos.js (or a new routes/batch.js)

router.post('/api/batch/sync-zoho', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var body = req.body || {};
  var soId = body.so_id;
  var batchId = body.batch_id;
  var statusLabel = body.status_label;  // e.g. 'Active — SV-B-000123'

  if (!soId || !batchId || !statusLabel) {
    return res.status(400).json({ error: 'Missing so_id, batch_id, or status_label' });
  }

  var cfName = process.env.ZOHO_CF_BATCH_STATUS;
  if (!cfName) {
    log.warn('[batch/sync-zoho] ZOHO_CF_BATCH_STATUS not configured — skipping');
    return res.json({ ok: true, skipped: true });
  }

  var payload = { custom_fields: [{ api_name: cfName, value: statusLabel }] };

  zohoPut('/salesorders/' + soId, payload)
    .then(function () {
      res.json({ ok: true });
    })
    .catch(function (err) {
      log.error('[batch/sync-zoho] Zoho error: ' + err.message);
      // Queue for retry (fire-and-forget)
      queueSyncForRetry({ so_id: soId, batch_id: batchId, status_label: statusLabel }, err.message);
      res.status(502).json({ ok: false, error: 'Zoho sync failed — queued for retry' });
    });
});
```

### Timeline HTML builder (BrewPad)

```javascript
// Source: pattern based on bp-detail-section idiom from brewpad.js (VERIFIED: direct read)
// All var, no const/let; escapeHTML on all user data

function buildLifecycleTimeline(batch, soDate) {
  var events = [
    { label: 'Sale — ' + escapeHTML(batch.zoho_so_number || ''), date: soDate },
    { label: 'Batch created',          date: batch.created_at },
    { label: 'Fermentation started',   date: batch.fermentation_started_at },
    { label: 'Batch completed',        date: batch.completed_at }
  ];

  var html = '<div class="bp-timeline">';
  events.forEach(function (ev) {
    var done = !!ev.date;
    html += '<div class="bp-timeline-item' + (done ? ' bp-timeline-item--done' : '') + '">';
    html += '<span class="bp-timeline-dot">' + (done ? '●' : '○') + '</span>';
    html += '<div class="bp-timeline-body">';
    html += '<span class="bp-timeline-label">' + ev.label + '</span>';
    html += '<span class="bp-timeline-date">' + (done ? fmtDate(ev.date) : '(pending)') + '</span>';
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}
```

### `update_batch` allowedFields extension (Apps Script)

```javascript
// Source: apps-script/adminApi.gs line 1879 (VERIFIED: direct read)
// Add these fields to the allowedFields array:
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  // Phase 7 additions:
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'fermentation_started_at', 'completed_at'
];
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Zoho SO has no batch reference | Custom field `cf_batch_status` on SO | Staff can see batch status in Zoho without switching to BrewPad |
| Timeline visible only in Zoho SO | Lifecycle timeline in BrewPad batch detail | Single pane of glass for full lifecycle |
| Manual batches have no SO link | "Link to Sales Order" button in detail view | All batches can be connected to their sale origin |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zoho Books API accepts `custom_fields` array on PUT `/salesorders/{id}` the same way as on POST `/invoices` | Sync endpoint, Code Examples | The PUT body schema may differ from POST; would need to check Zoho Books API docs and test manually before assuming the payload format is identical |
| A2 | `cf_batch_status` will be the auto-generated API name for a field named "Batch Status" in Zoho | Environment Availability | Zoho may generate a different API name; staff must verify the actual API name after field creation |
| A3 | The `update_batch_schedule` Apps Script action is what fires when a pending batch gets a schedule assigned | Pitfall 4 | If there is a separate code path for activating pending batches, `fermentation_started_at` write must go there instead |

---

## Open Questions

1. **Does Zoho Books PUT /salesorders/{id} support partial updates (only custom_fields)?**
   - What we know: `zohoPut('/salesorders/' + soId, payload)` is used in `/api/kiosk/salesorder-update` with a `{ line_items: [...] }` payload and it works.
   - What's unclear: Whether a body with only `custom_fields` and no `line_items` is accepted, or whether Zoho requires the full SO payload.
   - Recommendation: A1 above is an assumption. The planner should include a verification step: test the PUT with only `custom_fields` in the payload against a real Zoho SO before writing the full implementation.

2. **Which Apps Script action activates a pending batch (sets fermentation_started_at)?**
   - What we know: `update_batch_schedule` exists (doPost line 248). `updateBatch` handles status transitions.
   - What's unclear: Whether schedule assignment goes through `update_batch` or `update_batch_schedule` — the detail view was not fully traced for this flow.
   - Recommendation: Read `update_batch_schedule` function before implementing to confirm it transitions `pending → primary`.

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — new endpoint | `x-api-key` check (`MW_API_KEY`), same as all protected routes in pos.js |
| V4 Access Control | Yes | Referer guard already applies to all `/api/*` routes (server.js line 362) |
| V5 Input Validation | Yes | Validate `so_id`, `batch_id`, `status_label` in request body; reject missing/invalid |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized SO status update | Tampering | `x-api-key` check on sync endpoint (MW_API_KEY, same as all `/api/kiosk/*` routes) |
| SO id injection / path traversal in PUT | Tampering | Validate `soId` is non-empty string; Zoho API rejects malformed IDs |
| Custom field value injection | Tampering | `statusLabel` is constructed server-side from known batch ID + enum status — not user-supplied verbatim |
| SO search data leak | Info Disclosure | `/api/kiosk/salesorders` already protected by Referer guard + API key; no new surface added |

**Note:** The `status_label` value sent from BrewPad to the sync endpoint must be validated server-side (not trusted as-is). The middleware endpoint should construct the Zoho custom field value itself from `batch_id` + a validated status string, rather than passing the `status_label` string directly to Zoho. This prevents a caller from injecting arbitrary text into the Zoho SO field.

---

## Sources

### Primary (HIGH confidence — verified by direct codebase read)
- `zoho-middleware/routes/pos.js` — custom_fields pattern (lines 457, 477-480, 621, 629-633); salesorder update (lines 1213-1339); salesorders list endpoint (lines 800-884)
- `zoho-middleware/lib/brewpad-integration.js` — full file; Redis retry queue pattern (lines 96-111); retry sweep (lines 152-202)
- `zoho-middleware/lib/constants.js` — full file; `BATCH_RETRY_PREFIX` key (line 58)
- `zoho-middleware/lib/validateEnv.js` — full file; OPTIONAL env var registration pattern
- `apps-script/adminApi.gs` — `createBatch` (lines 1649-1717); `updateBatch` (lines 1794-1909); `handlePackagingCompletion` (lines 2241-2270); `getBatchDetail` (lines 1291-1335); doPost action routing (lines 197-297)
- `js/brewpad.js` — `renderBatchDetail` (lines 1527-1611); `shouldShowKioskBadge` (lines 78-85); module.exports (lines 4152-4162)
- `.planning/phases/07-zoho-audit-trail/07-CONTEXT.md` — locked decisions D-01 through D-11
- `.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — ZOHO-01, ZOHO-02, ZOHO-03 acceptance criteria
- `.planning/phases/06-kiosk-to-brewpad-integration/06-CONTEXT.md` — Phase 6 retry queue decisions (D-04)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified in codebase; no new libraries
- Architecture: HIGH — all integration points traced to specific line numbers
- Pitfalls: HIGH — identified from direct code inspection of existing patterns
- Zoho API custom field on PUT: ASSUMED (A1) — extrapolated from POST behavior; needs verification

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable codebase; 30-day window)
