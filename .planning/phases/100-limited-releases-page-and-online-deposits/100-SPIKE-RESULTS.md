# Phase 100 Spike Results (Wave 0, D-16)

Run: 2026-10-29 on the staging middleware container (live Zoho org, live Helcim account), script
`zoho-middleware/scripts/spike-limited-release-advance.js --zoho` (commit 1db398fa). Throwaway contact "ZZ Spike LR",
kit item RQ27 Ember (109900000001719001, stock 0, 0% tax), reference "LIMITED-SPIKE".

## LV1 - advance exists after salesorders_to_apply?

Observed: `POST /customerpayments` with `salesorders_to_apply:[{salesorder_id, amount_applied:50}]` succeeds (HTTP 200).
`GET /customerpayments/{id}` shows `amount: 50`, `unused_amount: 50`, `invoices: []`. The payment has NO sales-order
linkage field at all (no key matching `salesorder`/`order`; keys include `customer_advance_account_id`,
`description`, `reference_number`, `payment_status`, `settlement_status`, `last_four_digits`).
Consequence: the advance exists as customer unused credit (good, Plan A viable), but `salesorders_to_apply` has no
visible effect and the payment is NOT linked to the SO. The link between SO and deposit must be carried by our own
`description` text (see Deposit lookup). Owner should know the SO shows no deposit in Zoho's UI until invoiced and credited.

## LV2 - does the SO change after the payment?

Observed: No. SO-A (draft) and SO-B (open) both keep `balance: 282.85` (= total), `paid_status: ""` / `"unpaid"`,
`invoiced_status: ""` / `"not_invoiced"`. No payments/advance field on the SO. Consequence: kiosk and admin lists
cannot show "deposit paid" from the SO; Plans 08/09 need the preview from our own lookup (find payment by description,
read `unused_amount`).

## LV3 - does invoice conversion auto-apply the advance?

Observed: No. After `ensureOpenInvoiceForSalesOrder(SO-B)`: invoice status `sent`, `balance_due: 282.85`,
`payment_made: 0`; payment B still `unused_amount: 50`. Consequence: the credit step is mandatory (not a no-op); the
re-read `unused_amount` guard is still right for idempotency.

## LV4 - does POST /invoices/{id}/credits apply the payment?

Observed: Yes. Body `{invoice_payments:[{payment_id, amount_applied:50}]}` returned "Credits have been applied to the
invoice(s)." Re-read: invoice `balance_due: 232.85`, `payment_made: 50`, `status: partially_paid`; payment `unused_amount: 0`
with `invoices:[{invoice_number, invoice_id, amount_applied:50, balance:232.85}]`. Core of D-02 confirmed.

## LV5 - stock-0 item SO and payment against draft / confirmed SO

Observed: SO creation with the stock-0 Ember item succeeds. Payment accepted against both a draft SO (SO-A) and a confirmed SO
(SO-B, status `open` after `/status/confirmed`). Note the create response reports `status: "draft"` even before the confirm call.

## LV6 - description, notes, reference_number, search

- description persisted: yes (`LIMITED-SPIKE deposit SO-000082`).
- notes persisted: no (no `notes` key on `GET /customerpayments/{id}` or in list rows). Do not rely on notes.
- duplicate reference_number accepted: yes (second payment with the same `reference_number` created without error).
- `GET /customerpayments?search_text=<SO number>` returned exactly the one payment whose description contained that SO
  number (count 1, correct id). `GET /customerpayments?customer_id=...&description_contains=LIMITED-SPIKE` returned all 3.

## LV7 - list rows include unused_amount?

Observed: Yes. List rows include `unused_amount`, `bcy_unused_amount`, `description`, `reference_number`,
`applied_invoices`, `invoice_numbers`, `gateway_transaction_id`, `payment_gateway`, `payment_status`. No per-candidate
GET is needed to read `unused_amount`.

## LV8 - delete / void ordering

Observed:
- `DELETE /customerpayments/{id}` works for an unused payment AND for a payment already applied to an invoice via /credits.
- `DELETE /salesorders/{id}` works directly on draft SOs (no void step needed). SO-A and SO-C were deleted directly after their
  payments were deleted.
- An SO that has been converted to an invoice cannot be voided ("Invoiced sales order cannot be marked void", code 36009);
  the invoice must be removed first.
- An invoice with a credit applied cannot be voided or deleted ("You cannot void a paid invoice. Delete the recorded payment and try
  again", code 4001). Order that works: delete payment, then `POST /invoices/{id}/status/void`, then `DELETE /invoices/{id}`, then
  `DELETE /salesorders/{id}`, then `DELETE /contacts/{id}` (contact delete is refused while documents exist, code 3000, and succeeds
  once they are gone).
- Not exercised: deleting an SO while its deposit payment still exists (payments were deleted first). Plans 05/07/13 should delete the
  deposit payment first, then the SO.

## LV9 - omitted rate on a kit line

Observed: Yes. SO-C (Ember line with no `rate`) defaulted to `rate: 230`, `tax_id` 109900000000014433, `tax_percentage: 0`.
Fee lines: Maker's fee 45 at 5%, Materials fee 5 at 12%. Total 282.85. Explicit rate remains safest, but omission works.

## LV10 - multi-entry salesorders_to_apply

Observed: No. Two entries rejected with HTTP 400, code 15: `Please ensure that the "salesorders_to_apply" has less than 100
characters.` Given LV1 (field has no linking effect anyway), use one payment per SO.

## LV11 - HelcimPay invoiceRequest.invoiceNumber propagation

propagates: yes

Run 2026-10-29T21:50:15Z from the staging container (`--helcim-init --amount 1.00`), then paid by the owner ($1.00, card type AX).
Helcim transaction id 57428079, status APPROVED, type purchase, amount 1, CAD. Nonce sent: `LR-SPIKE-2bd2028e`.

- Accepted initialize body form: `invoiceRequest { invoiceNumber, lineItems[...] }`. A top-level `invoiceNumber` is rejected
  with 400 "Invalid Invoice Number". An `invoiceRequest` without `lineItems` is also rejected with 400. `lineItems` is therefore
  REQUIRED whenever `invoiceRequest` is sent (fix in spike script: commit d236e357).
- Readback field: `invoiceNumber`, top-level on `GET card-transaction` (`getCardTransactionById(57428079)` returned
  `{"status":"APPROVED","transactionId":57428079,"invoiceNumber":"LR-SPIKE-2bd2028e","cardType":"AX","amount":1,"type":"purchase"}`).
- postMessage SUCCESS payload: `eventMessage.data.data.invoiceNumber = "LR-SPIKE-2bd2028e"` (also transactionId, status, type, amount).
- Void: `--helcim-void 57428079` returned `{"ok":true,"transactionId":"57428079","status":"APPROVED"}` (accepted).

Consequence: the D-17 nonce binding works as designed. Plans 06, 07 and 12 are unblocked.

### Plan 06 Task 0 requirement (lib/helcim.js)

`zoho-middleware/lib/helcim.js` `initializeCheckout` (lines ~109-125) currently sets
`body.invoiceRequest = { invoiceNumber: opts.invoiceNumber }` ONLY. It does NOT include `lineItems` (grep for `lineItems` in the file
returns nothing). Helcim rejects that with 400, so Plan 06 Task 0 MUST change lib/helcim.js to send `invoiceRequest` WITH `lineItems`
(at least one item: description, quantity, price, total, e.g. a single "Limited release deposit" line equal to the amount) and add a
unit test asserting the body shape. Do not send a top-level `invoiceNumber`.

### Harness note (for Plan 13)

The planned localhost harness (http://localhost:8765 parent) did NOT work: Chrome rendered a broken-frame page for the Helcim iframe
(Helcim responded 200 with no frame-ancestors/X-Frame-Options; cause unconfirmed). The first checkout token (LR-SPIKE-0fec4eee) expired
unused and was never charged. Workaround: the orchestrator injected start.js + appendHelcimPayIframe at runtime (DevTools-style; nothing
committed or deployed) into https://staging.steinsandvines.ca/robots.txt (staging origin, no CSP meta); a second init was then paid.
Opening the Helcim pay URL top-level renders blank. Staging deposits in Plan 13 run from the real page, so no harness is needed.

### Ops note (RUNBOOK / Plan 13)

In the staging container the repo root is `/app` and the middleware is `/app/zoho-middleware`. Run scripts with
`railway ssh -e staging -s sv_middleware -- sh -c 'cd zoho-middleware && node scripts/...'` (service name `sv_middleware`, underscore).

## Confirmed endpoints

| Operation | Endpoint | Result |
|-----------|----------|--------|
| Create SO | `POST /salesorders` | Confirmed |
| Confirm SO | `POST /salesorders/{id}/status/confirmed` | Confirmed |
| Delete draft SO | `DELETE /salesorders/{id}` | Confirmed |
| Void invoiced SO | `POST /salesorders/{id}/status/void` | Failed (36009) while invoiced; not needed |
| Create deposit payment | `POST /customerpayments` (description carries SO link) | Confirmed |
| Delete payment (unused or applied) | `DELETE /customerpayments/{id}` | Confirmed |
| Convert SO to invoice | `ensureOpenInvoiceForSalesOrder` | Confirmed (no auto-apply) |
| Apply advance | `POST /invoices/{id}/credits` body `{invoice_payments:[{payment_id, amount_applied}]}` | Confirmed |
| Void invoice | `POST /invoices/{id}/status/void` | Confirmed after payment deleted; Failed (4001) while credit applied |
| Delete invoice | `DELETE /invoices/{id}` | Confirmed after void |
| Delete contact | `DELETE /contacts/{id}` | Confirmed once no documents; refused (3000) otherwise |
| Mark contact inactive | `POST /contacts/{id}/inactive` | Confirmed (fallback) |
| List/search payments | `GET /customerpayments?customer_id=&search_text=&description_contains=` | Confirmed |

## Deposit lookup

Plan 05's `findDepositAdvanceForSalesOrder` must NOT rely on any SO linkage (none exists). Use
`GET /customerpayments?customer_id=<SO customer>&search_text=<SO number>` and then filter client-side on `description`
containing both the SO number and the marker (for example `LIMITED-DEPOSIT`) and `unused_amount > 0`. `unused_amount` is present
in the list rows (LV7), so no per-payment GET is needed except for a final re-read guard before `/credits`. Always write
`description` (not `notes`) as `<MARKER> deposit <SO number>`; put the Helcim transaction id in `reference_number` (duplicates
are accepted, so uniqueness is NOT enforced by Zoho and idempotency must be handled in our own code/Redis). One payment per SO.

## Cleanup ledger

| Id | Kind | Final state |
|----|------|-------------|
| 109900000001748002 | contact (ZZ Spike LR) | deleted (manual retry; first marked inactive by script) |
| 109900000001746002 | salesorder SO-000082 | deleted |
| 109900000001748009 | salesorder SO-000083 | deleted (manual retry after invoice removed) |
| 109900000001748017 | salesorder SO-000084 | deleted |
| 109900000001746019 | customerpayment | deleted |
| 109900000001746029 | customerpayment (applied via /credits) | deleted |
| 109900000001746039 | customerpayment (duplicate ref) | deleted |
| 109900000001748027 | invoice INV-000254 | voided, then deleted (manual retry after payment removed) |
| Helcim token LR-SPIKE-0fec4eee (ccf19214...) | checkout token | expired unused, never charged |
| Helcim txn 57428079 ($1.00, LR-SPIKE-2bd2028e) | card transaction | voided (void accepted) |
| Helcim customer CST1211 | Helcim customer record, auto-created by the charge | left in place (not removed; no PII recorded beyond the code) |

Manual retry: the script's cleanup ran the invoice step before its payment was deleted, so the invoice, SO-B and contact
needed a second pass from the container (void, delete invoice, delete SO-B, delete contact; all OK). Note that invoice number
INV-000254 and SO-000082..84 were consumed from the numbering sequences (gaps will show in the books).

## Go/no-go

Go/no-go: Plan A - owner confirmed 2026-10-29. The advance exists with `unused_amount = 50` and
`/invoices/{id}/credits` applies it; LV11 propagates: yes. Caveat acknowledged: `salesorders_to_apply` does not link the payment to the
SO or change the SO, so the deposit is found by `description` text, not by Zoho linkage. The credit is not auto-applied at conversion (LV3).
