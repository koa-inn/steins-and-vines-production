---
phase: 28-zoho-customer-read-back-path
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - zoho-middleware/routes/pos.js
  - zoho-middleware/__tests__/batch-customer.test.js
  - apps-script/adminApi.gs
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 28: Code Review Report

**Reviewed:** 2026-06-11
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 28 adds a read-back path that resolves customer contact details from a Zoho
invoice/SO number (`GET /api/batch/customer-by-number` in `pos.js`) and a write-back
path that persists `customer_email`/`customer_phone` onto the batch record
(`allowedFields` addition in `adminApi.gs` `updateBatch`). A new Jest test file
covers the read endpoint.

The new handler is well-structured: prefix validation runs before any Zoho call,
the defensive exact-match loop correctly rejects fuzzy filter matches, and the
partial-200 / 502 error paths match the documented decisions (D-13, D-15). No
critical defects were found. However there are real concerns: an auth-comparison
pattern that fails open when the env var is unset, a documented-but-unguarded
data-erasure path on the write side, an input-validation gap on the `number`
length, and a test-env pollution bug in `afterEach`.

## Warnings

### WR-01: API-key check fails open when `MW_API_KEY` env var is unset

**File:** `zoho-middleware/routes/pos.js:1371-1374`
**Issue:** The handler authenticates with:
```js
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```
If `process.env.MW_API_KEY` is unset, a request that sends **no** key has
`apiKey === undefined`, so `undefined !== undefined` is `false` and the guard
passes — an unauthenticated caller reaches Zoho and exfiltrates customer name,
email, and phone. The global mutating-route guard in `server.js:232-252` handles
this case explicitly (returns 503 when `API_SECRET_KEY` is falsy and reads
`API_SECRET_KEY || MW_API_KEY`), but this GET route bypasses that guard
(`server.js:233` exempts all GET) and only checks `MW_API_KEY`. Production may set
only `API_SECRET_KEY` (Railway), in which case `MW_API_KEY` is undefined on the
server and this endpoint is open. This is a copy of the pre-existing pattern in
`/api/orders/recent`, `/api/admin/inventory-ledger`, and `/api/batch/search-invoices`,
so it is shipping behavior, but the new endpoint returns PII and is the most
sensitive instance.
**Fix:** Compare against the same resolved secret the global guard uses, and reject
when it is unset:
```js
var SECRET = process.env.API_SECRET_KEY || process.env.MW_API_KEY || '';
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (!SECRET || apiKey !== SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### WR-02: `number` query param has no length cap before Zoho call

**File:** `zoho-middleware/routes/pos.js:1376-1393`
**Issue:** `number` is trimmed and matched against `/^INV-\d+$/` / `/^SO-\d+$/`,
but those regexes have no upper bound on the digit run. A caller can send
`number=INV-` followed by tens of thousands of digits; it passes validation and is
forwarded verbatim into a Zoho list filter (`filterParams[filterKey] = number`).
Compared with the surrounding code, every other user-supplied string in this file
is length-capped (`item_id.length > 64`, `reference_number.slice(0, 64)`,
`idempotency_key.slice(0, 128)`). This one is not.
**Fix:** Add a length bound to the validation, e.g.
`var isInvoice = /^INV-\d{1,12}$/.test(number);` and the SO equivalent, or reject
`number.length > 32` up front before the regex test.

### WR-03: `updateBatch` write-back will erase customer fields if caller sends blanks

**File:** `apps-script/adminApi.gs:2157-2174`
**Issue:** `customer_email` and `customer_phone` were added to `allowedFields`, and
the apply loop writes any field that is `!== undefined`:
```js
allowedFields.forEach(function (field) {
  if (updates[field] !== undefined) {
    var colIndex = headers.indexOf(field);
    if (colIndex !== -1) {
      sheet.getRange(row, colIndex + 1).setValue(sanitizeInput(String(updates[field])));
    }
  }
});
```
If the refresh-from-Zoho flow returns `contact_unavailable` (email/phone `null`)
and the caller forwards `customer_email: ''`, the loop writes an empty string and
**overwrites** existing staff-entered contact data. The empty-string guard lives
only in the (not-yet-built) Phase 29 caller; the Apps Script itself has no
preserve-existing protection. The phase docs accept this (T-28-07 / D-02), but the
risk is real and silent — `sendBottlingInvite` (`adminApi.gs:1431-1434`) then fails
with `no_email` for a customer who previously had one.
**Fix:** Make the write self-defending by skipping blank string updates for these
two fields (treat "" as "no change"):
```js
allowedFields.forEach(function (field) {
  if (updates[field] === undefined) return;
  var val = sanitizeInput(String(updates[field]));
  if ((field === 'customer_email' || field === 'customer_phone') && val === '') return;
  var colIndex = headers.indexOf(field);
  if (colIndex !== -1) sheet.getRange(row, colIndex + 1).setValue(val);
});
```

### WR-04: Test `afterEach` writes the string `"undefined"` into `process.env.MW_API_KEY`

**File:** `zoho-middleware/__tests__/batch-customer.test.js:116-118`
**Issue:** When the suite runs in an environment where `MW_API_KEY` was not
previously set, `OLD_MW_KEY` is `undefined`, and `process.env.MW_API_KEY = OLD_MW_KEY`
coerces it to the literal string `"undefined"` (Node stringifies env assignments).
The variable is now polluted to a truthy non-empty string rather than being unset.
Within this file `beforeEach` re-sets it, so the suite passes, but the leak escapes
to any later code in the same worker that reads `process.env.MW_API_KEY` and
expects unset.
**Fix:** Restore by deleting when the original was absent:
```js
afterEach(function () {
  if (OLD_MW_KEY === undefined) delete process.env.MW_API_KEY;
  else process.env.MW_API_KEY = OLD_MW_KEY;
});
```

## Info

### IN-01: `document_status` for SOs ignores `order_status`

**File:** `zoho-middleware/routes/pos.js:1419`
**Issue:** `docStatus = doc.status || ''`. Elsewhere in this file the SO status is
read as `so.order_status || so.status` (`pos.js:1016`), because Zoho exposes the
fulfillment state under `order_status`. For sales orders the returned
`document_status` may therefore differ from what the kiosk-pay path reports for the
same order. Plan D-14 only requires that voided/deleted statuses still return data,
so this is consistency-only, not a correctness break.
**Fix:** For the SO branch, prefer `doc.order_status || doc.status || ''` for parity
with the rest of the module.

### IN-02: Contact-fetch failure and "no customer linked" both surface as `contact_unavailable: true`

**File:** `zoho-middleware/routes/pos.js:1421-1431, 1459-1472`
**Issue:** Two distinct conditions — document has no `customer_id` at all, vs. the
contact fetch threw — return the identical shape (`contact_unavailable: true`,
null email/phone). The caller cannot distinguish "no contact exists" from "Zoho
contact call failed, retry later." Matches the plan, but limits the UI's ability to
offer a retry vs. a manual-entry affordance.
**Fix:** Optionally add a discriminator (e.g. `reason: 'no_contact'` vs
`reason: 'contact_fetch_failed'`) so Phase 29 UI can branch.

### IN-03: Test suite does not cover the no-`customer_id` partial-200 branch

**File:** `zoho-middleware/__tests__/batch-customer.test.js` (whole file)
**Issue:** The handler has a partial-200 branch when the resolved document has a
blank `customer_id` (`pos.js:1421-1431`) that short-circuits before the second
Zoho call. No test exercises it — the D-15 test covers only the contact-fetch
**reject** path, which is a different branch. This is the branch most likely to
regress silently if the response shape is refactored.
**Fix:** Add a case: invoice resolves with `customer_id: ''` → expect 200,
`contact_unavailable: true`, `customer_email: null`, and assert `zohoGet` was
called exactly once (no contact lookup).

---

_Reviewed: 2026-06-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
