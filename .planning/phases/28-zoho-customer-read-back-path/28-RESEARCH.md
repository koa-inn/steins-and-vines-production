# Phase 28: Zoho Customer Read-Back Path - Research

**Researched:** 2026-06-11
**Domain:** Zoho Books REST API (invoice/SO lookup + contact detail), Express.js route handler, Google Apps Script batch mutation
**Confidence:** HIGH — all critical findings are verified against the live codebase; Zoho API behavior cross-referenced against official docs

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Refresh reads and writes exactly three fields: `customer_name`, `customer_email`, `customer_phone`. No first/last name columns, no `customer_id` re-stamping.

**D-02:** Preserve-existing policy for blanks: if Zoho has a blank value for a field, the write-back skips that field — a refresh never erases data the batch already has.

**D-03:** Lean read payload: the writable fields plus `customer_id` and the resolved invoice/SO number for traceability. No invoice totals/line items.

**D-04:** `customer_phone` comes from the contact's `phone` field, falling back to `mobile` when `phone` is blank.

**D-05:** Endpoint resolves both invoice and SO numbers by prefix: `INV-` → `/invoices`, `SO-` → `/salesorders`.

**D-06:** Lookup uses Zoho's exact-number filter (`invoice_number=` / `salesorder_number=`), not fuzzy `search_text` — deterministic, no wrong-document risk.

**D-07:** Email source: top-level contact record's `email`, falling back to the primary `contact_persons` entry's email when blank — directly handles the known INV-000078 pattern where the email lives only on a contact person.

**D-08:** `customer_name` comes straight off the resolved invoice/SO's `customer_name` field — consistent with what kiosk sales already stamp on batches.

**D-09:** Apps Script path = extend `updateBatch()` `allowedFields` with `customer_email` and `customer_phone` (mirrors how Phase 27 added `start_date`). No new dedicated action.

**D-10:** Frontend two-call orchestration (locked for Phase 29's design): the browser calls the middleware read endpoint, then calls Apps Script `update_batch` with the returned non-empty fields. No middleware→Apps Script server-to-server coupling.

**D-11:** Read endpoint is always live — no Redis caching. Guard Zoho quota with the existing per-route rate-limit pattern. Each refresh costs up to 2 Zoho calls (document + contact).

**D-12:** Staging verification done manually — curl the read endpoint and call Apps Script update for one known linked batch.

**D-13:** Three failure-state granularity: `404 not_found`, `502 zoho_error`, and `200` partial success when the document resolves but contact details are incomplete.

**D-14:** Voided/deleted-status documents still return customer details, with the document's Zoho `status` included in the payload.

**D-15:** If the document resolves but the follow-up `/contacts/{id}` fetch fails: return partial 200 — `customer_name` from the document, email/phone `null`, plus a `contact_unavailable: true` flag.

**D-16:** Input validation: `400 invalid_number` for inputs not matching the expected `INV-`/`SO-` number shapes — fail fast before any Zoho call.

### Claude's Discretion

- Endpoint route name/shape (e.g. `GET /api/batch/customer-by-number?number=INV-000123`) and which routes file it lives in — follow the existing `/api/batch/*` conventions in `pos.js`.
- Auth: follow the existing `x-api-key` (`MW_API_KEY`) pattern used by `sync-zoho` / `search-invoices`.
- Exact rate-limit threshold for the new route.
- Exact regex for D-16 number validation (planner should check what formats actually exist in the Batches sheet).
- Response JSON field names, as long as the D-03/D-13–D-15 semantics hold.
- Test structure/fixtures — follow existing middleware Jest patterns in `zoho-middleware/__tests__/`.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. Manual SO-linking for unlinked batches and automatic background re-sync are in REQUIREMENTS.md "Future Requirements." Customer reassignment is Phase 29.1.
</user_constraints>

---

## Summary

Phase 28 adds the read direction to the existing write-only Zoho sync. Two pieces of work: (1) a new Express route `GET /api/batch/customer-by-number` in `zoho-middleware/routes/pos.js` that resolves an invoice or sales-order number to its linked customer's name, email, and phone via two sequential Zoho Books calls; (2) adding `customer_email` and `customer_phone` to `updateBatch()`'s `allowedFields` array in `apps-script/adminApi.gs` so the calling browser can persist the refreshed fields back onto the batch record.

The codebase already has all the infrastructure needed: `zohoGet()` with `withRetry()` in `lib/zoho-api.js`, the `x-api-key` guard pattern in `pos.js`, and the `allowedFields`-based update mechanism in `adminApi.gs`. This phase only composes those pieces — no new libraries, no new infrastructure.

The Zoho Books `/contacts/{id}` detail endpoint returns a `contact_persons` array with `email`, `phone`, and `mobile` per contact person. The list-level response for `/invoices?invoice_number=...` and `/salesorders?salesorder_number=...` returns summary objects that include `customer_id` and `customer_name`, which means the two-call pattern (document list for ID + customer_id, then `/contacts/{id}` for email/phone) is confirmed as the correct approach.

**Primary recommendation:** Add `GET /api/batch/customer-by-number` to `pos.js`, chain two `zohoGet` calls (document filter then contact detail), shape the response per D-03/D-13–D-15, then add `'customer_email'` and `'customer_phone'` to the `allowedFields` array in `updateBatch()` at `adminApi.gs:2160`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read Zoho invoice/SO by number | API / Backend (middleware) | — | Needs Zoho OAuth token; cannot be called from browser due to CORS + org_id |
| Fetch Zoho contact detail (email/phone) | API / Backend (middleware) | — | Same — requires auth token |
| Validate number shape (INV-/SO- prefix) | API / Backend (middleware) | — | Fail-fast before Zoho call; backend enforces |
| Rate limiting on refresh calls | API / Backend (server.js) | — | Existing `apiLimiter` covers `/api/*` at 60 req/min |
| Persist refreshed fields onto batch record | Backend (Apps Script) | — | Batches sheet lives in Google Sheets; all mutations go through Apps Script |
| Preserve-existing policy (D-02) | Frontend (Phase 29 caller) | — | Caller sends only non-empty fields; backend does not need to compare |
| Two-call orchestration (read then write) | Frontend (Phase 29, D-10) | — | Browser calls MW read endpoint, then Apps Script `update_batch` |

---

## Standard Stack

### Core — all already installed
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | 4.21.2 [VERIFIED: package.json] | Route handler framework | Project's middleware runtime |
| `axios` | 1.13.5 [VERIFIED: package.json] | HTTP client for Zoho calls | Already used by `zoho-api.js` — `zohoGet` wraps axios |
| `jest` | 29.7.0 [VERIFIED: package.json] | Unit test runner | All 323 existing middleware tests use Jest |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `express-rate-limit` | 8.2.1 [VERIFIED: package.json] | Request throttling | Existing `apiLimiter` at 60 req/min already covers `/api/*` — no new limiter needed for this endpoint |

**No new packages required** — this phase adds no dependencies.

**Installation:**
```bash
# No installs needed — all dependencies already in zoho-middleware/package.json
```

---

## Package Legitimacy Audit

No new packages are installed in this phase. The audit is not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (Phase 29 caller)
  |
  | GET /api/batch/customer-by-number?number=INV-000123
  |     x-api-key: MW_API_KEY
  v
Express (pos.js) — validate prefix, check x-api-key
  |
  | zohoGet('/invoices?invoice_number=INV-000123')        [Zoho Books call 1]
  |   --> returns { invoices: [{ invoice_id, customer_id, customer_name, status }] }
  |
  | zohoGet('/contacts/{customer_id}')                    [Zoho Books call 2]
  |   --> returns { contact: { contact_name, email, contact_persons: [...] } }
  |
  +-- success --> 200 { customer_name, customer_email, customer_phone,
  |                     customer_id, document_number, document_status }
  +-- not found --> 404 { error: 'not_found' }
  +-- contact fetch fails --> 200 { customer_name, customer_email: null,
  |                                 customer_phone: null, contact_unavailable: true }
  +-- Zoho down --> 502 { error: 'zoho_error' }
  +-- bad input --> 400 { error: 'invalid_number' }
  
Browser (Phase 29 caller)
  |
  | POST Apps Script (action: update_batch)
  |   { batch_id, updates: { customer_name, customer_email, customer_phone } }
  |   (only non-empty fields sent — D-02 preserve policy lives here)
  v
adminApi.gs updateBatch()
  |
  | allowedFields includes 'customer_email', 'customer_phone' (Phase 28 addition)
  | sanitizeInput() runs on both (strips XSS, passes emails/phones safely)
  v
Batches Google Sheet
  |
  +-- column 'customer_email' updated
  +-- column 'customer_phone' updated (IF the column exists — see Open Question 2 resolution)
  +-- last_updated bumped (optimistic locking version)
```

### Recommended Project Structure

No new directories. The new files land in existing locations:

```
zoho-middleware/
├── routes/
│   └── pos.js               # Add GET /api/batch/customer-by-number here
└── __tests__/
    └── batch-customer.test.js   # New test file (name at planner's discretion)

apps-script/
└── adminApi.gs              # Add 'customer_email', 'customer_phone' to allowedFields
```

### Pattern 1: Exact-number filter for invoice lookup
**What:** Pass `invoice_number=` as a query param to Zoho's list endpoint to get exactly one document. The list endpoint returns `customer_id` and `customer_name` in summary objects — no detail fetch of the invoice is needed.
**When to use:** When you have the human-readable number (e.g. `INV-000123`) but not the opaque internal `invoice_id`.
**Example:**
```javascript
// Source: verified from zoho.com/books/api/v3/invoices/ + search-invoices pattern in pos.js
zohoGet('/invoices', { invoice_number: 'INV-000123' })
  .then(function(data) {
    var invoices = data.invoices || [];
    if (invoices.length === 0) {
      // 404 not_found
    }
    var inv = invoices[0];
    var customerId = inv.customer_id;
    var customerName = inv.customer_name;
    var documentStatus = inv.status;
  });
```

### Pattern 2: Contact detail fetch for email/phone
**What:** Call `/contacts/{customer_id}` (detail endpoint) to get the `contact_persons` array which contains `email`, `phone`, and `mobile`.
**When to use:** After resolving `customer_id` from the document lookup. The list endpoint `/contacts` includes `contact_persons` in its response, but the detail endpoint is the reliable path.
**Example:**
```javascript
// Source: verified from zoho.com/books/api/v3/contacts/ — contact_persons fields confirmed
zohoGet('/contacts/' + customerId)
  .then(function(data) {
    var contact = data.contact || {};
    var email = contact.email || '';  // top-level email (may be blank per INV-000078 pattern)
    var persons = contact.contact_persons || [];
    var primaryPerson = persons.filter(function(p) { return p.is_primary_contact; })[0] || persons[0] || {};
    if (!email) email = primaryPerson.email || '';         // D-07 fallback
    var phone = primaryPerson.phone || primaryPerson.mobile || '';  // D-04 fallback
  });
```

### Pattern 3: x-api-key guard for batch endpoints (copied from sync-zoho)
**What:** Check `req.headers['x-api-key']` against `process.env.MW_API_KEY` before any processing.
**When to use:** All `/api/batch/*` endpoints that are called from staff-authenticated browser sessions.
**Example:**
```javascript
// Source: pos.js:1305-1335 (sync-zoho pattern)
router.get('/api/batch/customer-by-number', function(req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  var number = (req.query.number || '').trim();
  // ... validate, fetch, respond
});
```

### Pattern 4: D-16 input validation (number prefix check)
**What:** Validate that the input matches `INV-` or `SO-` prefix before making any Zoho call. The existing `zoho_so_number` field stores both invoice numbers (from kiosk) and SO numbers (from online checkout).
**Example:**
```javascript
// Derived from pos.js sync-zoho validation style + D-16 locked decision
var INV_PATTERN = /^INV-\d+$/;
var SO_PATTERN  = /^SO-\d+$/;
if (!INV_PATTERN.test(number) && !SO_PATTERN.test(number)) {
  return res.status(400).json({ error: 'invalid_number',
    message: 'number must start with INV- or SO- followed by digits' });
}
```

**Note on regex (RESOLVED — see Open Question 1):** The `zoho_so_number` value is always a Zoho-generated number stamped from `invoice.invoice_number` (kiosk) or `salesorder_number` (checkout/SO). Both are server-generated in the canonical `INV-\d+` / `SO-\d+` shapes. `/^INV-\d+$/` and `/^SO-\d+$/` accept every format the code can produce.

### Pattern 5: allowedFields extension in updateBatch() (mirrors Phase 27 start_date)
**What:** Add the new field names as strings to the `allowedFields` array. `sanitizeInput()` runs automatically on all fields in this array.
**When to use:** When a new field needs to be writable via `update_batch` without vessel-status side effects or other special logic.
**Example:**
```javascript
// Source: adminApi.gs:2160-2173 (verified Phase 27 extension for start_date)
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at',
  'recipe_id',
  'start_date',
  'customer_email',   // Phase 28: refresh from Zoho write-back (D-09)
  'customer_phone'    // Phase 28: refresh from Zoho write-back (D-09)
];
```

`sanitizeInput()` strips HTML/script tags and event handlers but does NOT strip `@` symbols, digits, hyphens, or parentheses — email addresses and phone numbers pass through unmangled. [VERIFIED: adminApi.gs:3126-3155]

### Anti-Patterns to Avoid

- **Using `search_text=` instead of `invoice_number=`:** `search_text` is fuzzy and can return wrong documents (D-06). Use `invoice_number=` for exact match.
- **Assuming the document detail endpoint is needed for customer_id:** The list endpoint for invoices and salesorders includes `customer_id` and `customer_name` in summary objects. No detail fetch of the document is required — saves one Zoho call.
- **Caching the read result:** D-11 explicitly prohibits caching — staleness defeats the purpose of a refresh feature.
- **Adding a new Apps Script action:** D-09 locks the approach as extending `allowedFields`. A new action would duplicate the optimistic locking and sanitization logic already in `updateBatch()`.
- **Server-to-server MW→Apps Script coupling:** D-10 locks the two-call orchestration in the browser (Phase 29). The middleware read endpoint returns the data; the browser decides what to write.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Authenticated Zoho HTTP calls with retry + quota handling | Custom axios wrapper | `zohoGet()` in `lib/zoho-api.js` | Already handles token refresh, exponential backoff, quota codes 44/45/1070 |
| Input sanitization on Apps Script writes | Custom HTML stripper | `sanitizeInput()` in `adminApi.gs` | Already strips XSS vectors; safe for emails/phones |
| Optimistic locking on batch updates | Custom version check | `updateBatch()` existing mechanism | Already implemented with `expectedVersion` / `last_updated` |
| Express rate limiting | Manual counter | `apiLimiter` already applied to `/api/*` | The global `apiLimiter` (60 req/min) already covers the new GET endpoint |
| 400 validation for line items | Custom array validator | `validateLineItems()` in `lib/validate.js` | Not needed here — but `classifyZohoError()` in the same file is useful for the Zoho error path |

**Key insight:** This phase is almost entirely composition. The infrastructure (Zoho auth, retry, rate limiting, Apps Script update mechanism) already exists. The only new code is the route handler logic and the test file.

---

## Common Pitfalls

### Pitfall 1: contact_persons email not at contact top-level (INV-000078 class)
**What goes wrong:** Code reads `contact.email` and gets blank/undefined because the Zoho contact was created via the kiosk or online checkout paths, which store email under `contact_persons[0].email` (the INV-000078 fix shipped in quick task 260611-94q). If the fallback to `contact_persons` is missing, email will be silently blank for all kiosk-created customers.
**Why it happens:** Zoho Books silently drops `email` at the contact top level when creating contacts; email/phone only persist under `contact_persons`. The existing `buildContactPayload()` nests them correctly on creation, but a GET of the contact may still return blank at the top level.
**How to avoid:** Always implement D-07: `email = contact.email || primaryPerson.email`. The test suite must include a fixture where `contact.email` is blank but `contact_persons[0].email` has the value.
**Warning signs:** Integration test returns blank email for a batch known to have a customer email in Zoho.

### Pitfall 2: zohoGet path vs param confusion for list endpoints
**What goes wrong:** Using `zohoGet('/invoices?invoice_number=' + number)` (string concat) instead of `zohoGet('/invoices', { invoice_number: number })` (params object). The `zohoGet` function merges `organization_id` via `Object.assign` on the params arg — appending it to a pre-built query string produces malformed URLs.
**Why it happens:** `search-invoices` in pos.js uses string concat for `search_text` (`zohoGet('/invoices?search_text=' + ...)`). That pattern works for `search_text` but would conflict with `organization_id` merging if you re-use it. Looking at that line without tracing `zohoGet`'s internals leads to copying the wrong pattern.
**How to avoid:** Use the params-object form: `zohoGet('/invoices', { invoice_number: number })`. Check `lib/zoho-api.js:73-85` — params are merged via `Object.assign`.
**Warning signs:** Zoho returns unexpected results or 400 errors because the URL has duplicate/malformed params.

### Pitfall 3: Assuming document detail endpoint needed for customer_id
**What goes wrong:** Fetching the full invoice/SO detail (`/invoices/{invoice_id}`) to get `customer_id`, costing an extra Zoho call when the list response already includes it.
**Why it happens:** Pattern in `search-invoices` already confirms `customer_id` is in the list response. However, if a developer looks at the existing `kiosk/salesorder/:id` (detail fetch) they may assume the detail is required.
**How to avoid:** The list endpoint response for `/invoices?invoice_number=...` includes `customer_id` and `customer_name` in each summary object. Only the contact detail (`/contacts/{id}`) requires a second call.
**Warning signs:** Three Zoho calls per refresh instead of two.

### Pitfall 4: Sending empty/null fields to update_batch (violates D-02)
**What goes wrong:** The middleware read endpoint returns `customer_email: null` (contact_unavailable partial 200). Phase 29's caller naively passes all three fields to `update_batch`, overwriting a batch's existing email with null — the preserve-existing policy is violated.
**Why it happens:** D-02 lives in the frontend caller (Phase 29), not in the middleware or Apps Script. The Apps Script `updateBatch()` will happily write whatever `allowedFields` receives.
**How to avoid:** D-02 is the Phase 29 caller's responsibility. Phase 28 research documents this clearly: the middleware read endpoint returns null for unavailable fields; the caller must filter out nulls before calling `update_batch`. This phase's work (the read endpoint and allowedFields extension) does not enforce D-02 — it relies on the caller.
**Warning signs:** Batch records show blank email after a refresh on a batch that previously had an email entered manually by staff.

### Pitfall 5: Zoho 404 masquerading as empty list
**What goes wrong:** When an invoice number doesn't exist in Zoho, the list endpoint (`/invoices?invoice_number=...`) returns an empty `invoices: []` array rather than HTTP 404. Code that treats an HTTP 404 response as the not-found condition will never fire — Zoho returns 200 with an empty list.
**Why it happens:** Zoho's list endpoints always return 200 with an empty array for zero-result queries. HTTP 404 is only returned for resource-path lookups like `/invoices/{invoice_id}`.
**How to avoid:** Check `(data.invoices || []).length === 0` as the not-found condition, and return your own `404 not_found` response. The test fixture for `not_found` should mock `zohoGet` returning `{ invoices: [] }`.
**Warning signs:** Not-found test never triggers; always falls through to contact fetch on a mock returning empty array.

### Pitfall 6: customer_phone column may not exist in the Batches sheet
**What goes wrong:** `customer_phone` may not exist as a column header in the Batches sheet at all. `createBatch()` in `adminApi.gs` does NOT write `customer_phone` — neither in the positional `appendRow()` call (~line 1948) nor in any header-lookup write afterward (only `customer_firstname`/`customer_lastname`/`recipe_id`/`recipe_snapshot` get header-lookup writes). [VERIFIED: adminApi.gs createBatch, code inspection 2026-06-11] If the column header is absent, adding `customer_phone` to `allowedFields` silently no-ops (`headers.indexOf('customer_phone')` returns -1 and the write is skipped).
**Why it happens:** The Batches sheet schema was built before phone capture; `customer_phone` was never wired into batch creation. The column may have been added manually to the sheet, or may not exist at all.
**How to avoid:** The `allowedFields` extension is defensively safe regardless — the write loop no-ops on a missing column rather than erroring. But because code cannot confirm the column exists, the staging verification checkpoint (Plan 02 Task 3) MUST confirm `customer_phone` actually persists on a real batch. If it stays blank after a refresh that returned a phone number, the human adds a `customer_phone` column header to the Batches sheet (and the existing `allowedFields` write then populates it on the next refresh — no code change needed).
**Warning signs:** `customer_phone` always stays blank after refresh even when Zoho has a phone number → the sheet column header is missing; add it.

---

## Code Examples

### GET handler skeleton (pos.js addition)

> ⚠️ ILLUSTRATIVE ONLY — this skeleton shows the response-field shapes and branch handling.
> It is NOT the authoritative implementation template. For the canonical express-mock/handler
> structure and the `findHandler` capture used by the tests, the AUTHORITATIVE source is
> `28-PATTERNS.md` (the `kiosk-salesorders.test.js` analog) plus the live `search-invoices` /
> `kiosk/salesorder/:id` handlers in `pos.js`. Do not copy this snippet's surrounding structure
> verbatim into either the handler or the test — follow PATTERNS.md for structure, use this only
> as a checklist of which fields and branches each response must contain.

```javascript
// Source: pattern derived from sync-zoho (pos.js:1305) and search-invoices (pos.js:1338)
router.get('/api/batch/customer-by-number', function(req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var number = (req.query.number || '').trim();

  // D-16: validate prefix before any Zoho call
  var isInvoice = /^INV-\d+$/.test(number);
  var isSO      = /^SO-\d+$/.test(number);
  if (!number || (!isInvoice && !isSO)) {
    return res.status(400).json({ error: 'invalid_number',
      message: 'number must match INV-NNNN or SO-NNNN format' });
  }

  var path    = isInvoice ? '/invoices'    : '/salesorders';
  var filter  = isInvoice ? 'invoice_number' : 'salesorder_number';
  var listKey = isInvoice ? 'invoices'     : 'salesorders';

  // Zoho call 1: resolve document by number
  zohoGet(path, { [filter]: number })
    .then(function(data) {
      var docs = data[listKey] || [];
      if (docs.length === 0) {
        return res.status(404).json({ error: 'not_found',
          message: 'No document found with number ' + number });
      }
      // D-06 exact-match defensive check (RESOLVED — see Open Question 3):
      // verify the returned document's number equals the requested number (case-insensitive)
      // before using it, so exact-vs-prefix Zoho semantics are irrelevant to correctness.
      var numberField = isInvoice ? 'invoice_number' : 'salesorder_number';
      var doc = null;
      for (var i = 0; i < docs.length; i++) {
        var dn = String(docs[i][numberField] || '');
        if (dn.toLowerCase() === number.toLowerCase()) { doc = docs[i]; break; }
      }
      if (!doc) {
        // Filter matched fuzzily but no exact-number match — treat as not found
        return res.status(404).json({ error: 'not_found',
          message: 'No exact-number match for ' + number });
      }
      var customerId   = doc.customer_id   || '';
      var customerName = doc.customer_name || '';
      var docStatus    = doc.status        || '';

      if (!customerId) {
        // Document has no customer — return partial
        return res.json({
          customer_name: customerName,
          customer_id: '',
          customer_email: null,
          customer_phone: null,
          document_number: number,
          document_status: docStatus,
          contact_unavailable: true
        });
      }

      // Zoho call 2: contact detail for email/phone (D-07, D-04)
      return zohoGet('/contacts/' + customerId)
        .then(function(contactData) {
          var contact = contactData.contact || {};
          var persons = contact.contact_persons || [];
          var primary = persons.filter(function(p) { return p.is_primary_contact; })[0]
                        || persons[0] || {};

          // D-07: top-level email, fallback to primary contact person email
          var email = contact.email || primary.email || null;
          // D-04: phone, fallback to mobile
          var phone = primary.phone || primary.mobile || null;

          return res.json({
            customer_name:    customerName,
            customer_id:      customerId,
            customer_email:   email  || null,
            customer_phone:   phone  || null,
            document_number:  number,
            document_status:  docStatus
          });
        })
        .catch(function(contactErr) {
          // D-15: contact fetch failed — partial 200
          log.warn('[batch/customer-by-number] Contact fetch failed for ' + customerId
            + ': ' + contactErr.message);
          return res.json({
            customer_name:    customerName,
            customer_id:      customerId,
            customer_email:   null,
            customer_phone:   null,
            document_number:  number,
            document_status:  docStatus,
            contact_unavailable: true
          });
        });
    })
    .catch(function(err) {
      log.error('[batch/customer-by-number] Zoho error: ' + err.message);
      return res.status(502).json({ error: 'zoho_error',
        message: 'Failed to retrieve document from Zoho' });
    });
});
```

### Test file skeleton (batch-customer.test.js)

> ⚠️ ILLUSTRATIVE ONLY — the `_handlers` dict pattern below is a SIMPLIFIED sketch and DIVERGES
> from the project's actual test convention. The AUTHORITATIVE express-mock + route-capture
> pattern is the `_routeRegistry` / `findHandler('get', path)` form documented in `28-PATTERNS.md`
> (the `kiosk-salesorders.test.js` analog). Use PATTERNS.md `findHandler` verbatim. Do NOT copy
> the `_handlers = {}` dict from this snippet — if you do, the RED-state verify grep
> ("No GET handler registered") will not match and TDD discipline is silently bypassed.

```javascript
// Source: pattern from batch-sync.test.js and kiosk-salesorders.test.js
'use strict';

jest.mock('express', function() {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function() {};
  express.Router = function() { return router; };
  return express;
});
jest.mock('../lib/zoho-api', function() { return { zohoGet: jest.fn() }; });
jest.mock('../lib/cache', function() { return {
  get: jest.fn(), set: jest.fn(), del: jest.fn(), isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/logger', function() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function() { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function() { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function() {
  return { decrementStock: jest.fn() };
});
jest.mock('../lib/helcim', function() { return {
  isTerminalEnabled: jest.fn().mockReturnValue(false)
}; });

require('../routes/pos');

var zohoApi = require('../lib/zoho-api');
var express = require('express');
var _handlers = {};
var router = express.Router();
router.get.mock.calls.forEach(function(call) {
  _handlers[call[0]] = call[call.length - 1];
});

var handler = _handlers['/api/batch/customer-by-number'];

function makeReq(query, headers) {
  return { query: query || {}, headers: headers || {} };
}
function makeRes() {
  var res = { _status: 200, _json: null };
  res.status = jest.fn(function(code) { res._status = code; return res; });
  res.json   = jest.fn(function(data)  { res._json  = data;  return res; });
  return res;
}
function flush() { return new Promise(function(r) { setImmediate(r); }); }

describe('GET /api/batch/customer-by-number', function() {
  var OLD_KEY;
  beforeEach(function() {
    jest.clearAllMocks();
    OLD_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-key';
  });
  afterEach(function() {
    process.env.MW_API_KEY = OLD_KEY;
  });

  test('401 without API key', function() {
    handler(makeReq({ number: 'INV-000123' }), makeRes());
    expect(makeRes().status).not.toHaveBeenCalled(); // checked below via res.status mock
  });

  test('400 for invalid number shape', function() {
    var res = makeRes();
    handler(makeReq({ number: 'BADNUM' }, { 'x-api-key': 'test-key' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('invalid_number');
  });

  test('404 when Zoho returns empty invoice list', function() {
    zohoApi.zohoGet.mockResolvedValue({ invoices: [] });
    var res = makeRes();
    handler(makeReq({ number: 'INV-000999' }, { 'x-api-key': 'test-key' }), res);
    return flush().then(function() {
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.error).toBe('not_found');
    });
  });

  test('success path returns customer_name, email, phone', function() {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{
        invoice_id: 'INV-ID-1', invoice_number: 'INV-000001', customer_id: 'CUST-1',
        customer_name: 'Anne MacDougall', status: 'sent'
      }]})
      .mockResolvedValueOnce({ contact: {
        email: '',  // blank top-level — D-07 fallback test
        contact_persons: [{
          email: 'anne@example.com', phone: '604-555-0100',
          is_primary_contact: true
        }]
      }});
    var res = makeRes();
    handler(makeReq({ number: 'INV-000001' }, { 'x-api-key': 'test-key' }), res);
    return flush().then(function() {
      expect(res.status).not.toHaveBeenCalled();
      expect(res._json.customer_name).toBe('Anne MacDougall');
      expect(res._json.customer_email).toBe('anne@example.com'); // D-07 fallback
      expect(res._json.customer_phone).toBe('604-555-0100');
    });
  });

  test('partial 200 when contact fetch fails (D-15)', function() {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{
        invoice_id: 'INV-ID-2', invoice_number: 'INV-000002', customer_id: 'CUST-2',
        customer_name: 'Bob Smith', status: 'paid'
      }]})
      .mockRejectedValueOnce(new Error('Contact not found'));
    var res = makeRes();
    handler(makeReq({ number: 'INV-000002' }, { 'x-api-key': 'test-key' }), res);
    return flush().then(function() {
      expect(res.status).not.toHaveBeenCalled(); // 200
      expect(res._json.customer_name).toBe('Bob Smith');
      expect(res._json.customer_email).toBeNull();
      expect(res._json.contact_unavailable).toBe(true);
    });
  });

  test('502 when Zoho document call fails', function() {
    zohoApi.zohoGet.mockRejectedValue(new Error('Zoho down'));
    var res = makeRes();
    handler(makeReq({ number: 'INV-000003' }, { 'x-api-key': 'test-key' }), res);
    return flush().then(function() {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res._json.error).toBe('zoho_error');
    });
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zoho email at contact top level | Email nested under `contact_persons` (INV-000078 fix) | Quick task 260611-94q | Read path must implement D-07 fallback — blank top-level email is the norm for kiosk-created contacts |
| Write-only Zoho sync | Read + write (this phase adds read direction) | Phase 28 | Enables Phase 29's Refresh button |

**Deprecated/outdated:**
- `search_text=` for invoice lookup: Still functional but returns fuzzy results — replaced by `invoice_number=` for this phase's exact-match requirement (D-06).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zoho Books list endpoint for `/invoices?invoice_number=...` returns a summary object that includes `customer_id` and `customer_name` without needing a detail fetch | Standard Stack / Code Examples | If `customer_id` is absent from the list response, the two-call pattern fails and a three-call pattern (list + detail + contact) is required |
| A2 | `/salesorders?salesorder_number=...` behaves the same as the invoice filter (returns non-empty list with `customer_id` when found) | Code Examples | If SO list filter behaves differently, the D-05 prefix-routing logic needs adjustment |
| A3 | RESOLVED (see Open Question 2): the `customer_phone` column may NOT exist in the Batches sheet — `createBatch()` never writes it. The `allowedFields` write is defensively safe (no-ops on missing column); staging checkpoint confirms persistence | Pitfalls | Low — write no-ops rather than erroring; mitigation is adding the column header on the sheet, no code change |
| A4 | Zoho's `/contacts/{id}` detail endpoint returns `contact_persons` with both `phone` and `mobile` fields even when they are blank | Code Examples | If the fields are absent (not just blank), the `|| primary.mobile` fallback in D-04 is a no-op rather than a true fallback |

**If this table is empty:** N/A — four assumptions flagged above.

---

## Open Questions (RESOLVED)

1. **Exact `zoho_so_number` format in production Batches sheet** — **(RESOLVED 2026-06-11, code inspection)**
   - Resolution: `zoho_so_number` is never entered by hand. It is stamped from Zoho-generated values on every write path:
     - Kiosk sale: `var invoiceNumber = invoice.invoice_number || ''` → passed to `createBatchesFromSale()` → written as `zoho_so_number` [VERIFIED: pos.js:487, brewpad-integration.js:153,169].
     - Online checkout / SO sale: `salesorder_number` from the Zoho SO response [VERIFIED: checkout.js:551, pos.js:569,949].
     - Recipe sale: same `invoiceNumber` plumbing [VERIFIED: brewpad-integration.js:380-391].
   - Zoho generates these in the canonical `INV-\d+` and `SO-\d+` shapes (e.g. `INV-000078`, `SO-00123`). There is NO code path that writes a free-form or partial value into `zoho_so_number`.
   - Conclusion: the D-16 regexes `/^INV-\d+$/` and `/^SO-\d+$/` accept every value the code can produce. A production sheet scan is NOT required — the format is fully code-derived. Residual risk (pre-system legacy rows with hand-typed numbers) is negligible and, if it surfaces, manifests only as a benign `400 invalid_number` on that one stale batch; it is covered by the staging verification checkpoint (Plan 02 Task 3).

2. **`customer_phone` column existence in Batches sheet** — **(RESOLVED 2026-06-11, code inspection)**
   - Resolution: Code inspection of `createBatch()` in `adminApi.gs` shows `customer_phone` is **never written** — not in the positional `appendRow()` (~line 1948, which writes `customer_email` at col 7 but has no phone slot) and not in any of the subsequent header-lookup writes (only `customer_firstname`, `customer_lastname`, `recipe_id`, `recipe_snapshot` get header-lookup writes). The earlier `sanitizeInput(payload.customer_phone || '')` at line 834 belongs to the **reservation** append function (note the `timeslot`/`pending`/`now` columns), NOT `createBatch` — it does not prove a Batches-sheet column.
   - Conclusion: code CANNOT confirm a `customer_phone` column header exists in the Batches sheet. This is acceptable: the `updateBatch()` write loop does `headers.indexOf(field)` and silently skips when the column is absent (`-1`), so adding `customer_phone` to `allowedFields` is defensively safe — it errors nothing. The residual unknown (does the column exist?) is explicitly pushed to the staging verification checkpoint (Plan 02 Task 3), which asserts that a refresh returning a phone number actually persists it; if it stays blank, the human adds the `customer_phone` column header to the sheet and the existing `allowedFields` write populates it on the next refresh — no code change. `customer_email` (col 7) is confirmed present, so email persistence is guaranteed.

3. **`invoice_number=` exact vs `invoice_number_contains` Zoho behavior** — **(RESOLVED 2026-06-11, defensive-contract resolution)**
   - Resolution: D-06 is a locked decision to use the `invoice_number=` / `salesorder_number=` filter. Rather than depend on Zoho's documented-vs-undocumented exact-match semantics (MEDIUM confidence, not confirmed in official v3 docs), the handler defends against it: after the list call returns, the handler iterates the returned docs and selects the one whose `invoice_number` / `salesorder_number` field **equals the requested number exactly, case-insensitively**, before using it. If no doc exact-matches, it returns `404 not_found`.
   - Consequence: whether Zoho's filter is exact-match or behaves like a `contains`/`startswith` prefix is now IRRELEVANT to correctness — a fuzzy/multi-result response can never yield a wrong document, because the defensive equality check rejects non-exact matches. This is reflected in the GET-handler skeleton above (the exact-match loop) and is a required acceptance criterion + test fixture in Plan 28-01 Task 2.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Middleware runtime | ✓ | Inherited from Railway deployment | — |
| Redis | Rate limiting (apiLimiter) | ✓ (Railway) | Managed Railway service | Falls back to in-process MemoryStore per `redisUnavailableSkip` |
| Zoho Books API | Document + contact lookup | ✓ (requires Zoho re-auth after MW restart) | v3 | None — 502 returned to caller |

**Missing dependencies with no fallback:** None for this phase.

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — staff endpoint, no user auth in middleware |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes | `x-api-key` (`MW_API_KEY`) guard on the new GET endpoint — same as `sync-zoho` and `search-invoices` |
| V5 Input Validation | Yes | D-16 prefix regex on `number` param before Zoho call; `sanitizeInput()` on Apps Script write |
| V6 Cryptography | No | No crypto in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized Zoho data disclosure via new read endpoint | Information Disclosure | `x-api-key` guard (MW_API_KEY); existing `requireAllowedReferer` + CORS guard at server level |
| Enumeration of customer data via sequential INV- numbers | Information Disclosure | `apiLimiter` at 60 req/min + `x-api-key` required; MW_API_KEY is semi-public by design (see SECURITY.md — accepted risk) |
| XSS injection via customer data written to Batches sheet | Tampering | `sanitizeInput()` runs on all `allowedFields` writes in Apps Script |
| Input that triggers unexpected Zoho API behavior | Tampering | D-16 regex validates format before any Zoho call; Zoho calls are read-only |

---

## Sources

### Primary (HIGH confidence)
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/routes/pos.js` lines 1304–1411 — existing batch endpoint patterns: sync-zoho, search-invoices, kiosk/salesorder/:id [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/routes/pos.js` line 487 — kiosk `invoice_number` → `zoho_so_number` origin [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/lib/brewpad-integration.js` lines 153–169, 380–391 — `invoiceNumber` plumbed into `zoho_so_number` [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/routes/checkout.js` line 551 — `salesorder_number` origin [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/lib/zoho-api.js` — `zohoGet()`, `withRetry()`, params-object API [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/apps-script/adminApi.gs` lines 1948–1982 — `createBatch()` row write: writes `customer_email`, does NOT write `customer_phone` [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/apps-script/adminApi.gs` lines 2073–2228 — `updateBatch()`, `allowedFields` at line 2160, `sanitizeInput()` at line 3126 [VERIFIED: codebase]
- `/Users/koa/dev/steins-and-vines-website/zoho-middleware/server.js` lines 128–373 — rate limiters, `requireAllowedReferer`, route registration order [VERIFIED: codebase]
- `https://www.zoho.com/books/api/v3/contacts/` — `contact_persons` array fields confirmed: `email`, `phone`, `mobile`, `is_primary_contact` [CITED: official Zoho Books API docs]

### Secondary (MEDIUM confidence)
- `https://www.zoho.com/books/api/v3/invoices/` — invoice list endpoint supports `invoice_number` filter; list response includes `customer_id` and `customer_name` [CITED: official docs — exact-match vs prefix behavior not explicitly specified; neutralized by the defensive exact-match check, Open Question 3]

### Tertiary (LOW confidence)
- Community examples and WebSearch results confirming `invoice_number=` as a filter parameter on the list endpoint [ASSUMED — not explicitly documented as "exact match" in official v3 docs; the handler's defensive exact-match equality check makes this irrelevant to correctness per Open Question 3]

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new packages; all existing packages verified via package.json
- Architecture: HIGH — derived directly from verified codebase patterns
- Pitfalls: HIGH — INV-000078 is a documented production incident; other pitfalls verified via code inspection
- Zoho API behavior (list filter exact-match): MEDIUM (cited from official docs) but NEUTRALIZED — the defensive exact-match equality check (Open Question 3) removes dependence on Zoho's filter semantics

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable middleware; Zoho API v3 stable)
