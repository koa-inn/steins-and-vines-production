---
phase: 29-refresh-from-zoho-admin-ui
reviewed: 2026-06-12T20:02:23Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - js/admin.js
  - js/brewpad.js
  - tests/frontend/brewpad-zoho-refresh.test.js
  - tests/frontend/admin-zoho-refresh.test.js
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-06-12T20:02:23Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the Phase 29 "Refresh from Zoho" diff (b7694a3..HEAD): new pure helpers (`isValidZohoNumber`, `buildRefreshUpdates`, `compareRefreshFields`) duplicated in `js/admin.js` and `js/brewpad.js`, two click handlers calling `GET /api/batch/customer-by-number`, new Email/Phone/Zoho Ref detail rows, and two new Jest suites (53 tests, all passing).

The pure helpers are mostly sound and well-tested in isolation, but the handler integration has two Critical defects: (1) the frontend validity gate is case-insensitive while the middleware endpoint validates case-sensitively — the code comments claiming "a 400 can never fire from the UI" are provably false; and (2) the refreshed `customer_name` is invisible for all non-legacy batches because display logic prefers `customer_firstname`/`customer_lastname`, which the refresh never updates — the success toast lies and the Sheet is left internally inconsistent. The designed version-conflict error path is dead code in both files (the substring check never matches the Apps Script message). Tests only cover the pure helpers; no test exercises the handler, which is exactly where every defect below lives.

## Critical Issues

### CR-01: Case-sensitivity contract mismatch — frontend gate accepts refs the middleware rejects with 400

**File:** `js/brewpad.js:46-49`, `js/admin.js:9570-9573` (vs `zoho-middleware/routes/pos.js:1379-1384`)
**Issue:** Both frontend copies of `isValidZohoNumber` use a case-insensitive regex (`/^(INV|SO)-\d+$/i`), but the middleware endpoint validates case-sensitively:

```js
// pos.js:1379-1380 — NO `i` flag
var isInvoice = /^INV-\d+$/.test(number);
var isSO      = /^SO-\d+$/.test(number);
```

For a batch whose `zoho_so_number` is `inv-000123` or `so-42`, the Refresh button renders, the click fires, and the middleware returns **400 `invalid_number`**. Neither handler has a 400 branch, so the user gets the generic "Refresh failed — try again" — and retrying can never succeed. The doc comments assert the opposite invariant ("a 400 invalid_number response can never fire from the UI" — `js/brewpad.js:45`; "matches the format the … endpoint accepts — /^(INV|SO)-\d+$/i" — `js/admin.js:9562-9566`), and the tests bake the broken contract in as expected behavior (`returns true for inv-5`, `so-999`). Note the middleware itself does a case-insensitive exact-match at `pos.js:1409`, so the two layers disagree internally about case handling.
**Fix:** Pick one contract. Either (a) drop the `i` flag in both frontend helpers so lowercase refs render "Not linked"/no button (matches current middleware), or (b) normalize in the middleware before validating:
```js
var number = (req.query.number || '').trim().toUpperCase();
```
Option (b) matches the stated D-08 intent and the existing case-insensitive match at pos.js:1409. Update the tests to match whichever contract is chosen.

### CR-02: Refreshed customer name is never displayed for non-legacy batches; Sheet left internally inconsistent

**File:** `js/admin.js:6093-6098`, `js/brewpad.js:2612-2619` (vs `getCustomerDisplayName` at `js/admin.js:36-41`, `js/brewpad.js:34-39`)
**Issue:** The refresh writes only `customer_name`/`customer_email`/`customer_phone`, but both display helpers prefer `customer_firstname`/`customer_lastname` when present:

```js
function getCustomerDisplayName(b) {
  if (b.customer_firstname || b.customer_lastname) {
    return ((b.customer_firstname || '') + ' ' + (b.customer_lastname || '')).trim();
  }
  return b.customer_name || '';   // legacy fallback only
}
```

Modern batches are created *with* firstname/lastname (Apps Script `create_batch` writes them — `apps-script/adminApi.gs:1975`; kiosk flow — `js/admin.js:10348`; brewpad — `js/brewpad.js:3642`). So for the common case: the customer's name is corrected in Zoho, staff click Refresh, the toast says "Customer info updated from INV-…", but the Customer row (`customerNode.textContent = getCustomerDisplayName(b)`) and every list card keep showing the stale firstname/lastname. Meanwhile the Batches sheet now holds a `customer_name` that contradicts its own `customer_firstname`/`customer_lastname` columns — and any other consumer that prefers those fields (e.g., the public batch greeting at `adminApi.gs:1437-1438`) continues using stale data. The feature's primary purpose (name correction) silently no-ops visually while reporting success.
**Fix:** Include name parts in the update payload so all three name fields stay coherent, e.g.:
```js
var updates = buildRefreshUpdates(data);
if (updates.customer_name) {
  var parts = updates.customer_name.split(/\s+/);
  updates.customer_firstname = parts.shift() || '';
  updates.customer_lastname = parts.join(' ');
}
```
(or clear firstname/lastname when customer_name is refreshed, and make `getCustomerDisplayName` fall through). Apply in both files and patch the same keys into the in-memory objects/caches.

## Warnings

### WR-01: Version-conflict detection is dead code — the substring check never matches the server's message

**File:** `js/admin.js:6130`, `js/brewpad.js:2663` and `js/brewpad.js:2679`
**Issue:** Both handlers detect optimistic-lock conflicts with `err.message.toLowerCase().indexOf('version') !== -1`. But `adminApiPost` throws `new Error(data.message || data.error)` (`js/admin.js:670`, `js/brewpad.js:683`), and the Apps Script returns:
```js
// adminApi.gs:2096
return { ok: false, error: 'version_conflict', message: 'Batch was modified by another user. Refresh and try again.' };
```
`data.message` always wins, and neither conflict message ("Batch was modified by another user…", "Batch was modified…") contains the substring "version". The "Batch was updated elsewhere — please reload" branch can never execute; conflicts surface as "Refresh failed — try again", which tells the user to do the one thing that cannot work (retry with the same stale version).
**Fix:** Match on the actual message or, better, carry the error code. Minimal local fix:
```js
if (msg.indexOf('version') !== -1 || msg.indexOf('modified') !== -1) { ... }
```
Robust fix: in `adminApiPost`, attach `err.code = data.error` before throwing and check `err.code === 'version_conflict'` in the handlers.

### WR-02: brewpad sends a stale `expectedVersion` after any other edit in the same detail pane

**File:** `js/brewpad.js:2596-2600`
**Issue:** The refresh handler is the *only* `update_batch` caller in brewpad that sends `expectedVersion` (sourced from `_currentBatchDetail.last_updated`). Every other handler in the same pane — notes (`brewpad.js:2726`), status (`brewpad.js:2482`), vessel/location (`brewpad.js:1838`), etc. — neither sends a version nor writes the server's new `last_updated` back into `_currentBatchDetail`. After any such save, the server's `last_updated` is newer than the client's, so a subsequent "Refresh from Zoho" in the same session is guaranteed to hit `version_conflict` — and, combined with WR-01, the user sees "Refresh failed — try again" with no working recovery short of closing and reopening the pane. Edit-notes-then-refresh is a routine flow.
**Fix:** Have the other brewpad save handlers update `_currentBatchDetail.last_updated = result.newVersion` (the Apps Script already returns it), or re-fetch the batch (or skip `expectedVersion`, as every other brewpad write does) before calling `update_batch` from the refresh handler.

### WR-03: brewpad double-escapes values assigned via `textContent` — names/emails with `&`, `<`, `>`, `"` display corrupted

**File:** `js/brewpad.js:2619`, `js/brewpad.js:2623`, `js/brewpad.js:2627`
**Issue:** `nameNode.textContent = escapeHTML(getCustomerDisplayName(...))` (and email/phone equivalents). `textContent` does not parse entities, so a customer named "Smith & Sons" renders as `Smith &amp; Sons` after a refresh; an email like `"ops"@x.co` renders with `&quot;`. The admin handler does this correctly (`js/admin.js:6097-6104` assigns raw values).
**Fix:** Drop `escapeHTML` on all three `textContent` assignments:
```js
nameNode.textContent = getCustomerDisplayName(_currentBatchDetail || b) || '—';
```

### WR-04: admin `buildRefreshUpdates` writes untrimmed/uncoerced values to the Sheet; duplicated helpers have divergent semantics

**File:** `js/admin.js:9583-9594` (vs `js/brewpad.js:54-66`)
**Issue:** The admin copy stores the raw value (`updates[k] = v;`) after only *checking* `String(v).trim() !== ''`, so `'  Alice  '` or `' a@b.co '` from Zoho is persisted with padding (and a non-string value would be persisted as-is). The brewpad copy trims (`result[k] = raw.trim();`) and requires strings. The same three same-named helpers now exist in two files with different behavior — `isValidZohoNumber` also diverges (admin coerces via `String(num)`, brewpad requires `typeof num === 'string'`). Because `compareRefreshFields` compares trimmed values, a padded-but-equal field is treated as "no change" in admin, yet when any *other* field differs, the padded values get written. Divergent duplicates are how the next bug ships in only one surface.
**Fix:** In admin, `updates[k] = String(v).trim();`. Longer term, move the helper trio to `js/lib/` (project convention per CLAUDE.md) and require it from both files and both test suites.

### WR-05: Non-JSON error responses lose the HTTP status — proxy 502s show the wrong message

**File:** `js/admin.js:6070-6072`, `js/brewpad.js:2580-2582`
**Issue:** Every error branch does `return r.json().then(function (d) { throw { status: …, error: d.error }; })`. When the body is not JSON — Railway/Cloudflare 502/503 pages are HTML, which is precisely when the 502 branch matters — `r.json()` rejects with a `SyntaxError`, the typed `{status: 502}` throw never happens, and the catch falls through to the generic "Refresh failed — try again" instead of "Zoho unreachable — try again later".
**Fix:**
```js
if (!r.ok) {
  return r.json().catch(function () { return {}; }).then(function (d) {
    throw { status: r.status, error: d.error || 'Unknown error' };
  });
}
```
(one branch with `r.status` covers 404/502/other).

## Info

### IN-01: brewpad escapes HTML inside toast messages that are rendered via `textContent`

**File:** `js/brewpad.js:2650`, `js/brewpad.js:2652`, `js/brewpad.js:2654`, `js/brewpad.js:2674`
**Issue:** `showToast` assigns via `msgSpan.textContent` (`js/brewpad.js:306`), so `escapeHTML(soNumber)`/`escapeHTML(docStatus)` would display literal entities if the input ever contained specials. Harmless today (soNumber is regex-constrained, docStatus is `void`/`deleted`) but it is the same anti-pattern as WR-03; the admin handler documents the correct convention at `js/admin.js:6109`.
**Fix:** Remove `escapeHTML` from toast message construction in brewpad.

### IN-02: admin compares `document_status` case-sensitively; brewpad normalizes

**File:** `js/admin.js:6110` (vs `js/brewpad.js:2648`)
**Issue:** `data.document_status === 'void' || data.document_status === 'deleted'` — brewpad lowercases first. If Zoho ever returns `Void`/`Deleted`, admin silently skips the void/deleted warning toast while brewpad shows it.
**Fix:** `var docStatus = String(data.document_status || '').toLowerCase();` in admin, matching brewpad.

### IN-03: Tests cover only the pure helpers — zero coverage of the handlers where all the real defects live

**File:** `tests/frontend/admin-zoho-refresh.test.js:105-284`, `tests/frontend/brewpad-zoho-refresh.test.js:35-209`
**Issue:** Both suites exercise only `isValidZohoNumber`/`buildRefreshUpdates`/`compareRefreshFields`. No test drives the click handler, the fetch status mapping, the no-change short-circuit, or the version-conflict path — CR-01 (a contract test against the middleware regex) and WR-01 (a conflict-message test) would both have been caught. The two suites are also near-duplicate copies, and `tests/frontend/brewpad-zoho-refresh.test.js:45-50` actively asserts the broken case-insensitive contract from CR-01.
**Fix:** Add handler-level tests (mock `fetch` + `adminApiPost`) for: 400/404/502/non-JSON responses, the `version_conflict` rejection message, and the no-change path. Align the `inv-5`/`so-999` expectations with the resolution of CR-01.

### IN-04: Post-success exceptions are reported as "Refresh failed" even though the update was persisted

**File:** `js/brewpad.js:2659-2668`, `js/admin.js:6122-6136`
**Issue:** The catch attached to the `adminApiPost` chain also catches anything thrown *after* a successful save (DOM patching, list-cache loop, toast construction). A rendering error after persistence shows "Refresh failed — try again", prompting a retry of a write that already succeeded (harmless only because of the D-12 no-change short-circuit — which itself depends on the patched in-memory state).
**Fix:** Wrap the post-save DOM/cache patching in its own `try { … } catch (e) { /* log */ }`, or show the success toast before the cosmetic patching.

---

_Reviewed: 2026-06-12T20:02:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
