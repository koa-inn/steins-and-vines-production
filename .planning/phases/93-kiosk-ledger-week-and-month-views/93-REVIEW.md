---
phase: 93-kiosk-ledger-week-and-month-views
reviewed: 2026-10-17T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - css/kiosk.css
  - js/kiosk-core.js
  - js/kiosk.js
  - kiosk.html
  - tests/frontend/kiosk-past-sales-range-drill.test.js
  - tests/frontend/kiosk-past-sales-range.test.js
  - zoho-middleware/__tests__/kiosk-history-range-lib.test.js
  - zoho-middleware/__tests__/kiosk-history-range.test.js
  - zoho-middleware/lib/authTiers.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/lib/kiosk-history.js
  - zoho-middleware/routes/kiosk-history.js
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 93: Code Review Report

**Reviewed:** 2026-10-17
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This review covers the Phase 93 diff (`9ba208ef..HEAD`) and the Past Sales functions around it.

**Middleware: sound.**
- `buildLedger` and `buildRange` now share the same per-day chain, `hist.ledgerRowsForDay`, so D-12 holds by construction. The equality test runs against a mock that honours `date_start`/`date_end`.
- The refactor of `buildLedger` adds an invoice-`date` and payment-`date` window filter. This filter is a no-op for the day query, so day figures are unchanged.
- `needsPaymentNotes` is derived from `classify` itself. It therefore also covers non-digit "other" references such as `ABC1`, which is more robust than the D-12 wording.
- Page caps are constants that the request cannot override.
- The `type`/`date` validation rejects arrays, future dates and pre-2020 dates.
- The allowlist entry matches exactly and the `requireTiers` self-gate is present.
- The `partial` heuristic (`day <= oldest createdDay`) is correct because Zoho sorts by `created_time` descending.

**Frontend: three state bugs.**
- `_kioskPsRange` from the previous range type survives a Week↔Month switch, so the step buttons act on the wrong period.
- Partial days with 0 loaded sales cannot be tapped, which blocks the D-10 escape hatch.
- The disabled state of the ‹ button carries over from a range into the day ledger.

D-11 clearing, the late-response drop through the shared `_kioskPsLedgerSeq`, ES5 compliance and XSS escaping all check out. The build artifacts contain the new code.

No critical issues.

## Warnings

### WR-01: Stale range payload of the other type drives ‹ › / ↻ / label after a Week↔Month switch

**File:** `js/kiosk-core.js:4668-4692` (`kioskPsSetMode`), `js/kiosk-core.js:4694-4733` (`kioskPsLoadRange`), `js/kiosk-core.js:4964-4970` (`kioskPsShiftDay`), `js/kiosk-core.js:5034-5037` (`kioskPsRefresh`)

**Issue:** When the mode changes from week to month (or month to week), `kioskPsSetMode` sets `_kioskPsMode` but keeps `_kioskPsRange`, which still holds the week payload. Until the month response arrives (D-09 says this "can take a few seconds"), or for good if that request fails:

- **‹ / › use the wrong anchor.** `kioskPsShiftDay` reads `_kioskPsRange.prev_anchor`/`next_anchor` from the week payload and loads the month that contains it.
  - Example: today is Oct 17. The week's `prev_anchor` is Oct 11, so tapping ‹ loads **October** again instead of September.
  - Going the other way (month to week), ‹ jumps to the week containing the last day of the previous month.
  - The in-flight current-month request is then dropped by the sequence bump, so the user lands on the wrong period with no sign that anything went wrong.
- **↻ uses the wrong anchor.** `kioskPsRefresh` busts `_kioskPsRange.range_start` of the week. For a week such as Sep 28 – Oct 4, that loads **September** in Month mode.
- **The display is wrong after a failed load.** The range label, the ‹/› enabled state and the date input still describe the old week while the Month chip is active and the error message is shown.
- **The loading copy names the wrong month.** It takes `_kioskPsRange.period_start` from the old type. For example, it says "Loading September…" while October is loading.

**Fix:** Drop the old payload whenever the requested type differs from it, and disable stepping while nothing valid is loaded:

```js
function kioskPsLoadRange(type, anchor, bust) {
  ...
  if (_kioskPsRange && _kioskPsRange.type !== type) {
    _kioskPsRange = null;
    kioskPsSetHtml('kiosk-ps-range-label', '');
  }
  if (!_kioskPsRange) {
    var pb = kioskPsEl('kiosk-ps-prev'); if (pb) pb.disabled = true;
    var nb = kioskPsEl('kiosk-ps-next'); if (nb) nb.disabled = true;
  }
  ...
}
```

Add a frontend test: render a week, switch to Month with the response held pending, tap ‹, and assert that no request is sent with the week's `prev_anchor`.

### WR-02: Partial (truncated) days that loaded 0 sales cannot be tapped, which blocks the D-10 exact-figures path

**File:** `js/kiosk-core.js:4761-4762` (render), `js/kiosk-core.js:4778-4786` (`kioskPsWireDayRows`)

**Issue:** D-10 says that when a range is truncated, the affected days are flagged and "drilling into a day still gives exact day figures."

The server truncates the oldest `created_time` rows first. So the days most likely to show `count: 0` under truncation are exactly the days flagged `partial: true`. The test "truncated with no invoices fetched marks every day partial" builds this case.

These rows get `kiosk-ps-dayrow--zero` because `count` is 0, so `kioskPsWireDayRows` skips them. The user sees a greyed "0 sales · $0.00 · partial" row and cannot open the day ledger, which is the only place the exact figure is available. The greyed styling also suggests a closed day, which contradicts D-05's goal of telling a closed day apart from missing data.

**Fix:** Treat a row as inert only when it is zero **and** not partial:

```js
var zero = !(Number(day.count) > 0) && !day.partial;
```

Add a test that a `partial: true, count: 0` row opens the day ledger.

### WR-03: Disabled ‹ button carries over from a range into the day ledger

**File:** `js/kiosk-core.js:4672-4679` (`kioskPsSetMode` early return), `js/kiosk-core.js:4790-4812` (`kioskPsOpenDay`), `js/kiosk-core.js:4911-4919` (`kioskPsRenderLedger`)

**Issue:** `kioskPsRenderRange` sets `prev.disabled = !d.prev_anchor`. This is true for the floor period: January 2020, or the week of Dec 30, 2019.

Two paths switch to day mode without resetting the button:

- `kioskPsOpenDay`, when drilling into a day.
- The early-return branch of `kioskPsSetMode('day')` while drilled in.

`kioskPsRenderLedger` only manages `next`. As a result, in a day ledger such as 2020-01-15 the ‹ button stays disabled, and the user cannot step back to Jan 14 even though `prev_date` is valid.

The non-drilled Day path (`kioskPsSetMode` at :4683) does reset the button, which shows the omission is accidental.

**Fix:** Have the day render own both buttons:

```js
var prevBtn = kioskPsEl('kiosk-ps-prev');
if (prevBtn) prevBtn.disabled = !d.prev_date || d.date <= '2020-01-01';
```

This also stops ‹ from requesting 2019-12-31, which currently fails with a 400.

## Info

### IN-01: The cached range payload freezes `today` / `current` / `next_anchor` / `range_end` at build time

**File:** `zoho-middleware/routes/kiosk-history.js:298`

**Issue:** The cache key is `type:period_start`. It does not include `rangeEnd`.

For up to `TTL_RANGE_CURRENT` (300 s) after Vancouver midnight, a current-period payload built before midnight is served unchanged. It has these effects:
- Yesterday is labelled "Today" (the frontend compares rows against the payload's `today`).
- The new day's row is missing.
- At a week or month rollover, › stays disabled.

D-13 accepted lag in today's **figures**, but not a mislabelled or missing row. The impact is low because the store is closed at midnight.

**Fix:** Append `':' + rangeEnd` to the key. Past periods are unaffected.

### IN-02: Loading copy names a month in Week mode

**File:** `js/kiosk-core.js:4704-4707`

**Issue:** `what` is always a month name. In Week mode this gives copy such as "Loading October…". Stepping ‹ from a week whose `prev_anchor` falls in the previous month shows "Loading September…" for a week that is mostly in October.

**Fix:** For `type === 'week'`, use "Loading week…", or format the week label from the anchor.

### IN-03: Range day rows are click-only `<div>`s

**File:** `js/kiosk-core.js:4762-4770`

**Issue:** The day rows have no `role="button"`, no `tabindex` and no key handler. The existing `.kiosk-ps-row` follows the same pattern, so this is consistent with the codebase, but these rows are now navigation controls.

**Fix:** Render tappable rows as `<button type="button">`, or add `role="button" tabindex="0"`.

### IN-04: The payment page cap has no sizing basis

**File:** `zoho-middleware/routes/kiosk-history.js:22-25`

**Issue:** The comment sizes the caps from invoice volume only ("Sept 2026 = 28 invoices"). `/customerpayments` returns **all** customer payments for the month, including online and SO deposits, and is fetched whenever any counted invoice needs notes.

When the payment cap is hit, the frontend shows "at least" in the footer and a note, but no day is flagged. D-10 asked for the cap to be sized "from real volume."

**Fix:** Record the observed monthly payment count next to the constant, or flag all days `partial` when `pay.truncated`.

### IN-05: The 400 copy "Pick a date up to today." is also shown for pre-2020 anchors

**File:** `js/kiosk-core.js:4719`

**Issue:** This copies the Phase 92 pattern. Neither the day input nor the range input sets a `min`, so a date such as 2019-06-01 produces a misleading message.

**Fix:** Set `min="2020-01-01"` on `#kiosk-ps-date`, and reword the message to "Pick a date between 2020 and today."

---

_Reviewed: 2026-10-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
