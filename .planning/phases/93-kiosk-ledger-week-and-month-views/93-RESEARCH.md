# Phase 93: Kiosk ledger week and month views - Research

**Researched:** 2026-10-17
**Domain:** Express read-only aggregation route over Zoho Books list endpoints, plus ES5 kiosk UI state
**Confidence:** HIGH on code-derived findings, MEDIUM on volume sizing (no live Zoho access in this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Day / Week / Month chips above the date bar on the Ledger tab, `kiosk-so-chip` style. Day is the default; Phase 92 behaviour unchanged when the tab opens.
- D-02: Week and Month open on the current period (the one containing today, Vancouver).
- D-03: Date bar adapts. ‹ › step one week or month. Label shows the range ("Oct 12 – 18", "October 2026"). The native date input stays; picking a date jumps to the week or month containing it. › disabled on the current period.
- D-04: Tapping a day row with sales opens that day's existing Phase 92 day ledger. A "‹ Back to week" / "‹ Back to month" link above the day ledger returns to the same range at the same scroll position. While drilled in, the Day chip is not selected. D-11 clearing rules also wipe range state and the back context.
- D-05: Zero-sale days shown as greyed "0 sales · $0.00" rows. Past week = 7 rows, month = one row per day. Tapping a zero row does nothing.
- D-06: Future days left out. Current week/month list ends at today. Today's row labelled "Today".
- D-07: Rows newest first.
- D-08: Month is a flat list of days (no week sub-headers or subtotals). Each row: weekday label plus date ("Sat Oct 17"), sale count, gross.
- D-09: A range loads in one go: skeleton plus progress message ("Loading October… this can take a few seconds"); rows and footer appear together. No progressive streaming.
- D-10: On hitting the server safety cap, render what loaded, show a "partial" notice (Phase 92 truncated-notice style), prefix footer with "at least", flag affected days where identifiable. Drilling into a day still gives exact figures. The cap must be sized so a normal busy month does not truncate.
- D-11: Lookback floor is the same as the day ledger (2020 onward). Future periods rejected with 400.
- D-12: Exact match with the day ledger: a day's count and gross in Week/Month must equal the day ledger's figures under the same rules (in-store classification, void/draft exclusion, `createdDay` Vancouver bucketing). Payments lookup may be skipped when not needed; when needed it runs as one ranged and paged query. Planner adds a test asserting range per-day figures equal `buildLedger` figures for the same fixture data.
- D-13: Current week/month cached about 5 minutes. ↻ forces a fresh build. Today's row may lag the Today day ledger (60 s) by up to about 5 minutes.
- D-14: Past weeks/months cached 1 hour (`TTL_PAST = 3600`). ↻ always forces a rebuild.
- Carried over from ROADMAP: per-day summary rows only; Mon-Sun weeks and calendar months in America/Vancouver; footer count + gross only (no tender split); in-store only (blank reference = in-store); voids and drafts excluded; read-only; cleared on Customer View, lock screen, new sale.

### Claude's Discretion
- Zoho call strategy (one ranged /invoices query bucketed by `createdDay`, strictly sequential `fetchPages`, or compose from day caches), as long as D-12 holds.
- Page caps (`RANGE_MAX_INVOICE_PAGES` etc.): hard-coded server constants, not request-overridable (Phase-57 WR-02, T-92-11). Only query params: range anchor date and `bust`.
- Route shape (new `/range` route or param on ledger route). Must keep `requireTiers(['legacy','device','session'])` self-gate and be added to the device-token allowlist in `lib/authTiers.js`. Slim response.
- Cache key design: new `KIOSK_HISTORY_RANGE_PREFIX`; keep `sharedBuild` dedupe and bust throttle (WR-05); decide whether to warm per-day caches.
- Visual design; empty/error states (zero rows still render, footer "0 sales · $0.00"; Zoho down = existing 502 message plus retry).

### Deferred Ideas (OUT OF SCOPE)
- Weekly subtotals inside Month view.
- Tender split / end-of-day cash-up report.
- Progressive or streaming range load.
- Individual sales across a range; any Zoho write; any change to the By-customer tab.
</user_constraints>

<phase_requirements>
## Phase Requirements

No IDs are mapped yet. Proposed IDs (mirroring PSL-01..07; add to ROADMAP Phase 93 and REQUIREMENTS):

| ID | Description | Research Support |
|----|-------------|------------------|
| PSL-08 | Range endpoint: new read-only `GET /api/kiosk/past-sales/range`, self-gated, allowlisted for device tokens, hard-coded caps, slim response (D-11 validation, T-92-11) | Route design, Security |
| PSL-09 | Exact match: per-day count/gross equals `buildLedger` for the same data (D-12), via shared pure helpers | Exact-match strategy |
| PSL-10 | Week (Mon-Sun) and month boundary math in Vancouver day strings, future trimming, floor, zero-day fill, newest first (D-05..D-08, D-11) | Boundary math |
| PSL-11 | Mode chips, adaptive date bar, ‹ › stepping, date jump, label (D-01..D-03) | Frontend |
| PSL-12 | Drill-in to the day ledger and back with scroll restore (D-04) | Frontend |
| PSL-13 | Range cache TTL 300/3600, bust, in-flight dedupe, bust throttle (D-13, D-14) | Caching |
| PSL-14 | Partial/truncation handling with "at least" footer and flagged days (D-09, D-10) | Cap sizing, Frontend |
| PSL-15 | D-11 (Phase 92) clearing and late-response drop for range state | Frontend |
</phase_requirements>

## Summary

All needed server building blocks already exist in `zoho-middleware/routes/kiosk-history.js` and `lib/kiosk-history.js`. The range route is one ranged `/invoices` query (date_start = period start, date_end = period end + 1), bucketed by `createdDay`, plus an optional single ranged `/customerpayments` query, summarised per day with the same `classify` and `ledgerTotals` the day ledger uses. Real volume is tiny (about 1 invoice per day across all channels, see below), so a month is normally 1 invoice page and 0-1 payment pages, about 2-3 s cold. The existing 3-page caps would already be safe; recommend 5/5 for headroom.

Two findings change CONTEXT assumptions and the planner must act on them:

1. **Payment-skip rule is wider than "all-digit refs".** `classify` consults notes for ANY reference that is non-blank and not `KIOSK-`/`POS-` prefixed (an in-store note short-circuits to `in-store` before the all-digit check, so an "other" reference like `ABC1` with an in-store note flips to in-store). Skipping payments only for the all-digit case would break D-12 for such invoices. Derive the rule from `classify` itself (see Pattern 2).
2. **A naive ranged query is NOT provably equal to N day builds.** The day ledger only admits an invoice if its Zoho `date` is in {D, D+1} (server-side filter) AND `createdDay === D`; and only sees payments whose UTC `date` is in {D, D+1}. A ranged query admits invoices backdated/forward-dated relative to their created day, and payments dated days later. To make equality provable, add the same per-day window predicates in the range build, and share one pure function between `buildLedger` and the range build.

**Primary recommendation:** Add pure helpers in `lib/kiosk-history.js` (week/month bounds, `inDayQueryWindow`, `needsPaymentNotes`, `summarizeDay`), refactor `buildLedger` to call the same helper (existing tests must still pass unmodified), add `/api/kiosk/past-sales/range` with caps 5/5, TTL 300/3600, key `kiosk:history:range:v1:<type>:<periodStart>`, and an ES5 frontend mode state machine that shares the existing ledger sequence counter.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Period bounds, floor/future validation | API / Backend | — | Server owns "today" (Vancouver) and caps; client only sends an anchor |
| Per-day classification and totals | API / Backend | — | Must share code with `buildLedger` for exact match |
| Zoho paging, caps, quota | API / Backend | — | Sequential `fetchPages`, hard-coded caps |
| Range cache and dedupe | Database / Storage (Redis) via API | — | `cachedOrBuild` / `sharedBuild` |
| Mode state, drill-in origin, scroll restore, late-response drop | Browser / Client | — | `js/kiosk-core.js` state, ES5 |
| Range label and weekday text formatting | Browser / Client | — | Pure string formatting from YYYY-MM-DD, no timezone math |
| Device-token gating | API / Backend | — | `authTiers` allowlist plus inline `requireTiers` |

## Standard Stack

No new packages. Everything reuses the existing stack: Express router, `zohoGet` (via `fetchPages`), `cache` (Redis), Jest (middleware and jsdom frontend). 

### Package Legitimacy Audit
No external packages are installed in this phase. Packages removed: none. Flagged: none.

## Zoho volume and cap sizing (D-10)

**Evidence (repo and project memory, no live Zoho query possible):**
- The read-only Zoho Books MCP tools (`list_invoices`) were not available to this agent, so no live count was taken. [ASSUMED] that the numbers below hold; the owner can confirm on staging with a month view.
- Invoice numbers are sequential across ALL channels (kiosk, online, SO-pay, recipes): INV-000160 on 2026-07-30 (`.planning/STATE.md` Phase 67 note), INV-000171 in Aug (BrewPad backfill memory), INV-000241 on 2026-10-16 (recipe confirm test memory). That is about 81 invoices in 78 days, roughly 1 per day, roughly 30 per month. [CITED: .planning/STATE.md, project memory]
- Phase 92 sized the day cap at 600 invoices "far above need" (92-RESEARCH.md:197).

**Recommendation:**
- `RANGE_MAX_INVOICE_PAGES = 5` (1000 invoices at `PER_PAGE = 200`). A month today is about 30 invoices (1 page); 1000 is more than 30x current volume. Weeks never need more than the same cap.
- `RANGE_MAX_PAYMENT_PAGES = 5`. Customer payments are roughly 1 per invoice, same headroom. Payments use the same hard-coded `PER_PAGE`.
- Worst case total is 10 sequential calls, about 10-12 s at ~1 req/s; typical is 1-2 calls, about 2-3 s cold, because `zohoGet` handles quota backoff. The Phase 92 skeleton message ("this can take a few seconds") fits.
- Constants live next to the other caps, are never read from `req`, and are exported under `_internals.caps` for tests (same pattern as Phase 92).

**Truncation semantics:** The query is sorted `created_time` descending (same as the day ledger). On truncation the unseen invoices are all older than the oldest one fetched. So: let `oldestSeenDay` be the minimum `createdDay` among fetched rows in range; days `<= oldestSeenDay` are possibly incomplete (the oldest seen day may be partial, earlier days wholly missing). Mark each such day `partial: true` in the response, set top-level `truncated: true`, and the client prefixes the footer with "at least". If truncated and no row was fetched, mark all days partial. Payments truncation sets `classification_incomplete: true` (classification could be wrong), with the existing day-ledger wording ("totals may be incomplete").

## Exact-match strategy (D-12)

**Decision: one ranged `/invoices` call (plus optional one ranged `/customerpayments`), bucketed per day, sharing pure helpers with `buildLedger`. Do not compose from N day builds** (N sequential 2-3 call chains for a month would be 60-90 requests, about 1.5 min cold; unacceptable).

### What the day ledger does exactly (`routes/kiosk-history.js:135`)
1. `/invoices` with `date_start=D, date_end=D+1` (Zoho filters on invoice `date`).
2. Keep rows where `createdDay(inv) === D`.
3. `/customerpayments` with `date_start=D, date_end=D+1` (payment `date` is UTC, A-05).
4. `indexPaymentsByInvoice` on those payments, `classify(inv, notes)`; keep `in-store`.
5. `slimInvoiceRow` then `ledgerTotals` (skips Void and Draft; cents-rounded sum).

### Divergence edges for a naive ranged query
| Edge | Day ledger | Naive range | Fix |
|------|-----------|-------------|-----|
| Invoice with `date` outside {D, D+1} but `createdDay` = D (backdated or forward-dated invoice) | Excluded (never returned by Zoho for D) | Included (inside the big window) | Add `hist.inDayQueryWindow(inv, day)`: if `inv.date` is a valid YYYY-MM-DD, require `date === day \|\| date === addDays(day,1)`; if absent, accept (mocks and rows lacking `date` are then identical on both paths) |
| Payment dated D+2 or later (recipe lag, WR-04) | Not seen for invoice created D | Seen if inside the range window | When building a day's notes index, use only payments whose `date` is missing or in {D, D+1}. Memoise one `indexPaymentsByInvoice` per day |
| Invoice created D 23:30 Vancouver, UTC date is D+1 | `createdDay` uses Intl Vancouver, so D | Same helper, so D | None; both call `createdDay` |
| Notes only matter for some references | `classify` always given notes | Skipped payments call | Only skip when `needsPaymentNotes` is false for every in-window invoice (below) |
| Float summing | `ledgerTotals` sums cents per day | Range footer | Footer = sum of per-day cents (integer), divided by 100 once. Never sum floats of day grosses |
| Invoice at the period boundary (D = period end, or D+1 beyond today) | n/a | Query `date_end = end+1` | Always `date_end = addDays(periodEnd, 1)` and bucket only days inside [start, end] |

### Payment-skip predicate (correction to CONTEXT D-12)
`classify` returns `in-store` for `KIOSK-`/`POS-` refs and blank refs regardless of notes; for every other non-blank ref the result depends on notes (`inStoreNote` is checked before the all-digit test, so a non-digit "other" reference with an in-store note becomes in-store). Therefore notes are needed for any reference that is non-blank and not `KIOSK-`/`POS-`, not just all-digit.

Robust, self-maintaining form (no duplicated rules):
```js
// lib/kiosk-history.js
function needsPaymentNotes(inv) {
  // true when notes could change the classification of this invoice
  return classify(inv, []) !== classify(inv, [IN_STORE_NOTE_PREFIXES[0] + 'x']);
}
```
Run payments paging only when `invoices.some(needsPaymentNotes)` (invoices after the createdDay and `inDayQueryWindow` filter). Note the existing customer route uses the narrower `/^\d+$/` test; that only affects a display label there and is out of scope (do not touch, surface to the owner as a smell).

### Provable equality via a shared helper
Extract from `buildLedger` a pure function used by both paths:
```js
// lib/kiosk-history.js (pure, ES5)
// invoices: raw Zoho invoice rows already filtered to createdDay === day && inDayQueryWindow
// payRows: raw customerpayments rows (any window); returns kept slim rows in created-desc order
function ledgerRowsForDay(day, invoices, payRows, linkageField, notesField) {
  var dayPays = (payRows || []).filter(function (p) { return paymentInDayWindow(p, day); });
  var idx = indexPaymentsByInvoice(dayPays, linkageField, notesField);
  // ... same classify / slimInvoiceRow / sortByCreatedDesc as buildLedger today
}
```
`buildLedger` calls it with the day's rows (the extra payment-window filter is a no-op there because Zoho already scoped the payments, and is also a no-op for mock rows without `date`). The range build calls it once per day. Existing Phase 92 tests must pass unmodified (CLAUDE.md rule 10); if the refactor changes any existing assertion, stop and rethink rather than editing tests.

The D-12 equality test: feed one fixture (mixed in-store/online/void/draft/blank/`KIOSK-`/non-digit "other" with in-store note/backdated `date`/late-dated payment) through (a) `buildLedger` for each day (mocked `zohoGet` returning the per-day slice a real Zoho filter would return) and (b) the range handler (mocked `zohoGet` returning the whole set), then assert `days[i].count` and `gross_total` equal the day ledger values for every day, and that the footer equals the sum.

## Boundary math in Vancouver day strings

All arithmetic is on `YYYY-MM-DD` via `Date.UTC` (`addDays`, `addMonths`), independent of process timezone, so DST and the 2026-11-01 permanent-time change cannot shift a boundary. Only `createdDay` (Intl `America/Vancouver`) depends on tzdata, and the same function is used by both paths. [VERIFIED: lib/kiosk-history.js read]

New pure helpers (put in `lib/kiosk-history.js`, unit-tested in `kiosk-history-lib.test.js` additions or a new file):
```js
function weekStart(day) {            // Monday on/before day
  var dow = new Date(parseDateUtc(day)).getUTCDay();   // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}
function monthStart(day) { return day.slice(0, 8) + '01'; }
function monthEnd(day) { return addDays(addMonths(monthStart(day), 1), -1); }
function periodBounds(type, anchor) {     // type 'week' | 'month'
  if (type === 'week') { var s = weekStart(anchor); return { start: s, end: addDays(s, 6) }; }
  var ms = monthStart(anchor); return { start: ms, end: monthEnd(anchor) };
}
```
`addMonths(monthStart, 1)` clamps day 1 so there is no overflow problem; leap February works through `Date.UTC` (2028-02 has 29 days; test it). 

Route logic:
- Validate `type` in {week, month}; `date` optional (default today) must match `DATE_RE` and `isRealDate`; `date > today` is 400; `date < LEDGER_MIN_DATE` is 400 (D-11).
- `{start, end} = periodBounds(type, date)`; `effStart = max(start, LEDGER_MIN_DATE)` (week containing 2020-01-01 starts 2019-12-30; clip rather than 400); `effEnd = min(end, today)`.
- Days list: iterate `effStart..effEnd` with `addDays`; zero-fill; output newest first (D-07). `current = end >= today` (drives TTL and `next` disabling).
- Navigation fields: `prev_anchor = addDays(start, -1)` or `null` when `start <= LEDGER_MIN_DATE`; `next_anchor = addDays(end, 1)` or `null` when that is `> today`. The client sends any date in the period; the server normalises, so the cache key uses the period start, not the raw anchor.
- Tests: Mon-Sun for dates on each weekday, a Sunday anchor, month ends (30/31/28/29), 2028 leap Feb, year rollover week (2026-12-28..2027-01-03), 2026-11-01 week (Oct 26 - Nov 1 and Nov 2 - 8) with `createdDay` cases near midnight (these use Intl so they hit the known local Node 20 failures; mark them in the existing vancouver-timezone style, they are valid on Node 24 prod/CI).

## Architecture Patterns

### Request flow
```
Kiosk UI (chips / ‹ › / date / ↻)
   | GET /api/kiosk/past-sales/range?type=&date=[&bust=1]
   v
requireTiers(legacy|device|session)  --(authTiers.KIOSK_ROUTES allowlist for device tokens)
   v
validate type/date (400: bad, future, pre-2020)  -> periodBounds, clip to [floor, today]
   v
cachedOrBuild(key = RANGE_PREFIX + type + ':' + periodStart, ttl(fresh)=current?300:3600, bust)
   |-- hit --> JSON
   |-- miss/bust (throttled 10 s, in-flight deduped) --> buildRange:
        fetchPages /invoices (date_start..end+1, created_time desc, cap 5)
          -> bucket by createdDay (inside [effStart,effEnd]) + inDayQueryWindow
          -> any needsPaymentNotes? yes -> fetchPages /customerpayments (cap 5) ; no -> skip
          -> per day: ledgerRowsForDay -> ledgerTotals -> {date,count,gross}
          -> zero-fill, newest first, footer = sum of cents, truncation flags
   v
slim JSON  (never invoice rows)  -- Zoho error -> not cached -> 502
```

### Recommended structure (changes only)
```
zoho-middleware/lib/kiosk-history.js        # + weekStart/monthStart/periodBounds, inDayQueryWindow,
                                            #   paymentInDayWindow, needsPaymentNotes, ledgerRowsForDay
zoho-middleware/lib/constants.js            # + KIOSK_HISTORY_RANGE_PREFIX: 'kiosk:history:range:v1:'
zoho-middleware/lib/authTiers.js            # + '/api/kiosk/past-sales/range' in KIOSK_ROUTES
zoho-middleware/routes/kiosk-history.js     # + caps, buildRange, GET /range; buildLedger uses ledgerRowsForDay
zoho-middleware/__tests__/kiosk-history-range.test.js   # new
js/kiosk-core.js, js/kiosk.js, kiosk.html, css/kiosk.css (+ rebuilt .min via npm run build)
tests/frontend/kiosk-past-sales-range.test.js           # new
```

### Response shape (slim, field by field, no spread)
```json
{
  "type": "month", "period_start": "2026-10-01", "period_end": "2026-10-31",
  "range_start": "2026-10-01", "range_end": "2026-10-17",
  "today": "2026-10-17", "current": true,
  "prev_anchor": "2026-09-30", "next_anchor": null,
  "days": [ { "date": "2026-10-17", "count": 3, "gross_total": 112.5, "partial": false } ],
  "count": 41, "gross_total": 1530.25,
  "truncated": false, "classification_incomplete": false
}
```
`days` is newest-first and zero-filled. Do not add any invoice-level or customer data.

### Caching (D-13, D-14)
- Key: `C.CACHE_KEYS.KIOSK_HISTORY_RANGE_PREFIX + type + ':' + effectivePeriodStart` (use the nominal Monday/1st, not the clipped start and not the raw anchor, so a mid-week anchor and the Monday share one entry and one in-flight build).
- TTL function `function (fresh) { return fresh.current ? 300 : 3600; }` (`sharedBuild` already supports function TTLs). Add `TTL_RANGE_CURRENT = 300` beside `TTL_TODAY`/`TTL_PAST` and export it in `_internals.caps`.
- Reuse `cachedOrBuild` unchanged, which gives dedupe and the 10 s bust throttle (WR-05) per key for free. `lastBuilt` has its own 500-key bound.
- Do NOT warm per-day caches. Day payloads include tender and invoice rows (range skips payments and has no rows), so warming would need a different build and would risk serving subtly different data. Independent caches keep D-12 simple. Consequence to state in the plan: ↻ on a drilled-in day busts only the day key; the range may still show the old figure for up to its TTL. Mitigation: the client's ↻ in range mode busts the range; document the lag (already accepted in D-13).
- Midnight edge: a cached "current" payload built yesterday could lack today's row for up to 300 s after midnight. Accepted by D-13; mention in the notes, no extra code.

### Frontend model (ES5, `js/kiosk-core.js`)
State (module-private, next to `_kioskPsLedger`):
```js
var _kioskPsMode = 'day';        // 'day' | 'week' | 'month'
var _kioskPsRange = null;        // last range payload
var _kioskPsOrigin = null;       // { mode, anchor, scrollTop } while a day is open from a range
```
- **Sequence counter:** reuse `_kioskPsLedgerSeq` for range loads too (`++_kioskPsLedgerSeq` in `kioskPsLoadRange`). Then a day drill-in or a mode switch automatically invalidates a late month response, and vice versa. The generation counter `_kioskPsGen` (bumped by `kioskPastSalesClear`) continues to guard against D-11 clears; `_kioskPsFetch(path, gen)` already returns `null` for stale gens.
- **Functions:** `kioskPsSetMode(mode)` (day: load today via existing `kioskPsLoadLedger(null,false)`; week/month: `kioskPsLoadRange(mode, null, false)`), `kioskPsLoadRange(type, anchor, bust)` (clone of `kioskPsLoadLedger` structure: skeleton plus "Loading October… this can take a few seconds", fetch, set `_kioskPsRange`, `kioskPsRenderRange()`; 400 and error/Retry handling like the day path), `kioskPsRenderRange()`, `kioskPsOpenDay(date)`, `kioskPsBackToRange()`.
- **Drill-in:** on a row tap with `count > 0`: `_kioskPsOrigin = { mode: _kioskPsMode, anchor: <range anchor>, scrollTop: <scroller>.scrollTop }`; set mode to `'day'` with chips deselected (render chips from `_kioskPsOrigin ? none : _kioskPsMode`), show back link `‹ Back to week|month`, call `kioskPsLoadLedger(date,false)`. Day ‹ › stepping while drilled in is fine; the back link stays.
- **Back:** render from the stored `_kioskPsRange` with no network call (rows appear instantly, scroll restore is reliable), then set `scrollTop` after render. If `_kioskPsRange` is somehow null, reload via `kioskPsLoadRange`. Check which element actually scrolls on the iPad (the `#kiosk-view-past-sales` container versus the window) in `css/kiosk.css` before choosing the scroller; save and restore that one element.
- **Date bar:** `kioskPsShiftDay(delta)` becomes mode-aware: in week/month use `_kioskPsRange.prev_anchor/next_anchor` (null disables the button, mirrors `next_date`); the label element shows "Oct 12 – 18" (cross-month "Oct 28 – Nov 3", cross-year includes the year) or "October 2026". Format from the `period_start`/`period_end` strings with a month-name array, never `new Date(str)` local parsing (timezone shifts). The date input `change` handler calls the range loader when mode is not day. In range mode set the input `value` to `range_end` (or today) and keep `max = today`.
- **Rows:** use a new class (`kiosk-ps-dayrow`, plus `--zero` greyed, `--partial` flag) and a separate wire function so the invoice-detail toggle in `kioskPsWireRows` is not attached. Weekday label via a pure `weekdayOf(dateStr)` using `Date.UTC(...).getUTCDay()`. "Today" label when `date === range.today`. Escape all strings with `escapeHTML`.
- **Footer:** `N sales · $X` with "at least " prefix when `range.truncated`; zero case "0 sales · $0.00" (the day footer renders empty for zero invoices, range must not). Partial notice in `#kiosk-ps-ledger-message` using existing wording style ("Not all sales are shown for this period."), partial days get a "partial" marker.
- **Refresh:** `kioskPsRefresh` branches: day (and drilled-in day) busts the day; week/month busts the range (`bust=1`).
- **Clearing (D-11):** extend `kioskPastSalesClear` (the single choke point) to reset `_kioskPsMode='day'`, `_kioskPsRange=null`, `_kioskPsOrigin=null`, clear the chips (Day active), label, back link and range containers. `kioskPsSetTab('ledger')` currently loads the day when `!_kioskPsLedger`; keep that for mode day, and for range modes when `!_kioskPsRange`.
- **kiosk.html:** inside `#kiosk-ps-ledger-panel` add the chip row above `.kiosk-ps-daybar` (`<button class="kiosk-so-chip kiosk-ps-mode" data-mode="day">`...), a label element between ‹ and the date input (or above the bar), and `<button id="kiosk-ps-backlink">` above `#kiosk-ps-ledger-message`. No CSP change (no new third-party domains). Add CSS next to `.kiosk-ps-total` in `css/kiosk.css`.
- **kiosk.js wiring:** mode chip click handlers calling `KioskCore.pastSalesSetMode`, back link calling `KioskCore.pastSalesBackToRange`; export the new functions from `KioskCore` and extend `_getPastSalesState` additively (mode, range, origin). Do not change the shape existing tests read.
- Run `npm run build` after changing `js/kiosk-core.js`/`js/kiosk.js`; never edit `.min.js` or `main.js` directly (CLAUDE.md rules 8-9).

### Anti-patterns
- Day builds N times for a range (quota and latency).
- `new Date('YYYY-MM-DD')` or `getDay()` on local dates for week math (timezone drift).
- Summing float day grosses (use cents).
- Reading `per_page`, `page`, caps from `req.query`.
- Skipping payments by an independent regex instead of deriving from `classify`.
- Streaming or partial totals shown before the full response (D-09).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zoho paging and quota | New paging loop | `fetchPages` (sequential) | Already caps and flags truncation |
| Cache plus dedupe plus bust throttle | New cache logic | `cachedOrBuild` / `sharedBuild` | WR-05 behaviour and function TTLs already tested |
| In-store classification | New rules | `classify` (and `needsPaymentNotes` derived from it) | D-12 equality depends on one source of truth |
| Day totals | New summation | `ledgerTotals` on slim rows | Voids/drafts and cent rounding already handled |
| Vancouver day bucketing | Offset math | `createdDay` / `vancouverDay` | Intl based, handles BC time change |
| Date string arithmetic | `Date` local math | `addDays`, `addMonths` | `Date.UTC` based |
| Auth | Own checks | `requireTiers` + `KIOSK_ROUTES` | Self-gate pattern for GETs |

## Common Pitfalls

1. **Backdated invoices diverge from the day ledger.** Cause: ranged `date` filter is wider than D..D+1. Avoid with `inDayQueryWindow` shared by both paths. Warning sign: equality test fails only for the backdated fixture row.
2. **Payments skipped too eagerly.** Cause: using the all-digit regex. Use `needsPaymentNotes` derived from `classify`.
3. **Late payments change classification only in the range.** Filter payments per day to {D, D+1}.
4. **Zero-state footer blank.** Day footer renders empty for no invoices; range footer must read "0 sales · $0.00".
5. **Late response overwrites newer view.** Share the ledger sequence counter; check `gen` and `seq` in both then and catch.
6. **Back link loses scroll.** Restore after render, from the stored payload, not after a refetch; verify the actual scroller.
7. **Cache key by raw anchor.** Fragments the cache and defeats dedupe; key by the nominal period start.
8. **Today's TTL.** The TTL function must key off `current` (period end >= today), not off the anchor being today.
9. **Existing tests asserting `_getPastSalesState` keys or ledger markup.** Only add; do not modify them (CLAUDE.md rule 10).
10. **Truncated range, drill-in differs.** Expected by D-10; the partial flag explains it.

## State of the Art

Nothing external changed; this is internal composition. Prod runs Node 24 with BC permanent time tzdata from 2026-10-16 (memory), local Node 20 shows 2 known `vancouver-timezone` failures.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Invoice volume is about 1 per day (derived from invoice-number deltas INV-000160 to INV-000241 over 78 days). **CONFIRMED** 2026-10-17 by live read-only Zoho count: 28 invoices in Sept 2026, 10 in Oct 1-16 (see Addendum) | Cap sizing | If a month holds more than 1000 invoices the range would show "at least"; cap 5 pages is ~35x headroom so low risk |
| A2 | Zoho `/invoices` `date_start`/`date_end` filter on invoice `date`, inclusive on both ends (inferred from Phase 92 use and 92-01 fixture notes) | Exact match | If `date_end` were exclusive the D+1 handling would differ; the day ledger relies on the same behaviour, so equality still holds, but verify on staging by comparing a month view to day ledgers |
| A3 | `/customerpayments` honors `date_start`/`date_end` (92-01 `customerpayments_date_range_honored`, used by `buildLedger` today) | Exact match | Range payments call would over-fetch; per-day payment filter keeps the result correct |
| A4 | The scrolling element on the kiosk Past Sales view must be confirmed in CSS | Frontend | Scroll restore wrong element; check in plan task 1 of UI |
| A5 | Proposed IDs PSL-08..15 need owner/planner acceptance | Requirements | Cosmetic |

## Open Questions (RESOLVED)

1. **Staging confirmation of equality.** Plan a UAT step: open Month on staging and compare 2-3 days against their day ledgers. Recommendation: include in the final plan's verification.
   RESOLVED: 93-05 Task 2 (checkpoint:human-verify) step 4 compares September 2026 and current-month day figures against their day ledgers on the staging iPad; 93-02 Task 2 proves the same equality on a fixture (test name contains "equals the day ledger").
2. **Customer-route narrow regex (`/^\d+$/`).** Not part of this phase; label-only effect there. Surface to owner as a separate issue, do not change.
   RESOLVED: out of scope. 93-02 leaves buildCustomer unchanged (acceptance check on `git diff`) and records the smell in 93-02-SUMMARY.md; 93-05-SUMMARY.md lists it as an open owner item.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (local) | Jest runs | yes | 20.x (known vancouver-timezone failures) | Node 24 on prod/CI |
| Zoho Books MCP (read-only count) | Volume check | not available in this session | — | Derive from invoice numbers (done), confirm on staging |
| Redis | Cache | tests mock `lib/cache` | — | Cache read error = miss (existing) |
| gemini CLI | — | broken per memory | — | grep + Read (used) |

Missing dependencies with no fallback: none.

## Validation Architecture

(`workflow.nyquist_validation` is `false` in `.planning/config.json`; section included because the phase brief explicitly requires it.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (middleware node env; frontend jsdom) |
| Config file | `zoho-middleware/package.json` jest config; root `package.json` jest config |
| Quick run (middleware) | `cd zoho-middleware && npx jest __tests__/kiosk-history` |
| Quick run (frontend) | `npx jest tests/frontend/kiosk-past` |
| Full suite | `npm test` and `cd zoho-middleware && npm test`, plus `npm run lint` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PSL-08 | Route registered, self-gated (401/403 without tier), in `KIOSK_ROUTES`, 400 for bad type/date/future/pre-2020, caps not overridable by `per_page`/`page`/`cap` params, slim keys only | unit | `cd zoho-middleware && npx jest __tests__/kiosk-history-range` | No (Wave 0) |
| PSL-09 | Per-day count/gross equals `buildLedger` on the same fixture (backdated invoice, late payment, `KIOSK-`/blank/digit/non-digit-with-note refs, void/draft, midnight boundary); payments skipped only when no invoice `needsPaymentNotes`; footer = sum of cents | unit | same | No (Wave 0) |
| PSL-10 | `weekStart`/`monthEnd`/`periodBounds` Mon-Sun, month ends, leap Feb 2028, year rollover, 2026-11-01 week; future trim; zero fill; newest first; floor clip | unit (lib) | `cd zoho-middleware && npx jest __tests__/kiosk-history-lib` | Extend file or new `kiosk-history-range-lib.test.js` |
| PSL-13 | TTL 300 current / 3600 past, key by nominal period start, bust throttle and in-flight dedupe, Zoho error not cached (502) | unit | `cd zoho-middleware && npx jest __tests__/kiosk-history-range __tests__/kiosk-history-cache` | Wave 0 |
| PSL-14 | Truncation: `truncated`, per-day `partial` for days <= oldest seen, `classification_incomplete` on payments cap | unit | `cd zoho-middleware && npx jest __tests__/kiosk-history-range` | Wave 0 |
| PSL-11 | Mode chips, label text, ‹ › stepping and disabled states, date jump, loading copy | frontend | `npx jest tests/frontend/kiosk-past-sales-range` | No (Wave 0) |
| PSL-12 | Drill-in loads day, Day chip deselected, back link restores range and scrollTop without refetch, zero rows inert | frontend | same | Wave 0 |
| PSL-15 | Clear on Customer View exit, lock screen, new sale resets mode/range/origin; late month response dropped after switching mode or day | frontend | `npx jest tests/frontend/kiosk-past` | Extend via new file only |
| Regression | All Phase 92 tests unchanged and green | unit | `cd zoho-middleware && npx jest __tests__/kiosk-history __tests__/kiosk-past-sales` and `npx jest tests/frontend/kiosk-past` | Yes |

### Sampling Rate
- Per task commit: the quick commands above plus `npm run lint`.
- Per wave merge: `npm test` and `cd zoho-middleware && npm test` (shared utility `lib/kiosk-history.js` changes require both full suites, CLAUDE.md rule 7). Known pre-existing failures: 2 local Node 20 `vancouver-timezone` tests.
- Phase gate: both full suites green, `npm run build` regenerated, staging smoke (month view compared with 2-3 day ledgers), then owner UAT on the iPad.

### Wave 0 Gaps
- [ ] `zoho-middleware/__tests__/kiosk-history-range.test.js` (copy mock/harness header from `kiosk-history-ledger.test.js`)
- [ ] `tests/frontend/kiosk-past-sales-range.test.js` (copy DOM/harness from `kiosk-past-sales.test.js`)
- [ ] Shared fixture rows for the equality test (new JSON or inline; do not edit `zoho-past-sales-shapes.json` if existing tests pin it)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing tiers; inline `authTiers.requireTiers(['legacy','device','session'])` in the handler (global guard skips GETs) |
| V3 Session Management | no change | Existing |
| V4 Access Control | yes | Add `/api/kiosk/past-sales/range` to `KIOSK_ROUTES` (exact match; `isKioskRoute` needs no prefix change); test that unlisted sibling paths stay denied |
| V5 Input Validation | yes | `type` whitelist, `DATE_RE` + `isRealDate`, future and floor checks, ignore every other query param |
| V6 Cryptography | no | n/a |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Caller-controlled caps/pagination (T-92-11) | DoS | Page caps and PER_PAGE are module constants, never read from `req`; test that `per_page=9999&page=50&max_pages=99` are ignored |
| Quota exhaustion by `bust=1` spam | DoS | `cachedOrBuild` 10 s per-key bust throttle plus in-flight dedupe; worst case is bounded by key count (week/month x periods back to 2020, so an attacker with a device token can walk distinct keys: about 3000 periods; each is a bounded 2-10 call chain). Accepted under the existing device-token threat model plus the general `/api` limiter (92-RESEARCH.md:203). Optionally note that `lastBuilt` is bounded at 500 keys |
| Data leak through the range response | Information disclosure | Slim allowlist: dates, counts, totals only, built field by field (no customer names, invoice ids) |
| Writes | Tampering | Route is GET-only; no Zoho write calls anywhere in the phase |
| XSS via rendered strings | Tampering | Client uses `escapeHTML` for all server strings; dates validated server-side |
| Redis key injection | Tampering | Key built from validated `type` and server-computed date only |

## Sources

### Primary (HIGH confidence)
- `zoho-middleware/routes/kiosk-history.js` (caps, `fetchPages`, `cachedOrBuild`, `buildLedger`, routes) read in full
- `zoho-middleware/lib/kiosk-history.js` (`classify`, `createdDay`, `ledgerTotals`, `addDays`, `addMonths`) read in full
- `zoho-middleware/lib/authTiers.js:60-105`, `lib/constants.js:46-49`
- `js/kiosk-core.js:4480-4795, 6651`, `js/kiosk.js:1578-1612`, `kiosk.html:406-440`, `css/kiosk.css:3014-3035`
- `.planning/phases/92-.../92-REVIEW-FIX.md` (WR-01 sequence counters, WR-03 drafts), `92-RESEARCH.md`, `92-03-PLAN.md` A-05

### Secondary (MEDIUM)
- Project memory and `.planning/STATE.md` for invoice-number-based volume estimate

### Tertiary (LOW)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies
- Architecture and exact-match: HIGH, derived directly from the source being reused
- Volume sizing: MEDIUM, derived from invoice-number deltas, not a live count
- Pitfalls: HIGH

**Research date:** 2026-10-17
**Valid until:** 2026-11-16 (stable; re-check only if Phase 92 code changes)

## Addendum — A1 volume confirmed live (orchestrator, 2026-10-17)

Read-only Zoho Books count (`list_invoices`, `response_option=2`, org 110002406307):
- 2026-09-01..2026-09-30: **28 invoices** (all channels, all statuses)
- 2026-10-01..2026-10-16: **10 invoices**

A1 is CONFIRMED: a month is a single 200-row page. `RANGE_MAX_INVOICE_PAGES=5` (1,000/month) gives ~35x headroom. The `date` range filter is a `"comparator":"range"` with both ends inclusive, which supports A2 (date_end inclusive).
