# Phase 92: Kiosk past-sales lookup and ledger - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds two **read-only** kiosk views over Zoho invoices. The owner asked for both on 2026-10-15.

1. **Past-order lookup by customer.** Staff type a name, pick the Zoho contact, and see that customer's past invoices. Line items are one tap away.
2. **Sales ledger.** One day of in-store kiosk sales, newest first, with a day picker and a day total.

Out of scope:
- No refunds, voids, edits, reprints or resends.
- No changes to the money path.
- No new Zoho writes.

</domain>

<decisions>
## Implementation Decisions

### A. Ledger scope & range
- **D-01: Ledger scope is all in-store kiosk sales.** That covers three kinds of invoice:
  - `KIOSK-…` reference invoices from `/api/kiosk/sale`
  - kiosk recipe sales (`routes/pos-recipe.js`)
  - Sales Orders paid at the kiosk (`/api/kiosk/salesorder-pay`)

  Online/website orders and manual back-office invoices are **excluded** from the ledger.
  - **Research must pin how the server identifies these, because no single reference prefix covers them.**
  - SO-pay invoices come from `invoices/fromsalesorder` with an empty body and carry **no** `reference_number` (`routes/pos.js` ~:1907, see D-50-08 in ROADMAP).
  - Recipe confirm uses the numeric terminal txn id or a client reference as `reference_number` (`routes/pos-recipe.js` ~:856, ~:1456), not `KIOSK-`.
  - Candidate approaches: identify online orders positively (checkout's own reference or contact pattern) and treat the rest as in-store; or match on the kiosk payment/SO linkage.
  - The researcher picks the approach and documents any edge cases it misses.
- **D-02: Date filter.** The ledger opens on **today** (Vancouver time) and shows **one day at a time**. Staff move with ‹ › previous/next-day arrows and a date input to jump to any day. There is no free range.
- **D-03: Footer total.** The footer shows count + gross total, e.g. "14 sales · $1,240.55". It is not an accounting report, so there is no tender split.
- **D-04: Voided invoices are shown greyed with a "Void" badge** and **excluded** from the count and total.

### B. Customer lookup flow
- **D-05: Entry point.** A new **"Past Sales" header button** in the standalone kiosk header (`kiosk.html` ~:71, next to Sales Orders / Gift Cards) opens **one view with two tabs: "By customer" and "Ledger"**.
- **D-06: History window.** Show the last **12 months**, newest first, with a **"Load older"** button that extends further back.
- **D-07: Customer history includes ALL of that contact's invoices**, both in-store and online. Each row gets an **In-store / Online source tag**. This intentionally differs from the ledger (D-01), which is in-store only.
- **D-08: Invoices only.** Open or unpaid Sales Orders do **not** appear in customer history. They stay in the existing Sales Orders view.
- **D-09: Walk-in contact excluded.** If the picked contact is the default `KIOSK_CONTACT_ID`, do not list its invoices. Show a message instead: "Walk-in sales aren't tied to a customer, use the Ledger by date." The server enforces this too. Walk-ins still appear in the ledger.
- Contact picking reuses the existing `GET /api/contacts/search` (Zoho `search_text`, ≥2 chars).

### C. Access & privacy
- **D-10: Auth tier.** The new routes are **purpose-built kiosk routes** that accept the same tiers as `GET /api/kiosk/salesorders`: `authTiers.requireTiers(['legacy','device','session'])`.
  - This works on the standalone iPad, which sends only `x-device-token`.
  - The D-46-02 block in `PII_GET_ROUTES` (`server.js:759`) is **unchanged**. The bare device token still cannot reach the generic `/api/invoices` or `/api/contacts`.
- **D-11: Customer View isolation.** Past Sales is **not reachable from the customer-facing "Customer View"** (browse mode).
  - Entering Customer View clears any loaded customer history and ledger data from the DOM and from JS memory.
  - So does starting a new sale or finishing one.
  - The next customer must not be able to scroll back to someone else's history.
- **D-12: Slim allowlist response.** The server maps Zoho data to only the fields the view renders:
  - invoice id/number, date (and time where available), customer name, source tag, status, tender label
  - subtotal, tax, total, balance
  - for line items: name, quantity, rate, amount

  **Never** return email, phone, address, notes, custom fields or payment/transaction references. Follow the slim-map pattern at `routes/pos.js` ~:2415.
- **D-13: View only.** There is no reprint, resend, refund or void action anywhere in these views (see Deferred).

### D. What each row shows
- **D-14: Ledger tender.** The ledger row shows **Card / Cash / Gift card**, mapped from the Zoho customer payment's `payment_mode`:

  | `payment_mode` | Label |
  |---|---|
  | `creditcard` | Card (terminal and MOTO can't be told apart, which is accepted) |
  | `cash` | Cash |
  | `others` | Gift card |

  - Split tender shows both, e.g. "Gift card + Card".
  - Get these from **one customer-payments query per ledger day**, joined to the invoices. Do not make one call per invoice.
  - **Customer history shows status only** (Paid / Unpaid / Partial / Void), with no tender, to save Zoho calls.
- **D-15: Line items expand inline, fetched on tap.** Tapping a row expands it in place to show the items (name, qty, price, line total) plus subtotal, tax and total.
  - The detail is fetched from the invoice detail endpoint on first tap and then cached in client memory, which is cleared per D-11.
  - Never fan out detail fetches up front. Zoho list responses have empty `line_items` (T-64-01) and the quota is ~1 req/s.
- **D-16: Freshness.** Use a server cache plus a ↻ refresh button, like Sales Orders.
  - **~60 s** for today's ledger and for customer invoice lists.
  - **Longer** for past ledger days and invoice details, which rarely change.
  - Refresh bypasses or busts the cache for the current view.

### Claude's Discretion
- Exact cache TTLs, cache key design (e.g. per day, per contact) and cache bust on refresh.
- How the "Load older" pages (by month window vs Zoho page) and the paging limits. Keep server-side caps that the request cannot override (Phase-57 WR-02 precedent).
- Visual design of the tabs, rows, badges and expanded detail. Follow the existing Sales Orders card and chip styles.
- Empty and error states (no sales that day, Zoho unavailable → clear message + retry, following the existing kiosk 502 handling).
- Whether the admin-embedded kiosk also gets the button. Baseline: standalone `kiosk.html` only, following the Phase 90 D-25 precedent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` §"Phase 92: Kiosk past-sales lookup and ledger" — goal, the owner's open questions, the read-only constraint
- `.planning/ROADMAP.md` D-50-08 (~line 1568) — SO-pay invoices have an empty-body create and no `reference_number` (affects D-01)

### Kiosk patterns to reuse
- `zoho-middleware/routes/pos.js` ~:2376 — `GET /api/kiosk/salesorders`: auth tier, cache, slim map and search filter. This is the template for the new routes.
- `zoho-middleware/routes/pos.js` ~:3771 — `GET /api/contacts/search`: contact picker backend
- `zoho-middleware/routes/pos.js` ~:3006 — `GET /api/batch/search-invoices`: search-then-detail with a `MAX_DETAIL_FETCH` cap and a sequential chain (T-64-01, Phase-57 WR-02)
- `kiosk.html` ~:71 (header buttons), ~:380 (`#kiosk-view-collect` markup and chips)
- `js/kiosk-core.js` ~:950 `kioskShowView`, ~:2743 / ~:4877 contact search UI, ~:116 `_kcMergeAuth`
- `js/kiosk.js` ~:749 / ~:1494 (Customer View toggle), ~:1532 (Sales Orders button wiring)

### Auth & PII
- `zoho-middleware/server.js` ~:444 (global guard exempts GET), ~:759 `PII_GET_ROUTES` + `requirePiiApiKey` (D-46-02: device token must not reach the generic invoice/contact routes)
- `zoho-middleware/lib/authTiers.js` — `requireTiers`

### Tender data
- `zoho-middleware/routes/pos.js` ~:1720-1760 — `payment_mode` values booked per tender (`cash`, `creditcard` incl. MOTO, `others` for the gift-card clearing account)
- `zoho-middleware/routes/pos-recipe.js` ~:1453 — recipe sales book `creditcard`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Sales Orders view (`#kiosk-view-collect`)**: header + search + ↻ refresh + chip filter + card list. Copy its layout and CSS for the Past Sales view.
- **`/api/contacts/search`**: kiosk-tier contact search that already returns a slim shape. Reuse it for the "By customer" picker.
- **`cache.get/set` + `C.CACHE_KEYS`**: Redis cache used by the salesorders route. Add new keys to the constants.
- **`zohoGet`**: rate-aware Zoho client. Use a sequential chain for any multi-call work.

### Established Patterns
- Every kiosk GET self-gates with `authTiers.requireTiers(...)` inside the handler, because the global guard skips GETs.
- Slim-map every Zoho response before sending it to the kiosk client.
- Zoho invoice list responses never include line items, so details need a per-invoice fetch, on demand only.
- Business dates are Vancouver local, and Node 24 tzdata is fixed on prod. Compute "today" and day boundaries in `America/Vancouver`, not UTC.
- Frontend kiosk code is ES5 (`js/kiosk-core.js`, `js/kiosk.js`). Run `npm run build` after changes to regenerate the min files.

### Integration Points
- New middleware routes in `zoho-middleware/routes/pos.js` (or a new `routes/kiosk-history.js` mounted in `server.js`, at the planner's discretion). Suggested shapes: customer invoices (by `customer_id`, window), ledger (by `date`), invoice detail (by id).
- New header button + view in `kiosk.html`, with logic in `js/kiosk-core.js` / `js/kiosk.js`, wired into `kioskShowView` and the Customer View toggle for D-11 clearing.
- Tests: middleware `__tests__/` for the routes (auth tiers, walk-in exclusion, allowlist shape, void exclusion from totals, tender mapping incl. split); `tests/frontend/` for view clearing and rendering.

</code_context>

<specifics>
## Specific Ideas

- The main use case: a customer at the counter asks "what did I buy last time?" Staff should be able to answer in a few taps.
- Ledger footer example: "14 sales · $1,240.55".
- Walk-in message wording: "Walk-in sales aren't tied to a customer, use the Ledger by date."

</specifics>

<deferred>
## Deferred Ideas

- **Reprint or resend a past receipt** from Past Sales. This is an outbound action, so it would be its own phase.
- **"Reorder" / add a past order's items to the cart.** It was not requested, and it is a new capability rather than a read-only view.
- **Tender-split day totals / end-of-day cash-up report.** The owner chose count + gross only (D-03).

### Reviewed Todos (not folded)
- 19 pending todos matched by keyword only. None concern past-sales lookup or a ledger, so none were folded. Nearby kiosk todos remain separate: cash tender, auto-clear customer after sale, MOTO, kiosk manual-refresh recurrence, and the terminal push delay.

</deferred>

---

*Phase: 92-kiosk-past-sales-lookup-and-ledger*
*Context gathered: 2026-10-16*
