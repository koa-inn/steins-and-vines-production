---
phase: 92-kiosk-past-sales-lookup-and-ledger
reviewed: 2026-10-16T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - zoho-middleware/routes/kiosk-history.js
  - zoho-middleware/lib/kiosk-history.js
  - zoho-middleware/lib/authTiers.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/server.js
  - zoho-middleware/scripts/spike-past-sales-shapes.js
  - js/kiosk-core.js
  - js/kiosk.js
  - kiosk.html
  - css/kiosk.css
  - zoho-middleware/__tests__/kiosk-history-customer.test.js
  - zoho-middleware/__tests__/kiosk-history-invoice.test.js
  - zoho-middleware/__tests__/kiosk-history-ledger.test.js
  - zoho-middleware/__tests__/kiosk-history-lib.test.js
  - zoho-middleware/__tests__/spike-past-sales-sanitize.test.js
  - tests/frontend/kiosk-past-sales.test.js
  - tests/frontend/kiosk-past-sales-customer.test.js
findings:
  critical: 1
  warning: 7
  info: 7
  total: 15
status: issues_found
fix_status: critical_warning_fixed
fix_report: 92-REVIEW-FIX.md
---

# Phase 92: Code Review Report

**Reviewed:** 2026-10-16
**Depth:** standard (pre-existing large files reviewed via `git diff 9c20f992 HEAD` only)
**Files Reviewed:** 17
**Status:** issues_found

## Summary

These things hold up: the server-side allowlist (D-12), the auth gating (D-10), input validation, and output escaping.
- Both slim builders (`slimInvoiceRow`, `slimInvoiceDetail`) build their output one field at a time.
- Every query param is type-checked and regex-checked before use.
- `gate()` calls `requireTiers(['legacy','device','session'])` inline, so the GET exemption in the global guard does not bypass it.
- `PII_GET_ROUTES` is unchanged.
- Every dynamic value in the frontend HTML goes through `escapeHTML`, which escapes quotes, so the `data-*` attributes are safe too.
- Ledger totals are summed in integer cents.
- Vancouver day bucketing uses Intl. The D..D+1 invoice window correctly allows for the money paths writing a UTC `date` (`new Date().toISOString().slice(0,10)` in `routes/pos.js:1416`, `pos-recipe.js:1361`).

Main concerns:
1. **D-11 isolation is cosmetic.** Customer View has a one-tap, PIN-less way back to the staff POS, and Past Sales opens from there.
2. **The client stale-response guard only covers view clears.** It does not cover requests that finish out of order inside the view (date changes, contact switches, a double-tapped "Load older").
3. **Draft invoices are counted in ledger totals.**
4. **Silent misclassification paths in customer history.** Payment truncation and the payment date window are not surfaced.
5. **Latent PII gaps in the spike sanitizer.** The committed fixture is clean only because the sampled fields were blank.

## Critical Issues

### CR-01: Past Sales is reachable from Customer View in two taps with no PIN (D-11 not actually enforced)

**Fix status:** FIXED (commits eb806418, 19e83ec9). Owner decision 2026-10-16: leaving Customer View requires the staff PIN. Both exits show the lock screen. A verified PIN returns to `browse` through a one-shot continuation that does not re-run `showKioskApp`, so the cart is preserved. This also closes the Sales Orders exposure.

**File:** `js/kiosk-core.js:959-960`, `js/kiosk-core.js:4507-4508`; related pre-existing wiring at `js/kiosk.js:758-762`, `js/kiosk.js:1502-1505`, `js/kiosk.js:1529-1532`
**Issue:** D-11 says Past Sales must not be reachable from the customer-facing Customer View. Right now the only protections are hiding `#kiosk-past-sales-btn` while `_kioskCurrentView === 'browse-customer'` and an early return in `kioskShowPastSales()`. But Customer View has two un-gated exits straight to the staff POS (`browse`):
- the `#kiosk-cb-back-btn` ("← POS") button
- the `#kiosk-cb-start-purchase-btn` ("Start Purchase →") button

Both call `kioskExitCustomerBrowse()`, which calls `kioskShowView('browse')`. That shows the header again, including the Past Sales button. So a customer holding the iPad can tap "← POS", then "Past Sales", then search any name with `/api/contacts/search` and see that person's 12 months of invoices (up to 120 with "Load older"), with line items. The D-11 clear stops someone scrolling back through earlier data. It does nothing to stop a fresh lookup.

Sales Orders already had this exposure. Past Sales widens it a lot: it shows full purchase history per named customer.

If the owner treats "Start Purchase" and "← POS" as a deliberate handback to staff, this could drop to WARNING. As built, though, D-11's "not reachable" is not met.
**Fix:** Gate entry to Past Sales on staff presence rather than on the current view. Track Customer-View provenance and require the staff PIN when you leave it, or at least before opening Past Sales:
```js
// kiosk-core.js
var _kioskPsUnlockedAt = 0;
function kioskShowPastSales() {
  if (_kioskCurrentView === 'browse-customer') return;
  if (_kioskCameFromCustomerView && Date.now() - _kioskPsUnlockedAt > 60000) {
    return kioskRequirePin(function () { _kioskPsUnlockedAt = Date.now(); kioskShowPastSales(); });
  }
  kioskShowView('past-sales');
  kioskPsSetTab(_kioskPsTab);
}
```
Or require the PIN in `kioskExitCustomerBrowse()` itself, which also closes the existing Sales Orders exposure. Record the owner's decision either way.

## Warnings

### WR-01: Ledger responses that finish out of order render the wrong day (no per-request guard)

**Fix status:** FIXED (commit 5b1b53ed). Per-tab request sequence numbers for the ledger and contact search. Picking a contact also supersedes an in-flight search.

**File:** `js/kiosk-core.js:4584-4612`, `js/kiosk-core.js:4550-4569`
**Issue:** `_kioskPsGen` only changes in `kioskPastSalesClear()`, so it protects against view switches but not against two ledger requests racing each other. Example: staff pick a date in `#kiosk-ps-date`, then quickly tap ‹ (which uses the *previous* `_kioskPsLedger.prev_date`), or change the date input twice. Whichever response arrives last wins. Because `kioskPsRenderLedger()` writes `d.date` back into the input, the screen stays self-consistent, but it is not the day staff last asked for. The same problem hits the contact search (`js/kiosk-core.js:4817`): an older `/api/contacts/search` result can overwrite the results for a newer query.
**Fix:** Add a per-tab request sequence number and drop superseded responses:
```js
var _kioskPsLedgerSeq = 0;
function kioskPsLoadLedger(date, bust) {
  var seq = ++_kioskPsLedgerSeq; var gen = _kioskPsGen;
  _kioskPsFetch(path, gen).then(function (data) {
    if (data === null || seq !== _kioskPsLedgerSeq) return;
    ...
  }).catch(function (err) {
    if (gen !== _kioskPsGen || seq !== _kioskPsLedgerSeq) return;
    ...
  });
}
```
Do the same for `kioskPsSearch`.

### WR-02: Customer tab: a double-tapped "Load older" duplicates rows; an old contact's error and Retry leak into the new contact

**Fix status:** FIXED (commit 0209d8d1). Added a customer-request sequence and an in-flight flag: Load older is disabled and ignored while a load runs. Handlers check the contact, and the Retry closure captures the contact.

**File:** `js/kiosk-core.js:4857-4904`, `js/kiosk-core.js:4932-4934`
**Issue:**
1. `kioskPsLoadOlder()` reads `_kioskPsWindowStart`, but that value only advances when the response lands. Two taps before then send two identical `before=` requests, and both append. The same invoices are listed twice and `_kioskPsHistoryCount` is inflated.
2. The success path checks `_kioskPsContact !== contact`, but the `.catch` only checks `gen`. If contact A's request fails after staff have picked contact B, A's error message and Retry button overwrite B's message area. Tapping Retry then calls `kioskPsLoadCustomer(before, bust)` with A's `before` window against B's contact, because `kioskPsLoadCustomer` reads `_kioskPsContact`.
**Fix:** In the catch, add `if (_kioskPsContact !== contact) return;`. Add an in-flight flag (or the sequence number from WR-01): hide or disable `#kiosk-ps-load-older` while a request runs, and ignore `kioskPsLoadOlder()` until it settles. Make the Retry closure capture `contact`, and have it bail out if `_kioskPsContact !== contact`.

### WR-03: Draft invoices are counted in the ledger's sale count and gross total

**Fix status:** FIXED (commit 8e985030). Owner decision 2026-10-16: drafts are shown with a Draft badge but excluded from count and gross_total, like voids. Customer history now labels them Draft, not Unpaid.

**File:** `zoho-middleware/lib/kiosk-history.js:225-234`, `zoho-middleware/routes/kiosk-history.js:120-130`
**Issue:** `ledgerTotals` excludes only `Void`. Blank-reference invoices count as in-store by owner decision, so a Draft invoice is counted as a sale. Drafts can come from a back-office draft or a half-finished kiosk/SO-pay flow (see the kiosk slow-approval orphan incident). The footer total ("14 sales · $1,240.55") then overstates real sales. The customer route treats drafts differently and relabels them `Unpaid` (`routes/kiosk-history.js:206`), so the two views disagree.
**Fix:** Exclude `Draft` from count and total, as you already do for `Void`, and badge it in the row. Or drop drafts from the ledger entirely:
```js
if (r.status === 'Void' || r.status === 'Draft') return;
```
Confirm the rule with the owner, since D-04 only covers voids.

### WR-04: Customer history can mislabel recipe sales as "Online" without saying so (payment truncation and window not surfaced)

**Fix status:** FIXED (commit 6ec7cb0e). Added a `source_incomplete` flag for payment truncation, which the UI shows. The payments window now runs 7 days past winEnd. Added `next_before`, which resumes from the oldest returned day when invoices are truncated; the client de-dupes rows by invoice_id.

**File:** `zoho-middleware/routes/kiosk-history.js:191-218`
**Issue:**
- `truncated` comes only from the invoice fetch. When `/customerpayments` hits `CUSTOMER_MAX_PAYMENT_PAGES` (2 × 200), its `truncated` flag is thrown away. Any all-digit-reference recipe invoice whose payment fell off the page then has no "Kiosk …" note and is classified `online`. No hint reaches the client.
- Payments are filtered by payment date over the same `[winStart, winEnd]` window as the invoices. A recipe invoice near the window's start whose payment is dated outside the window gets misclassified the same way.
- When invoices *are* truncated, `has_older` still comes only from `winStart > floor`. "Load older" then jumps to the previous 12-month window, and every invoice between the truncation point and `winStart` is skipped for good. The client shows "Showing the most recent sales only" and offers "Load older" anyway.
**Fix:** Return `truncated: inv.truncated || pay.truncated` (or a separate `source_incomplete` flag). Widen the payments `date_end` by a few days past `winEnd`. When invoices are truncated, set the next `before` to the oldest returned invoice's date instead of `winStart` (for example, return `next_before`).

### WR-05: `bust=1` is unthrottled and builds are not deduplicated, so the shared Zoho quota can be burned

**Fix status:** FIXED (commit ca93153d). Builds are deduped per key while in flight, and bust is ignored within 10 s of the last build for that key. Both are server constants.

**File:** `zoho-middleware/routes/kiosk-history.js:60-70`, `:165`, `:253`, `:274`
**Issue:** Any caller with a device token can send `bust=1` on every request. A ledger build is up to 6 sequential Zoho GETs and a customer build up to 5, each wrapped in `withRetry`. Concurrent requests for the same key each run a full build because there is no in-flight dedupe. Repeated ↻ taps, or a leaked device token looping on `bust=1`, use up the same Zoho quota (~1 req/s plus a daily cap) that the money paths depend on. Only the generic `apiLimiter` protects it.
**Fix:** Keep a per-key in-flight promise map so concurrent builds share one chain. Rate-limit busts per key, for example by ignoring `bust` when the cached entry is under 10 s old:
```js
var inflight = {};
function cachedOrBuild(key, ttl, bust, build) {
  if (inflight[key]) return inflight[key];
  ...
  var p = read.then(...).finally(function () { delete inflight[key]; });
  inflight[key] = p; return p;
}
```

### WR-06: Spike sanitizer misses address, attention, fax, last-four and `cf_*` values

**Fix status:** FIXED (commit e1293686). Address, hash and cf_* subtrees and scalars are now redacted, with a populated-value test. The committed fixture was not regenerated; it needs a live run.

**File:** `zoho-middleware/scripts/spike-past-sales-shapes.js:84`, `:112-153`
**Issue:** `NAME_LIKE` catches `address`, `phone` and `email`. It does not catch the other `billing_address` / `shipping_address` sub-keys: `street2`, `city`, `state`, `zip`, `country`, `fax`, `attention`. `attention` is usually a person's name. `last_four_digits` (card last four) survives because it is under 10 digits. Top-level `cf_*` custom-field values and the `custom_field_hash` contents also pass through unredacted (the fixture shows `cf_batch_status: "Pending — SV-B-000228"`). The fixture committed in `__tests__/fixtures/zoho-past-sales-shapes.json` is clean only because the sampled addresses were blank. The next run against a customer with an address on file would print street, city, postcode and the attention name into a file that gets committed. The staging org is shared with prod.
**Fix:** Redact whole subtrees and use an allowlist for the rest:
```js
if (key === 'billing_address' || key === 'shipping_address' || key === 'custom_field_hash') return v ? { REDACTED: true } : v;
if (/^cf_/.test(key) || key === 'last_four_digits' || key === 'attention' || key === 'fax') return v === '' ? '' : 'REDACTED_' + key.toUpperCase();
```
Add a sanitize test case with populated address and `cf_*` values.

### WR-07: `before` equal to the history floor produces an inverted Zoho date range

**Fix status:** FIXED (commit e9b4aef3). The check is now `before <= floor`, plus an inverted-window backstop.

**File:** `zoho-middleware/routes/kiosk-history.js:244-251`
**Issue:** The check is `before < floor`, so `before === floor` gets through. Then `winEnd = floor - 1 day`, `winStart` is clamped to `floor`, and Zoho receives `date_start > date_end`. Depending on Zoho, that is a 400 (turned into a misleading 502 "Unable to fetch customer sales") or an empty list cached for 60 s. The shipped client never sends this value because `has_older` is false at the floor, but the server should not depend on that.
**Fix:** `if (before <= floor) return badRequest(res, 'before is outside the history limit');`, and/or reject `winStart > winEnd` after clamping.

## Info

### IN-01: The authTiers header comment does not record the D-10 widening of device-token access

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `zoho-middleware/lib/authTiers.js:10-13`, `:70-72`, `:100`
**Issue:** The module header still says device tokens are "NEVER admin-grade (a stolen iPad must not reach PII…)". A bare device token can now read any customer's invoice history and any invoice's line items by id. D-10 accepts this. The D-54-GC reversal was recorded in the header, though, and this one is not.
**Fix:** Add a short "Phase 92 D-10" paragraph next to the D-54-GC note describing the accepted residual risk.

### IN-02: `validateConfig` accepts join modes that are not implemented

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `zoho-middleware/routes/kiosk-history.js:40-49`, `:99-102`, `:182-184`
**Issue:** `detail-fallback` and `none` pass the boot-time validation but then fail every request with a 502. Boot validation should reject anything that was not built.
**Fix:** Restrict `modes` to `['list-join']` until the other modes exist.

### IN-03: Dead response fields and an unused constant

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `zoho-middleware/routes/kiosk-history.js:144-145`, `zoho-middleware/lib/constants.js` (`KIOSK_HISTORY_TENDER_PREFIX`), `zoho-middleware/lib/kiosk-history.js:19` (`ONLINE_NOTE_PREFIXES`)
**Issue:** `classification_incomplete` is always `false` and `unclassified_count` always `0`, yet the client renders branches for both (`js/kiosk-core.js` `kioskPsRenderLedger`). The tender cache prefix and the online-note prefixes are never read.
**Fix:** Remove them, or mark them as reserved for detail-fallback.

### IN-04: Bust parsing is duplicated

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `zoho-middleware/routes/kiosk-history.js:165` vs `:177-179`
**Issue:** The ledger route inlines the same expression that `isBust()` implements.
**Fix:** Use `isBust(q)` in the ledger route.

### IN-05: Row click wiring is duplicated

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `js/kiosk-core.js:4696-4711` vs `js/kiosk-core.js:4906-4930`
**Issue:** The ancestor-walk and toggle handler is copy-pasted. The ledger version also has no `data-wired` guard, so it is only safe because the list is always fully replaced.
**Fix:** Make one `kioskPsWireRow(el)` helper that sets `data-wired`, and call it from both places.

### IN-06: The ledger 400 message is wrong for dates before 2020

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `js/kiosk-core.js:4605-4606`
**Issue:** Every 400 shows "Pick a date up to today.", including a date before `LEDGER_MIN_DATE` (2020-01-01) picked from the date input, which has no `min`. After a 400, `_kioskPsLedger` still holds the previous day, so ‹ › move relative to that day while the input shows the rejected date.
**Fix:** Set `min="2020-01-01"` on `#kiosk-ps-date`. Show the server's `message` field, or a range-aware message. Restore the input to `_kioskPsLedger.date` after an error.

### IN-07: The cached past-day payload carries a stale `today`

**Fix status:** NOT FIXED (out of scope: Info items left as logged per the fix brief).

**File:** `zoho-middleware/routes/kiosk-history.js:134-138`, `:166`
**Issue:** Past days are cached for 3600 s with `today` frozen at build time. If a past day is loaded just before Vancouver midnight, the date input's `max` (set from `d.today`) can stay on the old day for up to an hour, which blocks picking the new today from the input. The arrows still work. Late tender writes for a day that was cached right after midnight (slow-approval flows) also lag up to an hour unless someone taps ↻.
**Fix:** Overwrite `payload.today` and `payload.next_date` per request after the cache read, and/or use a shorter TTL for yesterday.

---

_Reviewed: 2026-10-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
