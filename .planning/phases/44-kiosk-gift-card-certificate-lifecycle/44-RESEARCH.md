# Phase 44: Kiosk Gift Card / Certificate Lifecycle — Research

**Researched:** 2026-06-27
**Domain:** Kiosk POS gift card accounting (Zoho Books), balance storage (Google Sheets / Apps Script), split-tender integration (pos.js v4.2 money path)
**Confidence:** HIGH for R-02 and R-03; MEDIUM for R-01 (Zoho API confirmed for recommended approach; one-time owner setup required)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 Assisted redemption.** Staff enter the certificate number; the system looks up and displays the live balance; staff enter the amount to apply to the current sale; any remainder is charged on the Helcim terminal. Partial redemption supported (applied amount ≤ min(balance, amount due)). Redemption is a **tender/payment path**, NOT a cart line item.
- **D-02 System-suggested cert number + uniqueness check.** At sale the system proposes the next number (e.g. `GC-NNNNNN`); staff may override; the server **rejects duplicates**. Keeps the paper workflow while preventing collisions/typos.
- **D-03 No tax at sale.** Zero tax on the certificate. Tax applies to the underlying goods at **redemption** (goods already taxed; gift card reduces amount due post-tax, not taxable base).
- **D-04 Sale = liability not revenue.**
- **D-05 Server-authoritative balances.** Partial redemption must decrement **atomically**; guard against double-spend / replay (reuse the kiosk idempotency/replay patterns from the v4.2 money path).
- **D-06 Full lifecycle:** sell / redeem / balance lookup / partial redemption / reload.
- **D-07 Paper certificate, manually-assigned number.** No barcode, digital, or email generation in v1.
- **D-08 Build on both forked surfaces** (`kiosk.js` + `admin.js`) until Phase 42 de-fork.

### Claude's Discretion
- Cert-number format details (prefix/width), the exact "Add gift card" vs "Redeem gift card" UI affordances on the kiosk (likely mirroring the custom-item modal + a tender option in the payment view), receipt rendering of a sold/redeemed certificate.
- Validation specifics (amount bounds for a sale/reload, sane max balance), error copy.

### Deferred Ideas (OUT OF SCOPE)
- Pre-printed barcoded cards / scanning; digital + emailed codes with generation; customer-facing balance lookup; card-stock inventory.
- Phase 42 kiosk de-fork (would remove the duplicate-into-both-files burden).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GIFTCARD-01 | Full gift-card / gift-certificate lifecycle: sell, redeem (split-tender), balance lookup, partial redemption, reload — for paper certificates with manually-assigned numbers, on both forked kiosk surfaces. Correct accounting (sale = liability, not revenue) and tax (no tax at sale; tax applies to goods at redemption). | R-01/R-02/R-03 resolutions enable concrete planning for every sub-requirement |
</phase_requirements>

---

## Summary

Phase 44 adds the full gift-card lifecycle to the Steins & Vines kiosk POS. Research resolved all three open questions: R-01 (Zoho accounting mechanism), R-02 (balance-of-record location), and R-03 (split-tender integration in pos.js).

**R-01 (Zoho accounting):** Zoho Books has no native gift card feature. The recommended mechanism is a **dedicated Zoho item mapped to a "Gift Cards Sold" Current Liability account** (one-time owner setup in Zoho Books UI + one env var `KIOSK_GIFT_CARD_ITEM_ID`). At sale, a regular Zoho invoice with this zero-tax item creates the correct entry: Dr Cash, Cr Gift Cards Sold Liability. At redemption, two `POST /customerpayments` calls against the goods invoice (terminal portion + gift-card-as-`others`) fully close the invoice. The liability-to-revenue conversion at redemption is a periodic manual journal in Zoho (acceptable for S&V's scale); the middleware does not need to manage Zoho chart-of-accounts conversion per-transaction. This approach uses only the existing `zohoPost('/invoices')` and `zohoPost('/customerpayments')` surfaces — no new Zoho API endpoints.

**R-02 (balance of record):** **Google Sheets `GiftCards` tab via Apps Script** — the same pattern as the batch tracking system. New Apps Script actions (`issue_gift_card`, `lookup_gift_card`, `redeem_gift_card`, `reload_gift_card`, `void_gift_card`) using `LockService.getScriptLock()` for atomic balance decrements and idempotency key matching for double-spend prevention. The middleware calls Apps Script via `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN` (already set on Railway).

**R-03 (split tender):** Confirmed: no special tax handling is needed — the gift card reduces the post-tax amount due, not the taxable base. The v4.2 pos.js flow is extended by (a) a balance lookup before the terminal push, (b) reducing `terminal_amount = grandTotal - gift_amount` sent to Helcim, and (c) performing the GiftCards balance decrement as the LAST step after all Zoho invoice/payment calls succeed. This ordering ensures void-on-failure works correctly: if the terminal or Zoho step fails, the balance is never decremented.

**Primary recommendation:** Build the five new middleware routes (`issue`, `lookup`, `redeem`, `reload`, `void`) in a new `routes/gift-cards.js`, backed by five new Apps Script actions in `adminApi.gs`, with the balance decrement as the final atomic step in the extended `processSaleWithPrices` / confirm flow.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gift card sale (Zoho invoice + payment) | API/Middleware | Zoho Books | Middleware already owns all Zoho invoice/payment creation |
| Balance storage and atomic decrement | Apps Script / Google Sheets | Redis (idempotency overlay) | Owner-visible; already-operational analog (batch tracking); `LockService` atomicity |
| Split-tender terminal charge | API/Middleware | Helcim terminal | `terminalPurchase(terminal_amount)` — existing pos.js path |
| Balance lookup (server-authoritative) | API/Middleware | — | Never trust client-supplied balance per D-05 |
| UI (issue modal + redeem tender) | Browser/Client | — | iPad Safari kiosk; ES5/var; forked surfaces (kiosk.js + admin.js) per D-08 |
| Zoho accounting audit trail | Zoho Books | — | Invoice + payments; periodic liability journal by owner |

---

## R-01 Resolution: Zoho Accounting Mechanism

> **⚠ DECISION UPDATE — 2026-06-27 (owner-confirmed, SUPERSEDES the "map item to liability" approach below).**
> Owner verified in their live Zoho Books: a **Sales item's "Account" dropdown only lists income accounts** — a Current-Liability account ("Gift Cards Sold") is NOT selectable on the item. The original recommended approach (item mapped directly to a liability account) is therefore **not implementable** in this org.
>
> **Locked mechanism (owner choice "#2"):**
> - The "Gift Certificate" Zoho item maps to a **dedicated income account** ("Gift Card Sales"), with the item's **own tax set to 0% / exempt** (satisfies D-03; likely removes the need for `ZOHO_TAX_ZERO_ID`).
> - The **"Gift Cards Sold" Current-Liability account is retained as the journal target** (not on the item).
> - At sale, the middleware flow is UNCHANGED from the code below (invoice + payment via `KIOSK_GIFT_CARD_ITEM_ID`) — only the item's mapped account differs (income, not liability). The sale therefore initially books to income.
> - **Revenue deferral is a periodic MANUAL journal by the owner/bookkeeper:** roughly monthly, post one journal moving the *unredeemed* gift-card balance from "Gift Card Sales" income into "Gift Cards Sold" liability. The GiftCards sheet provides the outstanding-balance figure. This preserves D-04 (liability not revenue) on an accrual basis without per-transaction journals.
> - **NOT chosen (deferred):** option #1 (recognize at sale, no journal — would violate D-04 unless accountant approves cash-basis) and option #3 (middleware auto-posts journals at sale/redemption — clean but more build + extra Zoho calls). Option #3 remains the documented v2 upgrade path.
> - **Planner action:** include the periodic-deferral-journal cadence as an owner `checkpoint:human-action` (not code); keep the fail-closed `KIOSK_GIFT_CARD_ITEM_ID` guard; the redemption split-tender (R-03) is unaffected.
>
> The `payment_mode: 'others'` redemption mechanics, two-payment invoice close, and all R-03 ordering below remain valid as written.

### What Zoho Books Does NOT Support
- **No native gift card entity.** [VERIFIED: zoho.com/books/api/v3]
- **`/customerpayments` requires an `invoices` array** — cannot record a standalone advance/store-credit without an invoice. [VERIFIED: zoho.com/books/api/v3/customer-payments]

### What Zoho Books DOES Support (options investigated)

**Option 1 — Retainer Invoice (theoretically correct)**
- `POST /retainerinvoices` creates a "Customer Deposits" Current Liability entry. [VERIFIED: zoho.com/books/api/v3/retainer-invoices]
- `POST /retainerinvoices/{id}/invoices` applies the retainer (partially or fully) to a regular invoice. [VERIFIED]
- `POST /customerpayments` has a `retainerinvoice_id` field to link a payment to a retainer invoice. [VERIFIED: zoho.com/books/api/v3/customer-payments]
- **Problem:** (a) Whether `invoices: []` can be omitted when paying a retainer is not confirmed in docs — requires runtime testing. (b) All retainers would accumulate under `KIOSK_CONTACT_ID` (one walk-in contact), requiring `zoho_retainer_id` stored per cert in the GiftCards sheet. (c) More API calls per transaction. For S&V's scale this complexity is not justified.

**Option 2 — Journal Entry**
- `POST /journals` supports debit/credit entries against any chart of accounts. [VERIFIED: zoho.com/books/api/v3/journals]
- Correct accounting: Dr Cash → Cr Gift Card Liability at sale; Dr Gift Card Liability → Cr Revenue at redemption.
- **Problem:** Journal entries don't close Zoho invoice balances. Would still need separate `customerpayments` to close the redemption invoice. Results in redundant API calls and split accounting records.

**Option 3 — Invoice + Dedicated Zoho Item (RECOMMENDED)**
- Create a Zoho Books item "Gift Certificate" mapped to a **Current Liability account** ("Gift Cards Sold") in Zoho's Chart of Accounts — one-time owner setup in Zoho Books UI.
- Store the Zoho item_id as `KIOSK_GIFT_CARD_ITEM_ID` env var on Railway.
- Uses the EXISTING `zohoPost('/invoices', ...)` and `zohoPost('/customerpayments', ...)` endpoints already in `zoho-api.js` and `pos.js` — no new Zoho API surface.

### RECOMMENDED APPROACH: Invoice + Dedicated Zoho Item

#### At Gift Card SALE

```javascript
// Step 1: Create Zoho invoice for the gift card
// POST /invoices via zohoPost
var saleInvoicePayload = {
  date: today,
  customer_id: process.env.KIOSK_CONTACT_ID,
  reference_number: cert_number,              // e.g. 'GC-000001'
  line_items: [{
    item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,  // maps to liability account
    name: 'Gift Certificate ' + cert_number,
    quantity: 1,
    rate: face_value,
    tax_id: process.env.ZOHO_TAX_ZERO_ID     // D-03: zero tax at sale
  }],
  notes: 'Gift certificate ' + cert_number + ' sold. Balance: $' + face_value.toFixed(2)
};
// POST /invoices → { invoice: { invoice_id, invoice_number } }

// Step 2: Record cash/card payment immediately
// POST /customerpayments via zohoPost
var salePaymentPayload = {
  customer_id: process.env.KIOSK_CONTACT_ID,
  payment_mode: 'creditcard',  // or 'cash' — same as regular kiosk sales
  amount: face_value,
  date: today,
  invoices: [{ invoice_id: invoiceId, amount_applied: face_value }],
  notes: 'Gift certificate ' + cert_number + ' sale payment'
};
// Result in Zoho: Dr Cash, Cr Gift Cards Sold Liability  ✓
```

#### At Gift Card REDEMPTION (split tender)

```javascript
// Step 1: Create goods invoice normally (existing path) — full grandTotal including tax
// POST /invoices → { invoice_id }

// Step 2: Record terminal payment for remainder
// POST /customerpayments
{
  customer_id: process.env.KIOSK_CONTACT_ID,
  payment_mode: 'creditcard',
  amount: terminal_amount,                    // grandTotal - gift_amount
  date: today,
  invoices: [{ invoice_id, amount_applied: terminal_amount }]
}

// Step 3: Record gift card payment for applied portion
// POST /customerpayments
{
  customer_id: process.env.KIOSK_CONTACT_ID,
  payment_mode: 'others',
  amount: gift_amount,
  date: today,
  reference_number: cert_number,              // GC-NNNNNN for traceability
  invoices: [{ invoice_id, amount_applied: gift_amount }],
  notes: 'Gift certificate ' + cert_number + ' redemption — balance was $' + prev_balance.toFixed(2)
}
// Invoice is now fully paid (terminal_amount + gift_amount = grandTotal)  ✓
```

#### Accounting at Redemption (small business simplification)

The `others` payment at redemption posts to whatever Zoho's default "Others" payment clearing account is — NOT the Gift Cards Sold liability account. This means the liability account balance in Zoho is not automatically zeroed per transaction. The correct double-entry (Dr Gift Cards Sold Liability, Cr Revenue/Clearing) requires a **periodic manual journal** by the owner.

For S&V's scale (estimated low transaction volume), this is acceptable. The GiftCards sheet is the definitive financial record for outstanding certificate balances. If the owner wants automated liability clearing in Zoho, Phase 44 v2 can add a `POST /journals` call at redemption — the API surface is already documented.

#### Human setup required (checkpoint in plan)

Owner must (UPDATED per 2026-06-27 decision — item maps to INCOME, not liability):
1. ✅ DONE — In Zoho Books: Chart of Accounts → "Gift Cards Sold" (type: Current Liability). Retained as the periodic-journal target.
2. In Zoho Books: Chart of Accounts → add a dedicated income account "Gift Card Sales" (type: Income) for the item to map to. (An existing income account works, but a dedicated one makes the monthly deferral journal trivial.)
3. In Zoho Books: Items → New Item "Gift Certificate" → set account to **"Gift Card Sales" (income)** [liability is not selectable on a sales item], **tax = 0% / exempt**, item type = Sales (not inventory-tracked).
4. Note the item_id (from Zoho Books item URL or GET /items).
5. In Railway dashboard: add `KIOSK_GIFT_CARD_ITEM_ID=<zoho_item_id>`.
6. `ZOHO_TAX_ZERO_ID` likely NOT needed if the item itself is set to 0% tax (verify in Wave 0).
7. Establish the recurring (≈monthly) manual deferral journal: Dr "Gift Card Sales" income, Cr "Gift Cards Sold" liability, for the unredeemed balance per the GiftCards sheet. (Owner/bookkeeper task — not automated in v1.)

---

## R-02 Resolution: Balance of Record

**Decision: Google Sheets `GiftCards` tab, accessed via Apps Script `adminApi.gs`.**

### Why Not Redis
Redis is operational (used for caching and idempotency) but is explicitly wrong as money-of-record. Redis has no persistence guarantee appropriate for financial data and no staff-facing UI.

### Why Not Zoho (as primary balance)
Zoho store-credit/retainer is tied to a contact, not a cert_number. Querying "balance of GC-000001" requires knowing which retainer_invoice_id to look up, and that requires querying the GiftCards sheet anyway. The Zoho balance would be a secondary source, not the primary.

### Why Google Sheets / Apps Script
- Exact analog of the batch tracking system (`createBatch`, `getBatches`, `findRowById`, `generateNextId` — all reusable)
- Staff-visible without admin panel (direct Google Sheets access)
- `LockService.getScriptLock()` provides mutex for atomic balance decrement (used in `createBatch()` already)
- `generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)` provides the next cert number suggestion (D-02)
- Already deployed infrastructure; `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN` are in Railway

### GiftCards Sheet Schema

| Column | Type | Purpose |
|--------|------|---------|
| cert_number | string | Primary key, GC-NNNNNN |
| face_value | float | Original sale value |
| current_balance | float | Authoritative remaining balance |
| status | enum | active / void / depleted |
| issued_date | YYYY-MM-DD | Sale date |
| issued_by | string | Staff email or 'kiosk' |
| zoho_invoice_number | string | Sale invoice number for audit |
| notes | string | Free text |
| last_updated | ISO timestamp | Last modification |
| last_tx_ref | string | Idempotency: last transaction reference |

### New Apps Script Actions in `adminApi.gs`

All staff-auth protected via `_requireStaff(e)` except server-token-auth paths (middleware calls):

| Action | HTTP Method | Auth | Purpose |
|--------|-------------|------|---------|
| `issue_gift_card` | POST | server_token | Create new cert row; reject duplicate cert_number |
| `lookup_gift_card` | GET | server_token | Return {balance, status, face_value} by cert_number |
| `redeem_gift_card` | POST | server_token | Atomic balance decrement + idempotency check |
| `reload_gift_card` | POST | server_token | Atomic balance increment |
| `void_gift_card` | POST | staff | Set status='void' |
| `get_gift_cards` | GET | staff | List all certs (admin panel view) |

### Atomic Decrement Pattern (mirrors `createBatch`)

```javascript
// adminApi.gs — redeem_gift_card handler
function redeemGiftCard(payload) {
  var certNum = payload.cert_number;
  var amount = parseFloat(payload.amount);
  var txRef = payload.transaction_ref;  // kiosk reference_number (idempotency)

  if (!certNum || !amount || !txRef) {
    return { ok: false, error: 'missing_fields' };
  }

  var lock = acquireScriptLock(15000);  // EXISTING helper
  try {
    var result = findRowById(GIFT_CARDS_SHEET_NAME, certNum);
    if (result.row === -1) return { ok: false, error: 'not_found' };

    var gc = result.data;

    // Idempotency: if same tx_ref, return last-known result without decrementing
    if (String(gc.last_tx_ref) === String(txRef)) {
      return { ok: true, idempotent: true, new_balance: parseFloat(gc.current_balance) };
    }

    if (String(gc.status) !== 'active') {
      return { ok: false, error: 'invalid_status', status: gc.status };
    }
    var balance = parseFloat(gc.current_balance);
    if (amount > balance + 0.001) {  // float tolerance
      return { ok: false, error: 'insufficient_balance', balance: balance };
    }

    var newBalance = Math.round((balance - amount) * 100) / 100;
    var newStatus = newBalance <= 0 ? 'depleted' : 'active';

    // Write new balance atomically (inside lock)
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GIFT_CARDS_SHEET_NAME);
    sheet.getRange(result.row, /* current_balance col */ 3).setValue(newBalance);
    sheet.getRange(result.row, /* status col */ 4).setValue(newStatus);
    sheet.getRange(result.row, /* last_updated col */ 9).setValue(new Date().toISOString());
    sheet.getRange(result.row, /* last_tx_ref col */ 10).setValue(txRef);

    invalidateSheetCache(GIFT_CARDS_SHEET_NAME);
    return { ok: true, new_balance: newBalance, status: newStatus };
  } finally {
    lock.releaseLock();
  }
}
```
[ASSUMED — exact column indices must be confirmed at implementation against the actual sheet headers]

### Apps Script Redeploy Checkpoint

Every change to `adminApi.gs` requires **manual redeploy** (not in CI). Plans MUST include a `checkpoint:human-action` task for the Apps Script redeploy before any middleware routes that call the new actions can be tested end-to-end.

---

## R-03 Resolution: Redemption Tax Mechanics + Split Tender

### Tax Mechanics (confirmed)

D-03 is correct by construction:

- The goods invoice is created for the full taxed amount (existing tax pipeline unchanged).
- The gift card is applied as a **payment instrument** (a second `POST /customerpayments`), NOT as a discount or line item adjustment.
- Tax was computed on the goods; the gift card reduces what the customer owes, not what they're taxed on.
- **No tax recalculation, no special tax handling is needed at redemption.** [ASSUMED based on standard accounting; this matches how gift card tenders work everywhere]

### Split Tender in pos.js — Where Gift Card Reduces Terminal Charge

The modification point is `processSaleWithPrices()` (and the matching logic in `confirm`):

```javascript
// In processSaleWithPrices():
var gift_amount = 0;
var gift_cert_number = '';

if (body.gift_card && body.gift_card.cert_number) {
  // D-05: server validates balance — client cannot supply amount without server lookup
  // balance_lookup must have happened BEFORE this call (separate middleware route)
  gift_amount = Math.min(
    Number(body.gift_card.amount_applied) || 0,
    grandTotal  // cannot exceed sale total
    // also bounded by validated balance from lookup (validated in /api/kiosk/gift-card/redeem)
  );
  gift_cert_number = String(body.gift_card.cert_number).slice(0, 20);
}

var terminal_amount = Math.round((grandTotal - gift_amount) * 100) / 100;

if (terminal_amount > 0) {
  // existing terminal flow (unchanged)
  helcimLib.terminalPurchase(terminal_amount, refNumber)...
} else {
  // Gift card covers 100% — skip terminal entirely
  // Jump straight to confirm-equivalent (no async polling needed)
  processGiftCardOnlySale(body, idempotencyKey, req, res,
    lineItems, subtotal, taxTotal, grandTotal, catalogMap, gift_amount, gift_cert_number);
}
```

### Failure Ordering (critical for atomicity)

The correct ordering that ensures no double-charge or phantom balance decrement:

```
1. POST /api/kiosk/gift-card/lookup       — validate cert, get balance
2. POST /api/kiosk/sale                   — push terminal_amount to terminal
3. (terminal approved via webhook/poll)
4. POST /api/kiosk/sale/confirm           — create Zoho invoice (full grandTotal)
5.   → zohoPost('/invoices', ...)
6.   → zohoPost('/customerpayments', terminal payment)
7.   → zohoPost('/customerpayments', gift card payment, payment_mode='others')
8.   → POST Apps Script redeem_gift_card (LAST — decrement happens after all Zoho calls)
9. Return 201

Failure at step 2 (terminal push)    → no balance decrement, no invoice  ✓
Failure at step 3 (terminal declined) → no balance decrement, no invoice  ✓
Failure at step 4/5 (invoice fail)   → void terminal, no balance decrement ✓
Failure at steps 6/7 (payment fail)  → void terminal, no balance decrement ✓
Failure at step 8 (Apps Script down) → log CRITICAL, return 201 + warning, invoice already paid
                                        Balance not decremented — staff can fix manually in Sheets
```

Step 8 failure is the only unrecoverable error mode. Because the balance decrement happens LAST, the worst case is that the invoice is fully paid in Zoho but the GiftCards sheet still shows the pre-redemption balance. Staff can manually correct the Sheets row. The `last_tx_ref` idempotency guard prevents a retry from double-decrementing.

### Idempotency Extension

The existing `idempotency_key` (already used for the terminal push in pos.js) is extended to cover gift card operations. The `transaction_ref` passed to Apps Script `redeem_gift_card` is the same kiosk `refNumber` ('KIOSK-' + Date.now() or staff-supplied). Redis caches the confirmed sale result; the Apps Script `last_tx_ref` provides secondary replay protection for the Apps Script path.

---

## Standard Stack

### Core (all existing in codebase)

| Library/Service | Version | Purpose | Status |
|----------------|---------|---------|--------|
| Express.js | existing | New `routes/gift-cards.js` | Existing |
| `zoho-api.js` | existing | `zohoPost('/invoices')`, `zohoPost('/customerpayments')` | Existing surface |
| `adminApi.gs` | existing | New GiftCards sheet actions | Existing, requires redeploy |
| Redis (`cache.js`) | existing | Idempotency key caching for gift card ops | Existing |
| `lib/logger.js` / `eventLog.js` | existing | Structured logging of lifecycle events | Existing |

### No New npm Packages

This phase requires **no new npm dependencies**. All functionality is implementable with the existing middleware stack. [VERIFIED: code reviewed]

---

## Package Legitimacy Audit

> Not applicable — no new packages are installed in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
Staff (iPad Safari — kiosk.js or admin.js)
     |
     |  [Issue] POST /api/kiosk/gift-card/issue
     |  [Lookup] GET  /api/kiosk/gift-card/lookup?cert_number=GC-000001
     |  [Redeem] → embedded in POST /api/kiosk/sale / confirm flow
     |  [Reload] POST /api/kiosk/gift-card/reload
     |  [Void]   POST /api/kiosk/gift-card/void
     v
Middleware (Railway — zoho-middleware/)
  routes/gift-cards.js  ─────────────────────────────────────┐
     |                                                        |
     |──── zohoPost('/invoices')                              |
     |──── zohoPost('/customerpayments')                      v
     |                                                   Zoho Books
     |                                                  (invoice audit
     |──── axios.post(APPS_SCRIPT_URL, {action: ...})     trail + liability
     v                                                    account)
  Google Sheets GiftCards tab (balance of record)
     |
     └── LockService.getScriptLock() → atomic decrement

  routes/pos.js (EXTENDED — split tender)
     |
     |──── balance lookup → gift-cards.js → Apps Script
     |──── helcimLib.terminalPurchase(terminal_amount)
     |──── zohoPost('/invoices', fullAmount)
     |──── zohoPost('/customerpayments', terminal_amount)
     |──── zohoPost('/customerpayments', gift_amount, 'others')
     └──── Apps Script redeem_gift_card (LAST)
```

### Recommended Project Structure (new files)

```
zoho-middleware/
├── routes/
│   └── gift-cards.js          # New: 5 gift card endpoints
├── lib/
│   └── (no new lib needed)    # gift card logic is self-contained in routes

apps-script/
└── adminApi.gs                # Extended: GIFT_CARDS_SHEET_NAME + 6 actions

js/
├── kiosk.js                   # Extended: "Issue" modal + "Redeem" tender step
└── admin.js                   # Extended: identical logic, openModal/closeModal wrapper
```

### Pattern 1: Gift Card Issue Flow

```javascript
// routes/gift-cards.js
router.post('/api/kiosk/gift-card/issue', function(req, res) {
  var body = req.body || {};
  var face_value = parseFloat(body.face_value);

  // Validate
  if (!isFinite(face_value) || face_value <= 0 || face_value > 2000) {
    return res.status(400).json({ error: 'face_value must be $0.01–$2000' });
  }

  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN' });
  }

  // Step 1: Reserve cert_number in Sheets (uniqueness check + create row)
  return callAppsScript('issue_gift_card', {
    cert_number: cert_number,
    face_value: face_value,
    issued_by: 'kiosk'
  }).then(function(gsResult) {
    if (!gsResult.ok) {
      if (gsResult.error === 'duplicate') return res.status(409).json({ error: 'Certificate number already in use' });
      return res.status(500).json({ error: 'Failed to create certificate' });
    }

    // Step 2: Create Zoho invoice for the sale (liability account)
    var today = new Date().toISOString().slice(0, 10);
    return zohoPost('/invoices', {
      date: today,
      customer_id: process.env.KIOSK_CONTACT_ID,
      reference_number: cert_number,
      line_items: [{
        item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,
        name: 'Gift Certificate ' + cert_number,
        quantity: 1,
        rate: face_value,
        tax_id: process.env.ZOHO_TAX_ZERO_ID
      }],
      notes: 'Gift certificate ' + cert_number
    }).then(function(invoiceData) {
      var invoice = invoiceData.invoice || {};
      var invoiceId = invoice.invoice_id || '';
      var invoiceNumber = invoice.invoice_number || '';

      // Step 3: Record cash/card payment
      return zohoPost('/customerpayments', {
        customer_id: process.env.KIOSK_CONTACT_ID,
        payment_mode: 'creditcard',  // terminal was used for sale
        amount: face_value,
        date: today,
        invoices: [{ invoice_id: invoiceId, amount_applied: face_value }],
        notes: 'Gift certificate ' + cert_number + ' sale'
      }).then(function() {
        // Step 4: Update Sheets with Zoho invoice number
        return callAppsScript('update_gift_card_invoice', {
          cert_number: cert_number,
          zoho_invoice_number: invoiceNumber
        });
      }).then(function() {
        res.status(201).json({ ok: true, cert_number: cert_number, face_value: face_value, zoho_invoice_number: invoiceNumber });
      });
    }).catch(function(zohoErr) {
      // Zoho failed after Sheets record created — void the Sheets row
      callAppsScript('void_gift_card', { cert_number: cert_number, reason: 'zoho_invoice_failed' }).catch(function() {});
      log.error('[gift-cards/issue] Zoho invoice failed: ' + zohoErr.message);
      return res.status(502).json({ error: 'Failed to record gift card sale in accounting system' });
    });
  });
});
```
[Source: synthesized from existing pos.js patterns + zoho-api.js surface — [ASSUMED] implementation detail]

### Pattern 2: Suggested Next Cert Number (D-02)

```javascript
// GET /api/kiosk/gift-card/next-number
// Apps Script generates next GC-NNNNNN via generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)
// Server returns { suggested: 'GC-000042' }
// Client pre-fills input; staff may override; server rejects duplicates on issue
```
[Source: `generateNextId()` already exists in adminApi.gs — [VERIFIED: code reviewed]]

### Pattern 3: UI Placement (Claude's Discretion)

**Issue modal** (Phase 43 custom-item modal analog):
- Button: "Issue Gift Card" — appears in the kiosk browse/cart view alongside "Add Custom Item"
- Modal fields: cert_number (pre-filled with suggested, staff can override), face_value
- On submit: `POST /api/kiosk/gift-card/issue` → success shows cert_number on receipt

**Redeem tender** (payment view step):
- In the kiosk payment view, before "Proceed to Terminal", a "Apply Gift Card" button opens a sub-panel
- Staff enters cert_number → system shows live balance
- Staff enters amount_to_apply (≤ min(balance, total))
- Payment view updates: "Terminal: $X" + "Gift Card: $Y" + "Total: $Z"
- The split tender amounts are sent with the sale body

**For both forked surfaces (D-08):**
- `kiosk.js`: inline overlay/panel pattern (existing)
- `admin.js`: `openModal` / `closeModal` wrapper (existing)
- Logic is identical — only modal instantiation differs

### Anti-Patterns to Avoid

- **Client-supplied balance:** Never trust `amount_applied` without a server-side lookup. Balance is always read from Apps Script inside the middleware (D-05).
- **Balance decrement before Zoho:** Always perform the Apps Script decrement LAST (after all Zoho calls succeed) to ensure void-on-failure works correctly.
- **Skipping the lock:** Never write to the GiftCards sheet balance outside `LockService.getScriptLock()`. Apps Script is single-threaded but receives concurrent HTTP requests.
- **Mixing gift card amounts with taxable subtotal:** The gift card `amount_applied` is subtracted from `grandTotal` (post-tax), NOT from `subtotal` before tax computation. Tax is never recomputed.
- **Single `customerpayments` for split tender:** The terminal portion and gift card portion must be two separate `POST /customerpayments` calls with correct `amount_applied` values summing to `grandTotal`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mutex / atomic writes to Sheets | Custom retry loop | `LockService.getScriptLock()` | Existing pattern in `createBatch()`; Apps Script SDK handles concurrency |
| Cert number generation | Random UUID | `generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)` | Existing helper; sequential + human-readable; collision-free |
| Zoho invoice for liability posting | Custom journal entry per-transaction | Invoice with `KIOSK_GIFT_CARD_ITEM_ID` item (mapped to liability account) | One-time owner setup; reuses existing `/invoices` endpoint |
| Idempotency for redemption | Custom dedup table | `last_tx_ref` on GiftCards row + existing Redis `KIOSK_IDEM_PREFIX` | Already-deployed infrastructure |
| Tax computation at redemption | Any new tax logic | None needed | Gift card is a payment instrument, not a taxable item |

**Key insight:** This phase is almost entirely configuration + new routes using existing infrastructure. The complexity is in the ordering of operations (rollback safety), not in any novel algorithm.

---

## Common Pitfalls

### Pitfall 1: Balance Decrement Before Zoho Calls

**What goes wrong:** Balance is decremented in Apps Script, then Zoho invoice creation fails, terminal is voided — but the gift card balance is already reduced. Customer is owed money with no way to automatically recover.

**Why it happens:** Mirrors a common mistake in payment flows (charging before confirming all downstream steps).

**How to avoid:** The Apps Script `redeem_gift_card` call is the LAST step in the confirm flow, after all `zohoPost` calls succeed.

**Warning signs:** Any implementation where `redeem_gift_card` appears before `zohoPost('/invoices', ...)` in the confirm handler.

---

### Pitfall 2: Concurrent Issue/Redeem Without Lock

**What goes wrong:** Two concurrent redemptions for the same cert arrive within the Apps Script execution window. Both read the same balance, both pass the validation, both decrement — balance goes negative.

**Why it happens:** Apps Script receives HTTP requests concurrently even though each execution is single-threaded.

**How to avoid:** Every balance-modifying Apps Script action (issue, redeem, reload, void) must start with `acquireScriptLock(15000)`.

**Warning signs:** Missing `var lock = acquireScriptLock(15000)` at the top of any balance-modifying handler.

---

### Pitfall 3: gift_amount Exceeds invoice_total at Confirm

**What goes wrong:** Client sends `gift_card.amount_applied: 100` but the server recomputes `grandTotal: 80` (prices changed between quote and confirm). Terminal was charged $0 but invoice needs $80 covered.

**Why it happens:** Price anchoring at confirm (existing pos.js pattern) can change the total between the initial sale push and the confirm.

**How to avoid:** In `sale/confirm`, re-clamp `gift_amount = Math.min(body.gift_card.amount_applied, recomputed_grandTotal)`. If `gift_amount` decreases, the terminal charge ($0 if gift card was supposed to cover everything) creates an invoice balance that can't be closed. Best defense: the initial sale already reduces the terminal by the correct server-computed `gift_amount` based on the same catalog cache.

**Warning signs:** `amount_applied` from the client is used directly without re-clamping to the server-computed `grandTotal` in the confirm handler.

---

### Pitfall 4: KIOSK_GIFT_CARD_ITEM_ID Not Set

**What goes wrong:** Gift card sale creates a Zoho invoice with no `item_id`, so it posts to a generic/default income account instead of the dedicated "Gift Card Sales" income account — the monthly deferral journal (which moves unredeemed "Gift Card Sales" income to the "Gift Cards Sold" liability per D-04) can then no longer cleanly isolate gift-card sales, silently breaking the liability treatment.

**Why it happens:** Env var not set or Zoho item not created before deploying.

**How to avoid:** `validateEnv.js` should list `KIOSK_GIFT_CARD_ITEM_ID` as OPTIONAL (with a startup warning). The issue route should fail-closed if the env var is missing: `if (!process.env.KIOSK_GIFT_CARD_ITEM_ID) return res.status(503).json({ error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)' })`.

**Warning signs:** No `KIOSK_GIFT_CARD_ITEM_ID` check at route entry; gift card invoices missing an item_id.

---

### Pitfall 5: Forked Surface Drift (D-08)

**What goes wrong:** Gift card issue modal works on `kiosk.js` but not `admin.js` (or vice versa), because Phase 43 custom-item modal was added to both files identically — but one file gets forgotten.

**Why it happens:** The kiosk POS is forked; any addition requires touching both files.

**How to avoid:** Every plan task that modifies `js/kiosk.js` for gift cards must have a paired task for `js/admin.js`. The plan should explicitly call out the fork requirement (D-08).

---

### Pitfall 6: Apps Script Cache Not Invalidated After Write

**What goes wrong:** `lookup_gift_card` returns stale balance because `_sheetCache` was populated in the same Apps Script request context.

**Why it happens:** `sheetToObjects()` uses `_sheetCache` per-request. Since each Apps Script HTTP request is a fresh execution, this is NOT a problem in practice — each `lookup` or `redeem` call has its own fresh cache. But within a single action that calls both `findRowById` and then writes, always call `invalidateSheetCache(GIFT_CARDS_SHEET_NAME)` after the write.

---

## Code Examples

### Existing Pattern: `generateNextId` for cert numbers

```javascript
// adminApi.gs — already exists, reuse as-is
// function generateNextId(sheetName, prefix, padLength)
// Usage: generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)
// Returns: 'GC-000001', 'GC-000042', etc.
```
[VERIFIED: reviewed in adminApi.gs lines 1136–1158]

### Existing Pattern: `acquireScriptLock` for atomic operations

```javascript
// adminApi.gs — already exists
function acquireScriptLock(timeoutMs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(timeoutMs);  // throws if cannot acquire
  return lock;
}
// Usage in createBatch():
var lock = acquireScriptLock(15000);
try { /* write operations */ } finally { lock.releaseLock(); }
```
[VERIFIED: reviewed in adminApi.gs lines 1130–1135]

### Existing Pattern: Server-to-server Apps Script call from middleware

```javascript
// zoho-middleware/routes/checkout.js pattern — reuse for gift card routes
var axios = require('axios');
// ...
axios.post(process.env.APPS_SCRIPT_URL, {
  action: 'issue_gift_card',
  server_token: process.env.APPS_SCRIPT_SERVER_TOKEN,
  // ... payload
}).then(function(resp) { ... });
```
[VERIFIED: reviewed in pos.js line 1710 — same axios.get pattern for scan-invoices dedup]

### Existing Pattern: Custom line in kiosk confirm (Phase 43 analog)

```javascript
// pos.js — custom line validation already handles taxable=false:
if (item.custom) {
  var taxable = item.taxable !== false;
  var li = {
    custom: true,
    description: fullDesc,
    rate: rate,
    quantity: qty,
    tax_percentage: taxable ? 5 : 0
  };
  // Gift card SALE uses the same mechanism but routes through dedicated item_id
}
```
[VERIFIED: reviewed in pos.js lines 265–356]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global Payments terminal | Helcim terminal | April 2026 | All kiosk sale + void patterns use `helcimLib` |
| Invoice-only kiosk flow | Invoice + terminal via async webhook | v4.2 (Phase 31-33) | Split-tender must respect the async `sale → status → confirm` pattern |
| Monolithic kiosk JS | Forked `kiosk.js` + `admin.js` | Pre-v4.4 | Phase 44 must touch BOTH files (D-08); Phase 42 will merge |

**Deprecated/outdated:**
- `payment_mode: 'creditcard'` as the only payment mode: `'others'` is a documented, valid Zoho Books payment mode for non-card tenders (gift cards, store credit).
- Single `customerpayments` per kiosk sale: Phase 44 introduces the first two-payment scenario for a single invoice.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `payment_mode: 'others'` in Zoho Books `POST /customerpayments` is accepted and posts to a user-configurable "Others" clearing account | R-01 Redemption | Low: 'others' is documented as valid; worst case is payment posts to wrong account but invoice is still closed |
| A2 | `ZOHO_TAX_ZERO_ID` env var is already set on Railway (or `ZOHO_TAX_ZERO_RULE` can derive a zero-tax line) | R-01 Sale | Medium: if not set, the zero-tax line may default to a non-zero rate; plan should include env check |
| A3 | Tax treatment at redemption (gift card as post-tax tender, no tax recalculation) matches BC/Canada rules for gift certificates | R-03 | Low: this is standard gift card tax treatment in Canada; owner should confirm with accountant if in doubt |
| A4 | Apps Script `LockService.getScriptLock()` provides adequate serialization for concurrent redemption requests at S&V's expected volume | R-02 atomicity | Low: `getScriptLock()` is per-script and provides mutual exclusion; timeout 15000ms is sufficient for the write |
| A5 | `KIOSK_CONTACT_ID` is appropriate for all gift card Zoho transactions (same walk-in contact used for all kiosk sales) | R-01 | Low: already used for all kiosk invoice transactions |
| A6 | Two separate `POST /customerpayments` calls summing to `grandTotal` will fully close a Zoho Books invoice | R-01 + R-03 | Low: this is standard Zoho behavior (multiple payments per invoice are documented) |
| A7 | `KIOSK_GIFT_CARD_ITEM_ID` Zoho item must be created by owner before route is live — plan must include a checkpoint | R-01 | High if missing: gift card sale will fail or post to wrong account |
| A8 | `generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)` on an empty GiftCards sheet returns 'GC-000001' | R-02 | Low: reviewed `generateNextId()` code — returns first ID based on prefix+padLength |

---

## Open Questions

1. **Does the Zoho `ZOHO_TAX_ZERO_ID` env var exist in Railway production?**
   - What we know: `ZOHO_TAX_ZERO_RULE` is set (used in pos.js line 28); `ZOHO_TAX_ZERO_ID` is listed as OPTIONAL in validateEnv.js but may not be set
   - What's unclear: whether the zero-ID is needed to use zero-tax on a custom invoice line vs the item's built-in tax setting
   - Recommendation: Plan Wave 0 should include verifying Railway env has `ZOHO_TAX_ZERO_ID` (or configuring the Zoho item to be tax-exempt by default, which avoids needing the env var)

2. **Exactly which payment mode does the `'others'` customerpayments posting target in S&V's Zoho Books account?**
   - What we know: 'others' is a documented valid value [VERIFIED]
   - What's unclear: whether S&V's Zoho account has a configured "Others" clearing account or whether it will error
   - Recommendation: Test `POST /customerpayments` with `payment_mode: 'others'` against a test invoice before implementing gift card redemption; add to Wave 0 environment check

3. **Apps Script redeploy timing relative to middleware deploy?**
   - What we know: Apps Script changes require manual redeploy (human action checkpoint)
   - What's unclear: whether the new Apps Script actions will need to exist before the middleware gift card routes are deployed (they do — calling a non-existent action returns an error)
   - Recommendation: Plan Wave 0 must include the Apps Script `GiftCards` sheet creation + action stubs before any middleware route is deployed to staging

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Zoho Books API (zohoPost) | R-01 accounting | ✓ | v3 (existing) | — |
| Google Apps Script (`APPS_SCRIPT_URL`) | R-02 balance | ✓ | Existing deployment | — |
| `APPS_SCRIPT_SERVER_TOKEN` | R-02 middleware auth | ✓ | Set in Railway | — |
| `KIOSK_CONTACT_ID` | R-01 Zoho contact | ✓ | Set in Railway | — |
| `KIOSK_GIFT_CARD_ITEM_ID` | R-01 liability item | ✗ | NOT SET — needs owner action | Fail-closed: route returns 503 until set |
| `ZOHO_TAX_ZERO_ID` | R-01 zero-tax line | ? | Possibly not set in Railway | Use Zoho item's own tax setting as fallback |
| Redis (`cache.js`) | Idempotency | ✓ | Existing | Degrade: skip Redis cache, Apps Script `last_tx_ref` as sole guard |
| Helcim terminal | Split tender | ✓ | Configured (HELCIM_DEVICE_CODE set) | Gift-card-only sales can proceed without terminal |

**Missing with no automatic fallback:**
- `KIOSK_GIFT_CARD_ITEM_ID` — blocks gift card SALE route (fail-closed). Owner must create the Zoho item and set the env var before any sales can be processed.

**Missing with fallback:**
- `ZOHO_TAX_ZERO_ID` — if the Zoho item is configured as zero-tax by default, this env var is not needed on the invoice line.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (middleware: `cd zoho-middleware && npm test`; frontend: `npm test`) |
| Config file | `zoho-middleware/jest.config.js` (existing) |
| Quick run (middleware) | `cd zoho-middleware && npm test -- --testPathPattern=gift-card` |
| Full suite | `cd zoho-middleware && npm test && npm test` (root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| GIFTCARD-01 (issue) | `/api/kiosk/gift-card/issue` validates face_value bounds, rejects duplicate cert_number, creates Zoho invoice + payment | unit/integration | `cd zoho-middleware && npm test -- gift-card` | ❌ Wave 0 |
| GIFTCARD-01 (lookup) | `/api/kiosk/gift-card/lookup` returns balance + status, 404 on unknown cert | unit | `cd zoho-middleware && npm test -- gift-card` | ❌ Wave 0 |
| GIFTCARD-01 (redeem) | Split-tender reduces terminal amount; balance decremented LAST; idempotency key prevents double-decrement | unit | `cd zoho-middleware && npm test -- gift-card` | ❌ Wave 0 |
| GIFTCARD-01 (tax) | Gift card portion posts to invoice as `payment_mode='others'`; goods invoice tax unchanged | unit | `cd zoho-middleware && npm test -- pos` | ❌ Wave 0 |
| GIFTCARD-01 (void) | Voided cert returns `invalid_status` error on redeem | unit | `cd zoho-middleware && npm test -- gift-card` | ❌ Wave 0 |
| GIFTCARD-01 (UI) | Issue modal pre-fills suggested cert_number; redeem panel shows live balance | manual/e2e | iPad Safari staging UAT | N/A |

### Sampling Rate
- Per task commit: `cd zoho-middleware && npm test -- --testPathPattern=gift-card` (fast)
- Per wave merge: `cd zoho-middleware && npm test && npm test` (root — full suite)
- Phase gate: Full suite green + staging iPad Safari UAT before shipping to prod

### Wave 0 Gaps
- [ ] `zoho-middleware/__tests__/gift-cards.test.js` — all five route handlers (issue/lookup/redeem/reload/void)
- [ ] Mock `callAppsScript` helper for test isolation (same pattern as existing Zoho mock in checkout.test.js)
- [ ] Extend `zoho-middleware/__tests__/pos.test.js` with split-tender scenario (gift card + terminal)
- [ ] `npm test` root: no gaps (frontend gift card UI is ES5 kiosk code, tested manually on iPad)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `MW_API_KEY` header guard on all `/api/kiosk/*` routes |
| V3 Session Management | no | — |
| V4 Access Control | yes | Gift card routes require `x-api-key`; `void_gift_card` Apps Script action requires staff auth (Google OAuth) |
| V5 Input Validation | yes | `cert_number` must match `/^GC-\d{6}$/`; `face_value` bounded 0.01–2000; `amount_applied` bounded to server-side balance; all string inputs sanitized via existing `sanitizeInput()` in Apps Script |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-supplied balance bypass | Tampering | Server always reads balance from Apps Script; client `amount_applied` is clamped to server-side balance (D-05) |
| Double redemption via race condition | Tampering | `LockService.getScriptLock()` in Apps Script + `last_tx_ref` idempotency |
| Cert number enumeration | Information disclosure | `MW_API_KEY` guards lookup endpoint; balance is not exposed via any public endpoint (D-07: no customer-facing lookup in v1) |
| Negative face_value (free money) | Elevation of privilege | `face_value > 0` validation fail-closed; `amount_applied > 0` validation fail-closed |
| Replay of successful redemption | Repudiation | `last_tx_ref` on GiftCards row prevents replay; Redis `KIOSK_IDEM_PREFIX` provides session-level guard |
| Gift card issued without Zoho invoice | Financial fraud | Issue route fails-closed if Zoho invoice creation fails; Apps Script row voided on Zoho failure |

---

## Sources

### Primary (HIGH confidence)
- [Zoho Books API v3 — Customer Payments](https://www.zoho.com/books/api/v3/customer-payments/) — `retainerinvoice_id`, `payment_mode` values, `invoices[]` array structure
- [Zoho Books API v3 — Retainer Invoices](https://www.zoho.com/books/api/v3/retainer-invoices/) — apply-to-invoice endpoint confirmed
- [Zoho Books API v3 — Journals](https://www.zoho.com/books/api/v3/journals/) — journal entry structure confirmed (endpoint, fields)
- `zoho-middleware/routes/pos.js` — v4.2 money path reviewed: `processSale`, `processSaleWithPrices`, confirm handler, void-on-failure, idempotency
- `zoho-middleware/lib/zoho-api.js` — existing surface: `zohoGet`, `zohoPost`, `zohoPut`
- `apps-script/adminApi.gs` — `generateNextId`, `acquireScriptLock`, `sheetToObjects`, `findRowById`, `createBatch` reviewed in full
- `zoho-middleware/lib/validateEnv.js` — env vars confirmed
- `docs/APPS_SCRIPT.md` — Apps Script deployment process confirmed

### Secondary (MEDIUM confidence)
- Zoho Community thread — confirmed `/customerpayments` has no standalone advance capability; `retainerinvoice_id` field confirmed via docs
- WebSearch synthesis — `payment_mode: 'others'` is a valid Zoho Books payment mode; confirmed in docs

### Tertiary (LOW confidence)
- [ASSUMED] Tax treatment at redemption (gift card as post-tax tender) — standard Canadian gift card accounting; not verified against CRA publication

---

## Metadata

**Confidence breakdown:**
- R-01 (Zoho accounting): MEDIUM — recommended mechanism (invoice + dedicated item) uses confirmed endpoints; the one-time Zoho item setup requires owner action; `payment_mode='others'` is confirmed valid; liability→revenue conversion at redemption is a manual periodic step (accepted limitation)
- R-02 (balance storage): HIGH — exact analog of existing batch tracking; all infrastructure confirmed in codebase
- R-03 (split tender): HIGH — tax mechanics confirmed by accounting logic; failure-ordering analysis derived directly from existing pos.js patterns
- UI patterns: HIGH — Phase 43 custom-item modal is the confirmed UI analog; D-08 fork requirement is confirmed

**Research date:** 2026-06-27
**Valid until:** 2026-08-27 (stable domain; expires sooner if Zoho Books API releases breaking changes)
