# Phase 93: Kiosk ledger week and month views - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds **Week** (Monday to Sunday) and **Month** (calendar month) ranges to the existing Phase 92 kiosk **Past Sales → Ledger** tab, in America/Vancouver time.

- A range shows **one summary row per day**: the date, the sale count and the gross total.
- Tapping a day opens that day's existing Phase 92 day ledger.
- The range footer shows the count and gross total.

The owner asked for this at Phase 92 UAT on 2026-10-16.

**Owner decisions already locked in ROADMAP (2026-10-16). They are not re-discussed here:**
- **List shape:** per-day summary rows. Individual sales are never listed across a range.
- **Ranges:** Monday-to-Sunday weeks and calendar months, Vancouver time, with ‹ › stepping.
- **Footer:** count and gross only, with no tender split. The end-of-day cash-up report stays deferred.
- **Phase 92 rules carry over unchanged:**
  - In-store only. Invoices with a blank reference count as in-store.
  - Voids and drafts are excluded from counts and totals.
  - Read-only.
  - Data is cleared when Customer View, the lock screen or a new sale starts.

**Out of scope:**
- Tender split.
- Cash-up or accounting reports.
- Listing individual sales across a range.
- Any Zoho write.
- Any change to the By-customer tab.

</domain>

<decisions>
## Implementation Decisions

### A. Range switcher & drill-in
- **D-01: Day · Week · Month chips sit above the date bar on the Ledger tab.**
  - They use the existing `kiosk-so-chip` style, the same as the By customer / Ledger tabs.
  - **Day is the default**, so the Phase 92 behaviour is unchanged when the tab opens.
- **D-02: Week and Month open on the current period**, meaning the week or month that contains today in Vancouver time. This matches Day opening on today.
- **D-03: The date bar adapts to the mode.**
  - **‹ ›** step one week or one month.
  - The label shows the range, e.g. "Oct 12 – 18" or "October 2026".
  - The single native date input stays. Picking a date jumps to the week or month that contains it.
  - **›** is disabled on the current period, the same as Day on today.
- **D-04: Drill-in and back.**
  - Tapping a day row with sales opens that day's existing Phase 92 day ledger.
  - A **"‹ Back to week" / "‹ Back to month"** link above the day ledger returns to the same range **at the same scroll position**.
  - While drilled in, the Day chip is not selected, so it is clear the day is being viewed inside a range.
  - The D-11 clearing rules from Phase 92 also wipe the range state and the "back" context.

### B. Summary row contents
- **D-05: Zero-sale days are shown** as greyed "0 sales · $0.00" rows.
  - A past week always shows 7 rows, and a month shows one row per day.
  - Gaps stay visible, so a closed day can be told apart from missing data.
  - Tapping a zero-sale row does nothing.
- **D-06: Future days are left out.**
  - In the current week or month, the list ends at today.
  - Today's row is labelled **"Today"**.
- **D-07: Rows are newest first**, matching the day ledger, so today or the latest day is at the top.
- **D-08: Month is a flat list of days**, with no week sub-headers or weekly subtotals.
- Each row shows a weekday label plus the date (e.g. "Sat Oct 17"), the sale count and the gross total.

### C. Slow / partial ranges
- **D-09: A range loads in one go.**
  - While it loads, show a skeleton and a progress message, e.g. "Loading October… this can take a few seconds".
  - All the rows and the footer then appear together. A half-built total is never shown.
  - There is no progressive or week-by-week streaming.
- **D-10: Truncation shows partial data with a clear warning.**
  - If a range hits the server's safety cap, render what loaded.
  - Show a "partial" notice in the same style as the Phase 92 truncated notice.
  - Prefix the footer with "at least".
  - Flag the affected days where they can be identified.
  - Drilling into a day still gives exact day figures.
  - The cap must be sized so that a normal busy month does **not** truncate. The researcher should size it from real volume.
- **D-11: Lookback uses the same floor as the day ledger** (2020 onward, the existing pre-2020 rejection).
  - Future periods are rejected with a 400, the same as a future day.

### D. Freshness & accuracy
- **D-12: Exact match with the day ledger.**
  - A day's count and gross in Week or Month must equal the day ledger's figures for that day under the same rules: in-store classification (blank reference = in-store, plus payment notes for all-digit references), void and draft exclusion, and the `createdDay` Vancouver bucketing.
  - The payments lookup **may be skipped** when the range contains no all-digit-reference invoices, because classification only reads notes for those and tender is not shown. When such invoices exist, it must run, as one ranged and paged query.
  - Planner: add a test that asserts range per-day figures equal `buildLedger` figures for the same fixture data.
- **D-13: The current week or month is cached for about 5 minutes.**
  - ↻ forces a fresh build.
  - **Accepted side effect:** today's row inside the current range can lag the Today day ledger (60 s cache) by up to about 5 minutes. The rules are identical; only the staleness differs.
- **D-14: Past weeks and months are cached for 1 hour**, the same as past days (`TTL_PAST = 3600`). ↻ always forces a rebuild.

### Claude's Discretion
- **Zoho call strategy.**
  - Use one ranged `/invoices` query for the whole period, bucketed by `createdDay`, rather than N day builds. Mind the D+1 boundary that `buildLedger` uses, and the fact that payment `date` is UTC (A-05).
  - Do it with strictly sequential `fetchPages`.
  - Or compose from day caches if research shows that is cheaper or more robust.
  - Whichever is chosen, it must satisfy D-12.
- **Page caps** (`RANGE_MAX_INVOICE_PAGES` etc.).
  - These are hard-coded server constants that the request cannot override (Phase-57 WR-02, T-92-11).
  - The only query params are the range anchor date and `bust`.
- **Route shape.** Either a new `GET /api/kiosk/past-sales/range?type=week|month&date=…` or a param on the ledger route.
  - It must keep the `requireTiers(['legacy','device','session'])` self-gate.
  - It must be added to the device-token allowlist in `lib/authTiers.js`.
  - Its response must be slim: dates, counts and totals only.
- **Cache key design.**
  - Add a new `KIOSK_HISTORY_RANGE_PREFIX` to `C.CACHE_KEYS`.
  - Keep the `sharedBuild` in-flight dedupe and the bust throttle from the Phase 92 review fixes (WR-05).
  - Decide whether the range build should also warm the per-day caches.
- **Visual design** of the chips, the range label, zero-day greying, the "Today" label, the back link and the partial notice. Follow the existing Past Sales and Sales Orders styles.
- **Empty and error states.** If the whole range has no sales, the zero rows still render and the footer reads "0 sales · $0.00". If Zoho is unavailable, show the existing 502 message plus retry.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` §"Phase 93: Kiosk ledger week and month views" (~line 1726): the owner's locked decisions and open questions.
- `.planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-CONTEXT.md`: the Phase 92 D-01..D-16 rules that carry over (scope, voids, isolation D-11, slim allowlist D-12, caching D-16).
- `.planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-RESEARCH.md`: Zoho quota (~1 req/s), list/join findings, A-05 (payment `date` is UTC), threat model T-92-11 (no caller-controlled caps).
- `.planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-REVIEW.md` and `92-REVIEW-FIX.md`: WR-05 (in-flight dedupe and bust throttle) and the other review fixes the new code must not regress.
- `.planning/phases/92-kiosk-past-sales-lookup-and-ledger/92-VERIFICATION.md`: where each Phase 92 behaviour lives.

### Code to extend
- `zoho-middleware/routes/kiosk-history.js`:
  - caps and TTLs at :17-25
  - `sharedBuild` / `cachedOrBuild` at :78-102
  - `fetchPages` (sequential) at :110
  - `buildLedger` at :135, which is the exact-match reference for D-12
  - the ledger route at :189
- `zoho-middleware/lib/kiosk-history.js`:
  - `addDays` / `addMonths` at :49/:55
  - `createdDay` at :90
  - `classify` at :134 (notes are only needed for all-digit references)
  - `indexPaymentsByInvoice` at :152
  - `ledgerTotals` at :227
- `zoho-middleware/lib/constants.js:46-49`: the `KIOSK_HISTORY_*` cache key prefixes.
- `zoho-middleware/lib/authTiers.js` (~:70-100): device-token allowlist for the past-sales paths.
- `kiosk.html:406-440`: Past Sales view markup, Ledger panel and day bar (`#kiosk-ps-prev`, `#kiosk-ps-date`, `#kiosk-ps-next`).
- `js/kiosk-core.js`:
  - Past Sales state and clearing (~:4529)
  - `kioskPsLoadLedger` at :4594
  - `kioskPsRenderLedger` at :4671
  - `kioskPsShiftDay` at :4724
  - the exports at ~:6651
- `js/kiosk.js` ~:1579-1593: ledger prev/next/date/refresh wiring.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`fetchPages`, `cachedOrBuild`, `sharedBuild`**: sequential paging, Redis cache with function TTLs, and in-flight dedupe. Reuse them as they are for the range build.
- **`classify`, `indexPaymentsByInvoice`, `ledgerTotals`, `createdDay`**: these define what the day ledger counts. The range build must use the same helpers so that D-12 holds.
- **Day ledger UI** (`kioskPsLoadLedger` / `kioskPsRenderLedger`): reuse it for the drilled-in day. Add a range render alongside it plus mode state (`day|week|month`, the range anchor, and the drill-in origin).
- **The truncated notice and the skeleton/loading pattern** are already in the ledger render.

### Established Patterns
- Every kiosk GET self-gates with `requireTiers` inside the handler, because the global guard skips GETs.
- Caps are server constants, and request params cannot override them.
- Zoho failures are not cached and return 502.
- Business dates are Vancouver local. Prod runs Node 24 with tzdata fixed for BC permanent time from 2026-11-01. The local Node 20 `vancouver-timezone` test failures are a known pre-existing environment issue.
- Week boundaries are Monday to Sunday. Implement this in Vancouver-day string arithmetic (`addDays`) rather than with `Date#getDay()` in UTC.
- Frontend is ES5. Run `npm run build` after changing `js/kiosk-core.js` or `js/kiosk.js`.
- A generation counter drops late responses (Phase 92). Range loads must use it too, because a slow month response must not overwrite a newer view.

### Integration Points
- A new range route or param in `routes/kiosk-history.js`, plus a new cache prefix and allowlist entry.
- Ledger panel markup: the mode chips, the range label and the back link.
- `kiosk-core.js` state, render and clearing, plus `kiosk.js` wiring.
- Tests:
  - Middleware `__tests__/kiosk-history*`: week/month boundaries (Mon–Sun, month ends, leap February, the DST and permanent-time edge on 2026-11-01), zero-day fill, future-day trimming, future-period and pre-2020 400s, truncation flag, the cap not overridable, the D-12 equality test against `buildLedger`, and payments skipped only when there are no all-digit references.
  - Frontend `tests/frontend/kiosk-past*`: mode switching, drill-in and back with scroll restore, clearing on Customer View and lock, and late-response drop.

</code_context>

<specifics>
## Specific Ideas

- Range label examples: "Oct 12 – 18" for a week and "October 2026" for a month.
- Loading copy: "Loading October… this can take a few seconds".
- Zero-day row: greyed "0 sales · $0.00". The current day is labelled "Today".
- Back link: "‹ Back to week" / "‹ Back to month".
- Truncated footer: prefixed with "at least".

</specifics>

<deferred>
## Deferred Ideas

- **Weekly subtotals inside Month view.** Not chosen (D-08), and could be added later if wanted.
- **Tender split or an end-of-day cash-up report.** Still deferred, as in Phase 92 D-03.
- **Progressive or streaming range load.** Not chosen (D-09).

### Reviewed Todos (not folded)
- 18 pending todos matched by keyword only (kiosk, status, owner, 2026). None concern ledger ranges, so none were folded. This is the same set Phase 92 reviewed. `node-tzdata-bc-permanent-time` is relevant background only: it is resolved on prod (Node 24) and is covered by the Vancouver-time patterns above.

</deferred>

---

*Phase: 93-kiosk-ledger-week-and-month-views*
*Context gathered: 2026-10-17*
