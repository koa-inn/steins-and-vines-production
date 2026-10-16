# Phase 92: Kiosk past-sales lookup and ledger - Research

**Researched:** 2026-10-16
**Domain:** Read-only Zoho Books invoice/payment views behind kiosk-tier auth (Express middleware + ES5 kiosk frontend)
**Confidence:** MEDIUM. The codebase facts are HIGH. Two Zoho response shapes (payments list) are unverified and need a Wave 0 live spike.

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied from `92-CONTEXT.md`. D-01 to D-16 are locked.

### Locked Decisions
- **D-01** Ledger scope is all in-store kiosk sales: `KIOSK-` reference invoices from `/api/kiosk/sale`, kiosk recipe sales, and Sales Orders paid at the kiosk. Online/website orders and manual back-office invoices are excluded. Research pins how the server identifies them. SO-pay invoices carry no `reference_number`.
- **D-02** The ledger opens on today (Vancouver) and shows one day at a time. It has prev/next arrows and a date input. There is no free range.
- **D-03** The footer shows count + gross total, e.g. "14 sales · $1,240.55". There is no tender split.
- **D-04** Voided invoices are shown greyed with a "Void" badge and excluded from count and total.
- **D-05** A "Past Sales" header button in standalone `kiosk.html` opens one view with two tabs: "By customer" and "Ledger".
- **D-06** Customer history shows the last 12 months, newest first, with a "Load older" button.
- **D-07** Customer history includes ALL of that contact's invoices, each with an In-store / Online source tag.
- **D-08** Invoices only. Sales Orders do not appear in history.
- **D-09** The walk-in `KIOSK_CONTACT_ID` contact is excluded from customer history. The message is "Walk-in sales aren't tied to a customer, use the Ledger by date." The server enforces it. Walk-ins still appear in the ledger.
- Contact picking reuses `GET /api/contacts/search`.
- **D-10** New routes accept `authTiers.requireTiers(['legacy','device','session'])`. The D-46-02 `PII_GET_ROUTES` block is unchanged.
- **D-11** Past Sales is not reachable from Customer View. Entering Customer View, starting a sale, or finishing a sale clears history and ledger data from the DOM and from JS memory.
- **D-12** Slim allowlist response. Fields are invoice id/number, date (and time where available), customer name, source tag, status, tender label, subtotal/tax/total/balance, and line item name/qty/rate/amount. Never return email, phone, address, notes, custom fields, or payment/transaction references.
- **D-13** View only. No reprint, resend, refund or void.
- **D-14** Ledger tender comes from the Zoho payment `payment_mode`: `creditcard` is Card, `cash` is Cash, `others` is Gift card. Split tender shows both. Use one customer-payments query per ledger day, joined to the invoices. Customer history shows status only.
- **D-15** Line items expand inline and are fetched on tap, then cached in client memory (cleared per D-11). No up-front fan-out.
- **D-16** Server cache plus a refresh button. TTL is about 60 s for today's ledger and customer lists, longer for past days and details. Refresh busts the cache.

### Claude's Discretion
Cache TTLs and key design; "Load older" paging and server-side caps the request cannot override; visual design; empty/error states following the kiosk 502 handling; whether the admin-embedded kiosk gets the button (baseline is standalone `kiosk.html` only).

### Deferred Ideas (OUT OF SCOPE)
Reprint/resend, "Reorder"/add past items to cart, tender-split day totals and end-of-day cash-up.
</user_constraints>

## Summary

All the data needed already exists in Zoho, and the codebase has near-exact templates for every piece. The hard problems are two data-shape issues the CONTEXT did not anticipate.

1. **No single invoice field identifies "in-store".**
   - Standard kiosk and recipe sales have `reference_number` = `KIOSK-<ms>`. The kiosk client mints that key (`js/kiosk-core.js:2948`) and sends it as `reference_number` / `reference`. The CONTEXT note that recipe sales use a numeric txn id as the *invoice* reference is wrong. The numeric txn id is the *payment* reference (`pos-recipe.js:1456`).
   - SO-pay invoices come from `fromsalesorder`, so they have no reference. They look the same as back-office invoices.
   - Online checkout invoices use the Helcim numeric txn id as `reference_number` (`checkout.js:582`).
   - The reliable discriminator for SO-pay is the **payment notes** written by each money path. The ledger already needs the day's payments for D-14, so no extra call is needed.

2. **The invoice `date` the kiosk writes is the UTC date.** Every creator uses `new Date().toISOString().slice(0,10)`. BC is permanently UTC-7, so a sale after 17:00 local carries tomorrow's date. A ledger bucketed by `date` alone would put evening sales on the wrong day. The invoice list *does* return `created_time` with an offset. Bucket by `created_time` converted to a Vancouver day, and query `date_start=D&date_end=D+1`.

**Primary recommendation:** Add a new `routes/kiosk-history.js` router with three GET routes (customer invoices, ledger day, invoice detail), all self-gated with `requireTiers(['legacy','device','session'])`. Add the paths to `KIOSK_ROUTES`. Use the in-store classifier below (KIOSK- prefix OR in-store payment note). Bucket days on `created_time` in `America/Vancouver`. Run a Wave 0 live spike on staging for the payments-list shape before locking the join code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| In-store classification, tender mapping, void/total math | API/Backend | — | Needs Zoho data and PII control. The client must only render the slim result. |
| Allowlist slimming (D-12) | API/Backend | — | Zoho objects carry email/notes/custom fields/txn refs. |
| Walk-in exclusion (D-09) | API/Backend | Browser (message) | Server enforces it. The client shows the message. |
| Vancouver day boundaries | API/Backend | Browser (date input) | Server computes "today" and buckets. The client only sends `YYYY-MM-DD`. |
| Cache (D-16) | API/Backend (Redis) | Browser memory (details) | Redis for lists; a client Map for details, cleared per D-11. |
| Customer-view isolation (D-11) | Browser | — | DOM and memory lifecycle is entirely client-side. |
| Contact picking | API/Backend (existing `/api/contacts/search`) | Browser | Reuse. |

## Standard Stack

No new packages. Nothing to install, so there is no package legitimacy audit.

| Piece | Source | Notes |
|---|---|---|
| `zohoGet` | `zoho-middleware/lib/zoho-api.js` | Retries 429/5xx with backoff. 15 s timeout. `organization_id` is auto-added. |
| `cache` | `lib/cache.js` | `get/set(key, val, ttlSec)/del`. Redis-backed; tests mock it. |
| `authTiers.requireTiers` | `lib/authTiers.js` | Invoked inline in each GET handler. |
| `Intl.DateTimeFormat('en-CA', {timeZone})` | Node 24, tz 2026c on prod | Pattern at `lib/batch-rules.js:718` (`zoneParts`/`formatDay`, not exported). |
| Jest, jsdom, Playwright | existing | |

[VERIFIED: codebase grep] for all of the above.

## Architecture Patterns

### System Architecture Diagram

```
Kiosk iPad (x-device-token)
  "Past Sales" button -> kioskShowView('past-sales')
     |-- tab "By customer": /api/contacts/search?q=  (existing)
     |        -> pick contact -> GET /api/kiosk/past-sales/customer?customer_id=&before=
     |-- tab "Ledger":  GET /api/kiosk/past-sales/ledger?date=YYYY-MM-DD[&bust=1]
     '-- row tap:       GET /api/kiosk/past-sales/invoice/:id   (client Map cache)
            |
            v
   Express router (routes/kiosk-history.js)
     requireTiers([legacy,device,session]) -> 401/403
     validate (digits-only ids, date regex, hard caps)
     cache.get(key) --hit--> slim JSON
        | miss
        v
     zohoGet('/invoices', ...)  [sequential]
     ledger only: zohoGet('/customerpayments', {date:D[,D+1]})
        -> classify (KIOSK- ref OR in-store payment note)
        -> bucket by created_time (Vancouver day)
        -> map payment_mode -> tender label, join by invoice number
        -> slim allowlist map, totals (exclude void)
        -> cache.set(key, ttl) -> res.json
     Zoho failure -> 502 {error}  (client shows message + retry)
```

### Recommended structure
```
zoho-middleware/
  routes/kiosk-history.js        # 3 GET routes, mounted in server.js (app.use('/', ...))
  lib/kiosk-history.js           # pure helpers: classify, tender map, slim maps, vancouver day, totals
  __tests__/kiosk-history.test.js, __tests__/kiosk-history-lib.test.js
js/kiosk-core.js                 # past-sales view logic (shared file, null-safe DOM)
kiosk.html + css/kiosk.css       # button, view markup, styles
tests/frontend/kiosk-past-sales.test.js
```

Put pure logic in `lib/` (a new lib file means the full middleware suite must be run, per the CLAUDE.md rule on `zoho-middleware/lib/*.js`). Keep the route file thin. A new router file needs `app.use('/', require('./routes/kiosk-history'))` in `server.js` near line 780. Alternatively add to `pos.js` (4756 lines); a new file is recommended.

### In-store classifier (D-01, D-07), the core recommendation

Every invoice-creation path in the middleware:

| Path | Code | `reference_number` | Notes (invoice) | Customer | Payment written (mode / notes) |
|---|---|---|---|---|---|
| `/api/kiosk/sale/confirm` (kit/products, cash, MOTO, GC) | `pos.js:1414-1705` | `body.reference_number` or `KIOSK-<ms>` (client always sends `KIOSK-<ms>`) | `In-store kiosk sale (manual confirm). Ref: …` (+ discount) | `body.contact_id` else `KIOSK_CONTACT_ID` | `cash` / `Kiosk cash payment. Ref:`; `creditcard` / `Kiosk POS terminal payment. Ref:` or `Kiosk phone-order (card-not-present) payment. Ref:`; `others` / `Gift certificate <n> redemption. Ref:` |
| `/api/kiosk/recipe-sale/confirm` | `pos-recipe.js:1365-1458` | `body.reference` = client `KIOSK-<ms>` | `Kiosk recipe sale (<type>). Recipe: … Ref:` | `body.contact_id` else `KIOSK_CONTACT_ID` | `creditcard` / `Kiosk recipe sale. Ref:` (payment ref = numeric txn id) |
| `/api/kiosk/salesorder-pay` | `pos.js:2738` via `money-path.js:317` | **none** (`fromsalesorder`, empty body) | inherited from the SO | the SO's customer | `creditcard` or `debitcard` / `Kiosk SO payment. Terminal txn:` |
| `/api/pos/collect` webhook | `webhooks.js:277` via `money-path` | none | inherited | the SO's customer | `creditcard` or `debitcard` / `In-store terminal payment. Helcim txn:` |
| Legacy `/api/pos/sale` | `pos.js:2183-2232` | `POS-<ms>` or the SO number | `Legacy POS sale. Terminal txn:` | `KIOSK_CONTACT_ID` | `creditcard` or `debitcard` / `Legacy POS payment. Terminal txn:` |
| Reconcile / orphan recovery | `reconcile.js:369-502` | pending ctx ref (`KIOSK-…`) | n/a | n/a | n/a |
| Online checkout (paid) | `checkout.js:582` | **Helcim numeric txn id** | customer's `body.notes` | resolved real contact | `creditcard` / `Online payment for Invoice …` |
| Online checkout (unpaid) | `checkout.js:583` | n/a (creates a Sales Order) | n/a | n/a | n/a |
| Brewpad / batch, gift cards | none | These do not create invoices (`brewpad-integration.js` only GETs an invoice) | | | |
| Manual back-office (Zoho UI) | n/a | arbitrary or empty | arbitrary | arbitrary | arbitrary |

[VERIFIED: codebase grep and Read of each path]

An online reservation (Sales Order) that is later paid at the counter becomes an SO-pay invoice, so it is **in-store by payment** even though it is online by origin. This matches the ledger's intent: money taken at the kiosk.

**Recommended rule.** An invoice is **in-store** iff either:
- (a) `reference_number` starts with `KIOSK-` (also accept `POS-`), **OR**
- (b) at least one customer payment applied to it has notes starting with one of `Kiosk `, `In-store terminal payment`, `Legacy POS payment`.

It is **online** if neither holds and either `reference_number` is all digits (the Helcim txn id) or a payment note starts with `Online payment`. Otherwise it is **other**.

- **Ledger:** run (a) on the invoice list and (b) on the day's payments. The union is the ledger set. The payments fetch is needed anyway for D-14.
- **Customer history source tag (D-07):** (a) is free from the list. For (b), do one `GET /customerpayments?customer_id=X` per cache miss, which is a single extra call. Without it, SO-pay invoices (blank reference) would be mis-tagged.
- **Open decision for the owner or planner:** D-07 specifies only In-store / Online. Blank-reference invoices with no matching payment (manual back-office) fit neither. Recommend a third neutral label "Other", or render no tag. Flag this to the user.

**Edge cases and misses:**
- A `KIOSK-` invoice whose payment-recording failed has no payment (D-12 path rethrows and voids the charge, but a draft invoice can remain). It is still in-store by (a) and shows tender blank / status Unpaid. That is useful for spotting orphans.
- A back-office invoice someone types `KIOSK-` into is a false positive. This is negligible.
- A payment whose notes were edited in the Zoho UI makes (b) miss. Rare.
- Stale payment notes are never rewritten. The notes strings are a de facto contract. Add a comment in the money paths, or better, a lib constant plus a test that fails if a notes prefix changes. This is a minor change in the money-path files (read-only phase, so just add a test that greps for the strings).
- Gift-card-only sale: the payment is `others`. The notes start with `Gift certificate`, which is not in the list. The invoice is still caught by (a) because its reference is `KIOSK-`.
- SO-pay where the invoice was previously partially paid by an online deposit: its payments include `Online payment for…` plus `Kiosk SO payment…`. Rule (b) matches, so it is in-store. Tender then lists both: a card label for the deposit and one for the counter payment, which is mostly correct.
- If the payments-list response does not expose notes (see Spike S1), fall back to the invoice **detail** `notes` plus `payments[]` only for blank-reference invoices. That is a bounded, sequential fan-out (cap it) and is the main risk to flag.

### Zoho query shapes

Invoice list `GET /invoices` [CITED: zoho.com/books/api/v3/invoices, fetched 2026-10-16]:
- Filters: `customer_id`, `date`, `date_start`, `date_end` (inclusive), `date_before`, `date_after` (exclusive), `created_date_start`/`created_date_end`, `status` (`sent|draft|overdue|paid|void|unpaid|partially_paid|viewed`), `reference_number`, `search_text`.
- Sort: `sort_column` in `customer_name|invoice_number|date|due_date|total|balance|created_time`; `sort_order` `A`/`D` (the codebase uses `D`).
- Paging: `per_page` max 200, `page`, and `page_context[.has_more_page]`.
- Row fields from the docs example: `invoice_id, invoice_number, customer_id, customer_name, status, reference_number, date, due_date, total, balance, created_time` (ISO with offset, e.g. `2013-11-18T02:17:40-0800`), `last_modified_time, last_payment_date, custom_fields, salesperson_name`. **Rows carry no `line_items`, no `notes`, no payment mode, no `sub_total`/`tax_total`.** Existing code confirms `line_items` is always empty (T-64-01).
- `created_time` is therefore available on the list, so "time where available" is satisfied. Parse the offset, convert to a Vancouver time label, and send `HH:MM` only.
- The repo shape is confirmed by existing usage: `pos.js:3087` (`customer_id`, `date_start`, `date_end`, `sort_column`, `per_page:200`), `pos.js:3251` (`date_after`, `page`, `has_more_page`), `data.page_context.has_more_page`.
- **Not combinable assumption:** `customer_id` with `date_start` is already used at `pos.js:3087`. [VERIFIED: codebase]

Invoice detail `GET /invoices/:id`: the repo reads `line_items[].{item_id,name,description,quantity,rate,item_total|amount}`, `balance_due` (`money-path.js:380`). The detail also carries `sub_total`, `tax_total`, `total`, `balance`, `status`, `payments[]`, `notes`. The totals names come from training and are tagged below. Do not forward anything except the allowlist. Prefer reading `total/sub_total/tax_total` and falling back to the list values.

Customer payments list `GET /customerpayments` [CITED: zoho.com/books/api/v3/customer-payments]: documented filters are `customer_id`, `date` (exact), `reference_number`, `notes` (+ `_startswith`/`_contains`), `payment_mode`, `filter_by=PaymentMode.*`, `search_text`, `page`, `per_page`. **`date_start`/`date_end` are not documented for this endpoint. The documented list-response example shows no `invoices[]` array** (only `invoice_number`, `payment_mode`, `amount`, `date`). No code in this repo has ever called `GET /customerpayments`. [VERIFIED: codebase grep] So the payments join is unverified. See Spike S1.

Recommended join: `GET /customerpayments?date=<D>` and a second call `date=<D+1>` (see the UTC-date issue below), both `per_page:200`, paged to a hard cap. Index payments by `invoice_number(s)`. Fall back to the detail `payments[]` for a bounded number of rows if the list lacks any invoice linkage. The `notes_startswith=Kiosk` filter is available as a narrowing option but costs an extra call per prefix, so do not use it.

### Vancouver day boundaries

- No exported helper exists. `lib/batch-rules.js:718-731` has non-exported `zoneParts`/`formatDay` using `Intl.DateTimeFormat('en-CA',{timeZone})`. `batch-drift.js` and `batch-pg-read.js` define `DEFAULT_TIMEZONE = 'America/Vancouver'`.
- Create `vancouverDay(date)` in the new lib using the same idiom. Node 24 + tz 2026c is live on prod since 2026-10-16 [VERIFIED: memory file]. Do not hardcode a UTC offset. BC is permanently UTC-7 from 2026-03-08, and tzdata 2025c (Node 20) would be wrong from 2026-11-01.
- **UTC-date pitfall (important):** every invoice and payment `date` is written as `new Date().toISOString().slice(0,10)` (pos.js:1417, pos-recipe.js:1360, checkout.js, pos.js:2175). A sale at 17:30 PDT carries the next UTC date.
  - Bucket the ledger by `created_time` converted to a Vancouver day.
  - Query `date_start=D`, `date_end=D+1` so the next-UTC-day rows are found.
  - Query payments for `date=D` and `date=D+1`. That is up to 2 calls per ledger day, a small deviation from D-14's "one query". Document this to the user. It is fixable later by writing Vancouver dates at creation, but that is a money-path change and out of scope.
- `fromsalesorder` SO-pay invoices take the date Zoho assigns (org timezone). `created_time` bucketing is correct for those too.
- Open check: confirm the Zoho org timezone so `created_time` offsets are Vancouver. Parsing the ISO offset makes this irrelevant, because the instant is converted regardless.

### Patterns to copy (verified in code)

- **Auth and 502** (`pos.js:2376-2452`): `authTiers.requireTiers(['legacy','device','session'])(req,res,function(){...})`; `cache.get(key).then(...)`; on error log (no PII) and `res.status(502).json({error:'Unable to fetch …'})`. The client treats non-2xx as an error with retry.
- **Contacts search** (`pos.js:3771`): reuse as is. Min 2 chars (400 below that); already returns a slim `contact_id/contact_name/email/phone`. Client code is at `kiosk-core.js:2743` and calls `fetch(mwUrl + '/api/contacts/search?q=' ...,_kcMergeAuth({}))`.
- **Detail fan-out cap** (`pos.js:3006`, `link-candidates` at `:3070`): `MAX_DETAIL_FETCH` hard-coded server-side, sequential promise chain, not request-controlled (Phase-57 WR-02). Use the same for any detail fallback.
- **Single-record detail** (`pos.js:4708`): `/api/kiosk/salesorder/:id`. It does **not** validate `:id`. Improve: `/^\d{6,25}$/` and 400 otherwise (the Zoho IDs are numeric). Never interpolate an unvalidated param into a Zoho path.
- **Cache keys** (`lib/constants.js:15`): add e.g. `KIOSK_HISTORY_LEDGER_PREFIX: 'kiosk:history:ledger:v1:'` (+ day), `KIOSK_HISTORY_CUSTOMER_PREFIX` (+ id + window), `KIOSK_HISTORY_INVOICE_PREFIX` (+ id). Include a version segment, like `batch-link-cand:v1:`. For refresh, accept `?bust=1` that skips the read and rewrites. The `?bust=1` precedent exists on the products route (WR-02 notes).
- **TTLs (discretion):** today's ledger and customer lists 60 s; past ledger days 1 hour; invoice details 1 hour for paid or void and 60 s for unpaid or partial. Never cache a 502. Refresh button sends `bust=1` for the current view only.
- **Caps:**
  - Ledger: max 3 invoice pages of 200 (600 invoices per day, far above need). If `has_more_page` after the cap, return `truncated:true` and show a notice.
  - Customer: `per_page:200`, a window of 12 months.
  - "Load older": the client passes `before=YYYY-MM-DD` (the oldest date already shown). The server validates the format, then returns the next 12-month window with `date_end = before-1 day` and `date_start = before-12 months`. Cap at, say, 10 years, and 3 pages per call.
  - Never accept `per_page`, `page` or `status` from the request.
- **KIOSK_CONTACT_ID:** read `process.env.KIOSK_CONTACT_ID` at request time. If `customer_id === KIOSK_CONTACT_ID`, return `200 {walk_in:true, invoices:[]}` (or 409; pick one and test it), and make no Zoho call. If the env var is unset (it is commented out in `.env.example`), the exclusion cannot be enforced. Log a warning. Also exclude by `customer_id` in the Zoho query, never by name.
- **KIOSK_ROUTES:** add the three paths (`/api/kiosk/past-sales/ledger`, `/customer`, and a documented `/api/kiosk/past-sales/invoice/:id` prefix entry like the `salesorder/:id` handling in `isKioskRoute`). GET requests skip the global guard (`server.js:440`: `if (req.method === 'GET') return next();`), so route-level `requireTiers` is the real gate, but `isKioskRoute` is the explicit allowlist documentation. Add an `isKioskRoute` test mirroring `gift-cards-adjust.test.js:362`. Avoid the `/api/kiosk/salesorder/` prefix trap by choosing distinct path names.
- **Rate limiting:** these are GET-only and are covered by the general `/api` limiter (`apiLimiter`). No new limiter is needed. A per-device cap is acceptable under the existing device-token threat model.

### Frontend (kiosk)

- **Header buttons** live at `kiosk.html:71-77`. Add `<button id="kiosk-past-sales-btn">Past Sales</button>` beside Sales Orders. **View container:** copy the `#kiosk-view-collect` block (`kiosk.html:380-403`, `.kiosk-collect-header`, `.kiosk-so-chip`, `.kiosk-so-list`, `.kiosk-collect-footer`). Add `id="kiosk-view-past-sales"`.
- **View switch:** `kioskShowView` (`kiosk-core.js:951`) hard-codes the view-name array `['browse','browse-customer','customer','payment','review-batches','receipt','error','collect','create-so']`. **The new view name must be added there**, or it will never be hidden when switching away. Because every `kioskShowView(other)` call hides it, put the D-11 clearing here: whenever the target name is not `'past-sales'`, call `kioskPastSalesClear()`. That one hook covers entering Customer View (`kioskShowCustomerBrowse` calls `kioskShowView('browse-customer')`), starting a sale (`kioskShowView('browse')`), the receipt/payment views, and the post-sale New Sale button. It is the single choke point, so it is safer than hooking each site.
- **Extra clearing hooks:** `showLockScreen` (`kiosk.js:326`, device lock/idle), `_kcEnv.setCustomer(null)` at the New Sale handlers (`kiosk-core.js:4250`, `:4747`), and the idle attract/reset (see `tests/frontend/kiosk-attract-reset.test.js`). Clear on lock too, since an idle kiosk may be left in front of customers. Hide the button and refuse to render while `_kioskCurrentView === 'browse-customer'`.
- **Clearing means:** set the list/footer/detail containers' `innerHTML = ''`, null the module-level arrays and the details Map, cancel in-flight requests (a generation counter so a late response is ignored after clear), and clear the search input and contact dropdown. A stale response landing after a clear is the main leak risk.
- **ES5 only** (`var`, no arrow functions, no template literals), as in `kiosk-core.js`. All dynamic text goes through `escapeHTML` (see `kiosk-html-escaping.test.js`).
- **Auth:** all fetches go through `_kcMergeAuth` (`kiosk-core.js:116`). The device token is added for the standalone surface.
- **Wiring:** buttons are wired in `kiosk.js` init (`:1532`, Sales Orders pattern). Put the view logic in `kiosk-core.js` and export through the `KioskCore` return object (around `:6131`), as `showGiftCardMgmt` does. Guard every `getElementById` so `admin.html` (which loads `kiosk-core.min.js` via `admin.html:1167` but has no such markup) does not throw. Do not add the button to `admin.html` (Phase 90 D-25 precedent).
- **Build:** `npm run build` -> `minify:js` runs terser on `js/kiosk-core.js` and `js/kiosk.js` -> `.min.js`; `minify:css` handles `css/kiosk.css`; `stamp:kiosk` rewrites the `?v=` cache-busters in `kiosk.html`. Run the build after changes. The `.min.js` files are committed artifacts. **CSP:** `kiosk.html:17` already allows `connect-src` to the middleware origins. No new third party is introduced, so no CSP change is needed.
- Day picker: `<input type="date">` plus ‹ › buttons. Compute "today" for the initial value from the **server** (return `today` in the ledger response, or fetch with no `date` param) so a mis-set iPad clock does not matter. The iPad is not guaranteed to be on Vancouver time, so never use `new Date()` on the client for the day. Format day arithmetic with plain `YYYY-MM-DD` string math or UTC dates.

### Anti-Patterns to Avoid
- Per-invoice detail fetches in a list or ledger (T-64-01, ~1 req/s quota).
- Returning the Zoho object, or spreading it, instead of building the allowlist object field by field.
- Returning `reference_number` or payment `reference_number` (the online invoice reference is the Helcim transaction id; D-12 forbids it).
- Passing request `page`, `per_page` or `status` through to Zoho.
- Doing the ledger bucketing by `invoice.date`.
- Adding Past Sales to `PII_GET_ROUTES` or changing the D-46-02 block.
- Using `Promise.all` for multiple Zoho calls (sequential chain, quota).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Zoho calls, retry, 429 backoff | custom axios | `zohoGet` | Handles quota codes 44/45/1070 |
| Timezone day math | manual UTC offset | `Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'})` | Permanent-time tzdata issue; offset hardcoding breaks |
| HTML escaping | string concat without escape | `escapeHTML` in kiosk-core | Customer names are untrusted |
| Auth | custom header checks | `authTiers.requireTiers` | Single dispatch point |
| Money sums | float addition | integer-cents summation | Footer total must equal the sum of displayed rows |

## Common Pitfalls

1. **Evening sales on the wrong day (UTC `date`).** See above. Test with a `created_time` of `2026-10-16T19:30:00-0700`, `invoice.date` `2026-10-17`, and assert it lands on the 16th.
2. **Payments list shape unknown.** Do not write the join before Spike S1. If `invoice_numbers`/`invoices[]` is absent, the join must use detail fetches (capped).
3. **Void rows polluting totals.** Void invoices appear in the list. Show them greyed, and exclude them from count and gross (D-04). Test with a void in the fixture.
4. **Draft and unpaid kiosk invoices.** A draft invoice (submit failed) still appears. Map statuses: `paid`->Paid, `sent|overdue|unpaid|viewed`->Unpaid, `partially_paid`->Partial, `void`->Void, `draft`->Unpaid or "Draft". Recommend "Draft" shown only in the ledger. Raise it as a decision.
5. **Debit tender.** SO-pay and legacy POS use `payment_mode:'debitcard'`, which D-14's table omits. Map `debitcard` to "Card" (document it), and any unknown mode to "Other" rather than blank.
6. **Split tender ordering.** Sum per label, dedupe, and order Card, Cash, Gift card.
7. **`balance` vs total.** Gross total in the footer should sum `total` of non-void in-store invoices. Do not subtract refunds (none exist in this scope).
8. **Stale response after clear (D-11).** Use a generation counter.
9. **Cache poisoning across days.** Include the day and the contact id in the key. Never key on the free-form search text.
10. **Prod vs staging Zoho data.** Both likely point at one Zoho org. Verify before treating staging fixtures as safe.
11. **Customer name search "contains" noise.** Contact search is the existing behaviour. Always query invoices by `customer_id`, never by `customer_name`.

## Code Examples

```javascript
// Source: pattern from routes/pos.js:2376 (salesorders) + lib/batch-rules.js:718 (zoneParts)
router.get('/api/kiosk/past-sales/ledger', function (req, res) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
    var today = hist.vancouverDay(new Date());
    var day = req.query.date ? String(req.query.date) : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hist.isRealDate(day)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    var bust = req.query.bust === '1';
    var key = C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX + day;
    var ttl = (day === today) ? 60 : 3600;
    Promise.resolve(bust ? null : cache.get(key).catch(function () { return null; }))
      .then(function (hit) {
        if (hit) return hit;
        return hist.buildLedger(zohoGet, day, today).then(function (fresh) {
          cache.set(key, fresh, ttl).catch(function () {});
          return fresh;
        });
      })
      .then(function (out) { res.json(out); })
      .catch(function (err) {
        log.error('[kiosk/past-sales/ledger] ' + (err && err.message));
        res.status(502).json({ error: 'Unable to fetch sales' });
      });
  });
});
```

```javascript
// Tender mapping (D-14) - pure, unit-tested
var TENDER = { creditcard: 'Card', debitcard: 'Card', cash: 'Cash', others: 'Gift card' };
var ORDER = ['Card', 'Cash', 'Gift card'];
function tenderLabel(payments) {
  var seen = {};
  payments.forEach(function (p) { seen[TENDER[p.payment_mode] || 'Other'] = true; });
  return ORDER.concat(['Other']).filter(function (l) { return seen[l]; }).join(' + ');
}
```

```javascript
// Slim allowlist (D-12): build field by field; never spread the Zoho object
function slimInvoiceRow(inv, source, tender) {
  return {
    invoice_id: String(inv.invoice_id || ''),
    invoice_number: inv.invoice_number || '',
    date: inv.date || '',
    time: hhmmVancouver(inv.created_time),   // '' when absent
    customer_name: inv.customer_name || '',
    source: source,                          // 'in-store' | 'online' | 'other'
    status: statusLabel(inv.status),
    tender: tender || '',
    total: Number(inv.total) || 0,
    balance: Number(inv.balance) || 0
    // NO reference_number, email, notes, custom_fields, payment refs
  };
}
```

## State of the Art

| Old | Current | Impact |
|---|---|---|
| Node 20 / tz 2025c (Vancouver -08:00 in Nov) | Node 24 / tz 2026c on prod since 2026-10-16 | `Intl` Vancouver math is correct; add a unit test under Node 24 |
| `salesorders_to_apply` payments | `invoices:[{invoice_id}]` payments (71-01) | Payments are applied to invoices, so the join by invoice works for all current paths. Old pre-71 SO payments may not be linked. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `GET /customerpayments` list rows include a way to link to invoices (`invoice_numbers` comma string, or `invoices[]`) | Zoho query shapes | The tender join needs per-invoice detail calls (capped) instead. HIGH impact on D-14 design. |
| A2 | The payments list returns the payment notes (as `description`) so rule (b) works | Classifier | SO-pay invoices cannot be told from back-office ones without detail fetches |
| A3 | `GET /customerpayments?date=D` returns all payments for that date and paginates with `page_context.has_more_page` | Zoho query shapes | Ledger tender may be incomplete on busy days |
| A4 | The invoice detail field names are `sub_total`, `tax_total`, `total`, `balance`, `payments[]` | Zoho query shapes | Minor; map with fallbacks. `balance_due` and `line_items` fields are verified in the repo. |
| A5 | Zoho invoice list `created_time` is populated for all rows, including those from `fromsalesorder` | Vancouver day | A row without it falls back to `date`; include a test |
| A6 | Zoho `customer_id` filter works with `date_start/date_end` on the list | Query shapes | Verified by `pos.js:3087` usage, so low risk |
| A7 | Staging and prod hit the same Zoho org | Pitfalls | Affects how safe live spikes are (they are read-only, so low risk) |
| A8 | `KIOSK_CONTACT_ID` is set on staging and prod | Walk-in | If unset, D-09 cannot be enforced server-side |
| A9 | The shop trades after 17:00 local, so the UTC-date issue matters | Day boundaries | If never, `date` bucketing would also work, but `created_time` is still correct |

## Open Questions

1. **Spike S1 (Wave 0, blocking for the ledger tender plan).** Run read-only against staging Zoho via `railway ssh` or a one-off script: `GET /customerpayments?date=<a day with sales>&per_page=5`. Record the exact keys: invoice linkage, `description`/`notes`, `payment_mode`, `created_time`, and whether `date_start` is honored. Save a sanitized fixture to `zoho-middleware/__tests__/fixtures/`. Also fetch one invoice list row and one detail to confirm A4/A5.
2. **Third source label.** What does the owner want for invoices that are neither in-store nor online? Recommendation: "Other" shown as a neutral chip.
3. **Draft status wording.** Show "Draft" or fold it into Unpaid?
4. **Walk-in response shape.** The message is client-side. The server returns `{walk_in:true, invoices:[]}` with 200. Recommend 200 so the client has one success path.
5. **Is a ledger day above 600 invoices realistic?** No. The cap is a safety valve.

## Environment Availability

| Dependency | Required By | Available | Notes |
|---|---|---|---|
| Node 24 | middleware, tz | yes on prod and staging (v24.21.0). Local default may still be 20, so `nvm use` for the tz test | |
| Redis | cache | yes in deployed envs. Tests mock it | |
| Zoho Books API | data | yes | Quota about 1 req/s. Keep calls sequential and bounded. |
| gemini CLI | n/a | broken, not used | |

## Validation Architecture

Nyquist validation is disabled for this project, but test coverage requirements come from CLAUDE.md.

| Property | Value |
|---|---|
| Middleware framework | Jest. Run `cd zoho-middleware && npm test` |
| Frontend framework | Jest + jsdom. `npm test` (root) |
| E2E | Playwright (`npm run test:e2e`), optional |

Middleware test pattern: copy `__tests__/kiosk-salesorders.test.js`. It mocks `../lib/zoho-api`, `../lib/cache`, `../lib/eventLog`, `../lib/logger`, and a fake `express.Router` that records handlers. It calls handlers with `makeReq(body, query, headers)` and `makeRes()`. Auth uses `process.env.MW_API_KEY='test-api-key'` and an `x-api-key` header. For the device tier, set `KIOSK_DEVICE_TOKEN` and send `x-device-token` (see how other tests, e.g. `kiosk-bundles.test.js`, do it).

| Behaviour (decision) | Test |
|---|---|
| 401 with no credential; 403 for a wrong tier; device token allowed (D-10) | route test |
| Classifier: KIOSK- ref, SO-pay by payment note, numeric online ref, blank back-office (D-01, D-07) | lib unit test with a fixture of each |
| Day bucketing by `created_time`; evening UTC rollover (D-02) | lib unit test |
| Void excluded from count/total but returned with status Void (D-03, D-04) | route test |
| Walk-in: no Zoho call, `walk_in:true` (D-09) | route test (assert `zohoGet` not called) |
| Allowlist: response keys equal the exact set; a Zoho fixture with email/notes/custom_fields/reference_number never leaks (D-12) | route test using `Object.keys` equality and a JSON string search for the sentinel strings |
| Tender mapping incl. split, `debitcard`, unknown (D-14) | lib unit test |
| Caps not overridable: `per_page=1000&page=9` ignored (D-16/WR-02) | route test, assert `zohoGet` params |
| Cache hit skips Zoho; `bust=1` skips the read; TTL 60 vs longer; 502 not cached (D-16) | route test |
| Invoice id validation (non-digits -> 400) | route test |
| 502 on Zoho failure | route test |
| `isKioskRoute` membership | authTiers test (see gift-cards-adjust.test.js:362) |
| Frontend: `kioskShowView` away from past-sales clears DOM and memory; late response after clear is dropped; lock screen clears; the view is not reachable in browse-customer (D-11) | `tests/frontend/kiosk-past-sales.test.js`, harness per `kiosk-gift-card-mgmt.test.js` (`loadSurface`) |
| Frontend: escapes names; detail fetched once and cached (D-15); `_kcMergeAuth` sends the device token | same file |
| Existing `kiosk-core-parity` test must stay green; admin surface with no markup does not throw | run the full suite |

Per CLAUDE.md: do not modify existing tests; run `npm test`, `cd zoho-middleware && npm test`, and `npm run lint` before committing (also `npm run build` after the JS changes). A new `lib/` file means running the full middleware suite.

Wave 0 gaps: the S1 fixture file, `__tests__/kiosk-history*.test.js`, and `tests/frontend/kiosk-past-sales.test.js`.

## Security Domain

| ASVS Category | Applies | Control |
|---|---|---|
| V2/V3 Auth/Session | yes | `requireTiers(['legacy','device','session'])` inside each handler (GET skips the global guard) |
| V4 Access Control | yes | Device token reaches only the new kiosk routes; D-46-02 `PII_GET_ROUTES` unchanged; add paths to `KIOSK_ROUTES` |
| V5 Input Validation | yes | Regex-validate `customer_id` (digits), `date` (`YYYY-MM-DD`, real date), `before`, `:id` (digits). Reject, never sanitize. |
| V6 Crypto | no | |
| V8 Data Protection | yes | Field allowlist, no `reference_number`/txn ids/notes/email/phone/address; no PII in logs (T-29.1-03: log ids and counts, never names) |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Stolen device token enumerates customer purchase history | Information disclosure | Accepted risk, same posture as `/api/kiosk/salesorders` (already lists names and line items). Keep it read-only and capped. Note it in the threat model. Consider staff-session-only for details as a stricter option. |
| Request overrides caps (`per_page`, `page`, window size) | DoS / quota exhaustion | Hard-coded server constants. Ignore those params. Bound `before` to a sane range. |
| Zoho path injection via `:id` or `customer_id` | Tampering | Digits-only validation before interpolation |
| Customer data left on screen for the next customer | Information disclosure | D-11 clearing at the `kioskShowView` choke point, lock, new-sale; generation counter |
| Cache key from free-form input | Cache poisoning | Keys built only from validated ids and dates |
| XSS via customer names or item names in innerHTML | Tampering | `escapeHTML` on every dynamic string |
| Quota exhaustion by refresh spam | DoS | Sequential calls; `bust=1` still bounded to the capped query; consider a short per-key lock |
| Walk-in contact bypass by name search | Info disclosure | Server compares `customer_id` to `KIOSK_CONTACT_ID` |

## Sources

### Primary (HIGH confidence)
- Codebase, read directly:
  - `zoho-middleware/routes/pos.js` (1414-1770, 2170-2240, 2363-2452, 2660-2760, 3006-3140, 3235-3275, 3771-3810, 4708-4750)
  - `routes/pos-recipe.js` (1355-1460), `routes/checkout.js` (520-720), `routes/webhooks.js` (255-285)
  - `lib/money-path.js` (260-420), `lib/authTiers.js`, `lib/zoho-api.js`, `lib/constants.js`, `lib/reconcile.js`, `lib/batch-rules.js` (705-732)
  - `server.js` (430-500, 728-790)
  - `kiosk.html` (17, 60-110, 370-420), `js/kiosk-core.js` (105-135, 935-960, 2735-2800, 2948, 3250, 4240-4270, 6120-6140), `js/kiosk.js` (205-240, 735-760, 1485-1580), `package.json`
  - `__tests__/kiosk-salesorders.test.js`, `tests/frontend/kiosk-core-parity.test.js`, `tests/frontend/kiosk-gift-card-mgmt.test.js`
- Memory: `node-tzdata-bc-permanent-time.md`

### Secondary (MEDIUM confidence)
- [Zoho Books API v3, Invoices (List invoices)](https://www.zoho.com/books/api/v3/invoices/): query params and the list row example, fetched 2026-10-16.
- [Zoho Books API v3, Customer Payments (List)](https://www.zoho.com/books/api/v3/customer-payments/): documented filters. The list example is sparse and its row shape cannot be trusted for the join (see S1).

### Tertiary (LOW confidence)
- Invoice detail field names beyond those the repo already reads (A4). Training knowledge.

## Metadata

**Confidence breakdown:**
- Standard stack and patterns: HIGH (verified in code)
- Classifier: MEDIUM-HIGH (creation paths verified; the payments-list notes field is unverified)
- Zoho payments join: LOW-MEDIUM until Spike S1
- Frontend hooks: HIGH
- Pitfalls: HIGH

**Research date:** 2026-10-16
**Valid until:** about 30 days, or until the S1 spike result changes the join design

## Suggested requirement IDs (derived from CONTEXT)

PS-LEDGER-01 (D-01, D-02, D-03, D-04), PS-CUST-01 (D-05 to D-09), PS-AUTH-01 (D-10, D-12, D-13), PS-ISOLATE-01 (D-11), PS-TENDER-01 (D-14), PS-DETAIL-01 (D-15), PS-CACHE-01 (D-16).
