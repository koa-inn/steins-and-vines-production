---
phase: 29-refresh-from-zoho-admin-ui
reviewed: 2026-06-12T22:45:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - js/admin.js
  - js/brewpad.js
  - zoho-middleware/routes/pos.js
  - tests/frontend/admin-zoho-refresh.test.js
  - tests/frontend/brewpad-zoho-refresh.test.js
  - zoho-middleware/__tests__/batch-customer.test.js
findings:
  critical: 1
  warning: 2
  info: 5
  total: 8
status: issues_found
---

# Phase 29: Code Review Report (post-gap-fix)

**Reviewed:** 2026-06-12T22:45:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Post-fix review of the Phase 29 gap-closure work (plans 29-04 / 29-05, diff `8c1f5e6..HEAD`). Verification of the five prior findings:

- **CR-01 (case contract) — FIXED.** `pos.js:1379` now normalizes with `.trim().toUpperCase()` before the case-sensitive regexes; the downstream exact-match at `pos.js:1410-1413` is case-insensitive, so lowercase refs resolve end-to-end. Both frontends added a 400 branch to the fetch chain (`admin.js:6072`, `brewpad.js:2606`) with a dedicated toast. Middleware regression tests cover `inv-000123` / `so-42` reaching the Zoho lookup.
- **CR-02 (name not re-rendered) — FIXED on the mainline path, with one residual gap (new CR-01 below).** `splitCustomerName` derives `customer_firstname`/`customer_lastname` whenever `updates.customer_name` is present; both handlers patch the in-memory batch and DOM, and Apps Script `updateBatch` whitelists both fields and writes `''` (clearing stale lastname for single-token names — verified at `apps-script/adminApi.gs:2157-2175`).
- **WR-01 (dead conflict detection) — FIXED.** `isVersionConflict` matches `'modified'`, which matches the actual Apps Script messages (`adminApi.gs:2096`, `:2303`). See WR-01 below for residual fragility of substring matching.
- **WR-03 (double-encoding) — FIXED on detail nodes**; `escapeHTML` removed from all `textContent` assignments in the brewpad patch block. Residual: brewpad toast calls still escape (IN-01).
- **WR-04 (trim parity) — FIXED.** Admin `buildRefreshUpdates` now emits `String(v).trim()`.

Both minified bundles (`js/admin.min.js`, `js/brewpad.min.js`) were rebuilt and contain the fixes (verified by grep for `customer_firstname` and `indexOf("modified")`). All 76 frontend tests and 14 middleware tests pass.

One Critical issue remains: the D-12 "Already up to date" short-circuit compares only `customer_name`/`customer_email`/`customer_phone`, so batches whose stored `customer_name` already matches Zoho but whose `customer_firstname`/`customer_lastname` are stale are never repaired — the display keeps showing the wrong customer while the toast claims success. These are precisely the rows the original CR-02 bug created.

## Critical Issues

### CR-01: D-12 "Already up to date" short-circuit bypasses the CR-02 firstname/lastname repair — stale display names are unrepairable and the toast is misleading

**File:** `js/admin.js:6077-6083` (compare) vs `js/admin.js:6087-6093` (split); `js/brewpad.js:2621-2627` vs `js/brewpad.js:2613-2619`
**Issue:** `compareRefreshFields` (`admin.js:9652-9663`, `brewpad.js:96-107`) compares only `customer_name`, `customer_email`, `customer_phone` against the batch. It never checks `customer_firstname`/`customer_lastname`, yet `getCustomerDisplayName` (`admin.js:36-41`, `brewpad.js:34-39`) **prefers** firstname/lastname over `customer_name`. When a batch's `customer_name` already matches Zoho but its firstname/lastname are stale, the handler short-circuits with "Already up to date" and the displayed name stays wrong — permanently, since repeated refreshes always skip.

This state is reachable in two concrete ways:

1. **Rows damaged by the original CR-02 bug.** Any batch refreshed between the initial Phase 29 ship and plan 29-05 had `customer_name`/`email`/`phone` updated but firstname/lastname left stale. For those rows, `compareRefreshFields` now returns `true` (all three compared fields match Zoho), so the very fix meant to close CR-02 never executes against the data CR-02 corrupted.
2. **Brewpad SO-relink.** The relink flow (`brewpad.js:807-820`) writes `zoho_so_number`, `customer_id`, `customer_name`, `product_name` — but **not** firstname/lastname. After relinking a batch to a different customer's SO, the detail view shows the *old* customer (firstname/lastname win). If the new customer's email/phone in Zoho are blank (common for walk-ins; `buildRefreshUpdates` then omits them) or happen to match, clicking "Refresh from Zoho" reports "Already up to date" while displaying the wrong customer.

**Fix:** Make the skip condition aware of display coherence. E.g. in both handlers, replace the bare `compareRefreshFields(data, b)` check with:

```js
function isDisplayCoherent(fetched, batch) {
  if (!fetched.customer_name || !String(fetched.customer_name).trim()) return true;
  var parts = splitCustomerName(fetched.customer_name);
  return String(batch.customer_firstname || '').trim().toLowerCase() === parts.customer_firstname.toLowerCase()
      && String(batch.customer_lastname  || '').trim().toLowerCase() === parts.customer_lastname.toLowerCase();
}

if (compareRefreshFields(data, b) && isDisplayCoherent(data, b)) {
  showToast('Already up to date', 'success');
  ...
}
```

(Alternatively, also fix the brewpad relink flow at `brewpad.js:807-813` to write split names, which removes path 2 but not path 1.) Add a regression test: batch with matching `customer_name` but mismatched firstname/lastname must NOT short-circuit.

## Warnings

### WR-01: Version-conflict detection matches free-text message substrings instead of the structured error code the API already returns

**File:** `js/admin.js:9600-9604`, `js/brewpad.js:58-62`; root cause at `js/admin.js:667-671` and `js/brewpad.js:704-708`
**Issue:** Apps Script returns a machine-readable code — `{ ok: false, error: 'version_conflict', message: 'Batch was modified…' }` (`adminApi.gs:2096`) — but `adminApiPost` discards it: `throw new Error(data.message || data.error || 'API error')`. `isVersionConflict` then re-derives intent by substring-matching `'version'`/`'modified'` on the human-readable message. This is the exact fragility that produced the original dead-code WR-01 (the old check matched `'version'`, the message said `'modified'`). It also false-positives: any future update_batch failure whose message contains "modified" (e.g. "Batch cannot be modified after completion") would show the misleading "Batch was updated elsewhere — please reload" toast. Other Apps Script paths reuse the word "modified" for reservations/holds (`adminApi.gs:901`, `:984`), so wording collisions are realistic.
**Fix:** Preserve the code in `adminApiPost`:

```js
if (!data.ok) {
  if (isUnauthorizedError(data)) handleUnauthorized();
  var apiErr = new Error(data.message || data.error || 'API error');
  apiErr.code = data.error;
  throw apiErr;
}
```

Then check `err.code === 'version_conflict'` first, keeping the message heuristic only as fallback.

### WR-02: `req.query.number` array input crashes the modified normalization line with a 500

**File:** `zoho-middleware/routes/pos.js:1379`
**Issue:** `(req.query.number || '').trim().toUpperCase()` throws `TypeError: .trim is not a function` when the parameter is supplied more than once (`?number=INV-1&number=SO-2` — Express's qs parser yields an array). The synchronous throw becomes an Express 500 with a stack trace instead of the intended 400 `invalid_number`. The line was rewritten in this phase (CR-01 fix), so the malformed-input contract of the exact code under change is incomplete. (Same latent pattern exists at `pos.js:1344` for `search`, pre-existing.)
**Fix:**

```js
var number = String(req.query.number || '').trim().toUpperCase();
```

`String(['a','b'])` → `'a,b'`, which fails the regex and returns the proper 400. Add a regression test with an array-valued `number`.

## Info

### IN-01: WR-03 fix incomplete — brewpad toasts still escapeHTML into a textContent sink

**File:** `js/brewpad.js:2685`, `2687`, `2689`, `2711`
**Issue:** `showToast` renders via `msgSpan.textContent` (`brewpad.js:330`), yet the refresh handler still wraps `soNumber`/`docStatus` in `escapeHTML(...)` for toast messages — the same double-encode pattern WR-03 removed from the detail nodes. Harmless today (`soNumber` is regex-gated by `isValidZohoNumber`; `docStatus` is gated to `'void'`/`'deleted'`), but inconsistent with `admin.js:6121-6127`, which deliberately passes raw values with a comment explaining why.
**Fix:** Drop `escapeHTML` from the four toast call sites for consistency.

### IN-02: Duplicated refresh helpers have already drifted between admin.js and brewpad.js

**File:** `js/admin.js:9629-9663` vs `js/brewpad.js:78-107`
**Issue:** The five Phase 29 helpers are copy-pasted into both files and the copies no longer behave identically: admin `buildRefreshUpdates` includes any non-null value via `String(v).trim()` (a numeric phone would pass), brewpad requires `typeof raw === 'string'` (a numeric phone is silently dropped); `compareRefreshFields` null-handling differs (`batch[k] || ''` vs explicit null/undefined check); and operation order differs (admin compares before building updates, brewpad builds + splits before comparing — wasted work on the skip path). The WR-04 fix itself was applied differently to each copy, demonstrating the drift risk.
**Fix:** Move the shared pure helpers to `js/lib/` (the project already has this pattern: `utils.js`, `auth.js`, `constants.js`), or at minimum align the two implementations verbatim.

### IN-03: splitCustomerName pollutes firstname/lastname columns for non-"First Last" names

**File:** `js/admin.js:9613-9619`, `js/brewpad.js:67-73`
**Issue:** Naive whitespace split: a Zoho company contact like `"Steins & Vines Ltd."` becomes firstname=`"Steins"`, lastname=`"& Vines Ltd."`; a `"Last, First"` formatted contact becomes firstname=`"Last,"`. Display is unaffected (the two are re-joined), but the Sheet columns carry semantically wrong values that other consumers (kiosk paths at `admin.js:10396`, batch creation) treat as real first names.
**Fix:** Acceptable for v1; consider stripping trailing commas and documenting that company names produce arbitrary splits.

### IN-04: All new tests target pure helpers — no test exercises the handler wiring where the remaining defect lives

**File:** `tests/frontend/admin-zoho-refresh.test.js`, `tests/frontend/brewpad-zoho-refresh.test.js`
**Issue:** The suites cover `splitCustomerName`/`isVersionConflict`/`buildRefreshUpdates`/`compareRefreshFields` in isolation, but nothing tests the click-handler integration: that the 400 branch produces the right toast, that the split is merged into the `update_batch` payload, or the D-12-skip vs CR-02-split interaction (CR-01 above) — which is exactly the seam where the residual defect sits. The middleware case-normalization tests assert "not 400" and call counts but never assert the uppercased number is what reaches `zohoGet`'s filter params (`expect(firstCall[1]).toEqual({ invoice_number: 'INV-000123' })` for lowercase input would lock the contract).
**Fix:** Add at least one handler-level test per surface (jsdom + mocked fetch/adminApiPost), and tighten the middleware lowercase tests to assert the normalized filter param.

### IN-05: Dead/inconsistent version-conflict path in brewpad's outer catch

**File:** `js/brewpad.js:2714-2720`
**Issue:** The outer `.catch` checks `isVersionConflict(err.message)`, but version conflicts can only originate from `adminApiPost`, whose rejection is fully consumed by the inner `.catch` at `brewpad.js:2694-2703` (which returns normally, so nothing propagates outward). The outer path only ever sees fetch-stage errors (`{status, error}` objects with no `.message`, or network `TypeError`s), so the branch is unreachable. It also omits the `err.error` fallback the inner catch has (`brewpad.js:2697`), a second copy-drift.
**Fix:** Remove the unreachable conflict branch from the outer catch, or unify error normalization between the two catches.

---

_Reviewed: 2026-06-12T22:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
