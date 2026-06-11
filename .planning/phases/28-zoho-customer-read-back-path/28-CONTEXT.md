# Phase 28: Zoho Customer Read-Back Path - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the net-new read path behind the Phase 29 "Refresh from Zoho" feature: (1) a new middleware endpoint that, given a batch's `zoho_so_number` (an invoice or sales-order number), resolves the document in Zoho Books and returns the linked customer's name, email, and phone; (2) an Apps Script write path that persists those refreshed fields onto an existing batch record by batch ID. Today the Zoho sync is write-only (`POST /api/batch/sync-zoho` pushes batch status TO Zoho); this phase adds the read direction.

**In scope:** new middleware read endpoint + unit tests (success, not-found, Zoho-error paths) + lint clean; extending `adminApi.gs` `updateBatch()` to accept `customer_email`/`customer_phone`; manual staging verification of the read→write loop for one known linked batch.

**Out of scope:** any UI (Phase 29 builds the "Refresh from Zoho" button); manual SO-linking for batches with no `zoho_so_number` (deferred future requirement); automatic/background re-sync; customer reassignment with Zoho propagation (Phase 29.1).

**⚠ Key scoping facts (verified in code):**
- `zoho_so_number` actually stores **invoice numbers** (e.g. `INV-000123`) — kiosk sales create invoices via `brewpad-integration.js` (`zoho_so_number: invoiceNumber`, lines ~169/391). Online checkout can produce SO numbers. The field name is misleading.
- The Batches sheet **already has** `customer_email` and `customer_phone` columns (written at create time, `adminApi.gs` ~833/1955), but `updateBatch()`'s `allowedFields` (~2157) does NOT include them — that's the entire Apps Script gap.
- Existing `GET /api/batch/search-invoices` (pos.js ~1338) returns `customer_name`/`customer_id` but **not email/phone** — those require a follow-up `/contacts/{customer_id}` fetch.

</domain>

<decisions>
## Implementation Decisions

### Refreshed field set
- **D-01:** Refresh reads and writes exactly three fields: `customer_name`, `customer_email`, `customer_phone`. No first/last name columns, no `customer_id` re-stamping.
- **D-02:** **Preserve-existing policy for blanks:** if Zoho has a blank value for a field, the write-back skips that field — a refresh never erases data the batch already has (staff may have manually entered an email Zoho lacks). Implication for Phase 29's caller: only send non-empty fields to `update_batch`.
- **D-03:** Lean read payload: the writable fields plus `customer_id` and the resolved invoice/SO number for traceability. No invoice totals/line items.
- **D-04:** `customer_phone` comes from the contact's `phone` field, falling back to `mobile` when `phone` is blank.

### Lookup & email source
- **D-05:** Endpoint resolves **both invoice and SO numbers by prefix**: `INV-` → `/invoices`, `SO-` → `/salesorders`.
- **D-06:** Lookup uses Zoho's **exact-number filter** (`invoice_number=` / `salesorder_number=`), not fuzzy `search_text` — deterministic, no wrong-document risk.
- **D-07:** Email source: top-level contact record's `email`, **falling back to the primary `contact_persons` entry's email** when blank — directly handles the known INV-000078 pattern where the email lives only on a contact person.
- **D-08:** `customer_name` comes straight off the resolved invoice/SO's `customer_name` field — consistent with what kiosk sales already stamp on batches; no name parsing from contact records.

### Write-back architecture
- **D-09:** Apps Script path = **extend `updateBatch()` `allowedFields`** with `customer_email` and `customer_phone` (mirrors how Phase 27 added `start_date`). No new dedicated action — reuses existing optimistic locking, sanitization, and the staff-OAuth `update_batch` route.
- **D-10:** **Frontend two-call orchestration** (locked for Phase 29's design): the browser calls the middleware read endpoint, then calls Apps Script `update_batch` with the returned non-empty fields. No middleware→Apps Script server-to-server coupling for this feature.
- **D-11:** Read endpoint is **always live** — no Redis caching of results (it's a refresh feature; staleness right after a Zoho edit defeats the purpose). Guard Zoho quota with the existing per-route rate-limit pattern (`rl:*` counters). Note each refresh costs up to 2 Zoho calls (document + contact).
- **D-12:** Staging verification (success criterion #4) is done manually — curl the read endpoint and call the Apps Script update (curl/browser console) for one known linked batch, then confirm the batch record shows current Zoho details. No throwaway verify script.

### Not-found/error contract
- **D-13:** Three failure-state granularity: `404 not_found` (number doesn't resolve in Zoho), `502 zoho_error` (Zoho down/quota/auth), and `200` **partial success** when the document resolves but contact details are incomplete (return what exists). Phase 29 maps these to distinct staff messages.
- **D-14:** Voided/deleted-status documents still return customer details, with the document's Zoho `status` included in the payload (e.g. `"void"`) so Phase 29 can warn if desired. Not treated as not-found.
- **D-15:** If the document resolves but the follow-up `/contacts/{id}` fetch fails (deleted contact, second-call error): return **partial 200** — `customer_name` from the document, email/phone `null`, plus a `contact_unavailable: true` flag. Combined with D-02, old email/phone on the batch stay intact.
- **D-16:** Input validation: `400 invalid_number` for inputs not matching the expected `INV-`/`SO-` number shapes — fail fast before any Zoho call, consistent with the strict validation style of existing batch endpoints.

### Claude's Discretion
- Endpoint route name/shape (e.g. `GET /api/batch/customer-by-number?number=INV-000123`) and which routes file it lives in — follow the existing `/api/batch/*` conventions in `pos.js`.
- Auth: follow the existing `x-api-key` (`MW_API_KEY`) pattern used by `sync-zoho` / `search-invoices`.
- Exact rate-limit threshold for the new route.
- Exact regex for D-16 number validation (planner should check what formats actually exist in the Batches sheet).
- Response JSON field names, as long as the D-03/D-13–D-15 semantics hold.
- Test structure/fixtures — follow existing middleware Jest patterns in `zoho-middleware/__tests__/`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Middleware (Express, `zoho-middleware/`)
- `zoho-middleware/routes/pos.js` ~1305–1410 — existing batch-namespace endpoints: `POST /api/batch/sync-zoho` (write-only sync, the auth/validation pattern to mirror), `GET /api/batch/search-invoices` (Phase 7 invoice search — returns customer_name/customer_id but no email), `GET /api/kiosk/salesorder/:id` (SO fetch by ID with response-shaping pattern).
- `zoho-middleware/lib/zoho-api.js` — `zohoGet` wrapper with `withRetry()` backoff and Zoho error-code handling (44/45/1070 quota codes) — the new endpoint's Zoho calls go through this.
- `zoho-middleware/lib/brewpad-integration.js` ~64–169/391 — proof that `zoho_so_number` is populated with invoice numbers from kiosk sales.
- `zoho-middleware/routes/checkout.js` ~536–551 — online checkout creates invoice OR salesorder (`useInvoice` branch) — why D-05 handles both prefixes.

### Backend (Apps Script)
- `apps-script/adminApi.gs` — `updateBatch()` `allowedFields` (~2157, add `customer_email`/`customer_phone` here); batch creation customer columns (~799–834, ~1955) proving the sheet columns exist; `update_batch` action routing + optimistic locking (`expectedVersion`) conventions.

### Phase planning docs
- `.planning/ROADMAP.md` §"Phase 28" — goal + 4 success criteria (unit tests for success/not-found/Zoho-error are explicitly required).
- `.planning/phases/27-pending-batch-visibility-activation/27-CONTEXT.md` — established batch-mutation conventions carried forward (expectedVersion, refresh helpers, update_batch extension precedent).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`zohoGet()` + `withRetry()`** (`lib/zoho-api.js`) — authenticated Zoho Books calls with quota-aware retry; the new endpoint composes two of these (document lookup, then contact fetch).
- **`/api/batch/*` endpoint template** — `sync-zoho` and `search-invoices` in `pos.js` show the exact `x-api-key` check, input validation, response shaping, and `502` Zoho-error handling to replicate.
- **`updateBatch()` allowedFields mechanism** — adding two strings to the array gets sanitization, version checking, and column mapping for free.
- **Middleware Jest suite** (`zoho-middleware/__tests__/`) — 323 existing tests with established mocking patterns for `zoho-api`.

### Established Patterns
- **`x-api-key` = `MW_API_KEY`** on mutating/staff batch endpoints; CORS + Referer guard at server level.
- **Optimistic locking** — batch mutations pass `expectedVersion`; the Phase 29 caller will need the batch's `last_updated` when calling `update_batch` (read path itself is unaffected).
- **Rate limiting** — existing `rl:*` Redis counter pattern per route.
- **CI gates** — middleware tests + ESLint run on push; success criterion #2 requires lint-clean.

### Integration Points
- New read endpoint ↔ Zoho Books `/invoices?invoice_number=` / `/salesorders?salesorder_number=` then `/contacts/{customer_id}`.
- `adminApi.gs` `update_batch` ↔ Batches sheet `customer_email`/`customer_phone` columns (already exist).
- Phase 29 UI (future) ↔ both of the above via the frontend two-call flow (D-10).

### ⚠ Planner notes
- Zoho list endpoints return summary objects; confirm whether the list response includes `customer_id` (it does for invoices per the Phase 7 endpoint) — if so, the detail fetch of the document itself may be skippable, keeping the call budget at 2 (list + contact).
- The contact fetch returns `contact_persons` only on the detail endpoint (`/contacts/{id}`), not the list — D-07's fallback requires the detail call.
- `sanitizeInput()` in `adminApi.gs` runs on all allowedFields writes — verify it passes emails/phones through unmangled (it strips HTML, which should be fine for both).

</code_context>

<specifics>
## Specific Ideas

- The INV-000078 contact_persons email gotcha is a real production incident this phase must handle (D-07) — it's the reason "fallback to contact_persons" is locked rather than discretionary.
- "Refresh" semantics drove two locked choices: always-live reads (D-11) and never-erase-existing-data (D-02). The mental model is "pull what Zoho knows, add it to the batch, never subtract."

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Manual SO-linking for unlinked batches and automatic background re-sync were already in REQUIREMENTS.md "Future Requirements" before this discussion; customer reassignment is Phase 29.1.)

</deferred>

---

*Phase: 28-Zoho Customer Read-Back Path*
*Context gathered: 2026-06-11*
