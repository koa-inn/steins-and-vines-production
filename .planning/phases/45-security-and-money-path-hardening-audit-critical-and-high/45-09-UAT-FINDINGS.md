# 45-09 Live-Card UAT — Findings

**Date:** 2026-06-30 (live controlled session, store closed)
**Surface:** standalone kiosk (kiosk.js) on the in-store iPad → prod Railway middleware → live Helcim terminal + Zoho
**Deploys made during the session:**
- `41f6462` — money-path waves (45-03/05/06/07/08 + FIX1/FIX2) to prod (image `sha256:4af2280c`)
- `51f3c64` — F1 fix (`current_balance`) to prod (image `sha256:b2c84eee`)

Test cert: **GC-000001** (paper). Test invoices: **INV-000127, INV-000128, INV-000129**.

---

## Findings

### F1 — Gift-card balance validation read the wrong field → 503 blocked ALL redemptions  ✅ FIXED
- **Severity:** High (money-path, prod-blocking)
- **Symptom (live):** every "Apply Gift Card" lookup at checkout returned `503 Gift card validation temporarily unavailable`.
- **Root cause:** 45-07 split-tender validation read `r.data.balance` from Apps Script `lookup_gift_card`, but the real response key is `r.data.current_balance` (proven by `gift-cards.test.js` and the live cert lookup). Lookup resolved to `state:'unavailable'` → prod fail-closed. The 45-07 unit mocks used the same fictional `balance` key, so code+tests agreed on a shape that never occurs in prod.
- **Locations:** `routes/pos.js:501` (sale), `:929` (confirm).
- **Fix:** commit **`51f3c64`** — read `current_balance` in both paths; added `T-FIELD` regression (RED→GREEN); corrected mis-mocked tests (`pos-giftcard.test.js` T1/T3/T2, `pos-money-defects.test.js` CR-02-C). Suite 1117 green, lint 0 errors. **Deployed + verified live** (redeem lookup now works).

### F2 — Auto-confirm did not recognize a successful terminal payment → forced manual-confirm (orphan-charge path)
- **Severity:** High (money-path) — UNRESOLVED
- **Symptom (live):** during the partial-redeem (Step 4a), the card **was charged** on the terminal, but the kiosk **did not auto-recognize** the approval. No invoice and no gift redemption were recorded — a live orphaned charge (real money taken, nothing booked). Recovered via the "Confirm Manually" fallback.
- **Backend state at the moment of the orphan (verified):** no new invoice; cert still $15 (redemption not yet recorded).
- **Recovery:** manual confirm (`confirmSale('manual-confirm')`, kiosk.js:3764 → `/api/kiosk/sale/confirm` with `transaction_id:'manual-confirm'`) created INV-000129 and redeemed the cert. Manual confirm is **books-only, no re-charge** (verified safe; idempotency hardening prevents a late auto-confirm from double-booking).
- **Open questions:** why did auto-confirm not surface the approval? terminal-polling/webhook timing, or a regression in the just-deployed money-path? Frequency unknown. The reconciliation backstop (45-08) would eventually sweep such an orphan, but it had not yet.
- **Note:** `transaction_id` was recorded as the literal `"manual-confirm"`, so the Zoho payment does NOT carry the real Helcim txn id — reconciliation cosmetic gap.

#### ROOT CAUSE — investigated 2026-07-01 (Railway logs)
**Finding: premature manual-confirm race, NOT a broken webhook/poll.** The auto-confirm infra is healthy; the 15s "Confirm Manually" button appears ~6s *before* a normal card-present approval completes, inviting staff to preempt it.

**Evidence & limitation:** INV-000129's own logs have rotated out — the session made 3 deploys (money-path, F1, F3), each restarting the container (`railway logs` only tails the *current* deployment; earliest retained line is the 22:00:36Z restart). So the F2 transaction itself is not directly reproducible from logs. But a **same-session, same-code-path** card sale IS retained and is decisive:

`KIOSK-1782857853344` → **INV-000130** ($191.10, standalone kiosk, prod image after F3):
- `22:17:35.009` push to terminal
- polls every 3s → `pending` through `22:17:53`
- `22:17:56.676` poll #7 flips `304→200` = **`approved` via the direct `/card-transactions?invoiceNumber=` API-poll fallback** (~21.7s after push)
- `22:17:57.727` **auto-confirm** created INV-000130 with the real txn id
- `22:17:58.638` webhook APPROVED `txn=50808404` arrived *after* (redundant) — poll had already won

So: (a) the API-poll + webhook paths both work; (b) **no `401/403`/"token missing read scope" errors** in-window (rules out the Helcim read-scope hypothesis); (c) a real approval legitimately took **~21s**, but the manual-confirm button is enabled at **15s** (`kiosk.js:3748`), i.e. it was on screen for ~6s while the charge was still legitimately processing. In the 4a redemption, staff (watching the terminal approve) tapped that already-visible button → `confirmSale('manual-confirm')` fired before the poll/webhook surfaced the approval → books-only confirm with no real Helcim id. At the instant of the tap it looked like an orphan (charge on terminal, nothing booked yet); the manual confirm then booked it.

**Severity re-assessment:** downgrade from "orphan charge (lost money)" → **UX timing race + txn-id fidelity gap**. Money was never actually lost (manual-confirm recovered it same-second); the durable defect is the missing real txn id + the latent risk that manual-confirm books a card payment *without server-side proof a charge occurred*.

**Latent risk exposed:** the `/confirm` handler treats `transaction_id` as opaque (`txnId = body.transaction_id || 'manual-confirm'`, `pos.js:864`) and records the card payment regardless — it never re-verifies against Helcim. If staff mis-tap manual-confirm when **no** charge happened, it books an uncharged invoice as paid (phantom-revenue class, same family as G-44-01).

**Fix — IMPLEMENTED 2026-07-01 (A + B, owner-approved), code-complete, NOT yet committed/deployed:**
- **A (frontend, `js/kiosk.js`):** the manual-confirm reveal timer changed `15000` → `POLL_TIMEOUT_MS` (45s), so the button no longer appears while a normal ~21s approval is still processing. Auto-confirm wins first; the button still surfaces at 45s for the genuine stall / failed-initial-POST case. Rebuilt `kiosk.min.js`.
- **B (backend, `zoho-middleware/routes/pos.js`):** `/api/kiosk/sale/confirm` now verifies before booking. When the confirm carries no real terminal id (`transaction_id` absent or `'manual-confirm'`) AND a card amount is owed, it calls `helcimLib.pollTerminalResult(reference_number)`:
  - approved → book with the **real Helcim txn id** (fixes the id-fidelity gap; the creditcard `customerpayment.reference_number` now carries the real id).
  - declined/cancelled → **400, nothing booked** ("do not re-charge").
  - pending/unverifiable → **409 fail-closed, nothing booked** ("will be reconciled automatically — do NOT re-charge"); the 45-08 sweep settles a genuinely-orphaned real charge. A real txn id (auto-confirm) is trusted and skips the lookup (no added latency).
- **Regression tests:** `pos-money-defects.test.js` → F2-A (books real id), F2-B (declined→400 no invoice), F2-C (pending→409 no invoice), F2-D (real id trusted, poll not called). RED→GREEN. Full suites green (mw 1122, fe 928), lint 0 errors.
- **Known limitation (accepted):** on a 409/400 fail-closed, the confirm idempotency lock is not released (matches existing confirm-failure behaviour), so an immediate staff retry may get a `409 contention` — acceptable given the "do not re-charge, reconciliation will settle" stance.

#### ✅ DEPLOYED + LIVE-VERIFIED 2026-07-02 (all three paths)
Deployed as `d8bf965` (backend) + `e029108` (frontend), pushed at `211ad6e` (staging + prod Pages `v=mr2fiih7`; Railway deployment `b8aebdca`, container `4833df8e9f8f`).
1. **Auto-confirm (healthy path):** $1 exempt custom sale → webhook APPROVED `txn=50913349` at ~10s → auto-confirm booked **INV-000131** with the real id in ~12s; manual button never appeared.
2. **Manual-confirm, no charge (fail-closed):** sale pushed, card never tapped, button appeared at ~45s (not 15s), tap → server `409`, **nothing booked** in Zoho.
3. **Manual-confirm, real charge (slow-customer):** sale pushed, card tapped ~47s later (`txn=50915774` APPROVED), manual confirm → server log `pollTerminalResult: webhook cache hit` → booked **INV-000134** with payment `reference_number: 50915774` (**real Helcim id**, verified in Zoho payment #135).

### F3 — Exempt custom line is default-taxed by Zoho (no zero-rate exemption sent) → phantom GST + partial-paid invoice  ✅ FIXED
- **Severity:** High (accounting integrity, GST mis-statement) — ✅ FIXED commit `97e8124`, deployed (image `sha256:5ec14723`); `ZOHO_TAX_ZERO_ID=109900000000014433` set in Railway. Definitive end-to-end check = next exempt custom-line sale books `tax_total:0` (verify on UAT resume).
- **Symptom (live):** a custom line marked **tax-exempt** (no tax shown on the kiosk) produced **INV-000129 = $10.50** (line booked taxable, GST $0.50), while only **$10.00** was tendered ($5 gift + $5 card) → invoice left **`partially_paid`, balance $0.50**. The customer's money was correct ($10 for an intended $10 exempt item); Zoho added GST that should not exist.
- **Proven (arithmetic):** `/sale` treated the line **exempt** (card $5 = `grandTotal − gift`; `grandTotal = subtotal + taxTotal`, pos.js:445; gift $5 ⇒ grandTotal $10 ⇒ taxTotal 0). So `/sale` received and honored `taxable:false`.
- **ROOT CAUSE (confirmed by code):** the kiosk sends the **same `items` array** to both calls (`standardSaleBody.items = items` at kiosk.js:3527 and `confirmSale` sends `items: items` at 3630), so `taxable:false` reaches `/confirm` too. `/confirm` builds the exempt custom line as `{ custom, description, rate, quantity, tax_percentage: 0 }` with **NO `tax_id` and NO `tax_exemption_id`** (pos.js:797-806; `tax_id` is set *only* when taxable). A custom line has **no backing Zoho item**, so — unlike gift-cert lines, which ride `KIOSK_GIFT_CARD_ITEM_ID` and inherit its EXEMPT setting (decision 44-01) — there is nothing telling Zoho the line is zero-rated. **Zoho applies the org's default GST** to the un-tagged line. The middleware's internal sale math is exempt (terminal charge correct), but the Zoho *invoice* is default-taxed.
  - The codebase already has the intended mechanism — env `ZOHO_TAX_ZERO_ID` (zero-rate tax) — but it is **never applied to custom lines** (`grep ZOHO_TAX_ZERO_ID routes/pos.js` → none) **and is not set in the prod `.env`**. The available EXEMPT exemption id (seen on gift-cert lines) is `109900000000014414`.
- **Blast radius:** **ALL exempt custom-line sales** (both auto-confirm and manual-confirm use the same `/confirm` line builder) — NOT manual-confirm-only, and **independent of F2**. Every exempt custom-line invoice is left partially-paid and **overstates GST collected**.
- **Pre-existing:** this is a **Phase 43 custom-line defect** (exempt path never wired a Zoho exemption), surfaced by this UAT — **not** a Phase 45 regression.
- **Fix direction:** for `taxable === false` custom lines, send an explicit zero-rate to Zoho — either `tax_id: ZOHO_TAX_ZERO_ID` (set the env to the org's 0% tax) or attach the EXEMPT `tax_exemption_id`. Add a confirm-path regression asserting an exempt custom line books `tax_total: 0`. Confirm against live Zoho with one throwaway probe invoice before/after.

### F4 — Cart inventory re-sync forces staff out of the payment screen on (nearly) every sale  📝 UX (owner-reported)
- **Severity:** Medium (UX friction, reported as "happens pretty much every sale")
- **Symptom:** going to pay, an error appears requiring the cart "reload" button (appears to be an inventory/catalog sync); staff must leave the payment screen, return to cart, wait for a slow reload, and redo all the steps to payment.
- **Pointer:** `js/kiosk.js:1388 kioskLoadProducts(forceRefresh)` + catalog cache (`_kioskCatalogLoaded`, line 756/928).
- **Asks:** preload/refresh the catalog ahead of checkout, allow pay without a blocking re-sync, or otherwise streamline this sticking point.
- **Status:** ✅ filed as **issue #108** (https://github.com/koa-inn/steins-and-vines-staging/issues/108), labels `type:ux` + `type:performance`. (Env `GH_TOKEN` in ~/.zshrc:16 is invalid and shadows valid keychain creds — used `env -u GH_TOKEN gh` per the existing `sv-issues` workaround. Consider removing/refreshing the stale token in ~/.zshrc.)

### F5 — Helcim refund webhooks are indistinguishable from purchases in our logs  📝 observability note (2026-07-02)
- During the resume session, four `cardTransaction … status=APPROVED` webhooks (txns 50913643/50913672/50913693/50913770) appeared carrying June-30 and Test-1 invoice references — initially read as unexplained charges. They were the **owner's Helcim-dashboard refunds** of earlier test charges: a refund is its own cardTransaction (new txn id, same invoiceNumber) and the webhook resolver never surfaces the transaction *type*. No defect, no money impact, and reconcile no-opped them correctly (their pending records were already settled) — but logs cannot distinguish refund from purchase, which cost real investigation time. Follow-up: log the txn `type` in `[webhook/helcim] cardTransaction:` lines.

### F6 — Double-tap on "Proceed to Terminal" falls through to the control underneath  📝 UX (2026-07-02)
- **Symptom (live):** during the step-8 double-tap probe, the first tap hid the button (good — that guard works) but the **second tap landed on the button that renders in the same position** ("back to cart"), yanking staff off the payment screen while a terminal request was live.
- **No money impact** (the pending terminal request stayed valid; idempotency held), but same family as F4: staff gets bounced off the payment flow. Fix idea: brief tap-shield/disabled overlay during the payment-view transition.

### F7 — Admin gift-card management modal completely non-functional (lookup + void)  ✅ FIXED `f057094` (2026-07-02)
- **Severity:** High (feature-dead — UAT step 5 was unexecutable from admin)
- **Symptom (live):** looking up GC-000001 in the admin management modal → "Connection error. Please check your connection and try again."
- **Root cause (three independent defects in the kgcm modal, `js/admin.js`):**
  1. Read `SHEETS_CONFIG.MW_URL`, which does not exist (the key is `MIDDLEWARE_URL`) → lookup AND void fetched relative to the static Pages host.
  2. Read lookup fields one level too shallow (`result.data.X` instead of `result.data.data.X`).
  3. Used `balance` instead of the contract's `current_balance` — the same field-name defect family as F1, and the same lesson: the modal was never exercised against the real response contract.
- **Fix:** route through the existing `kioskMwUrl()` helper + consume the nested contract kiosk.js uses. Regression `tests/frontend/admin-gift-card-mgmt.test.js` (3 tests, RED→GREEN, mock mirrors the real contract per the F1 lesson). Frontend suite 931 green, lint 0 errors. Deployed to staging+prod (`admin.min.js?v=mr3v5go3`) and **live-verified**: lookup rendered real status/balance; void succeeded (`kiosk.gift_card_voided GC-000001`).

---

## UAT step status

| Step | What | Result |
|------|------|--------|
| 1 | Issue cert (cart+terminal) | ✅ PASS — INV-000127 $10, Gift Card Sales liability, **no tax at sale**, cert active |
| 2 | Balance lookup | ✅ PASS — $10 (and surfaced the read path works) |
| 3 | Reload (cart+terminal) | ✅ PASS — INV-000128 $5, liability, no tax, balance $10→$15 |
| 4a | Partial redeem (split tender) | ⚠️ Redemption booked (cert $15→$10, $5 redeemed) BUT surfaced **F2** (orphan/manual-confirm) and **F3** (exempt→taxable, $0.50 phantom) |
| 4b | Full redeem (terminal skipped) | ✅ PASS (2026-07-02) — $2 exempt custom, `gift_card_only` path, terminal never woke; INV-000132 paid via $2 `others` payment to the clearing account; balance $10→$8 |
| 5 | Void certificate | ✅ PASS (2026-07-02, after F7 fix) — GC-000001 voided with reason, `kiosk.gift_card_voided` logged |
| 6 | Over-balance clamp | ✅ PASS (2026-07-02) — $10 sale, attempted $20 apply → server clamped to real $8 (`gift_card=$8.00`), terminal charged $2 (`txn=50914850`); INV-000133 paid by $8 GC + $2 card; balance $8→$0 |
| 7 | Redeem-failure → needs_manual_review | ✅ COVERED BY TEST — not safely reproducible on live money; regression suite covers forced Apps Script failure → `needs_manual_review` |
| 8 | Double-tap idempotency | ✅ PASS (2026-07-02) — UI hides the button on first tap; a same-key duplicate POST fired at the live server was answered in 15ms by `money-path Idempotent replay` (no second terminal push). Surfaced F6 (tap-through) |

**2026-07-02 resume session additions:** F2 + F3 live-verified (see F2 resolution block; F3: INV-000131 booked the exempt custom line with `Zero Rate (0%)` tax_id, `tax_total: 0`). Accounting spot-check: Gift Card Sales (income) $15 = issue+reload; Gift Card Redemptions (cash-type clearing) $15 = $5+$2+$8 redeemed; consistent with the D-04 manual-deferral design. **UAT COMPLETE.**

---

## Cleanup owed (test transactions on owner's own card)

**Card side (Helcim):**
- ✅ Refunded by owner 2026-07-02: June-30 charges ($10 issue, $5 reload, $5 redeem) + Test-1 $1 (the four F5 refund webhooks).
- ⏳ Still to refund: **$2** (step 6, `txn=50914850`) + **$1** (step 8/manual-confirm, `txn=50915774`) = **$3**.

**Zoho side (all WALK IN, 2026-06-30 + 2026-07-02):**
- Reverse/void: **INV-000127** $10, **INV-000128** $5, **INV-000129** $10.50 partially_paid (the $0.50 F3 phantom clears with it), **INV-000131** $1 (card already refunded), **INV-000132** $2, **INV-000133** $10, **INV-000134** $1 — with their customerpayments (#131–135 + June 30's). Note Zoho requires deleting/refunding a payment before voiding its invoice.
- The Gift Card Sales ($15) and Gift Card Redemptions ($15) account balances unwind as those invoices/payments are reversed.
- Cert **GC-000001 is voided** (was $0 balance). GiftCards sheet retains the audit trail.
- Dismiss the reconcile-sweep `needs_manual_review` flag for `KIOSK-1783016597951` (Test 2's cancelled, never-charged $1 — false alarm; alert email may have been sent).

---

## Follow-ups (non-blocking, post-phase)

1. **F6** — tap-shield during payment-view transition (file as issue; F4 family).
2. **F5** — log Helcim txn `type` in webhook lines so refunds are distinguishable from purchases.
3. Invoice notes say "In-store kiosk sale (manual confirm)" for EVERY kiosk sale (`pos.js:867` hardcoded) — now misleading since paths are distinguished.
4. `kiosk.sale_completed` event logs `txnId="manual-confirm"` for gift-card-only sales (no terminal txn exists — label should be `gift-card-only`/null).
5. Void route returns 500 (not 409) for already-voided certs — the modal's 409 "already voided" branch is dead code.
6. Reconcile sweep flags terminal-**cancelled** references as POTENTIAL ORPHAN even though the cancel is in the webhook cache — could consume the cached cancel and skip the false alarm.

---

## Disposition

- **F1:** ✅ done (fixed `51f3c64`, deployed, verified live).
- **F2:** ✅ done (fixed `d8bf965`+`e029108`, deployed `211ad6e`, live-verified on all three confirm paths 2026-07-02).
- **F3:** ✅ done (fixed `97e8124`, deployed, live-verified: INV-000131 `tax_total:0` with Zero Rate tax_id).
- **F4:** ✅ filed as issue #108.
- **F5:** observability note; follow-up item.
- **F6:** UX; to file as issue (F4 family).
- **F7:** ✅ done (fixed `f057094`, deployed, live-verified: lookup + void working from admin).
- **All 8 UAT steps pass (7 = covered-by-test). 45-09 live-card UAT COMPLETE 2026-07-02.**
