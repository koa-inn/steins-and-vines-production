---
phase: 92-kiosk-past-sales-lookup-and-ledger
fixed_at: 2026-10-17T00:00:00Z
review_path: .planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 92: Code Review Fix Report

**Fixed at:** 2026-10-17
**Source review:** .planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-01, WR-01..WR-07). The Info items (IN-01..IN-07) were out of scope and are left as logged.
- Fixed: 8
- Skipped: 0

Each fix has a regression test that was written first and seen to fail, and each is its own commit. Gates run before every commit:
- frontend Jest
- middleware Jest
- `npm run lint` in both packages

Only the known `vancouver-timezone.test.js` failures (2 tests, local Node 20.20.2) remain, plus some timeouts caused by machine load. Each timed-out file passed when rerun on its own.

## Fixed Issues

### CR-01: Past Sales reachable from Customer View with no PIN

**Files modified:**
- `js/kiosk.js`, `js/kiosk.min.js`
- `kiosk.html` (cache-bust restamp)
- `tests/frontend/kiosk-past-sales-cv-exit.test.js` (new)

**Commits:** eb806418 (fix), 19e83ec9 (test hardening: poll PIN-pad state instead of fixed sleeps)

**Applied fix:** Owner decision 2026-10-16.
- `kioskExitCustomerBrowse()`, which both "<- POS" and "Start Purchase ->" call, now does three things: sets a one-shot `_afterUnlock` continuation, stops the inactivity timer, and calls `showLockScreen({})`. The lock screen still clears Past Sales.
- `pinSubmit()` on success: if a continuation is set, it hides the lock, restarts the inactivity timer, and runs the continuation (`kioskShowView('browse')`, restore the Customer View button, `kioskRenderCart()`). It does not call `showKioskApp()`, so products, terminal and discounts are not re-fetched and the shared `_kioskCart` is untouched.
- A normal inactivity lock still unlocks through `showKioskApp()`, unchanged.
- A wrong PIN keeps the kiosk locked.
- This also closes the matching Sales Orders exposure.

**Status:** fixed: requires human verification. Confirm on the iPad that the PIN pad appears on both exits and that the cart carries into the POS.

### WR-01: Out-of-order ledger and contact-search responses

**Files modified:** `js/kiosk-core.js`, `js/kiosk-core.min.js`, `kiosk.html`, `tests/frontend/kiosk-past-sales.test.js`
**Commit:** 5b1b53ed
**Applied fix:**
- Added `_kioskPsLedgerSeq` and `_kioskPsSearchSeq`. The success and error handlers for both drop any response that isn't from the latest request.
- Picking a contact bumps the search sequence, so a late search response can't reopen the picker.

### WR-02: Double-tapped Load older; contact A's error leaking into contact B

**Files modified:** `js/kiosk-core.js`, `js/kiosk-core.min.js`, `kiosk.html`, `tests/frontend/kiosk-past-sales-customer.test.js`
**Commit:** 0209d8d1
**Applied fix:**
- Added `_kioskPsCustomerSeq` and `_kioskPsCustomerLoading`. While a request runs, `#kiosk-ps-load-older` is disabled and `kioskPsLoadOlder()` returns early.
- Both handlers check generation + sequence + contact.
- The Retry closure captures the contact and does nothing after a contact switch.

### WR-03: Drafts counted in ledger totals

**Files modified:**
- `zoho-middleware/lib/kiosk-history.js`
- `zoho-middleware/routes/kiosk-history.js`
- Phase-92 tests: `kiosk-history-lib`, `kiosk-history-ledger`, `kiosk-history-customer`, and frontend `kiosk-past-sales` / `kiosk-past-sales-customer`

**Commit:** 8e985030
**Applied fix:** Owner decision 2026-10-16.
- `ledgerTotals` now skips `Draft` as well as `Void`, so drafts are still listed but get no count and no gross.
- Customer history no longer rewrites Draft to Unpaid.
- The frontend already mapped Draft to the existing `.kiosk-ps-badge--draft` style, so no CSS change was needed; tests now pin it in both tabs.
- The Phase-92 tests that encoded the old rule were updated: count 8 -> 7, and Unpaid -> Draft.

### WR-04: Customer history mislabeling without saying so

**Files modified:**
- `zoho-middleware/routes/kiosk-history.js`, `zoho-middleware/__tests__/kiosk-history-customer.test.js`
- `js/kiosk-core.js`, `js/kiosk-core.min.js`, `kiosk.html`, `tests/frontend/kiosk-past-sales-customer.test.js`

**Commit:** 6ec7cb0e
**Applied fix:**
- New response field `source_incomplete`: true when the payments page cap was hit. The UI shows "Some In-store / Online tags may be wrong."
- The payments query `date_end` is now `winEnd + 7 days`.
- New response field `next_before`:
  - When invoices are truncated, it is the oldest returned Zoho day + 1, so the next window still includes that day. If that day is the window end, it is the day itself, which still makes progress.
  - Otherwise it is `window_start`.
  - `has_older` is now `next_before > floor`.
- The client pages from `next_before` (falling back to `window_start`) and de-dupes appended rows by `invoice_id`.
- The truncation message now reads "More sales in this period. Tap Load older to see them."

**Status:** fixed: requires human verification (paging logic).

### WR-05: Unthrottled bust and no build dedupe

**Files modified:**
- `zoho-middleware/routes/kiosk-history.js`
- `zoho-middleware/__tests__/kiosk-history-cache.test.js` (new)
- Phase-92 route tests (they now reset state in `beforeEach`)

**Commit:** ca93153d
**Applied fix:**
- A per-key in-flight build map, so concurrent requests, including bust requests, share one Zoho chain. A rejected build is released and not cached.
- `bust` is ignored when that key was built less than 10 s ago (`BUST_MIN_INTERVAL_MS`, a server constant). The request reads the cache instead, and still builds on a cache miss.
- The last-built map is pruned past 500 keys.
- `_internals.resetCacheState()` is exposed for tests.

### WR-06: Spike sanitizer missing address, attention, fax, last-four and cf_*

**Files modified:** `zoho-middleware/scripts/spike-past-sales-shapes.js`, `zoho-middleware/__tests__/spike-past-sales-sanitize.test.js`
**Commit:** e1293686
**Applied fix:**
- When populated, `billing_address`, `shipping_address` and `custom_field_hash` (and any object under a `cf_*` key) become `{ REDACTED: true }`.
- These scalar keys become `REDACTED_<KEY>`: `cf_*`, `last_four_digits`, `attention`, `fax`, `street`, `street2`, `city`, `state`, `state_code`, `zip`, `country`, `country_code`.
- Blank values stay blank and all keys are kept.
- New test with a populated address and cf_* values.

**Not done:** the committed fixture `__tests__/fixtures/zoho-past-sales-shapes.json` was not regenerated, because that needs a live Zoho run. It contains no PII today, only blank addresses and `cf_*` booleans/batch status.

### WR-07: `before` equal to the floor gives an inverted Zoho range

**Files modified:** `zoho-middleware/routes/kiosk-history.js`, `zoho-middleware/__tests__/kiosk-history-customer.test.js`
**Commit:** e9b4aef3
**Applied fix:** The check is now `before <= floor` and returns 400. As a backstop, a window that is still inverted after clamping also returns 400.

## Skipped Issues

None in scope. IN-01..IN-07 (Info) were deliberately not fixed per the fix brief and are marked NOT FIXED in 92-REVIEW.md.

---

_Fixed: 2026-10-17_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
